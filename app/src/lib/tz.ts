import tzlookup from 'tz-lookup'
import type { Location } from './astro'

export const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone

export const validTz = (tz: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false } }

/** IANA zone of a location (falls back to the browser's zone). */
export const tzOf = (l: Location) => l.tz && validTz(l.tz) ? l.tz : browserTz

/** Zone for a coordinate pair, or undefined over open ocean / bad input. */
export function tzFromCoords(lat: number, lon: number): string | undefined {
  try { return tzlookup(lat, lon) } catch { return undefined }
}

const fmt = new Map<string, Intl.DateTimeFormat>()
function parts(tz: string, ms: number) {
  let f = fmt.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    fmt.set(tz, f)
  }
  const o: Record<string, number> = {}
  for (const p of f.formatToParts(ms)) if (p.type !== 'literal') o[p.type] = +p.value
  return o
}

/** Offset of `tz` from UTC at an instant, in ms. */
const offsetMs = (tz: string, ms: number) => {
  const p = parts(tz, ms)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000
}

/** Epoch ms of a wall-clock time (y, m 1-12, d, hour) in `tz`. */
export function zonedEpoch(tz: string, y: number, m: number, d: number, hour: number, minute = 0): number {
  const guess = Date.UTC(y, m - 1, d, hour, minute)
  const t = guess - offsetMs(tz, guess)
  return guess - offsetMs(tz, t)
}

export const hourIn = (tz: string, ms: number) => parts(tz, ms).hour

/** Wall-clock date (YYYY-MM-DD) and minutes since midnight at the site right now. */
export function localNow(tz: string): { date: string; minutes: number } {
  const p = parts(tz, Date.now())
  return { date: `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`, minutes: p.hour * 60 + p.minute }
}

/** Clock time (HH:MM) at the site for an instant. */
export function clockIn(tz: string, ms: number): string {
  const p = parts(tz, ms)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

/** Today's calendar date at the site, as YYYY-MM-DD. */
export function todayIn(tz: string): string {
  const p = parts(tz, Date.now())
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** Night + minutes after 17:00 for the current moment; by day, tonight at 22:00. */
export function nightNow(tz: string) {
  const { date, minutes } = localNow(tz)
  const [y, m, d] = date.split('-').map(Number)
  const ymd = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
  if (minutes >= 17 * 60) return { night: date, tmin: minutes - 17 * 60 }
  if (minutes < 8 * 60) return { night: ymd(new Date(y, m - 1, d - 1)), tmin: minutes + 7 * 60 }
  return { night: date, tmin: 5 * 60 }
}
