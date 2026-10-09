import { useCallback, useSyncExternalStore } from 'react'
import type { MediaType, TmdbTitle } from './tmdb'
import { isSafeImagePath, titleOf, yearOf } from './tmdb'
import { currentSettings } from './settings'
import { setPersistenceState } from './persistence'
import { advanceRewatch, canSetDropped, MAX_REWATCHES, STATUS_IDS, watchedAtAfterProgress, type Status } from './status'
export type { Status } from './status'

export type Entry = {
  id: number
  mediaType: MediaType
  title: string
  year: string
  poster: string | null
  backdrop: string | null
  rating: number | null // personal 1–10
  status: Status
  favorite: boolean
  addedAt: number
  /** Movies: timestamp of the watch. */
  watchedAt: number | null
  runtime: number | null
  /** TV: "season-episode" → timestamp watched. */
  episodes: Record<string, number>
  totalEpisodes: number | null
  /** Timestamps of additional complete watch-throughs, beyond the first. */
  rewatches: number[]
  /** A TV rewatch is tracked separately from the original completed run. */
  rewatching: boolean
  rewatchEpisodes: Record<string, number>
  /** Retired: free-text notes were removed from the UI. Kept for back-compat. */
  note?: string
}

const LEGACY_STORAGE = 'archive.library.v1'
const LEGACY_CORRUPT_STORAGE = 'archive.library.v1.corrupt'
export const epKey = (s: number, e: number) => `${s}-${e}`
export const entryKey = (type: MediaType, id: number) => `${type}:${id}`

/** Hard bounds mirroring the server's truncations, so a crafted import can
 *  never persist a multi-MB title the UI then has to render. */
const MAX_TITLE_LEN = 200
const MAX_NOTE_LEN = 2000
const MAX_POSTER_LEN = 500
const MAX_BACKDROP_LEN = 500
const MAX_RUNTIME = 600
const MAX_TOTAL_EPISODES = 10000
const MAX_EPISODE_KEYS = 20000
const MAX_TIMESTAMP = 8_640_000_000_000_000

/** Map keys must be `movie:<id>` / `tv:<id>` — anything else (incl. __proto__
 *  style keys from crafted data) is dropped before it can touch the store. */
export function isSafeKey(key: unknown): key is string {
  if (typeof key !== 'string') return false
  const match = /^(movie|tv):(\d+)$/.exec(key)
  return !!match && Number.isSafeInteger(Number(match[2])) && Number(match[2]) > 0
}

function finiteOrNull(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

export function isValidTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= MAX_TIMESTAMP
}

/**
 * Bring a stored record up to the current shape in place: rename the
 * retired 'completed' status, coerce every scalar, and drop malformed episode
 * / rewatch timestamps — so one bad row can never crash a whole view.
 */
export function normalizeEntry(entry: Entry): Entry {
  if ((entry.status as string) === 'completed') entry.status = 'watched'
  if (!STATUS_IDS.includes(entry.status)) entry.status = 'planned'
  if (entry.mediaType !== 'movie' && entry.mediaType !== 'tv') entry.mediaType = 'movie'
  // Movies have no Dropped state. Keep every other field and move legacy
  // movie records to Planned so their existing data remains intact.
  if (entry.mediaType === 'movie' && entry.status === 'dropped') entry.status = 'planned'
  if (!Number.isSafeInteger(entry.id) || (entry.id as number) <= 0) entry.id = 0
  if (typeof entry.title !== 'string' || !entry.title) entry.title = 'Untitled'
  else entry.title = entry.title.slice(0, MAX_TITLE_LEN)
  if (typeof entry.year !== 'string') entry.year = ''
  else entry.year = entry.year.slice(0, 4)
  if (typeof entry.poster !== 'string' || entry.poster.length > MAX_POSTER_LEN || !isSafeImagePath(entry.poster)) entry.poster = null
  if (typeof entry.backdrop !== 'string' || entry.backdrop.length > MAX_BACKDROP_LEN || !isSafeImagePath(entry.backdrop)) entry.backdrop = null
  if (typeof entry.rating !== 'number' || !Number.isInteger(entry.rating) || entry.rating < 1 || entry.rating > 10) {
    entry.rating = null
  }
  entry.favorite = !!entry.favorite
  entry.addedAt = isValidTimestamp(entry.addedAt) ? entry.addedAt : Date.now()
  entry.watchedAt = isValidTimestamp(entry.watchedAt) ? entry.watchedAt : null
  const runtime = finiteOrNull(entry.runtime)
  entry.runtime = runtime == null ? null : Math.min(MAX_RUNTIME, Math.max(0, Math.floor(runtime)))
  const total = finiteOrNull(entry.totalEpisodes)
  entry.totalEpisodes = total == null ? null : Math.min(MAX_TOTAL_EPISODES, Math.max(0, Math.floor(total)))
  if (!entry.episodes || typeof entry.episodes !== 'object') entry.episodes = {}
  else {
    const keys = Object.keys(entry.episodes)
    for (const [k, v] of Object.entries(entry.episodes)) {
      if (!/^\d+-\d+$/.test(k) || !isValidTimestamp(v)) delete entry.episodes[k]
    }
    // Bound per-entry growth so one crafted row can't stall every commit.
    if (keys.length > MAX_EPISODE_KEYS) {
      const keep = new Set(keys.filter((k) => /^\d+-\d+$/.test(k)).slice(-MAX_EPISODE_KEYS))
      for (const k of Object.keys(entry.episodes)) if (!keep.has(k)) delete entry.episodes[k]
    }
  }
  if (!entry.rewatchEpisodes || typeof entry.rewatchEpisodes !== 'object' || Array.isArray(entry.rewatchEpisodes)) {
    entry.rewatchEpisodes = {}
  } else {
    for (const [k, v] of Object.entries(entry.rewatchEpisodes)) {
      if (!/^\d+-\d+$/.test(k) || !isValidTimestamp(v)) delete entry.rewatchEpisodes[k]
    }
    const keys = Object.keys(entry.rewatchEpisodes)
    if (keys.length > MAX_EPISODE_KEYS) {
      const keep = new Set(keys.slice(-MAX_EPISODE_KEYS))
      for (const k of keys) if (!keep.has(k)) delete entry.rewatchEpisodes[k]
    }
  }
  if (!Array.isArray(entry.rewatches)) entry.rewatches = []
  else entry.rewatches = entry.rewatches.filter(isValidTimestamp).slice(-MAX_REWATCHES)
  entry.rewatching = entry.mediaType === 'tv' && entry.status === 'watched' && entry.rewatching === true
  if (entry.mediaType !== 'tv') entry.rewatchEpisodes = {}
  if (typeof entry.note === 'string' && entry.note.length > MAX_NOTE_LEN) entry.note = entry.note.slice(0, MAX_NOTE_LEN)
  else if (entry.note != null && typeof entry.note !== 'string') entry.note = undefined
  return entry
}

/** Validate + normalize a raw id-keyed map, dropping unsafe keys entirely. */
function sanitizeMap(raw: unknown): Record<string, Entry> {
  const out: Record<string, Entry> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  let dropped = 0
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSafeKey(k) || !v || typeof v !== 'object') {
      dropped++
      continue
    }
    try {
      const normalized = normalizeEntry(v as Entry)
      const [mediaType, rawId] = k.split(':')
      if (normalized.mediaType !== mediaType || normalized.id !== Number(rawId)) {
        dropped++
        continue
      }
      out[k] = normalized
    } catch {
      dropped++
    }
  }
  if (dropped > 0) console.warn(`[library] dropped ${dropped} invalid stored rows`)
  return out
}

function readLegacySnapshot(): Record<string, Entry> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(LEGACY_STORAGE)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return sanitizeMap(parsed)
  } catch {
    try {
      localStorage.removeItem(LEGACY_STORAGE)
      console.warn('[library] invalid legacy browser data was discarded')
    } catch {}
    return {}
  }
}

function clearLegacyStorage() {
  try {
    localStorage.removeItem(LEGACY_STORAGE)
    localStorage.removeItem(LEGACY_CORRUPT_STORAGE)
  } catch {
    // The database is already authoritative; inaccessible browser storage is harmless.
  }
}

/** Merge event histories idempotently while preserving distinct events that
 *  happen to share a timestamp (for example, imports created in one tick). */
function mergeTimestampHistory(first: number[], second: number[]): number[] {
  const counts = new Map<number, number>()
  for (const timestamp of first) counts.set(timestamp, (counts.get(timestamp) ?? 0) + 1)
  const secondCounts = new Map<number, number>()
  for (const timestamp of second) secondCounts.set(timestamp, (secondCounts.get(timestamp) ?? 0) + 1)
  for (const [timestamp, count] of secondCounts) {
    counts.set(timestamp, Math.max(counts.get(timestamp) ?? 0, count))
  }
  return [...counts].flatMap(([timestamp, count]) => Array(count).fill(timestamp))
    .sort((a, b) => a - b)
    .slice(-MAX_REWATCHES)
}

const listeners = new Set<() => void>()
const noopSubscribe = () => () => {}
let cache = readLegacySnapshot()
const legacySnapshot = { ...cache }
const changedDuringHydration = new Map<string, Entry | null>()
let clearedDuringHydration = false
/**
 * Stable array snapshot. Rebuilt only on commit, so consumers can safely use
 * `entries` as a hook dependency — a fresh Object.values() per render would
 * invalidate every downstream useMemo/useCallback and loop their effects.
 */
let snapshot = Object.values(cache)

/**
 * SQLite at data/database.sqlite is the persistent source of truth. Existing
 * browser storage is read once for migration and removed after the database
 * confirms that the merged snapshot was saved.
 */
const DB_ENDPOINT = '/__data/library'

let hydrating = true
let mutatedDuringHydration = false

/** Coalesce rapid per-record changes; edits in another tab remain untouched. */
const pendingDatabaseChanges = new Map<string, Entry | null>()
let pendingDatabaseClear = false
let databaseWriteRunning = false
let databaseRetryTimer: ReturnType<typeof setTimeout> | null = null
let databaseRetryDelay = 1000

function scheduleDatabaseRetry() {
  if (databaseRetryTimer) return
  databaseRetryTimer = setTimeout(() => {
    databaseRetryTimer = null
    void flushDatabaseChanges()
  }, databaseRetryDelay)
  databaseRetryDelay = Math.min(databaseRetryDelay * 2, 30_000)
}

async function flushDatabaseChanges() {
  if (databaseWriteRunning || (!pendingDatabaseClear && pendingDatabaseChanges.size === 0)) return
  if (databaseRetryTimer) {
    clearTimeout(databaseRetryTimer)
    databaseRetryTimer = null
  }
  databaseWriteRunning = true
  setPersistenceState('library', 'saving')
  try {
    while (pendingDatabaseClear || pendingDatabaseChanges.size > 0) {
      const clearLibrary = pendingDatabaseClear
      const changes = Object.fromEntries(pendingDatabaseChanges)
      pendingDatabaseClear = false
      pendingDatabaseChanges.clear()
      const body = JSON.stringify({ clear: clearLibrary, changes })
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      try {
        const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
        const keepalive = hidden && new TextEncoder().encode(body).byteLength <= 64 * 1024
        const res = await fetch(DB_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive,
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`Database rejected update (${res.status})`)
        clearLegacyStorage()
        databaseRetryDelay = 1000
      } catch (e) {
        // Keep the latest value per key. If a newer edit arrived during this
        // request, it already occupies the map and must win over this batch.
        for (const [key, value] of Object.entries(changes)) {
          if (!pendingDatabaseChanges.has(key)) pendingDatabaseChanges.set(key, value as Entry | null)
        }
        if (clearLibrary) pendingDatabaseClear = true
        console.warn('[library] database unavailable; changes will be retried', e)
        setPersistenceState('library', 'error')
        scheduleDatabaseRetry()
        break
      } finally {
        clearTimeout(timeout)
      }
    }
  } finally {
    databaseWriteRunning = false
    if (!pendingDatabaseClear && pendingDatabaseChanges.size === 0) setPersistenceState('library', 'saved')
  }
}

function saveToDatabase(changes: Record<string, Entry | null>, clearLibrary = false) {
  if (hydrating) {
    mutatedDuringHydration = true
    return
  }
  if (clearLibrary) pendingDatabaseClear = true
  for (const [key, value] of Object.entries(changes)) pendingDatabaseChanges.set(key, value)
  if (pendingDatabaseClear || pendingDatabaseChanges.size > 0) void flushDatabaseChanges()
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flushDatabaseChanges())
}

function diffEntries(before: Record<string, Entry>, after: Record<string, Entry>) {
  const changes: Record<string, Entry | null> = {}
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = after[key] ?? null
  }
  return changes
}

// Hydration completion signal
const libraryHydrationListeners = new Set<() => void>()
function notifyLibraryHydrated() {
  for (const fn of [...libraryHydrationListeners]) fn()
}
export function subscribeLibraryHydrated(cb: () => void): () => void {
  if (!hydrating) { cb(); return () => {} }
  libraryHydrationListeners.add(cb)
  return () => libraryHydrationListeners.delete(cb)
}
export function isLibraryHydrated(): boolean {
  return !hydrating
}
/**
 * Load the canonical database, merge any records from the previous browser
 * store, and persist that one-time migration before removing the old copy.
 */
async function hydrateFromSqlite() {
  let databaseSnapshot: Record<string, Entry> | null = null
  let rawDatabaseSnapshot: unknown = null
  try {
    if (typeof fetch !== 'function') return
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 2500)
    const res = await fetch(DB_ENDPOINT, { signal: controller.signal }).catch(() => null as unknown as Response)
    clearTimeout(t)
    if (!res?.ok) return
    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('application/json')) return
    rawDatabaseSnapshot = await res.json()
    databaseSnapshot = sanitizeMap(rawDatabaseSnapshot)
  } catch {
    // Keep the legacy data in memory and in place until the database is reachable.
  } finally {
    hydrating = false
    if (databaseSnapshot) {
      const merged = clearedDuringHydration ? {} : { ...databaseSnapshot }
      if (!clearedDuringHydration) {
        for (const [key, legacyEntry] of Object.entries(legacySnapshot)) {
          const storedEntry = merged[key]
          merged[key] = storedEntry ? mergeMigratedEntry(legacyEntry, storedEntry) : legacyEntry
        }
      }
      for (const [key, changedEntry] of changedDuringHydration) {
        if (changedEntry) merged[key] = changedEntry
        else delete merged[key]
      }
      const changes = diffEntries(databaseSnapshot, merged)
      // sanitizeMap normalizes the in-memory copy, so explicitly persist this
      // one-time status correction for legacy movie rows in SQLite as well.
      if (rawDatabaseSnapshot && typeof rawDatabaseSnapshot === 'object' && !Array.isArray(rawDatabaseSnapshot)) {
        for (const [key, value] of Object.entries(rawDatabaseSnapshot)) {
          if (!isSafeKey(key) || !value || typeof value !== 'object' || Array.isArray(value)) continue
          const rawEntry = value as Partial<Entry>
          if (
            rawEntry.mediaType === 'movie' &&
            rawEntry.status === 'dropped' &&
            databaseSnapshot[key] &&
            !clearedDuringHydration &&
            !changedDuringHydration.has(key)
          ) changes[key] = merged[key] ?? databaseSnapshot[key]
        }
      }
      const databaseChanged = Object.keys(changes).length > 0
      cache = merged
      snapshot = Object.values(merged)
      for (const fn of [...listeners]) {
        try { fn() } catch (e) { console.error('[library] subscriber failed', e) }
      }
      if (databaseChanged || mutatedDuringHydration || clearedDuringHydration) saveToDatabase(changes, clearedDuringHydration)
      else {
        clearLegacyStorage()
        setPersistenceState('library', 'saved')
      }
    } else {
      // Keep legacy records and any edits made while hydration was pending.
      // The server applies these as patches, so retrying cannot erase data it
      // already holds even though its initial snapshot was unavailable.
      const changes: Record<string, Entry | null> = { ...cache }
      for (const [key, value] of changedDuringHydration) changes[key] = value
      if (Object.keys(changes).length > 0 || clearedDuringHydration) saveToDatabase(changes, clearedDuringHydration)
      else setPersistenceState('library', 'error')
    }
    mutatedDuringHydration = false
    notifyLibraryHydrated()
  }
}

function commit(next: Record<string, Entry>, changes = diffEntries(cache, next), clearLibrary = false) {
  if (hydrating) {
    for (const [key, value] of Object.entries(changes)) changedDuringHydration.set(key, value)
    if (clearLibrary) clearedDuringHydration = true
  }
  cache = next
  snapshot = Object.values(next)
  // Subscribers first: the UI reflects edits even if the database is offline.
  for (const fn of [...listeners]) {
    try {
      fn()
    } catch (e) {
      console.error('[library] subscriber failed', e)
    }
  }
  saveToDatabase(changes, clearLibrary)
}

void hydrateFromSqlite()

export function useLibrary(subscribeToStore = true) {
  const entries = useSyncExternalStore(
    subscribeToStore
      ? (fn) => {
          listeners.add(fn)
          return () => listeners.delete(fn)
        }
      : noopSubscribe,
    () => snapshot,
    () => snapshot,
  )

  const get = useCallback((type: MediaType, id: number) => cache[entryKey(type, id)], [])

  const upsert = useCallback((type: MediaType, id: number, patch: Partial<Entry>, seed?: TmdbTitle) => {
    if ((type !== 'movie' && type !== 'tv') || !Number.isSafeInteger(id) || id <= 0) return
    const key = entryKey(type, id)
    const existing = cache[key]
    if (patch.status === 'dropped' && !canSetDropped(type, existing?.status ?? 'planned', Object.keys(existing?.episodes ?? {}).length)) return
    const base: Entry = existing ?? {
      id,
      mediaType: type,
      title: seed ? titleOf(seed) : 'Untitled',
      year: seed ? yearOf(seed) : '',
      poster: seed?.poster_path ?? null,
      backdrop: null, // retired: no backdrop UI ships, so don't mirror dead weight
      rating: null,
      status: 'planned',
      favorite: false,
      addedAt: Date.now(),
      watchedAt: null,
      runtime: null,
      episodes: {},
      totalEpisodes: null,
      rewatches: [],
      rewatching: false,
      rewatchEpisodes: {},
    }
    const updated = normalizeEntry({ ...base, ...patch })
    commit({ ...cache, [key]: updated }, { [key]: updated })
  }, [])

  const remove = useCallback((type: MediaType, id: number) => {
    if ((type !== 'movie' && type !== 'tv') || !Number.isSafeInteger(id) || id <= 0) return
    const next = { ...cache }
    delete next[entryKey(type, id)]
    commit(next, { [entryKey(type, id)]: null })
  }, [])

  /** `at` backdates the log; defaults to now. Ignores non-integer season/episodes. */
  const toggleEpisode = useCallback((id: number, s: number, e: number, at?: number) => {
    if (!Number.isInteger(id) || !Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e < 0) return
    const key = entryKey('tv', id)
    const entry = cache[key]
    if (!entry) return
    if (entry.status === 'watched' && !entry.rewatching) return
    const k = epKey(s, e)
    const stamp = isValidTimestamp(at) ? at : Date.now()
    const episodes = { ...(entry.rewatching ? entry.rewatchEpisodes : entry.episodes) }
    if (Object.prototype.hasOwnProperty.call(episodes, k)) delete episodes[k]
    else episodes[k] = Number.isFinite(stamp) ? stamp : Date.now()
    if (entry.rewatching) {
      const cycle = advanceRewatch(entry, episodes, entry.totalEpisodes)
      const updated = { ...entry, ...cycle }
      commit({ ...cache, [key]: updated }, { [key]: updated })
      return
    }
    const watched = Object.keys(episodes).length
    const finished = currentSettings().autoCompleteSeries && !!entry.totalEpisodes && watched >= entry.totalEpisodes
    // An empty log is never "watched" — fall back to planned (dropped stays dropped).
    const status: Status = finished ? 'watched' : watched > 0 ? 'watching' : entry.status === 'dropped' ? 'dropped' : 'planned'
    const watchedAt = watchedAtAfterProgress(entry.status, finished, entry.watchedAt, maxTime(Object.values(episodes)))
    const updated = { ...entry, episodes, status, watchedAt }
    commit({ ...cache, [key]: updated }, { [key]: updated })
  }, [])

  const setSeasonWatched = useCallback(
    (id: number, s: number, numbers: number[], watched: boolean, at?: number) => {
    if (!Number.isInteger(id) || !Number.isInteger(s) || s < 0 || !Array.isArray(numbers)) return
    const key = entryKey('tv', id)
    const entry = cache[key]
    if (!entry) return
    if (entry.status === 'watched' && !entry.rewatching) return
    const episodes = { ...(entry.rewatching ? entry.rewatchEpisodes : entry.episodes) }
    for (const n of numbers) {
      if (!Number.isInteger(n) || n < 0) continue
      if (watched) episodes[epKey(s, n)] = episodes[epKey(s, n)] ?? (isValidTimestamp(at) ? at : Date.now())
      else delete episodes[epKey(s, n)]
    }
    if (entry.rewatching) {
      const cycle = advanceRewatch(entry, episodes, entry.totalEpisodes)
      const updated = { ...entry, ...cycle }
      commit({ ...cache, [key]: updated }, { [key]: updated })
      return
    }
    const count = Object.keys(episodes).length
    const finished = currentSettings().autoCompleteSeries && !!entry.totalEpisodes && count >= entry.totalEpisodes
    const status: Status =
      finished ? 'watched' : count > 0 ? 'watching' : entry.status === 'dropped' ? 'dropped' : 'planned'
    const watchedAt = watchedAtAfterProgress(entry.status, finished, entry.watchedAt, maxTime(Object.values(episodes)))
    const updated = { ...entry, episodes, status, watchedAt }
    commit({ ...cache, [key]: updated }, { [key]: updated })
    },
    [],
  )

  const setRewatching = useCallback((id: number, rewatching: boolean) => {
    const key = entryKey('tv', id)
    const entry = cache[key]
    if (!entry || entry.mediaType !== 'tv' || entry.status !== 'watched') return
    const updated = normalizeEntry({ ...entry, rewatching })
    commit({ ...cache, [key]: updated }, { [key]: updated })
  }, [])

  /** Log an additional watch-through at `at` (defaults to now). Capped at MAX_REWATCHES. */
  const addRewatch = useCallback((type: MediaType, id: number, at?: number) => {
    const key = entryKey(type, id)
    const entry = cache[key]
    if (!entry || (type === 'tv' && entry.rewatching)) return
    const stamp = at ?? Date.now()
    if (!isValidTimestamp(stamp)) return
    const rewatches = [...(entry.rewatches ?? []), stamp].sort((a, b) => a - b).slice(-MAX_REWATCHES)
    const updated = { ...entry, rewatches }
    commit({ ...cache, [key]: updated }, { [key]: updated })
  }, [])

  /** Rewrite one logged rewatch date by its index. */
  const setRewatchDate = useCallback((type: MediaType, id: number, index: number, at: number) => {
    if (!isValidTimestamp(at)) return
    const key = entryKey(type, id)
    const entry = cache[key]
    if (!entry?.rewatches || !Number.isInteger(index) || index < 0 || index >= entry.rewatches.length) return
    const rewatches = [...entry.rewatches]
    rewatches[index] = at
    rewatches.sort((a, b) => a - b)
    const updated = { ...entry, rewatches }
    commit({ ...cache, [key]: updated }, { [key]: updated })
  }, [])

  const removeRewatch = useCallback((type: MediaType, id: number, index: number) => {
    const key = entryKey(type, id)
    const entry = cache[key]
    if (!entry?.rewatches) return
    const rewatches = entry.rewatches.filter((_, i) => i !== index)
    const updated = { ...entry, rewatches }
    commit({ ...cache, [key]: updated }, { [key]: updated })
  }, [])

  const clear = useCallback(() => {
    commit({}, Object.fromEntries(Object.keys(cache).map((key) => [key, null])), true)
  }, [])
  const replaceAll = useCallback((next: Record<string, Entry>) => commit(sanitizeMap(next)), [])

  return {
    entries,
    get,
    upsert,
    remove,
    toggleEpisode,
    setSeasonWatched,
    setRewatching,
    addRewatch,
    setRewatchDate,
    removeRewatch,
    replaceAll,
    clear,
  }
}

/** Preserve the previous browser store's values on collisions, fill missing
 * fields from SQLite, and combine progress during the one-time migration. */
function mergeMigratedEntry(legacy: Entry, database: Entry): Entry {
  const rewatches = mergeTimestampHistory(legacy.rewatches, database.rewatches)
  return {
    ...database,
    ...legacy,
    episodes: { ...database.episodes, ...legacy.episodes },
    rewatchEpisodes: { ...database.rewatchEpisodes, ...legacy.rewatchEpisodes },
    rewatching: legacy.rewatching || database.rewatching,
    rewatches,
    rating: legacy.rating ?? database.rating,
    favorite: legacy.favorite || database.favorite,
    watchedAt: legacy.watchedAt ?? database.watchedAt,
    runtime: legacy.runtime ?? database.runtime,
    totalEpisodes: legacy.totalEpisodes ?? database.totalEpisodes,
    poster: legacy.poster ?? database.poster,
    backdrop: legacy.backdrop ?? database.backdrop,
    title: legacy.title || database.title,
    year: legacy.year || database.year,
    addedAt: Math.min(legacy.addedAt, database.addedAt),
  }
}

export type ImportResult = { merged: Record<string, Entry>; imported: number; skipped: number; combined: number }

/** Keep existing curated fields on collisions; imports can contribute missing
 * metadata and viewing progress without erasing the current library. */
function mergeImportedEntry(existing: Entry, incoming: Entry): Entry {
  const rewatches = mergeTimestampHistory(existing.rewatches, incoming.rewatches)
  return {
    ...incoming,
    ...existing,
    episodes: { ...incoming.episodes, ...existing.episodes },
    rewatchEpisodes: { ...incoming.rewatchEpisodes, ...existing.rewatchEpisodes },
    rewatching: existing.rewatching || incoming.rewatching,
    rewatches,
    rating: existing.rating ?? incoming.rating,
    favorite: existing.favorite || incoming.favorite,
    watchedAt: existing.watchedAt ?? incoming.watchedAt,
    runtime: existing.runtime ?? incoming.runtime,
    totalEpisodes: existing.totalEpisodes ?? incoming.totalEpisodes,
    poster: existing.poster ?? incoming.poster,
    backdrop: existing.backdrop ?? incoming.backdrop,
    title: existing.title || incoming.title,
    year: existing.year || incoming.year,
    addedAt: Math.min(existing.addedAt, incoming.addedAt),
  }
}

/** Validate a library JSON file and merge it without replacing curated data. */
export function parseLibraryImport(text: string, existing: Entry[]): ImportResult {
  if (text.length > 5 * 1024 * 1024) throw new Error('File too large — max 5 MB.')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Not a CineTrack JSON export — file could not be read.')
  }
  if (!Array.isArray(parsed)) throw new Error('Not a CineTrack JSON export — expected a list of titles.')
  if (parsed.length > 5000) throw new Error('Too many entries — max 5000 titles per import.')
  const merged: Record<string, Entry> = {}
  for (const entry of existing) merged[`${entry.mediaType}:${entry.id}`] = entry
  let imported = 0
  let skipped = 0
  let combined = 0
  for (const raw of parsed) {
    const entry = raw as Partial<Entry>
    if (!Number.isSafeInteger(entry?.id) || (entry?.id as number) <= 0 || (entry?.mediaType !== 'movie' && entry?.mediaType !== 'tv')) {
      skipped++
      continue
    }
    try {
      const key = `${entry.mediaType}:${entry.id}`
      if (!isSafeKey(key)) {
        skipped++
        continue
      }
      const incoming = normalizeEntry(entry as Entry)
      const current = merged[key]
      if (current) {
        merged[key] = mergeImportedEntry(current, incoming)
        combined++
      } else {
        merged[key] = incoming
        imported++
      }
    } catch {
      skipped++
    }
  }
  return { merged, imported, skipped, combined }
}

/* ---------- date helpers ---------- */

/** Timestamp → yyyy-mm-dd in local time (toISOString would shift the day). */
export function toDateInput(ts: number) {
  if (!isValidTimestamp(ts)) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** yyyy-mm-dd → timestamp at local midday, keeping the day stable across zones.
 *  Returns null for malformed input (including rolled-over dates like Feb 30)
 *  instead of NaN or a silently wrong day. */
export function fromDateInput(value: string): number | null {
  if (typeof value !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const ts = new Date(y, mo - 1, d, 12).getTime()
  if (!Number.isFinite(ts)) return null
  const check = new Date(ts)
  if (check.getFullYear() !== y || check.getMonth() !== mo - 1 || check.getDate() !== d) return null
  return ts
}

export const todayInput = () => toDateInput(Date.now())

/* ---------- derived metrics ---------- */

export function countStatuses(entries: Entry[]): Record<Status, number> {
  const counts: Record<Status, number> = { planned: 0, watching: 0, watched: 0, dropped: 0 }
  for (const entry of entries) {
    const status = entry.status === 'dropped' && entry.mediaType !== 'tv' ? 'planned' : entry.status
    counts[status]++
  }
  return counts
}

export const watchedCount = (e: Entry) => Object.keys(e.episodes ?? {}).length

/** Latest timestamp in a list without spread (avoids stack overflow on huge maps). */
function maxTime(times: readonly unknown[]): number | null {
  let max: number | null = null
  for (const t of times) {
    if (typeof t !== 'number' || !Number.isFinite(t)) continue
    if (max == null || t > max) max = t
  }
  return max
}

function validStamp(at: unknown): at is number {
  return isValidTimestamp(at)
}

export function progress(e: Entry) {
  if (e.mediaType === 'movie') return e.watchedAt != null && validStamp(e.watchedAt) ? 1 : 0
  if (!e.totalEpisodes || e.totalEpisodes <= 0) return 0
  const seen = e.rewatching ? Object.keys(e.rewatchEpisodes).length : watchedCount(e)
  return Math.min(1, Math.max(0, seen / e.totalEpisodes))
}

/** Episodes from the original run, finished rewatches, and a partial rewatch. */
export function loggedEpisodeCount(e: Entry): number {
  if (e.mediaType !== 'tv') return 0
  return watchedCount(e) + (e.rewatches.length * (e.totalEpisodes ?? 0)) + Object.keys(e.rewatchEpisodes).length
}

export function countRewatches(entries: Entry[]): number {
  return entries.reduce((sum, entry) => sum + entry.rewatches.length, 0)
}

/** Approximate minutes watched: movies use runtime per viewing; episodes assume 42m when unknown. */
export function minutesWatched(entries: Entry[]) {
  return entries.reduce((sum, e) => {
    const runtime = typeof e.runtime === 'number' && Number.isFinite(e.runtime) ? Math.max(0, e.runtime) : 0
    if (e.mediaType === 'movie') {
      const viewings = (validStamp(e.watchedAt) ? 1 : 0) + (e.rewatches ?? []).filter(validStamp).length
      return sum + viewings * (runtime || 110)
    }
    return sum + loggedEpisodeCount(e) * (runtime || 42)
  }, 0)
}

/** Consistent short date for ledger microcopy (en-GB: "05 Sept"). */
export function formatDayMonth(at: number) {
  if (!isValidTimestamp(at)) return 'Unknown date'
  return new Date(at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

/** Friendly relative date for the ledger ("Today", "3d ago"); falls back to
 *  the absolute form once the stamp is a year or more old. */
export function formatRelativeDay(at: number, now = Date.now()) {
  if (!isValidTimestamp(at) || !isValidTimestamp(now)) return 'Unknown date'
  const day = 86_400_000
  const startOfDay = (ts: number) => {
    const d = new Date(ts)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const diff = Math.max(0, Math.round((startOfDay(now) - startOfDay(at)) / day))
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return `${diff}d ago`
  if (diff < 30) {
    const w = Math.floor(diff / 7)
    return w <= 1 ? '1w ago' : `${w}w ago`
  }
  if (diff < 365) {
    const m = Math.floor(diff / 30)
    return m <= 1 ? '1mo ago' : `${m}mo ago`
  }
  return formatDayMonth(at)
}

/** Original completion timestamp for a series, excluding subsequent rewatches. */
export function originalCompletionAt(e: Entry): number | null {
  if (validStamp(e.watchedAt)) return e.watchedAt
  return e.mediaType === 'tv' ? maxTime(Object.values(e.episodes ?? {})) : maxTime(e.rewatches ?? [])
}

/** Latest viewing timestamp, including completed rewatches and a show rewatch in progress. */
export function lastActivityAt(e: Entry): number | null {
  if (e.mediaType === 'movie') {
    return maxTime([e.watchedAt, ...(e.rewatches ?? [])])
  }
  return [e.watchedAt, maxTime(Object.values(e.episodes ?? {})), maxTime(e.rewatches ?? []), maxTime(Object.values(e.rewatchEpisodes ?? {}))]
    .filter(validStamp)
    .reduce<number | null>((latest, at) => latest == null ? at : Math.max(latest, at), null)
}

export type Activity = { entry: Entry; at: number; label: string }

/** Completed viewings only — no per-episode rows. Movies use watchedAt,
 *  finished series collapse to a single row at their latest episode
 *  timestamp, and rewatch logs pass through. */
export function recentCompletions(entries: Entry[], limit = 8): Activity[] {
  const events: Activity[] = []
  for (const e of entries) {
    if (e.mediaType === 'movie') {
      if (validStamp(e.watchedAt)) events.push({ entry: e, at: e.watchedAt, label: 'Film' })
    } else if (e.status === 'watched' || validStamp(e.watchedAt)) {
      const at = validStamp(e.watchedAt) ? e.watchedAt : maxTime(Object.values(e.episodes ?? {}))
      if (at != null) events.push({ entry: e, at, label: 'Series' })
    }
    for (const at of e.rewatches ?? []) {
      if (validStamp(at)) events.push({ entry: e, at, label: 'Rewatch' })
    }
  }
  return events.sort((a, b) => b.at - a.at).slice(0, limit)
}

export function recentActivity(entries: Entry[], limit = 12): Activity[] {
  const events: Activity[] = []
  for (const e of entries) {
    if (e.mediaType === 'movie' && validStamp(e.watchedAt)) {
      events.push({ entry: e, at: e.watchedAt, label: 'Film' })
    } else {
      for (const [k, at] of Object.entries(e.episodes ?? {})) {
        const parts = k.split('-')
        if (parts.length !== 2) continue
        const [s, ep] = parts as [string, string]
        if (!/^\d+$/.test(s) || !/^\d+$/.test(ep) || !validStamp(at)) continue
        events.push({ entry: e, at, label: `S${s.padStart(2, '0')}E${ep.padStart(2, '0')}` })
      }
    }
    // Rewatches are logged viewings too — fold them into the ledger and charts.
    for (const at of e.rewatches ?? []) {
      if (validStamp(at)) events.push({ entry: e, at, label: 'Rewatch' })
    }
  }
  return events.sort((a, b) => b.at - a.at).slice(0, limit)
}

/** Completed titles per calendar month for the trailing `months` window —
 *  each finished movie/series counts once (never per episode); rewatch logs
 *  each count as one completed viewing. */
export function activityByMonth(entries: Entry[], months = 12) {
  const buckets = new Map<string, number>()
  const bump = (at: unknown) => {
    if (!validStamp(at)) return
    const d = new Date(at)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  for (const e of entries) {
    if (e.mediaType === 'movie') {
      if (e.watchedAt != null) bump(e.watchedAt)
    } else if (e.status === 'watched' || validStamp(e.watchedAt)) {
      const at = validStamp(e.watchedAt) ? e.watchedAt : maxTime(Object.values(e.episodes ?? {}))
      if (at != null) bump(at)
    }
    for (const at of e.rewatches ?? []) bump(at)
  }

  const out: { month: string; label: string; count: number }[] = []
  const cursor = new Date()
  cursor.setDate(1)
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    out.push({
      month: key,
      label: d.toLocaleDateString(undefined, { month: 'short' }),
      count: buckets.get(key) ?? 0,
    })
  }
  return out
}
