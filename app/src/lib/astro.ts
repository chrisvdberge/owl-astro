import * as Astronomy from 'astronomy-engine'

export type HorizonPoint = [az: number, alt: number]

export interface Location {
  id: string
  name: string
  lat: number
  lon: number // degrees east
  elevation: number
  horizon: HorizonPoint[] // sorted by azimuth; empty = flat horizon
}

/** Gaps wider than this between two points are open sky: the horizon ramps down to 0° beside each point. */
const GAP = 60, SHOULDER = 20

/** Minimum altitude of the local horizon at an azimuth (linear interpolation, wraps at 360°). */
export function horizonAlt(h: HorizonPoint[], az: number): number {
  if (h.length === 0) return 0
  const a = ((az % 360) + 360) % 360
  const n = h.length
  const pts: HorizonPoint[] = []
  for (let i = -1; i <= n; i++) {
    const k = ((i % n) + n) % n
    pts.push([h[k][0] + (i < 0 ? -360 : i >= n ? 360 : 0), h[k][1]])
  }
  const ext: HorizonPoint[] = [pts[0]]
  for (let i = 0; i < pts.length - 1; i++) {
    const a0 = pts[i][0], a1 = pts[i + 1][0]
    if (a1 - a0 > GAP) {
      ext.push([a0 + SHOULDER, 0], [a1 - SHOULDER, 0])
    }
    ext.push(pts[i + 1])
  }
  for (let i = 0; i < ext.length - 1; i++) {
    const [a0, v0] = ext[i], [a1, v1] = ext[i + 1]
    if (a >= a0 && a <= a1) return a1 === a0 ? v0 : v0 + ((v1 - v0) * (a - a0)) / (a1 - a0)
  }
  return 0
}

const observer = (l: Location) => new Astronomy.Observer(l.lat, l.lon, l.elevation)

export function targetAltAz(l: Location, raDeg: number, decDeg: number, t: Date) {
  const h = Astronomy.Horizon(t, observer(l), raDeg / 15, decDeg, 'normal')
  return { alt: h.altitude, az: h.azimuth }
}

function bodyAltAz(l: Location, body: Astronomy.Body, t: Date) {
  const o = observer(l)
  const eq = Astronomy.Equator(body, t, o, true, true)
  const h = Astronomy.Horizon(t, o, eq.ra, eq.dec, 'normal')
  return { alt: h.altitude, az: h.azimuth, ra: eq.ra * 15, dec: eq.dec }
}

export const sunAlt = (l: Location, t: Date) => bodyAltAz(l, Astronomy.Body.Sun, t).alt
export const moonAltAz = (l: Location, t: Date) => bodyAltAz(l, Astronomy.Body.Moon, t)

/** Moon illuminated fraction 0..1. */
export const moonIllum = (t: Date) => Astronomy.Illumination(Astronomy.Body.Moon, t).phase_fraction

/** Angular separation in degrees between two RA/Dec positions (degrees). */
export function separation(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const d = Math.PI / 180
  const c = Math.sin(dec1 * d) * Math.sin(dec2 * d) + Math.cos(dec1 * d) * Math.cos(dec2 * d) * Math.cos((ra1 - ra2) * d)
  return Math.acos(Math.min(1, Math.max(-1, c))) / d
}

export interface NightSample { t: Date; alt: number; az: number; sun: number; moon: number; usable: boolean }

/** Samples a night from 17:00 local on `day` to 08:00 the next day, every `stepMin` minutes. */
export function sampleNight(l: Location, ra: number, dec: number, day: Date, stepMin = 10, minAlt = 25): NightSample[] {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 17, 0, 0)
  const out: NightSample[] = []
  for (let m = 0; m <= 15 * 60; m += stepMin) {
    const t = new Date(start.getTime() + m * 60000)
    const { alt, az } = targetAltAz(l, ra, dec, t)
    const sun = sunAlt(l, t)
    const moon = moonAltAz(l, t).alt
    const usable = sun < -12 && alt >= Math.max(minAlt, horizonAlt(l.horizon, az))
    out.push({ t, alt, az, sun, moon, usable })
  }
  return out
}

export function parseHorizonFile(text: string): HorizonPoint[] {
  const pts: HorizonPoint[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^(-?\d+(?:\.\d+)?)[\s,;]+(-?\d+(?:\.\d+)?)/)
    if (m) pts.push([((+m[1] % 360) + 360) % 360, Math.max(0, +m[2])])
  }
  return pts.sort((a, b) => a[0] - b[0])
}
