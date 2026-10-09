import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
let vite
let parseLibraryImport

before(async () => {
  vite = await createServer({
    configFile: false,
    root,
    appType: 'custom',
    server: { middlewareMode: true },
  })
  ;({ parseLibraryImport } = await vite.ssrLoadModule('/src/lib/library.ts'))
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
  const unsafeImage = entry({ id: 3, title: 'Imported title', poster: 'https://attacker.example/poster.jpg' })
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
  assert.equal(result.merged['movie:3'].poster, null)
})

test('JSON import rejects malformed, oversized, and unsupported payloads', () => {
  assert.throws(() => parseLibraryImport('{'), /could not be read/)
  assert.throws(() => parseLibraryImport('{"titles":[]}'), /expected a list/)
  assert.throws(() => parseLibraryImport(' '.repeat(5 * 1024 * 1024 + 1)), /max 5 MB/)
  assert.throws(() => parseLibraryImport(JSON.stringify(Array(5001).fill(null)), []), /max 5000 titles/)
})
