import { horizonAlt, sunAlt, targetAltAz, type Location } from './astro'
import { tzOf, zonedEpoch } from './tz'

export interface MonthPeak { month: number; year: number; alt: number }

/** Highest altitude the target reaches in each of the next 12 months, on the 15th, while the sun is below −12° and above the local horizon. */
export function monthlyPeaks(loc: Location, ra: number, dec: number, from: Date): MonthPeak[] {
  const tz = tzOf(loc)
  return Array.from({ length: 12 }, (_, k) => {
    const d = new Date(from.getFullYear(), from.getMonth() + k, 15)
    const t0 = zonedEpoch(tz, d.getFullYear(), d.getMonth() + 1, 15, 17)
    let alt = 0
    for (let m = 0; m <= 15 * 60; m += 30) {
      const t = new Date(t0 + m * 60000)
      if (sunAlt(loc, t) >= -12) continue
      const h = targetAltAz(loc, ra, dec, t)
      if (h.alt >= horizonAlt(loc.horizon, h.az)) alt = Math.max(alt, h.alt)
    }
    return { month: d.getMonth(), year: d.getFullYear(), alt }
  })
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const monthName = (m: number) => MONTHS[m]

/** "Sep – Mar" style description of the months at or above `minAlt` (the list is a circle of 12 months). */
export function bestMonths(peaks: MonthPeak[], minAlt: number): string {
  const ok = peaks.map((p) => p.alt >= minAlt)
  if (ok.every(Boolean)) return 'All year'
  if (!ok.some(Boolean)) return 'Not above your minimum altitude'
  // walk the circle starting just after a month that is not ok, so no run is split at the array's ends
  const gap = ok.indexOf(false)
  const runs: [number, number][] = []
  for (let k = 1; k <= 12; k++) {
    const i = (gap + k) % 12
    if (!ok[i]) continue
    const last = runs[runs.length - 1]
    if (last && last[1] === (i + 11) % 12) last[1] = i
    else runs.push([i, i])
  }
  return runs.map(([a, b]) => (a === b ? monthName(peaks[a].month) : `${monthName(peaks[a].month)} – ${monthName(peaks[b].month)}`)).join(', ')
}

export const compass = (az: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((az % 360) + 360) % 360) / 45) % 8]
