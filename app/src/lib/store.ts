import { useCallback, useState } from 'react'
import type { Location } from './astro'
import { DEFAULT_SETTINGS, type MoonTolerance, type Settings } from './suitability'

export type Status = 'wishlist' | 'progress' | 'done'
export interface Session { id: string; date: string; hours: number; note: string }
export interface WishItem { id: string; status: Status; goalHours?: number; notes: string; moon?: MoonTolerance; added: string; sessions?: Session[] }

// Persistence goes through this small interface so a Supabase implementation can replace localStorage later.
interface State { locations: Location[]; activeId: string; wishlist: WishItem[]; settings: Settings }

const KEY = 'astroplanner.v1'

const DEFAULT: State = {
  locations: [{ id: 'home', name: 'Home (Amsterdam)', lat: 52.37, lon: 4.9, elevation: 0, horizon: [] }],
  activeId: 'home',
  wishlist: [],
  settings: DEFAULT_SETTINGS,
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw) as State
      if (s.locations?.length) return { ...DEFAULT, ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings }, wishlist: s.wishlist ?? [] }
    }
  } catch { /* storage unavailable */ }
  return DEFAULT
}

export function useStore() {
  const [state, setState] = useState<State>(load)

  const update = useCallback((fn: (s: State) => State) => {
    setState((prev) => {
      const next = fn(prev)
      try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  const active = state.locations.find((l) => l.id === state.activeId) ?? state.locations[0]

  return {
    locations: state.locations,
    active,
    wishlist: state.wishlist,
    settings: state.settings,
    setSettings: (patch: Partial<Settings>) => update((s) => ({ ...s, settings: { ...s.settings, ...patch } })),
    addWish: (id: string) =>
      update((s) => (s.wishlist.some((w) => w.id === id) ? s : { ...s, wishlist: [...s.wishlist, { id, status: 'wishlist', notes: '', added: new Date().toISOString().slice(0, 10) }] })),
    patchWish: (id: string, patch: Partial<WishItem>) =>
      update((s) => ({ ...s, wishlist: s.wishlist.map((w) => (w.id === id ? { ...w, ...patch } : w)) })),
    addSession: (id: string, ses: Omit<Session, 'id'>) =>
      update((s) => ({
        ...s,
        wishlist: s.wishlist.map((w) => (w.id === id ? { ...w, status: w.status === 'wishlist' ? 'progress' : w.status, sessions: [...(w.sessions ?? []), { ...ses, id: crypto.randomUUID() }] } : w)),
      })),
    removeSession: (id: string, sid: string) =>
      update((s) => ({ ...s, wishlist: s.wishlist.map((w) => (w.id === id ? { ...w, sessions: (w.sessions ?? []).filter((x) => x.id !== sid) } : w)) })),
    removeWish: (id: string) => update((s) => ({ ...s, wishlist: s.wishlist.filter((w) => w.id !== id) })),
    setActive: (id: string) => update((s) => ({ ...s, activeId: id })),
    saveLocation: (loc: Location) =>
      update((s) => ({
        ...s,
        locations: s.locations.some((l) => l.id === loc.id) ? s.locations.map((l) => (l.id === loc.id ? loc : l)) : [...s.locations, loc],
        activeId: loc.id,
      })),
    deleteLocation: (id: string) =>
      update((s) => {
        if (s.locations.length <= 1) return s
        const locations = s.locations.filter((l) => l.id !== id)
        return { ...s, locations, activeId: s.activeId === id ? locations[0].id : s.activeId }
      }),
  }
}
