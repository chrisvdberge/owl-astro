import { useCallback, useEffect, useRef, useState } from 'react'
import { EMPTY, diff, pull, push, supabase, type Op } from './sync'
import type { Location } from './astro'
import { DEFAULT_SETTINGS, type MoonTolerance, type Settings } from './suitability'

export type Status = 'wishlist' | 'progress' | 'done'
export interface Framing { rotation: number; cols: number; rows: number; survey: string }
export interface Session { id: string; date: string; hours: number; note: string }
export interface WishItem { id: string; status: Status; goalHours?: number; notes: string; moon?: MoonTolerance; added: string; sessions?: Session[]; framing?: Framing }

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

export type SyncStatus = 'local' | 'syncing' | 'synced' | 'error'

export function useStore(userId: string | null) {
  const [state, setState] = useState<State>(load)
  const [status, setStatus] = useState<SyncStatus>('local')
  const ref = useRef(state)
  const pending = useRef(new Map<string, Op>())
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const ready = useRef(false)

  const persist = (s: State) => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* ignore */ } }

  const flush = useCallback(async () => {
    if (!supabase || !userId || !pending.current.size) return
    const ops = [...pending.current.values()]
    pending.current.clear()
    setStatus('syncing')
    try {
      await push(supabase, userId, ops)
      setStatus(pending.current.size ? 'syncing' : 'synced')
    } catch (e) {
      console.error('sync failed', e)
      for (const o of ops) if (!pending.current.has(`${o.table}:${o.id}`)) pending.current.set(`${o.table}:${o.id}`, o)
      setStatus('error')
    }
  }, [userId])

  const enqueue = useCallback((ops: Op[]) => {
    if (!supabase || !userId || !ready.current || !ops.length) return
    for (const o of ops) pending.current.set(`${o.table}:${o.id}`, o)
    setStatus('syncing')
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 700)
  }, [userId, flush])

  const update = useCallback((fn: (s: State) => State) => {
    const prev = ref.current
    const next = fn(prev)
    if (next === prev) return
    ref.current = next
    setState(next)
    persist(next)
    enqueue(diff(prev, next))
  }, [enqueue])

  // On sign-in: take the remote copy, or upload the local data when the account is new.
  useEffect(() => {
    ready.current = false
    if (!supabase || !userId) { setStatus('local'); return }
    let dead = false
    const hydrate = async (initial: boolean) => {
      if (!initial && (pending.current.size || !ready.current)) return
      try {
        setStatus('syncing')
        const remote = await pull(supabase!, ref.current.settings)
        if (dead) return
        if (remote) {
          if (JSON.stringify(remote) !== JSON.stringify({ ...ref.current })) { ref.current = remote; setState(remote); persist(remote) }
        } else if (initial) {
          ready.current = true
          enqueue(diff(EMPTY, ref.current))
          await flush()
        }
        ready.current = true
        if (!pending.current.size) setStatus('synced')
      } catch (e) {
        console.error('pull failed', e)
        if (!dead) setStatus('error')
      }
    }
    hydrate(true)
    const onVisible = () => { if (document.visibilityState === 'visible') hydrate(false) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { dead = true; document.removeEventListener('visibilitychange', onVisible); clearTimeout(timer.current) }
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const active = state.locations.find((l) => l.id === state.activeId) ?? state.locations[0]

  return {
    locations: state.locations,
    syncStatus: status,
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
