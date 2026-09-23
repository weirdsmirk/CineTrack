import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import Discover, { dealSuggestions, plateKey, shuffleWithSeed } from './Discover'
import { ToastProvider } from './Toast'
import { useSettings } from '../lib/settings'
import type { TmdbTitle } from '../lib/tmdb'

const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  genreList: vi.fn(),
  recommendations: vi.fn(),
  searchMulti: vi.fn(),
  trending: vi.fn(),
}))

// Keep the real helpers (img, titleOf, yearOf…) and stub only the network calls.
vi.mock('../lib/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tmdb')>()
  return { ...actual, ...mocks }
})

function title(id: number, overrides: Partial<TmdbTitle> = {}): TmdbTitle {
  return {
    id,
    media_type: 'movie',
    title: `Title ${id}`,
    poster_path: null,
    backdrop_path: null,
    overview: '',
    vote_average: 0,
    ...overrides,
  }
}

const pool = (n: number) => Array.from({ length: n }, (_, i) => title(i + 1))
const ids = (list: TmdbTitle[]) => list.map((t) => t.id)

describe('dealSuggestions', () => {
  it('deals two rows worth of plates without repeating a title', () => {
    const hand = dealSuggestions([], pool(30), 12, 1)
    expect(hand).toHaveLength(12)
    expect(new Set(ids(hand)).size).toBe(12)
  })

  it('re-deals different plates when the shuffle seed moves on', () => {
    const source = pool(30)
    expect(ids(dealSuggestions([], source, 6, 1))).not.toEqual(ids(dealSuggestions([], source, 6, 2)))
  })

  it('is deterministic, so a dealt hand survives re-renders', () => {
    const source = pool(30)
    expect(ids(dealSuggestions([], source, 9, 4))).toEqual(ids(dealSuggestions([], source, 9, 4)))
  })

  it('leads with the batch a shuffle just pulled', () => {
    const fresh = pool(6)
    const hand = dealSuggestions(fresh, pool(30), 12, 3)
    expect(hand).toHaveLength(12)
    expect(ids(hand).slice(0, fresh.length).sort((a, b) => a - b)).toEqual(ids(fresh))
  })

  it('never repeats a title held by both the batch and the pool', () => {
    const shared = pool(4)
    const hand = dealSuggestions(shared, [...shared, ...pool(30).slice(4)], 12, 5)
    expect(hand).toHaveLength(12)
    expect(new Set(ids(hand)).size).toBe(12)
  })

  it('deals what it has when the pool is shallower than two rows', () => {
    const hand = dealSuggestions([], pool(3), 12, 1)
    expect(ids(hand).sort((a, b) => a - b)).toEqual([1, 2, 3])
  })
})


function shelfPlates(pageNo: number, count = 20): TmdbTitle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: pageNo * 100 + i,
    media_type: 'movie' as const,
    title: `Trending ${pageNo}.${i}`,
    poster_path: null,
    backdrop_path: null,
    overview: '',
    vote_average: 0,
  }))
}

function pageResult(results: TmdbTitle[], pageNo: number) {
  return { page: pageNo, total_pages: 10, results }
}

/** Drives a shelf setting from a test without reaching past the store hook. */
function ShelfWidth({ columns }: { columns: number }) {
  const { set } = useSettings()
  useEffect(() => {
    set('shelfColumns', columns)
  }, [columns, set])
  return null
}

describe('For You shelves', () => {
  beforeEach(() => {
    mocks.genreList.mockReset().mockResolvedValue([])
    mocks.discover.mockReset().mockResolvedValue(pageResult([], 1))
    mocks.recommendations.mockReset().mockResolvedValue(pageResult([], 1))
    mocks.searchMulti.mockReset().mockResolvedValue(pageResult([], 1))
    mocks.trending
      .mockReset()
      .mockImplementation((_type: string, _window: string, pageNo = 1) =>
        Promise.resolve(pageResult(shelfPlates(pageNo), pageNo)),
      )
  })

  it('stacks two rows of suggestions and swaps them on shuffle', async () => {
    render(
      <ToastProvider>
        <ShelfWidth columns={6} />
        <Discover onOpen={() => {}} />
      </ToastProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'Trending this week' })).toBeInTheDocument()
    const grid = document.querySelector('.poster-grid-dynamic') as HTMLElement
    expect(grid.style.getPropertyValue('--grid-desktop-cols')).toBe('6')

    const before = (await screen.findAllByRole('button', { name: /^Open Trending 1\./ })).map((b) =>
      b.getAttribute('aria-label'),
    )
    expect(before).toHaveLength(12)

    fireEvent.click(screen.getByRole('button', { name: 'Shuffle Trending this week suggestions' }))
    const dealt = screen.getAllByRole('button', { name: /^Open / }).map((b) => b.getAttribute('aria-label'))
    expect(dealt).not.toEqual(before)

    await waitFor(() => expect(mocks.trending).toHaveBeenLastCalledWith('all', 'week', 2, expect.anything()))
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Open Trending 2\./ }).length).toBeGreaterThan(0))
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(12)
  })

  it('takes the row width from settings', async () => {
    render(
      <ToastProvider>
        <ShelfWidth columns={4} />
        <Discover onOpen={() => {}} />
      </ToastProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'Trending this week' })).toBeInTheDocument()
    expect(await screen.findAllByRole('button', { name: /^Open Trending 1\./ })).toHaveLength(8)
    const grid = document.querySelector('.poster-grid-dynamic') as HTMLElement
    expect(grid.style.getPropertyValue('--grid-desktop-cols')).toBe('4')
  })
})

describe('shuffleWithSeed', () => {
  it('keeps every entry, reorders them, and leaves the source untouched', () => {
    const source = pool(12)
    const out = shuffleWithSeed(source, 7)
    expect(ids(out).sort((a, b) => a - b)).toEqual(ids(source))
    expect(ids(out)).not.toEqual(ids(source))
    expect(ids(source)).toEqual(ids(pool(12)))
  })
})

describe('plateKey', () => {
  it('identifies TV entries and falls back to movie when TMDb omits the type', () => {
    expect(plateKey(title(42, { media_type: 'tv' }))).toBe('tv-42')
    expect(plateKey(title(42, { media_type: undefined }))).toBe('movie-42')
    expect(plateKey(title(42, { media_type: undefined, title: undefined }))).toBe('tv-42')
    expect(plateKey(title(42))).toBe(plateKey(title(42, { title: 'Renamed' })))
  })
})
