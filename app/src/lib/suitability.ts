import * as Astronomy from 'astronomy-engine'
import { tzOf, zonedEpoch } from './tz'
import { horizonAlt, moonIllum, separation, type Location } from './astro'

export interface Settings { minAlt: number; minHours: number }
export const DEFAULT_SETTINGS: Settings = { minAlt: 25, minHours: 2 }

export type MoonTolerance = 'tolerant' | 'dark'

/** Emission-type objects tolerate the moon with the dual-band filter; everything else wants a dark sky. */
const TOLERANT = new Set(['HII', 'EmN', 'PN', 'SNR', 'Neb', 'Cl+N'])
export const defaultMoonTolerance = (type: string): MoonTolerance => (TOLERANT.has(type) ? 'tolerant' : 'dark')

const STEP_MIN = 20
const DAY_MS = 86400000

interface EphemSample { t: number; sun: number; moonAlt: number; moonRa: number; moonDec: number }
export interface EphemNight { date: Date; samples: EphemSample[]; illum: number }

const cache = new Map<string, EphemNight[]>()

/** Sun and moon for every night (17:00 → 08:00 site time) of the next `days` days; shared by all targets of a location. */
export function ephemeris(loc: Location, start: Date, days: number): EphemNight[] {
  const tz = tzOf(loc)
  const key = `${loc.lat},${loc.lon},${loc.elevation},${tz},${start.toDateString()},${days}`
  const hit = cache.get(key)
  if (hit) return hit
  const obs = new Astronomy.Observer(loc.lat, loc.lon, loc.elevation)
  const nights: EphemNight[] = []
  for (let d = 0; d < days; d++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d)
    const t0 = zonedEpoch(tz, day.getFullYear(), day.getMonth() + 1, day.getDate(), 17)
    const samples: EphemSample[] = []
    for (let m = 0; m <= 15 * 60; m += STEP_MIN) {
      const t = new Date(t0 + m * 60000)
      const s = Astronomy.Equator(Astronomy.Body.Sun, t, obs, true, true)
      const mo = Astronomy.Equator(Astronomy.Body.Moon, t, obs, true, true)
      samples.push({
        t: t.getTime(),
        sun: Astronomy.Horizon(t, obs, s.ra, s.dec, 'normal').altitude,
        moonAlt: Astronomy.Horizon(t, obs, mo.ra, mo.dec, 'normal').altitude,
        moonRa: mo.ra * 15, moonDec: mo.dec,
      })
    }
    nights.push({ date: day, samples, illum: moonIllum(new Date(t0 + 7 * 3600000)) })
  }
  cache.set(key, nights)
  return nights
}

export interface NightResult {
  date: Date
  hours: number          // usable hours (quality-weighted: nautical counts 60%)
  rawHours: number
  peakAlt: number
  moonIllum: number
  moonPenalty: number    // 0..1
  score: number          // 0..100, 0 when below the minimum window
  suitable: boolean
  /** minute offsets from 17:00 where the target is usable; for timelines */
  usable: boolean[]
}

export interface Target { ra: number; dec: number; type: string }

export function scoreNights(loc: Location, target: Target, nights: EphemNight[], s: Settings, tolerance?: MoonTolerance): NightResult[] {
  const tol = tolerance ?? defaultMoonTolerance(target.type)
  const obs = new Astronomy.Observer(loc.lat, loc.lon, loc.elevation)
  return nights.map((n) => {
    let weighted = 0, raw = 0, peak = 0, moonUp = 0, sepSum = 0
    const usable: boolean[] = []
    for (const e of n.samples) {
      const hz = Astronomy.Horizon(new Date(e.t), obs, target.ra / 15, target.dec, 'normal')
      const ok = e.sun < -12 && hz.altitude >= Math.max(s.minAlt, horizonAlt(loc.horizon, hz.azimuth))
      usable.push(ok)
      if (!ok) continue
      const w = STEP_MIN / 60
      raw += w
      weighted += e.sun < -18 ? w : w * 0.6
      peak = Math.max(peak, hz.altitude)
      if (e.moonAlt > 0) { moonUp++; sepSum += separation(target.ra, target.dec, e.moonRa, e.moonDec) }
    }
    const samplesUsed = Math.max(1, usable.filter(Boolean).length)
    const upFrac = moonUp / samplesUsed
    const sep = moonUp ? sepSum / moonUp : 180
    const sepFactor = sep < 30 ? 1 : sep > 90 ? 0.3 : 1 - ((sep - 30) / 60) * 0.7
    const moonPenalty = Math.min(1, n.illum * upFrac * sepFactor * (tol === 'tolerant' ? 0.3 : 1))
    const suitable = raw >= s.minHours
    const hoursScore = Math.min(weighted / 7, 1)
    const altScore = Math.min(Math.max((peak - s.minAlt) / 35, 0), 1)
    const score = suitable ? Math.round(100 * (0.65 * hoursScore + 0.2 * altScore + 0.15) * (1 - 0.9 * moonPenalty)) : 0
    return { date: n.date, hours: weighted, rawHours: raw, peakAlt: peak, moonIllum: n.illum, moonPenalty, score, suitable, usable }
  })
}

/** Weekly mean score (0..100) for strip charts: array of {start, score}. */
export function weekly(results: NightResult[]) {
  const out: { start: Date; score: number }[] = []
  for (let i = 0; i < results.length; i += 7) {
    const w = results.slice(i, i + 7)
    out.push({ start: w[0].date, score: w.reduce((a, r) => a + r.score, 0) / w.length })
  }
  return out
}

/** Human readable best periods, e.g. "12 Oct – 4 Jan", from weeks scoring ≥ threshold. */
export function bestPeriods(results: NightResult[], threshold = 50): string {
  const wk = weekly(results)
  const ranges: [Date, Date][] = []
  for (const w of wk) {
    if (w.score < threshold) continue
    const end = new Date(w.start.getTime() + 6 * DAY_MS)
    const last = ranges[ranges.length - 1]
    // merge across moon-phase dips: gaps under three weeks stay inside the same season
    if (last && w.start.getTime() - last[1].getTime() < 21 * DAY_MS) last[1] = end
    else ranges.push([w.start, end])
  }
  // the year is a circle: a season running past the end of the window continues at its start
  if (ranges.length > 1) {
    const first = ranges[0], last = ranges[ranges.length - 1]
    const windowEnd = wk[wk.length - 1].start.getTime() + 6 * DAY_MS
    if (first[0].getTime() === wk[0].start.getTime() && windowEnd - last[1].getTime() < 21 * DAY_MS) {
      first[0] = last[0]
      ranges.pop()
    }
  }
  if (!ranges.length) return 'No suitable period in the next year'
  const f = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return ranges.map(([a, b]) => `${f(a)} – ${f(b)}`).join(', ')
}
