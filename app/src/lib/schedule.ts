import { scoreNights, ephemeris, type MoonTolerance, type Settings } from './suitability'
import type { CatObject } from './catalog'
import type { Location } from './astro'
import type { PlanBlock } from './store'

export const SLOT = 20      // minutes per ephemeris sample
export const MIN_BLOCK = 20 // minutes

export const parseNight = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }

/** Free stretches of the dark window [d0, d1] between the scheduled blocks (minutes after 17:00). */
export function freeGaps(blocks: { start: number; end: number }[], d0: number, d1: number): [number, number][] {
  const out: [number, number][] = []
  let cur = d0
  for (const b of [...blocks].sort((a, c) => a.start - c.start)) { if (b.start - cur >= MIN_BLOCK) out.push([cur, b.start]); cur = Math.max(cur, b.end) }
  if (d1 - cur >= MIN_BLOCK) out.push([cur, d1])
  return out
}

/** Longest stretch within [from, to] (minutes) where the target is usable; `usable` holds one flag per SLOT. */
export function bestRun(usable: boolean[], from: number, to: number): [number, number] | null {
  let best: [number, number] | null = null, start = -1
  const last = Math.ceil(to / SLOT)
  for (let i = Math.floor(from / SLOT); i <= last; i++) {
    const ok = i < usable.length && usable[i] && (i + 1) * SLOT > from && i * SLOT < to
    if (ok && start < 0) start = i
    if ((!ok || i === last) && start >= 0) {
      const a = Math.max(from, start * SLOT), b = Math.min(to, (ok ? i + 1 : i) * SLOT)
      if (b - a >= MIN_BLOCK && (!best || b - a > best[1] - best[0])) best = [a, b]
      start = -1
    }
  }
  return best
}

/** Puts a target on a night's schedule in the free slot where it is usable longest (up to `maxMin`). Returns a message when it does not fit. */
export function placeOnNight(a: {
  loc: Location; settings: Settings; plan: PlanBlock[]; night: string; o: CatObject; moon?: MoonTolerance; maxMin?: number
  add: (b: PlanBlock) => void
}): string | null {
  const nights = ephemeris(a.loc, parseNight(a.night), 1)
  const samples = nights[0].samples
  const dark = samples.flatMap((s, i) => (s.sun < -12 ? [i] : []))
  if (!dark.length) return 'No astronomical darkness on that night'
  const d0 = dark[0] * SLOT, d1 = (dark[dark.length - 1] + 1) * SLOT
  const r = scoreNights(a.loc, a.o, nights, a.settings, a.moon)[0]
  let best: [number, number] | null = null
  for (const [from, to] of freeGaps(a.plan.filter((b) => b.date === a.night), d0, d1)) {
    const run = bestRun(r.usable, from, to)
    if (run && (!best || run[1] - run[0] > best[1] - best[0])) best = run
  }
  if (!best) return 'No free time on that night where it is usable'
  a.add({ id: crypto.randomUUID(), date: a.night, targetId: a.o.id, start: best[0], end: Math.min(best[1], best[0] + (a.maxMin ?? 120)) })
  return null
}
