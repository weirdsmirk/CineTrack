import { useSyncExternalStore } from 'react'

export type PersistenceArea = 'library' | 'settings'
export type PersistenceState = 'loading' | 'saved' | 'saving' | 'error'

const states: Record<PersistenceArea, PersistenceState> = { library: 'loading', settings: 'loading' }
const listeners = new Set<() => void>()

export function setPersistenceState(area: PersistenceArea, state: PersistenceState) {
  if (states[area] === state) return
  states[area] = state
  for (const listener of [...listeners]) listener()
}

function getPersistenceState(): PersistenceState {
  if (states.library === 'error' || states.settings === 'error') return 'error'
  if (states.library === 'saving' || states.settings === 'saving') return 'saving'
  if (states.library === 'loading' || states.settings === 'loading') return 'loading'
  return 'saved'
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePersistenceState() {
  return useSyncExternalStore(subscribe, getPersistenceState, getPersistenceState)
}
