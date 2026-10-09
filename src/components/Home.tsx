import { Suspense, lazy, useMemo, useState } from 'react'
import { img, type MediaType, type TmdbTitle } from '../lib/tmdb'
import { countRewatches, formatDayMonth, formatRelativeDay, minutesWatched, progress, recentCompletions, useLibrary, watchedCount } from '../lib/library'
import { useSettings } from '../lib/settings'
import type { LibraryView } from './Library'
import { Empty, SectionHead, Stat } from './ui'
import MastheadName from './MastheadName'

const MonthlyChart = lazy(() => import('./MonthlyChart'))
const TITLE_STOP_WORDS = new Set(['a', 'an', 'and', 'of', 'the'])

// ponytail: title tokens approximate franchise membership; use collection IDs if the library stores them.
function titleWords(title: string) {
  return [...new Set((title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => !TITLE_STOP_WORDS.has(word)))]
}

function sharesTitleFamily(a: string, b: string) {
  const aWords = titleWords(a)
  const bWords = titleWords(b)
  if (!aWords.length || !bWords.length) return false

  const smaller = aWords.length <= bWords.length ? aWords : bWords
  const larger = aWords.length <= bWords.length ? bWords : aWords
  const shared = smaller.filter((word) => larger.includes(word))
  const exactMatch = aWords.length === bWords.length && shared.length === aWords.length
  return exactMatch || (shared.length >= 2 && shared.length / smaller.length >= 0.4) ||
    (shared.length === 1 && smaller.length === 1 && smaller[0].length >= 6)
}

function pickDiverse<T extends { title: string }>(items: T[], count: number) {
  const shuffled = [...items]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  const picks: T[] = []
  for (const item of shuffled) {
    if (picks.every((pick) => !sharesTitleFamily(pick.title, item.title))) picks.push(item)
    if (picks.length === count) return picks
  }

  // If the shelf is mostly one franchise, fill the remaining slots anyway.
  for (const item of shuffled) {
    if (!picks.includes(item)) picks.push(item)
    if (picks.length === count) break
  }
  return picks
}

export default function Home({
  onOpen,
  onLibraryNavigate,
}: {
  onOpen: (t: MediaType, id: number, seed?: TmdbTitle) => void
  onLibraryNavigate: (view: LibraryView) => void
}) {
  const { entries } = useLibrary()
  const { settings } = useSettings()

  const stats = useMemo(() => {
    const movies = entries.filter((e) => e.mediaType === 'movie')
    const shows = entries.filter((e) => e.mediaType === 'tv')
    const moviesSeen = movies.filter((m) => m.status === 'watched' || m.watchedAt != null).length
    const showsSeen = shows.filter((s) => s.status === 'watched' || s.watchedAt != null).length
    const mins = minutesWatched(entries)
    const rated = entries.filter((e) => e.rating)
    return {
      total: entries.length,
      favorites: entries.filter((e) => e.favorite).length,
      rewatches: countRewatches(entries),
      moviesSeen,
      moviesTotal: movies.length,
      showsSeen,
      showsTotal: shows.length,
      hours: Math.round(mins / 60),
      days: (mins / 1440).toFixed(1),
      avg: rated.length ? (rated.reduce((s, e) => s + (e.rating ?? 0), 0) / rated.length).toFixed(1) : '—',
      inProgress: entries.filter((e) => e.status === 'watching' || (e.mediaType === 'tv' && e.rewatching)),
      planned: entries.filter((e) => e.status === 'planned'),
    }
  }, [entries])

  const activity = useMemo(() => recentCompletions(entries, 10), [entries])
  const hasData = entries.length > 0

  const [shuffleKey, setShuffleKey] = useState(0)
  const suggestions = useMemo(() => {
    return pickDiverse(stats.planned, 3)
  }, [stats.planned, shuffleKey])

  return (
    <div className="space-y-16">
      <section>
        <div className="border-b border-border pb-6">

          {/* Masthead keeps the full archive name to two balanced lines. */}
          <h1 className="mt-3 w-full max-w-full font-display text-[clamp(22px,6.2vw,92px)] leading-[0.95] tracking-tight">
            <MastheadName name={settings.archiveName} italicWordIndex={settings.archiveItalicWordIndex} />
          </h1>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Titles held" value={stats.total} onClick={() => onLibraryNavigate({ tab: 'all', filter: 'all' })} />
          <Stat label="Films seen" value={stats.moviesSeen} unit={`/ ${stats.moviesTotal}`} onClick={() => onLibraryNavigate({ tab: 'movie', filter: 'watched' })} />
          <Stat label="Shows seen" value={stats.showsSeen} unit={`/ ${stats.showsTotal}`} onClick={() => onLibraryNavigate({ tab: 'tv', filter: 'watched' })} />
          <Stat label="Favourites" value={stats.favorites} onClick={() => onLibraryNavigate({ tab: 'favorites', filter: 'all' })} />
          <Stat label="Rewatches" value={stats.rewatches} onClick={() => onLibraryNavigate({ tab: 'all', filter: 'rewatched' })} />
          <Stat label="Time in seat" value={stats.hours} unit="hrs" onClick={() => document.getElementById('monthly-log')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })} />
        </div>
      </section>

      <section>
        <SectionHead title="Currently in progress" note="Series, films, and rewatches left mid-viewing." rule={false} />
        {stats.inProgress.length === 0 ? (
          <Empty>Nothing underway — visit Discover to begin a title</Empty>
        ) : (
          <div className="grid gap-px border border-border bg-border md:grid-cols-2">
            {stats.inProgress.slice(0, 2).map((e, i) => (
              <button
                key={`${e.mediaType}-${e.id}`}
                onClick={() => onOpen(e.mediaType, e.id)}
                style={{ animationDelay: `${i * 55}ms` }}
                className={`group animate-rise flex items-center gap-4 bg-background p-4 text-left transition-colors duration-300 hover:bg-card ${
                  stats.inProgress.length === 1 ? 'md:col-span-2' : ''
                }`}
              >
                {img(e.poster, 'w185') && (
                  <img
                    src={img(e.poster, 'w185')!}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width={64}
                    height={96}
                    className="h-24 w-16 shrink-0 border border-border object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[21px] leading-tight group-hover:text-[var(--primary)]">
                    {e.title}
                  </span>
                  <span className="rule-label">
                    {e.mediaType === 'tv'
                      ? `${e.rewatching ? Object.keys(e.rewatchEpisodes).length : watchedCount(e)} of ${e.totalEpisodes ?? '?'} episodes${e.rewatching ? ' · Rewatching' : ''}`
                      : 'Film · in progress'}
                  </span>
                  {e.mediaType === 'tv' && (
                    <span className="mt-2 block h-[3px] w-full bg-secondary">
                      <span
                        className="animate-grow block h-full bg-[var(--primary)] transition-[width] duration-500 ease-out"
                        style={{ width: `${progress(e) * 100}%` }}
                      />
                    </span>
                  )}
                </span>
                {e.mediaType === 'tv' && (
                  <span className="font-sans text-[11px] tabular-nums text-muted-foreground">
                    {Math.round(progress(e) * 100)}%
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-8 md:grid-cols-[1.2fr_1fr] xl:grid-cols-[1fr_1.2fr]">
        <div>
          <SectionHead title="Recently watched" note="A running ledger of the last entries marked seen." rule={false} />
          {activity.length === 0 ? (
            <Empty>No viewings recorded</Empty>
          ) : (
            <ol className="divide-y divide-border border-y border-border">
              {activity.map((a, i) => (
                <li key={`${a.entry.id}-${a.at}-${i}`} className="animate-rise" style={{ animationDelay: `${i * 40}ms` }}>
                  <button
                    onClick={() => onOpen(a.entry.mediaType, a.entry.id)}
                    className="group flex w-full items-baseline gap-4 py-[12.5px] text-left transition-colors duration-200 hover:text-[var(--primary)]"
                  >
                    <span className="min-w-0 flex-1 truncate font-sans text-[16px] transition-transform duration-300 group-hover:translate-x-1">
                      {a.entry.title}
                    </span>
                    <span className="flex shrink-0 items-baseline gap-3 sm:gap-5">
                      <span className="font-sans text-[10px] text-[var(--accent)]">{a.label}</span>
                      <span className="min-w-[3.5rem] text-right font-sans text-[10px] tabular-nums text-muted-foreground">
                        {settings.dateStyle === 'relative' ? formatRelativeDay(a.at) : formatDayMonth(a.at)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex min-w-0 flex-col">
          <SectionHead
            title="Feeling lucky?"
            note="Three random picks from your shelf."
            rule={false}
            right={
              stats.planned.length > 3 ? (
                <button
                  onClick={() => setShuffleKey((k) => k + 1)}
                  aria-label="Shuffle recommendations"
                  className="press inline-flex items-center gap-2 border border-border px-3.5 py-2 font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
                >
                  <span aria-hidden className="text-[14px] leading-none">↻</span> Shuffle
                </button>
              ) : undefined
            }
          />
          {stats.planned.length === 0 ? (
            <div className="flex min-h-40 items-center gap-5 border border-dashed border-border px-6 py-8">
              <span aria-hidden className="font-display text-4xl italic text-[var(--primary)]">∅</span>
              <p className="max-w-[34ch] text-[13px] leading-relaxed text-muted-foreground">
                Your watchlist is waiting for its first feature.{' '}
                <a href="#discover" className="text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-[var(--primary)]">
                  Find something in Discover <span aria-hidden>→</span>
                </a>
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 items-start gap-3 sm:gap-4 xl:gap-4">
                {suggestions.map((e, i) => (
                  <button
                    key={`${e.mediaType}-${e.id}-${shuffleKey}-${i}`}
                    onClick={() => onOpen(e.mediaType, e.id)}
                    style={{ animationDelay: `${i * 60}ms` }}
                    aria-label={`Open ${e.title}`}
                    className="group animate-rise mx-auto flex w-full max-w-[300px] flex-col text-left"
                  >
                    <span className="relative block aspect-[2/3] w-full overflow-hidden border border-border bg-card transition-colors group-hover:border-[var(--primary)] group-focus-visible:border-[var(--primary)]">
                      {img(e.poster, 'w500') ? (
                        <img src={img(e.poster, 'w500')!} alt="" loading="lazy" decoding="async" width={300} height={450} className="h-full w-full object-contain transition-opacity duration-300 group-hover:opacity-90" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center font-display text-4xl text-muted-foreground">
                          {e.title.slice(0, 1)}
                        </span>
                      )}
                      <span className="absolute left-2 top-2 border border-border bg-background/90 px-1.5 py-1 font-sans text-[9px] tabular-nums text-muted-foreground">
                        0{i + 1}
                      </span>
                    </span>
                    <span className="mt-3 line-clamp-2 font-sans text-[13px] leading-tight transition-colors group-hover:text-[var(--primary)] sm:text-[15px]">
                      {e.title}
                    </span>
                    <span className="rule-label mt-1.5">
                      {e.mediaType === 'movie' ? 'Film' : 'Series'} <span className="px-1 text-border">/</span> {e.year || '—'}
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border pt-3 rule-label">
                <span>{stats.planned.length} titles on your shelf</span>
                <span><span className="text-[var(--primary)]">{String(suggestions.length).padStart(2, '0')}</span> selected</span>
              </div>
            </>
          )}
        </div>
      </section>

      <div id="monthly-log" className="scroll-mt-24">
        <Suspense
          fallback={
            <section aria-label="Monthly log loading">
              <SectionHead title="Monthly log" note="Completed titles in each of the trailing twelve months." rule={false} />
              <div className="w-full border border-border bg-card p-4 shimmer" style={{ height: 232 }} />
            </section>
          }
        >
          <MonthlyChart entries={entries} />
        </Suspense>
      </div>

      {!hasData && (
        <p className="border-t border-border pt-6 text-[13px] leading-relaxed text-muted-foreground">
          Your archive is empty. Head to{' '}
          <a href="#discover" className="font-medium text-foreground underline underline-offset-4 hover:text-[var(--primary)]">
            Discover
          </a>{' '}
          to search TMDb and add your first title. Your archive is stored locally on this device.
        </p>
      )}
    </div>
  )
}
