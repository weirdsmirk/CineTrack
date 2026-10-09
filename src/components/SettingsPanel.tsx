import { useEffect, useRef, useState } from 'react'
import { ARCHIVE_NAME_MAX_LENGTH, DEFAULT_ARCHIVE_NAME, LANGUAGES, THEMES, useSettings } from '../lib/settings'
import { minutesWatched, parseLibraryImport, useLibrary, watchedCount } from '../lib/library'
import { ConfirmDialog, Chip, SETTINGS_PANEL_ID, handleRadioGroupKeyDown, useBodyScrollLock, useFocusTrap } from './ui'
import { useToast } from './Toast'

export default function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, set } = useSettings()
  const { entries, replaceAll, clear } = useLibrary()
  const { toast } = useToast()
  const [confirmWipe, setConfirmWipe] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const [shown, setShown] = useState(false)
  useFocusTrap(panelRef, open)

  // Because this panel is lazy-mounted the first time it opens, its closed pose
  // (offscreen to the right) must paint before `data-open` flips — otherwise the
  // browser has no starting frame to transition from on that very first open.
  // Two rAFs: the first lets the resting pose be committed on screen, the second
  // latches `shown` so the slide-in runs from a painted start. Exit mirrors via
  // `shown` dropping to false while the sheet stays mounted.
  useEffect(() => {
    if (!open) {
      setShown(false)
      return
    }
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setShown(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [open])


  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  useBodyScrollLock(open)

  useEffect(() => {
    if (!open) setConfirmWipe(false)
  }, [open])

  const exportLibrary = () => {
    try {
      const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `cinetrack-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      toast('Library exported', 'success')
    } catch {
      toast('Export failed', 'error')
    }
  }

  const importLibrary = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast('File too large — max 5 MB.', 'error')
      return
    }
    try {
      const text = await file.text()
      const { merged, imported, skipped, combined } = parseLibraryImport(text, entries)
      replaceAll(merged)
      toast(
        `Imported ${imported} titles${combined ? `, combined ${combined} with existing (kept your data)` : ''}${skipped ? `, skipped ${skipped} invalid` : ''}`,
        skipped ? 'info' : 'success',
      )
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That file could not be read as a CineTrack export.', 'error')
    }
  }

  const counts = {
    movie: entries.filter((e) => e.mediaType === 'movie').length,
    tv: entries.filter((e) => e.mediaType === 'tv').length,
    total: entries.length,
  }

  const episodes = entries.reduce((s, e) => s + watchedCount(e), 0)
  const minutes = minutesWatched(entries)
  const hours = Math.round(minutes / 60)
  const days = (minutes / 1440).toFixed(1)
  const archiveNameLength = Array.from(settings.archiveName).length
  const archiveWords = settings.archiveName.trim().split(/\s+/).filter(Boolean)
  const italicWordIndex = settings.archiveItalicWordIndex < 0
    ? archiveWords.length - 1
    : Math.min(settings.archiveItalicWordIndex, archiveWords.length - 1)

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={`fixed inset-0 z-50 bg-[rgba(20,19,15,0.42)] transition-opacity duration-[var(--dur-quick)] ${
          shown ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        data-open={shown}
      />
      <aside
        ref={panelRef}
        id={SETTINGS_PANEL_ID}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        inert={!open}
        className="drawer-sheet quiet-scroll fixed right-0 top-0 z-50 h-full w-full max-w-[420px] overflow-y-auto border-l border-border bg-background"
        data-open={shown}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
          <span className="rule-label">Settings · Archive preferences</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="press flex h-8 w-8 items-center justify-center border border-border bg-background text-muted-foreground hover:border-[var(--foreground)] hover:text-foreground"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="divide-y divide-border">
          <Group title="Theme" note="Ground and ink for the whole archive.">
            <div className="grid grid-cols-4 gap-3">
              {THEMES.map((t) => {
                const active = settings.theme === t.id
                const [ground, ink, accent] = t.swatch
                return (
                  <span key={t.id} className="min-w-0">
                    <button
                      onClick={() => set('theme', t.id)}
                      title={`${t.name} — ${t.note}`}
                      aria-label={`${t.name} theme`}
                      aria-pressed={active}
                      className="press flex aspect-square w-full items-center justify-center overflow-hidden border transition-[filter] duration-200 hover:brightness-[0.96]"
                      style={{
                        background: ground,
                        borderColor: active ? accent : `${ink}24`,
                        boxShadow: active ? `inset 0 0 0 1px ${accent}` : undefined,
                      }}
                    >
                      <span aria-hidden className="flex">
                        <span className="block h-6 w-6" style={{ background: ink }} />
                        <span aria-hidden className="block h-6 w-6" style={{ background: accent }} />
                      </span>
                    </button>
                    <span className="mt-2 flex items-center justify-center gap-1">
                      <span
                        className={`truncate font-sans text-[10px] uppercase tracking-[0.14em] ${
                          active ? '' : 'text-muted-foreground'
                        }`}
                        style={active ? { color: accent } : undefined}
                      >
                        {t.name}
                      </span>
                      {active && (
                        <span aria-hidden className="font-sans text-[10px]" style={{ color: accent }}>
                          ✓
                        </span>
                      )}
                    </span>
                  </span>
                )
              })}
            </div>
          </Group>

          <Group title="Identity" note="Name the archive and its chrome.">
            <div>
              <label htmlFor="archive-name" className="block text-[13px]">Archive name</label>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span id="archive-name-hint" className="rule-label">Shown in the home masthead</span>
                <span
                  id="archive-name-count"
                  aria-label={`${archiveNameLength} of ${ARCHIVE_NAME_MAX_LENGTH} characters`}
                  className="font-sans text-[10px] tabular-nums text-muted-foreground"
                >
                  {archiveNameLength}/{ARCHIVE_NAME_MAX_LENGTH}
                </span>
              </div>
              <input
                id="archive-name"
                value={settings.archiveName}
                onChange={(e) => set('archiveName', e.target.value)}
                maxLength={ARCHIVE_NAME_MAX_LENGTH * 2}
                spellCheck={false}
                autoComplete="off"
                aria-describedby="archive-name-hint archive-name-count"
                onBlur={(e) => {
                  const normalized = e.currentTarget.value.trim()
                  if (normalized !== settings.archiveName) set('archiveName', normalized)
                }}
                placeholder="Enter an archive name"
                className="mt-2 h-10 w-full border border-border bg-card px-3 font-display text-[16px] text-foreground outline-none placeholder:font-sans placeholder:text-[13px] placeholder:text-muted-foreground focus:border-[var(--primary)] focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
              />
              {archiveWords.length > 1 && (
                <div className="mt-3">
                  <label htmlFor="archive-italic-word" className="block text-[13px]">Italic word</label>
                  <span id="archive-italic-word-hint" className="rule-label mt-0.5 block">Choose the highlighted word in the masthead</span>
                  <div className="relative mt-2">
                    <select
                      id="archive-italic-word"
                      value={italicWordIndex}
                      onChange={(e) => {
                        const index = Number(e.target.value)
                        set('archiveItalicWordIndex', index === archiveWords.length - 1 ? -1 : index)
                      }}
                      aria-describedby="archive-italic-word-hint"
                      className="h-10 w-full cursor-pointer appearance-none border border-border bg-card px-3 pr-9 text-[13px] text-foreground outline-none focus:border-[var(--primary)] focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
                    >
                      {archiveWords.map((word, index) => (
                        <option key={`${index}-${word}`} value={index}>{index + 1}. {word}</option>
                      ))}
                    </select>
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground"
                    >
                      <path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>
              )}
              {settings.archiveName !== DEFAULT_ARCHIVE_NAME && (
                <div className="mt-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      set('archiveName', DEFAULT_ARCHIVE_NAME)
                      set('archiveItalicWordIndex', -1)
                    }}
                    className="press min-h-8 px-1 font-sans text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-1 focus-visible:outline-[var(--primary)]"
                  >
                    Reset to default
                  </button>
                </div>
              )}
            </div>
            <Toggle
              label="Shortcut hints"
              note="Show keyboard hints in the navigation bar."
              value={settings.showNavHints}
              onChange={(v) => set('showNavHints', v)}
            />
          </Group>

          <Group title="Presentation" note="How plates and ledgers are laid out.">
            <NumberStepper
              label="Library items per row"
              note="Columns in library plates grid"
              value={settings.libraryColumns}
              min={3}
              max={12}
              onChange={(v) => set('libraryColumns', v)}
            />
            <NumberStepper
              label="Discover items per row"
              note="Columns in discover plates grid"
              value={settings.discoverColumns}
              min={3}
              max={12}
              onChange={(v) => set('discoverColumns', v)}
            />
            <NumberStepper
              label="For You suggestions per row"
              note="Each category shelf stacks two rows"
              value={settings.shelfColumns}
              min={3}
              max={12}
              onChange={(v) => set('shelfColumns', v)}
            />
            <OptionsRow
              label="Poster image quality"
              note="Data-saver fetches smaller artwork"
              value={settings.posterQuality}
              options={[
                { id: 'standard', label: 'Standard' },
                { id: 'saver', label: 'Data-saver' },
              ]}
              onChange={(v) => set('posterQuality', v)}
            />
            <OptionsRow
              label="Ledger dates"
              note="How viewing dates read in Recently watched"
              value={settings.dateStyle}
              options={[
                { id: 'absolute', label: 'Absolute' },
                { id: 'relative', label: 'Relative' },
              ]}
              onChange={(v) => set('dateStyle', v)}
            />
            <Toggle
              label="Community scores"
              note="Show IMDb vote averages beside release years."
              value={settings.showCommunityScores}
              onChange={(v) => set('showCommunityScores', v)}
            />
          </Group>

          <Group title="Tracking" note="Defaults for logging what you watch.">
            <OptionsRow
              label="New titles land in"
              note="Starting status for additions from Discover"
              value={settings.defaultStatus}
              options={[
                { id: 'planned', label: 'Planned' },
                { id: 'watching', label: 'Watching' },
              ]}
              onChange={(v) => set('defaultStatus', v)}
            />
            <Toggle
              label="Open title after adding"
              note="Jump into the title sheet right after accession."
              value={settings.openAfterAdd}
              onChange={(v) => set('openAfterAdd', v)}
            />
            <OptionsRow
              label="Watch date prefill"
              note="Date stamped when marking a title watched"
              value={settings.defaultWatchDate}
              options={[
                { id: 'today', label: 'Today' },
                { id: 'blank', label: 'Blank' },
              ]}
              onChange={(v) => set('defaultWatchDate', v)}
            />
            <Toggle
              label="Hide episode descriptions"
              note="Hide descriptions for every installment."
              value={settings.hideSpoilers}
              onChange={(v) => set('hideSpoilers', v)}
            />
          </Group>

          <Group title="Library defaults" note="Where the shelves open.">
            <OptionsRow
              label="Default shelf tab"
              note="Tab selected when Library opens"
              value={settings.defaultShelfTab}
              options={[
                { id: 'all', label: 'All' },
                { id: 'movie', label: 'Movies' },
                { id: 'tv', label: 'TV' },
                { id: 'favorites', label: 'Favourites' },
              ]}
              onChange={(v) => set('defaultShelfTab', v)}
            />
            <OptionsRow
              label="Default order"
              note="Sort applied when Library opens"
              value={settings.defaultSort}
              options={[
                { id: 'added', label: 'Recently added' },
                { id: 'lastWatched', label: 'Last watched' },
                { id: 'title', label: 'A–Z' },
                { id: 'rating', label: 'My rating' },
                { id: 'year', label: 'Year' },
              ]}
              onChange={(v) => set('defaultSort', v)}
            />
          </Group>

          <Group title="Catalogue" note="Upstream catalogue behaviour.">
            <Toggle
              label="Show adult titles"
              note="Include adult-rated movies and series in search and discover results."
              value={settings.includeAdult}
              onChange={(v) => set('includeAdult', v)}
            />
            <div>
              <span className="block text-[13px]">Metadata language</span>
              <span className="rule-label mt-0.5 block">Titles and synopses served by TMDb</span>
              <div className="relative mt-2">
                <select
                  value={settings.metadataLanguage}
                  onChange={(e) => set('metadataLanguage', e.target.value)}
                  aria-label="Metadata language"
                  className="h-9 w-full cursor-pointer appearance-none border border-border bg-card px-2 pr-9 text-[13px] text-foreground outline-none focus:border-[var(--primary)]"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground"
                >
                  <path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          </Group>

          <Group title="Holdings & storage" note="Local archive state and persistence.">
            <div className="space-y-2">
              <div className="rule-label text-[10px]">Collection Overview</div>
              <div className="grid grid-cols-3 gap-2 border border-border bg-card p-3">
                <div>
                  <dt className="rule-label text-[9px]">Movies</dt>
                  <dd className="mt-1 font-display text-[26px] leading-none tabular-nums text-foreground">{counts.movie}</dd>
                </div>
                <div>
                  <dt className="rule-label text-[9px]">Series</dt>
                  <dd className="mt-1 font-display text-[26px] leading-none tabular-nums text-foreground">{counts.tv}</dd>
                </div>
                <div>
                  <dt className="rule-label text-[9px]">Total</dt>
                  <dd className="mt-1 font-display text-[26px] leading-none tabular-nums text-foreground">{counts.total}</dd>
                </div>
                <div>
                  <dt className="rule-label text-[9px]">Episodes</dt>
                  <dd className="mt-1 font-display text-[26px] leading-none tabular-nums text-foreground">{episodes}</dd>
                </div>
                <div>
                  <dt className="rule-label text-[9px]">Hours</dt>
                  <dd className="mt-1 font-display text-[26px] leading-none tabular-nums text-foreground">{hours}</dd>
                </div>
                <div>
                  <dt className="rule-label text-[9px]">Days</dt>
                  <dd className="mt-1 font-display text-[26px] leading-none tabular-nums text-foreground">{days}</dd>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-border">
              <div className="rule-label mb-2 text-[10px]">Library portability</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={exportLibrary}
                  className="press flex items-center justify-center border border-border bg-card py-2 font-sans text-[11px] font-medium uppercase tracking-[0.14em] text-foreground hover:border-[var(--foreground)] hover:bg-background"
                >
                  Export JSON
                </button>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="press flex items-center justify-center border border-border bg-card py-2 font-sans text-[11px] font-medium uppercase tracking-[0.14em] text-foreground hover:border-[var(--foreground)] hover:bg-background"
                >
                  Import JSON
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void importLibrary(file)
                    event.target.value = ''
                  }}
                />
              </div>
            </div>

            <div className="pt-3 border-t border-border">
              <div className="rule-label mb-2 text-[10px] text-[var(--destructive)]">Danger Zone</div>
              <button
                type="button"
                onClick={() => setConfirmWipe(true)}
                className="press flex w-full items-center justify-center border border-[var(--destructive)] bg-[var(--destructive)] py-2 font-sans text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--destructive-foreground)] hover:opacity-90"
              >
                Erase entire library
              </button>
            </div>
          </Group>
        </div>

        <ConfirmDialog
          open={confirmWipe}
          title="Erase Entire Archive"
          message={
            <span>
              This will permanently delete all <strong>{entries.length}</strong> titles and logged episodes from your local database.
              Export a JSON copy first if you want to preserve your records.
            </span>
          }
          confirmLabel="Erase all records"
          onCancel={() => setConfirmWipe(false)}
          onConfirm={() => {
            clear()
            setConfirmWipe(false)
          }}
        />
      </aside>
    </>
  )
}

function Group({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section className="px-6 py-6">
      <div className="mb-4">
        <h3 className="font-display text-[22px] leading-none">{title}</h3>
        {note && <p className="mt-1 text-[12px] text-muted-foreground">{note}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function Toggle({
  label,
  note,
  value,
  onChange,
}: {
  label: string
  note: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between gap-4 text-left"
    >
      <span>
        <span className="block text-[13px]">{label}</span>
        <span className="rule-label">{note}</span>
      </span>
      <span
        className={`relative box-border block h-5 w-10 shrink-0 border transition-colors ${
          value ? 'border-[var(--primary)] bg-[var(--primary)]' : 'border-border bg-secondary'
        }`}
      >
        <span
          className={`absolute left-0 top-[2px] block h-[14px] w-[14px] transition-transform duration-200 ${
            value ? 'translate-x-[22px] bg-[var(--primary-foreground)]' : 'translate-x-[2px] bg-background'
          }`}
        />
      </span>
    </button>
  )
}

/** Labelled single-choice chip row bound to a string-union setting. */
function OptionsRow<T extends string>({
  label,
  note,
  value,
  options,
  onChange,
}: {
  label: string
  note?: string
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div>
      <span className="block text-[13px]">{label}</span>
      {note && <span className="rule-label mt-0.5 block">{note}</span>}
      <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label={label} onKeyDown={handleRadioGroupKeyDown}>
        {options.map((o) => (
          <Chip key={o.id} role="radio" active={value === o.id} onClick={() => onChange(o.id)}>
            {o.label}
          </Chip>
        ))}
      </div>
    </div>
  )
}

function NumberStepper({
  label,
  note,
  value,
  min = 3,
  max = 12,
  onChange,
}: {
  label: string
  note?: string
  value: number
  min?: number
  max?: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <span className="block text-[13px]">{label}</span>
        {note && <span className="rule-label mt-0.5 block text-[10px]">{note}</span>}
      </div>
      <div className="flex items-center border border-border bg-card">
        <button
          type="button"
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          aria-label={`Decrease ${label}`}
          className="press flex h-7 w-7 items-center justify-center font-sans text-[13px] font-medium text-muted-foreground hover:bg-background hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
        >
          −
        </button>
        <span className="flex h-7 w-8 items-center justify-center border-x border-border font-sans text-[11px] font-medium tabular-nums text-foreground">
          {value}
        </span>
        <button
          type="button"
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          aria-label={`Increase ${label}`}
          className="press flex h-7 w-7 items-center justify-center font-sans text-[13px] font-medium text-muted-foreground hover:bg-background hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
        >
          +
        </button>
      </div>
    </div>
  )
}
