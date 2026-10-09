import { useCallback, useSyncExternalStore } from 'react'
import { setPersistenceState } from './persistence'

export type ThemeId = 'paper' | 'halide' | 'velvet' | 'blueprint'

export const DEFAULT_ARCHIVE_NAME = 'The Standing Collection'
export const ARCHIVE_NAME_MAX_LENGTH = 48

export const LANGUAGES: { id: string; label: string }[] = [
  { id: 'en-US', label: 'English' },
  { id: 'de-DE', label: 'Deutsch' },
  { id: 'es-ES', label: 'Español' },
  { id: 'fr-FR', label: 'Français' },
  { id: 'it-IT', label: 'Italiano' },
  { id: 'nl-NL', label: 'Nederlands' },
  { id: 'pl-PL', label: 'Polski' },
  { id: 'pt-BR', label: 'Português' },
  { id: 'ja-JP', label: '日本語' },
  { id: 'ko-KR', label: '한국어' },
  { id: 'zh-CN', label: '中文' },
]

const STATUS_IDS = ['planned', 'watching'] as const
const TAB_IDS = ['all', 'movie', 'tv', 'favorites'] as const
const SORT_IDS = ['added', 'lastWatched', 'title', 'rating', 'year'] as const

export const THEMES: { id: ThemeId; name: string; note: string; tone: 'light' | 'dark'; swatch: [string, string, string] }[] = [
  { id: 'paper', name: 'Paper', note: 'True white stock, oxblood ink', tone: 'light', swatch: ['#ffffff', '#14130f', '#7a2318'] },
  { id: 'blueprint', name: 'Blueprint', note: 'Cool slate, technical ink', tone: 'light', swatch: ['#eef1f4', '#131a21', '#1f5673'] },
  { id: 'halide', name: 'Halide', note: 'Cold darkroom grey, silver-blue', tone: 'dark', swatch: ['#0f1417', '#e6edf1', '#6fa8c4'] },
  { id: 'velvet', name: 'Velvet', note: 'Cinema velvet, curtain-red house', tone: 'dark', swatch: ['#100e0d', '#f2ede1', '#b3402e'] },
]

export type Settings = {
  theme: ThemeId
  density: 'comfortable' | 'compact'
  hideSpoilers: boolean
  autoCompleteSeries: boolean
  posterMotion: boolean
  libraryColumns: number
  discoverColumns: number
  shelfColumns: number
  includeAdult: boolean
  archiveName: string
  archiveItalicWordIndex: number
  showNavHints: boolean
  defaultStatus: (typeof STATUS_IDS)[number]
  openAfterAdd: boolean
  defaultWatchDate: 'today' | 'blank'
  defaultShelfTab: (typeof TAB_IDS)[number]
  defaultSort: (typeof SORT_IDS)[number]
  showCommunityScores: boolean
  dateStyle: 'absolute' | 'relative'
  posterQuality: 'standard' | 'saver'
  metadataLanguage: string
}

const DEFAULTS: Settings = {
  theme: 'paper',
  density: 'comfortable',
  hideSpoilers: false,
  autoCompleteSeries: true,
  posterMotion: true,
  libraryColumns: 6,
  discoverColumns: 7,
  shelfColumns: 6,
  includeAdult: false,
  archiveName: DEFAULT_ARCHIVE_NAME,
  archiveItalicWordIndex: -1,
  showNavHints: true,
  defaultStatus: 'planned',
  openAfterAdd: false,
  defaultWatchDate: 'today',
  defaultShelfTab: 'all',
  defaultSort: 'added',
  showCommunityScores: false,
  dateStyle: 'absolute',
  posterQuality: 'standard',
  metadataLanguage: 'en-US',
}

const LEGACY_STORAGE = 'archive.settings.v1'
const LEGACY_CORRUPT_STORAGE = 'archive.settings.v1.corrupt'

function clamp(n: unknown, min: number, max: number, def: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.round(n as number)))
}

function sanitize(s: Partial<Settings> & Record<string, unknown>): Settings {
  const out: Settings = { ...DEFAULTS }
  // Retired id: Nitrate became Velvet (amber lamp → curtain red).
  const theme = (s.theme as string) === 'nitrate' ? 'velvet' : s.theme
  if (THEMES.some((t) => t.id === theme)) out.theme = theme as ThemeId
  if (s.density === 'comfortable' || s.density === 'compact') out.density = s.density
  out.hideSpoilers = !!s.hideSpoilers
  out.autoCompleteSeries = s.autoCompleteSeries !== false
  out.posterMotion = s.posterMotion !== false
  out.showNavHints = s.showNavHints !== false
  out.openAfterAdd = !!s.openAfterAdd
  out.showCommunityScores = !!s.showCommunityScores
  if (typeof s.archiveName === 'string') {
    out.archiveName = Array.from(s.archiveName).slice(0, ARCHIVE_NAME_MAX_LENGTH).join('')
  }
  if (typeof s.archiveItalicWordIndex === 'number' && Number.isInteger(s.archiveItalicWordIndex) && s.archiveItalicWordIndex >= -1) {
    out.archiveItalicWordIndex = Math.min(s.archiveItalicWordIndex, ARCHIVE_NAME_MAX_LENGTH - 1)
  }
  const archiveWordCount = out.archiveName.trim().split(/\s+/).filter(Boolean).length
  if (out.archiveItalicWordIndex >= archiveWordCount) out.archiveItalicWordIndex = archiveWordCount - 1
  if ((STATUS_IDS as readonly string[]).includes(s.defaultStatus as string)) {
    out.defaultStatus = s.defaultStatus as Settings['defaultStatus']
  }
  if (s.defaultWatchDate === 'today' || s.defaultWatchDate === 'blank') out.defaultWatchDate = s.defaultWatchDate
  if ((TAB_IDS as readonly string[]).includes(s.defaultShelfTab as string)) {
    out.defaultShelfTab = s.defaultShelfTab as Settings['defaultShelfTab']
  }
  if ((SORT_IDS as readonly string[]).includes(s.defaultSort as string)) {
    out.defaultSort = s.defaultSort as Settings['defaultSort']
  }
  if (s.dateStyle === 'absolute' || s.dateStyle === 'relative') out.dateStyle = s.dateStyle
  if (s.posterQuality === 'standard' || s.posterQuality === 'saver') out.posterQuality = s.posterQuality
  if (typeof s.metadataLanguage === 'string' && LANGUAGES.some((l) => l.id === s.metadataLanguage)) {
    out.metadataLanguage = s.metadataLanguage
  }
  out.libraryColumns = clamp(s.libraryColumns, 3, 12, DEFAULTS.libraryColumns)
  out.discoverColumns = clamp(s.discoverColumns, 3, 12, DEFAULTS.discoverColumns)
  out.shelfColumns = clamp(s.shelfColumns, 3, 12, DEFAULTS.shelfColumns)
  out.includeAdult = !!s.includeAdult
  return out
}

/**
 * Unknown keys (written by a newer client) ride along untouched so an older
 * client can never delete them on its next write — only known keys sanitize.
 */
let extraKeys: Record<string, unknown> = {}
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const RETIRED_KEYS = new Set(['chartStyle'])
function stashExtras(s: Record<string, unknown>, opts?: { merge?: boolean }) {
  if (!opts?.merge) extraKeys = {}
  for (const [k, v] of Object.entries(s)) {
    if (k in DEFAULTS || UNSAFE_KEYS.has(k) || RETIRED_KEYS.has(k)) continue
    extraKeys[k] = v
  }
}
function withExtras(s: Settings): Record<string, unknown> {
  return { ...extraKeys, ...s }
}

let legacySettingsPresent = false

function readLegacySettings(): Settings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULTS }
    const raw = localStorage.getItem(LEGACY_STORAGE)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<Settings>
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ...DEFAULTS }
    legacySettingsPresent = true
    stashExtras(parsed as Record<string, unknown>)
    return sanitize(parsed)
  } catch {
    try {
      localStorage.removeItem(LEGACY_STORAGE)
      console.warn('[settings] invalid legacy browser settings were discarded')
    } catch {}
    return { ...DEFAULTS }
  }
}

function clearLegacyStorage() {
  try {
    localStorage.removeItem(LEGACY_STORAGE)
    localStorage.removeItem(LEGACY_CORRUPT_STORAGE)
    legacySettingsPresent = false
  } catch {
    // The database is already authoritative; inaccessible browser storage is harmless.
  }
}

let cache: Settings = readLegacySettings()
const listeners = new Set<() => void>()
let hydrating = true
let hasMutatedDuringHydration = false
/** Keys changed locally — these win over server values during hydrate merge. */
const dirtyKeys = new Set<keyof Settings>()

function getSnapshot(): Settings {
  return cache
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function notify() {
  for (const fn of [...listeners]) {
    try {
      fn()
    } catch (e) {
      console.error(e)
    }
  }
}

export function applyTheme(theme: ThemeId) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
  const themeColor = THEMES.find((item) => item.id === theme)?.swatch[0]
  if (themeColor) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor)
}
try {
  applyTheme(cache.theme)
} catch {}

const SETTINGS_ENDPOINT = '/__data/settings'
const pendingSettingsChanges = new Map<string, unknown>()
let settingsWriteRunning = false
let settingsRetryTimer: ReturnType<typeof setTimeout> | null = null
let settingsRetryDelay = 1000

function scheduleSettingsRetry() {
  if (settingsRetryTimer) return
  settingsRetryTimer = setTimeout(() => {
    settingsRetryTimer = null
    void flushSettingsChanges()
  }, settingsRetryDelay)
  settingsRetryDelay = Math.min(settingsRetryDelay * 2, 30_000)
}

async function flushSettingsChanges() {
  if (settingsWriteRunning || pendingSettingsChanges.size === 0) return
  if (settingsRetryTimer) {
    clearTimeout(settingsRetryTimer)
    settingsRetryTimer = null
  }
  settingsWriteRunning = true
  setPersistenceState('settings', 'saving')
  try {
    while (pendingSettingsChanges.size > 0) {
      const changes = Object.fromEntries(pendingSettingsChanges)
      pendingSettingsChanges.clear()
      const body = JSON.stringify(changes)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      try {
        const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
        const keepalive = hidden && new TextEncoder().encode(body).byteLength <= 64 * 1024
        const res = await fetch(SETTINGS_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive,
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`Database rejected settings (${res.status})`)
        clearLegacyStorage()
        settingsRetryDelay = 1000
      } catch (e) {
        for (const [key, value] of Object.entries(changes)) {
          if (!pendingSettingsChanges.has(key)) pendingSettingsChanges.set(key, value)
        }
        console.warn('[settings] database unavailable; changes will be retried', e)
        setPersistenceState('settings', 'error')
        scheduleSettingsRetry()
        break
      } finally {
        clearTimeout(timeout)
      }
    }
  } finally {
    settingsWriteRunning = false
    if (pendingSettingsChanges.size === 0) setPersistenceState('settings', 'saved')
  }
}

function saveToDatabase(changes: Record<string, unknown>) {
  if (hydrating) {
    hasMutatedDuringHydration = true
    return
  }
  for (const [key, value] of Object.entries(changes)) pendingSettingsChanges.set(key, value)
  if (pendingSettingsChanges.size > 0) void flushSettingsChanges()
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flushSettingsChanges())
}

async function hydrateFromSqlite() {
  let stored: Record<string, unknown> | null = null
  try {
    if (typeof fetch !== 'function') return
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 2500)
    const res = await fetch(SETTINGS_ENDPOINT, { signal: controller.signal }).catch(() => null as unknown as Response)
    clearTimeout(t)
    if (!res?.ok) return
    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('application/json')) return
    const result: unknown = await res.json()
    if (!result || typeof result !== 'object' || Array.isArray(result)) return
    stored = result as Record<string, unknown>
  } catch {
    // Keep legacy settings in memory and in place until the database is reachable.
  } finally {
    hydrating = false
    if (stored) {
      stashExtras(stored, { merge: true })
      const sanitized = sanitize(stored as Partial<Settings> & Record<string, unknown>)
      // Keep locally customized values during the one-time migration. The
      // database fills untouched/default values and remains canonical after it.
      const merged: Record<string, unknown> = { ...sanitized }
      for (const [k, v] of Object.entries(cache)) {
        if (dirtyKeys.has(k as keyof Settings) || JSON.stringify(v) !== JSON.stringify(DEFAULTS[k as keyof Settings])) {
          merged[k] = v
        }
      }
      cache = sanitize(merged)
      try { applyTheme(cache.theme) } catch {}
      const current = withExtras(cache)
      const changes: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(current)) {
        if (JSON.stringify(stored[key]) !== JSON.stringify(value)) changes[key] = value
      }
      if (legacySettingsPresent || hasMutatedDuringHydration) {
        if (Object.keys(changes).length > 0) saveToDatabase(changes)
        else {
          clearLegacyStorage()
          setPersistenceState('settings', 'saved')
        }
      } else {
        clearLegacyStorage()
        setPersistenceState('settings', 'saved')
      }
      notify()
    } else {
      // Retry only legacy custom values and explicit edits. Defaults are not
      // written over settings that could not be read during this request.
      const changes: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(cache)) {
        if (dirtyKeys.has(key as keyof Settings) || JSON.stringify(value) !== JSON.stringify(DEFAULTS[key as keyof Settings])) {
          changes[key] = value
        }
      }
      if (legacySettingsPresent || hasMutatedDuringHydration) {
        for (const [key, value] of Object.entries(extraKeys)) changes[key] = value
      }
      if (Object.keys(changes).length > 0) saveToDatabase(changes)
      else setPersistenceState('settings', 'error')
    }
    notifySettingsHydrated()
    hasMutatedDuringHydration = false
    dirtyKeys.clear()
  }
}

// Settings hydration completion signal
const settingsHydrationListeners = new Set<() => void>()
function notifySettingsHydrated() {
  for (const fn of [...settingsHydrationListeners]) fn()
}
export function subscribeSettingsHydrated(cb: () => void): () => void {
  if (!hydrating) { cb(); return () => {} }
  settingsHydrationListeners.add(cb)
  return () => settingsHydrationListeners.delete(cb)
}
export function isSettingsHydrated(): boolean {
  return !hydrating
}

void hydrateFromSqlite()

/** Non-reactive read, for modules that aren't components. Returns copy. */
export const currentSettings = (): Settings => ({ ...cache })

export function useSettings() {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    let sanitized: Settings[K] = value
    // Validate per-key
    if (key === 'theme' && !THEMES.some((t) => t.id === value)) sanitized = DEFAULTS.theme as Settings[K]
    if ((key === 'libraryColumns' || key === 'discoverColumns' || key === 'shelfColumns') && typeof value === 'number') {
      sanitized = clamp(value as unknown as number, 3, 12, (DEFAULTS as Record<string, unknown>)[key] as number) as Settings[K]
    }
    if ((key === 'density' && value !== 'comfortable' && value !== 'compact')) {
      return
    }
    const next = sanitize({ ...cache, [key]: sanitized })
    cache = next
    dirtyKeys.add(key)
    if (key === 'theme')
      try {
        applyTheme(cache.theme)
      } catch {}
    if (hydrating) hasMutatedDuringHydration = true
    else saveToDatabase({ [key]: cache[key] })
    notify()
  }, [])

  return { settings, set }
}
