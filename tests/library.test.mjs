import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
let vite
let parseLibraryImport
let countStatuses
let recentCompletions
let activityByMonth
let minutesWatched
let applyShelfFilters
let STATUS_IDS
let STARTING_STATUS_IDS
let statusesForMediaType
let statusTransition
let watchedAtAfterProgress
let advanceRewatch
let normalizeEntry
let progress
let loggedEpisodeCount
let countShowRewatches
let originalCompletionAt
let lastActivityAt

before(async () => {
  vite = await createServer({
    configFile: false,
    root,
    appType: 'custom',
    server: { middlewareMode: true },
  })
  const library = await vite.ssrLoadModule('/src/lib/library.ts')
  const status = await vite.ssrLoadModule('/src/lib/status.ts')
  const shelf = await vite.ssrLoadModule('/src/components/Library.tsx')
  parseLibraryImport = library.parseLibraryImport
  normalizeEntry = library.normalizeEntry
  countStatuses = library.countStatuses
  countShowRewatches = library.countShowRewatches
  originalCompletionAt = library.originalCompletionAt
  lastActivityAt = library.lastActivityAt
  loggedEpisodeCount = library.loggedEpisodeCount
  progress = library.progress
  recentCompletions = library.recentCompletions
  activityByMonth = library.activityByMonth
  minutesWatched = library.minutesWatched
  applyShelfFilters = shelf.applyShelfFilters
  STATUS_IDS = status.STATUS_IDS
  STARTING_STATUS_IDS = status.STARTING_STATUS_IDS
  statusesForMediaType = status.statusesForMediaType
  statusTransition = status.statusTransition
  watchedAtAfterProgress = status.watchedAtAfterProgress
  advanceRewatch = status.advanceRewatch
})

after(async () => {
  await vite?.close()
})

const entry = (overrides = {}) => ({
  id: 1,
  mediaType: 'movie',
  title: 'A Film',
  year: '2001',
  poster: '/abc123.jpg',
  backdrop: null,
  rating: 6,
  status: 'watched',
  favorite: false,
  addedAt: 100,
  watchedAt: 200,
  runtime: 120,
  episodes: {},
  totalEpisodes: null,
  rewatches: [],
  rewatching: false,
  rewatchEpisodes: {},
  ...overrides,
})

test('JSON import validates entries and preserves existing curated data', () => {
  const current = entry({ rating: 9, favorite: true, episodes: { '1-1': 300 }, rewatches: [400], addedAt: 50 })
  const incoming = entry({
    rating: 3,
    favorite: false,
    poster: 'https://attacker.example/poster.jpg',
    episodes: { '1-2': 500 },
    rewatches: [600],
    addedAt: 100,
  })
  const added = entry({ id: 2, title: 'New title', poster: '/new.jpg' })
  const unsafeImage = entry({ id: 3, title: 'Imported title', status: 'dropped', poster: 'https://attacker.example/poster.jpg' })
  const result = parseLibraryImport(JSON.stringify([incoming, added, unsafeImage, { id: 0, mediaType: 'tv' }]), [current])

  assert.equal(result.imported, 2)
  assert.equal(result.combined, 1)
  assert.equal(result.skipped, 1)
  assert.equal(result.merged['movie:1'].rating, 9)
  assert.equal(result.merged['movie:1'].favorite, true)
  assert.deepEqual(result.merged['movie:1'].episodes, { '1-1': 300, '1-2': 500 })
  assert.deepEqual(result.merged['movie:1'].rewatches, [400, 600])
  assert.equal(result.merged['movie:1'].addedAt, 50)
  assert.equal(result.merged['movie:1'].poster, '/abc123.jpg')
  assert.equal(result.merged['movie:2'].title, 'New title')
  assert.equal(result.merged['movie:3'].status, 'planned')
  assert.equal(result.merged['movie:3'].poster, null)
})

test('Dropped is show-only and legacy movie records retain their other data', () => {
  const movie = normalizeEntry(entry({
    status: 'dropped',
    watchedAt: 200,
    rating: 9,
    favorite: true,
    note: 'Keep this note',
  }))
  assert.equal(movie.status, 'planned')
  assert.equal(movie.watchedAt, 200)
  assert.equal(movie.rating, 9)
  assert.equal(movie.favorite, true)
  assert.equal(movie.note, 'Keep this note')
  assert.deepEqual(statusesForMediaType('movie'), ['planned', 'watched'])
  assert.deepEqual(statusesForMediaType('tv'), STATUS_IDS)

  const show = entry({ mediaType: 'tv', status: 'dropped' })
  const rawDroppedMovie = entry({ id: 9, status: 'dropped' })
  assert.deepEqual(
    applyShelfFilters([show, rawDroppedMovie], { status: 'dropped', minRating: 0, query: '', sort: 'added' }).map((item) => item.mediaType),
    ['tv'],
  )
  assert.deepEqual(countStatuses([show, rawDroppedMovie]), { planned: 1, watching: 0, watched: 0, dropped: 1 })
})

test('Dropped is filterable, searchable, sortable, counted, and retains completion history', () => {
  const watchedAt = Date.now()
  const dropped = entry({
    id: 4,
    mediaType: 'tv',
    title: 'Quiet Exit',
    status: 'dropped',
    watchedAt,
    runtime: null,
    totalEpisodes: 10,
    episodes: { '1-1': watchedAt },
  })
  const watching = entry({ id: 5, mediaType: 'tv', title: 'Still Going', status: 'watching', watchedAt: null, addedAt: 200 })
  const planned = entry({ id: 6, title: 'Maybe Later', status: 'planned', watchedAt: null, addedAt: 300 })
  const entries = [dropped, watching, planned]

  assert.deepEqual(STATUS_IDS, ['planned', 'watching', 'watched', 'dropped'])
  assert.deepEqual(STARTING_STATUS_IDS, ['planned', 'watching'])
  assert.deepEqual(
    applyShelfFilters(entries, { status: 'dropped', minRating: 0, query: 'quiet', sort: 'added' }).map((item) => item.id),
    [4],
  )
  assert.deepEqual(
    applyShelfFilters(entries, { status: 'all', minRating: 0, query: '', sort: 'status' }).map((item) => item.status),
    ['planned', 'watching', 'dropped'],
  )
  assert.deepEqual(countStatuses(entries), { planned: 1, watching: 1, watched: 0, dropped: 1 })
  assert.equal(recentCompletions([dropped])[0].at, watchedAt)
  assert.equal(activityByMonth([dropped], 12).at(-1).count, 1)
  assert.equal(minutesWatched([dropped]), 42)
})

test('status transitions preserve history around Dropped and reset only on intentional restarts', () => {
  assert.deepEqual(statusTransition('watched', 'dropped', 500, 1000), {
    status: 'dropped',
    watchedAt: 500,
    clearEpisodes: false,
  })
  assert.deepEqual(statusTransition('dropped', 'watching', 500, 1000), {
    status: 'watching',
    watchedAt: 500,
    clearEpisodes: false,
  })
  assert.deepEqual(statusTransition('dropped', 'planned', 500, 1000), {
    status: 'planned',
    watchedAt: 500,
    clearEpisodes: false,
  })
  assert.deepEqual(statusTransition('watching', 'planned', 500, 1000), {
    status: 'planned',
    watchedAt: null,
    clearEpisodes: true,
  })
  assert.deepEqual(statusTransition('dropped', 'watched', null, 1000), {
    status: 'watched',
    watchedAt: 1000,
    clearEpisodes: false,
  })
  assert.equal(watchedAtAfterProgress('dropped', false, 500, 400, 1000), 500)
  assert.equal(watchedAtAfterProgress('dropped', true, 500, 900, 1000), 500)
  assert.equal(watchedAtAfterProgress('watching', false, 500, 400, 1000), null)
})

test('show rewatch progress remains separate and completion adds exactly one rewatch', () => {
  const original = entry({
    id: 7,
    mediaType: 'tv',
    title: 'A Finished Series',
    status: 'watched',
    watchedAt: 100,
    totalEpisodes: 2,
    episodes: { '1-1': 80, '1-2': 100 },
    rewatches: [200],
    rewatching: true,
  })
  const partial = {
    ...original,
    ...advanceRewatch(original, { '1-1': 300 }, original.totalEpisodes),
  }
  assert.equal(partial.rewatching, true)
  assert.deepEqual(partial.rewatchEpisodes, { '1-1': 300 })
  assert.equal(progress(partial), 0.5)
  assert.equal(originalCompletionAt(partial), 100)
  assert.equal(lastActivityAt(partial), 300)
  assert.deepEqual(partial.episodes, original.episodes)
  assert.equal(partial.watchedAt, original.watchedAt)
  assert.deepEqual(partial.rewatches, [200])

  const completed = {
    ...partial,
    ...advanceRewatch(partial, { ...partial.rewatchEpisodes, '1-2': 400 }, partial.totalEpisodes),
  }
  assert.equal(completed.status, 'watched')
  assert.equal(completed.rewatching, false)
  assert.deepEqual(completed.rewatchEpisodes, {})
  assert.deepEqual(completed.episodes, original.episodes)
  assert.equal(completed.watchedAt, original.watchedAt)
  assert.deepEqual(completed.rewatches, [200, 400])
  assert.equal(countShowRewatches([completed]), 2)
  assert.equal(loggedEpisodeCount(completed), 6)
  assert.equal(minutesWatched([completed]), 720)
  assert.equal(recentCompletions([completed]).filter((activity) => activity.label === 'Rewatch').length, 2)
  assert.deepEqual(advanceRewatch(completed, {}, completed.totalEpisodes).rewatches, [200, 400])

  const movie = normalizeEntry(entry({ rewatching: true, rewatchEpisodes: { '1-1': 500 } }))
  assert.equal(movie.rewatching, false)
  assert.deepEqual(movie.rewatchEpisodes, {})

  const inProgressShow = normalizeEntry(entry({ mediaType: 'tv', status: 'watching', rewatching: true, rewatchEpisodes: { '1-1': 500 } }))
  assert.equal(inProgressShow.rewatching, false)
})

test('Rewatching filter and text search include active shows only', () => {
  const active = entry({ id: 8, mediaType: 'tv', title: 'Active Series', rewatching: true, rewatchEpisodes: { '1-1': 300 } })
  const movie = entry({ id: 9, title: 'Movie Rewatch', rewatching: true, rewatchEpisodes: { '1-1': 300 } })
  const watched = entry({ id: 10, mediaType: 'tv', title: 'Finished Series' })
  const pool = [active, movie, watched]

  assert.deepEqual(
    applyShelfFilters(pool, { status: 'rewatching', minRating: 0, query: '', sort: 'added' }).map((item) => item.id),
    [8],
  )
  assert.deepEqual(
    applyShelfFilters(pool, { status: 'all', minRating: 0, query: 'rewatching', sort: 'added' }).map((item) => item.id),
    [8],
  )
})

test('library imports preserve original show history and merge active rewatch progress', () => {
  const original = entry({
    id: 12,
    mediaType: 'tv',
    status: 'watched',
    watchedAt: 100,
    totalEpisodes: 3,
    episodes: { '1-1': 80, '1-2': 100 },
  })
  const imported = entry({
    id: 12,
    mediaType: 'tv',
    status: 'watched',
    watchedAt: 200,
    totalEpisodes: 3,
    episodes: { '1-1': 200 },
    rewatching: true,
    rewatchEpisodes: { '1-1': 300 },
    rewatches: [300],
  })
  const result = parseLibraryImport(JSON.stringify([imported]), [original]).merged['tv:12']

  assert.equal(result.status, 'watched')
  assert.equal(result.watchedAt, 100)
  assert.deepEqual(result.episodes, { '1-1': 80, '1-2': 100 })
  assert.equal(result.rewatching, true)
  assert.deepEqual(result.rewatchEpisodes, { '1-1': 300 })
  assert.deepEqual(result.rewatches, [300])
})

test('rewatch history merges idempotently without collapsing same-time completions', () => {
  const current = entry({ id: 13, mediaType: 'tv', rewatches: [500, 500] })
  const imported = entry({ id: 13, mediaType: 'tv', rewatches: [500] })
  const firstMerge = parseLibraryImport(JSON.stringify([imported]), [current]).merged['tv:13']
  assert.deepEqual(firstMerge.rewatches, [500, 500])

  const repeatedExport = entry({ id: 13, mediaType: 'tv', rewatches: [500, 500] })
  const repeatedMerge = parseLibraryImport(JSON.stringify([repeatedExport]), [firstMerge]).merged['tv:13']
  assert.deepEqual(repeatedMerge.rewatches, [500, 500])
})

test('JSON import rejects malformed, oversized, and unsupported payloads', () => {
  assert.throws(() => parseLibraryImport('{'), /could not be read/)
  assert.throws(() => parseLibraryImport('{"titles":[]}'), /expected a list/)
  assert.throws(() => parseLibraryImport(' '.repeat(5 * 1024 * 1024 + 1)), /max 5 MB/)
  assert.throws(() => parseLibraryImport(JSON.stringify(Array(5001).fill(null)), []), /max 5000 titles/)
})
