import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Location } from './astro'
import { upgradeWish, type FrameData, type Framing, type PlanBlock, type Session, type WishItem } from './store'
import type { Settings } from './suitability'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** null when no Supabase project is configured: the app then runs local-only. */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null

export interface Data { locations: Location[]; activeId: string; wishlist: WishItem[]; settings: Settings; plan: PlanBlock[] }

export type Op =
  | { table: 'locations' | 'wishlist' | 'sessions' | 'framings' | 'plan_blocks'; kind: 'upsert'; id: string; row: Record<string, unknown> }
  | { table: 'locations' | 'wishlist' | 'sessions' | 'framings' | 'plan_blocks'; kind: 'delete'; id: string }
  | { table: 'settings'; kind: 'upsert'; id: 'settings'; row: Record<string, unknown> }

const locRow = (l: Location) => ({ id: l.id, name: l.name, lat: l.lat, lon: l.lon, elevation: l.elevation, horizon: l.horizon, seeing: l.seeing ?? 3, tz: l.tz ?? null })
const wishRow = (w: WishItem) => ({ id: w.id, status: w.status, goal_hours: w.goalHours ?? null, notes: w.notes, moon: w.moon ?? null, added: w.added, custom: w.custom ?? null, ...(w.priority ? { priority: w.priority } : {}) })
const framRow = (w: string, f: Framing) => { const { id, name, created, thumb, ...data } = f; return { id, wish_id: w, name, created, thumb: thumb ?? null, data } }
const planRow = (b: PlanBlock) => ({ id: b.id, date: b.date, target_id: b.targetId, start_min: b.start, end_min: b.end })
const sesRow = (w: string, s: Session) => ({ id: s.id, wish_id: w, date: s.date, hours: s.hours, note: s.note })
const setRow = (d: Data) => ({ min_alt: d.settings.minAlt, min_hours: d.settings.minHours, active_id: d.activeId, ...(d.settings.scope ? { scope: d.settings.scope } : {}) })

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function diffRows(table: Op['table'], prev: Map<string, Record<string, unknown>>, next: Map<string, Record<string, unknown>>): Op[] {
  const ops: Op[] = []
  for (const [id, row] of next) if (!same(prev.get(id), row)) ops.push({ table, kind: 'upsert', id, row } as Op)
  for (const id of prev.keys()) if (!next.has(id)) ops.push({ table, kind: 'delete', id } as Op)
  return ops
}

const locMap = (d: Data) => new Map(d.locations.map((l) => [l.id, locRow(l)]))
const wishMap = (d: Data) => new Map(d.wishlist.map((w) => [w.id, wishRow(w)]))
const framMap = (d: Data) => new Map(d.wishlist.flatMap((w) => (w.framings ?? []).map((f) => [f.id, framRow(w.id, f)] as const)))
const planMap = (d: Data) => new Map(d.plan.map((b) => [b.id, planRow(b)]))
const sesMap = (d: Data) => new Map(d.wishlist.flatMap((w) => (w.sessions ?? []).map((s) => [s.id, sesRow(w.id, s)] as const)))

/** What has to be written remotely to turn `prev` into `next`. */
export function diff(prev: Data, next: Data): Op[] {
  const ops = [
    ...diffRows('locations', locMap(prev), locMap(next)),
    ...diffRows('wishlist', wishMap(prev), wishMap(next)),
    ...diffRows('sessions', sesMap(prev), sesMap(next)),
    ...diffRows('framings', framMap(prev), framMap(next)),
    ...diffRows('plan_blocks', planMap(prev), planMap(next)),
  ]
  if (!same(setRow(prev), setRow(next))) ops.push({ table: 'settings', kind: 'upsert', id: 'settings', row: setRow(next) })
  return ops
}

export const EMPTY: Data = { locations: [], activeId: '', wishlist: [], settings: { minAlt: 25, minHours: 2 }, plan: [] }

/** Loads everything for the signed-in user; returns null when they have no locations yet (a new account). */
export async function pull(db: SupabaseClient, fallback: Settings): Promise<Data | null> {
  const [l, w, s, st, fr, pl] = await Promise.all([
    db.from('locations').select('*'), db.from('wishlist').select('*'), db.from('sessions').select('*'), db.from('settings').select('*').maybeSingle(), db.from('framings').select('*'), db.from('plan_blocks').select('*'),
  ])
  // plan_blocks arrived later: a database without it yet (42P01) just has no plan
  const pb = pl.error?.code === '42P01' ? { data: [] as Record<string, never>[] } : pl
  for (const r of [l, w, s, st, fr]) if (r.error) throw r.error
  if (pl.error && pl.error.code !== '42P01') throw pl.error
  if (!l.data?.length && !w.data?.length) return null
  const sessions = new Map<string, Session[]>()
  for (const r of s.data ?? []) sessions.set(r.wish_id, [...(sessions.get(r.wish_id) ?? []), { id: r.id, date: r.date, hours: r.hours, note: r.note }])
  const framings = new Map<string, Framing[]>()
  for (const r of fr.data ?? []) framings.set(r.wish_id, [...(framings.get(r.wish_id) ?? []), { ...(r.data as FrameData), id: r.id, name: r.name, created: r.created, thumb: r.thumb ?? undefined }])
  const plan: PlanBlock[] = (pb.data ?? []).map((r: Record<string, unknown>) => ({ id: r.id as string, date: r.date as string, targetId: r.target_id as string, start: r.start_min as number, end: r.end_min as number }))
  const locations: Location[] = (l.data ?? []).map((r) => ({ id: r.id, name: r.name, lat: r.lat, lon: r.lon, elevation: r.elevation, horizon: r.horizon ?? [], seeing: r.seeing ?? 3, tz: r.tz ?? undefined }))
  return {
    locations,
    activeId: st.data?.active_id && locations.some((x) => x.id === st.data.active_id) ? st.data.active_id : locations[0]?.id ?? '',
    // rows saved before the framings table existed still carry one framing + thumb: upgradeWish folds them in
    wishlist: (w.data ?? []).map((r) => upgradeWish({
      id: r.id, status: r.status, goalHours: r.goal_hours ?? undefined, notes: r.notes, moon: r.moon ?? undefined, priority: r.priority ?? undefined, added: r.added, custom: r.custom ?? undefined,
      framing: r.framing ?? undefined, thumb: r.thumb ?? undefined,
      sessions: sessions.get(r.id) ?? [], framings: framings.get(r.id),
    })),
    settings: { minAlt: st.data?.min_alt ?? fallback.minAlt, minHours: st.data?.min_hours ?? fallback.minHours, scope: st.data?.scope ?? undefined },
    plan,
  }
}

/** Applies ops in dependency order: parents before children on write, children before parents on delete. */
export async function push(db: SupabaseClient, userId: string, ops: Op[]) {
  const up = (t: Op['table']) => ops.filter((o) => o.table === t && o.kind === 'upsert') as Extract<Op, { kind: 'upsert' }>[]
  const del = (t: Op['table']) => ops.filter((o) => o.table === t && o.kind === 'delete').map((o) => o.id)
  const run = async (p: PromiseLike<{ error: unknown }>) => { const { error } = await p; if (error) throw error }
  for (const t of ['locations', 'wishlist', 'sessions', 'framings', 'plan_blocks'] as const) {
    const rows = up(t).map((o) => ({ ...o.row, user_id: userId }))
    if (rows.length) await run(db.from(t).upsert(rows))
  }
  const st = up('settings')[0]
  if (st) await run(db.from('settings').upsert({ ...st.row, user_id: userId }))
  for (const t of ['plan_blocks', 'framings', 'sessions', 'wishlist', 'locations'] as const) {
    const ids = del(t)
    if (ids.length) await run(db.from(t).delete().in('id', ids))
  }
}
