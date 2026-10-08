import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Location } from './astro'
import type { Session, WishItem } from './store'
import type { Settings } from './suitability'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** null when no Supabase project is configured: the app then runs local-only. */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null

export interface Data { locations: Location[]; activeId: string; wishlist: WishItem[]; settings: Settings }

export type Op =
  | { table: 'locations' | 'wishlist' | 'sessions'; kind: 'upsert'; id: string; row: Record<string, unknown> }
  | { table: 'locations' | 'wishlist' | 'sessions'; kind: 'delete'; id: string }
  | { table: 'settings'; kind: 'upsert'; id: 'settings'; row: Record<string, unknown> }

const locRow = (l: Location) => ({ id: l.id, name: l.name, lat: l.lat, lon: l.lon, elevation: l.elevation, horizon: l.horizon, seeing: l.seeing ?? 3, tz: l.tz ?? null })
const wishRow = (w: WishItem) => ({ id: w.id, status: w.status, goal_hours: w.goalHours ?? null, notes: w.notes, moon: w.moon ?? null, added: w.added, framing: w.framing ?? null })
const sesRow = (w: string, s: Session) => ({ id: s.id, wish_id: w, date: s.date, hours: s.hours, note: s.note })
const setRow = (d: Data) => ({ min_alt: d.settings.minAlt, min_hours: d.settings.minHours, active_id: d.activeId })

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function diffRows(table: Op['table'], prev: Map<string, Record<string, unknown>>, next: Map<string, Record<string, unknown>>): Op[] {
  const ops: Op[] = []
  for (const [id, row] of next) if (!same(prev.get(id), row)) ops.push({ table, kind: 'upsert', id, row } as Op)
  for (const id of prev.keys()) if (!next.has(id)) ops.push({ table, kind: 'delete', id } as Op)
  return ops
}

const locMap = (d: Data) => new Map(d.locations.map((l) => [l.id, locRow(l)]))
const wishMap = (d: Data) => new Map(d.wishlist.map((w) => [w.id, wishRow(w)]))
const sesMap = (d: Data) => new Map(d.wishlist.flatMap((w) => (w.sessions ?? []).map((s) => [s.id, sesRow(w.id, s)] as const)))

/** What has to be written remotely to turn `prev` into `next`. */
export function diff(prev: Data, next: Data): Op[] {
  const ops = [
    ...diffRows('locations', locMap(prev), locMap(next)),
    ...diffRows('wishlist', wishMap(prev), wishMap(next)),
    ...diffRows('sessions', sesMap(prev), sesMap(next)),
  ]
  if (!same(setRow(prev), setRow(next))) ops.push({ table: 'settings', kind: 'upsert', id: 'settings', row: setRow(next) })
  return ops
}

export const EMPTY: Data = { locations: [], activeId: '', wishlist: [], settings: { minAlt: 25, minHours: 2 } }

/** Loads everything for the signed-in user; returns null when they have no locations yet (a new account). */
export async function pull(db: SupabaseClient, fallback: Settings): Promise<Data | null> {
  const [l, w, s, st] = await Promise.all([
    db.from('locations').select('*'), db.from('wishlist').select('*'), db.from('sessions').select('*'), db.from('settings').select('*').maybeSingle(),
  ])
  for (const r of [l, w, s, st]) if (r.error) throw r.error
  if (!l.data?.length && !w.data?.length) return null
  const sessions = new Map<string, Session[]>()
  for (const r of s.data ?? []) sessions.set(r.wish_id, [...(sessions.get(r.wish_id) ?? []), { id: r.id, date: r.date, hours: r.hours, note: r.note }])
  const locations: Location[] = (l.data ?? []).map((r) => ({ id: r.id, name: r.name, lat: r.lat, lon: r.lon, elevation: r.elevation, horizon: r.horizon ?? [], seeing: r.seeing ?? 3, tz: r.tz ?? undefined }))
  return {
    locations,
    activeId: st.data?.active_id && locations.some((x) => x.id === st.data.active_id) ? st.data.active_id : locations[0]?.id ?? '',
    wishlist: (w.data ?? []).map((r) => ({
      id: r.id, status: r.status, goalHours: r.goal_hours ?? undefined, notes: r.notes, moon: r.moon ?? undefined, added: r.added, framing: r.framing ?? undefined,
      sessions: sessions.get(r.id) ?? [],
    })),
    settings: { minAlt: st.data?.min_alt ?? fallback.minAlt, minHours: st.data?.min_hours ?? fallback.minHours },
  }
}

/** Applies ops in dependency order: parents before children on write, children before parents on delete. */
export async function push(db: SupabaseClient, userId: string, ops: Op[]) {
  const up = (t: Op['table']) => ops.filter((o) => o.table === t && o.kind === 'upsert') as Extract<Op, { kind: 'upsert' }>[]
  const del = (t: Op['table']) => ops.filter((o) => o.table === t && o.kind === 'delete').map((o) => o.id)
  const run = async (p: PromiseLike<{ error: unknown }>) => { const { error } = await p; if (error) throw error }
  for (const t of ['locations', 'wishlist', 'sessions'] as const) {
    const rows = up(t).map((o) => ({ ...o.row, user_id: userId }))
    if (rows.length) await run(db.from(t).upsert(rows))
  }
  const st = up('settings')[0]
  if (st) await run(db.from('settings').upsert({ ...st.row, user_id: userId }))
  for (const t of ['sessions', 'wishlist', 'locations'] as const) {
    const ids = del(t)
    if (ids.length) await run(db.from(t).delete().in('id', ids))
  }
}
