import * as Astronomy from 'astronomy-engine'
import { tzOf, zonedEpoch } from './tz'

export type HorizonPoint = [az: number, alt: number]

export interface Location {
  id: string
  name: string
  lat: number
  lon: number // degrees east
  elevation: number
  horizon: HorizonPoint[] // sorted by azimuth; empty = flat horizon
  seeing?: number // typical seeing in arcsec at this site (default 3)
  tz?: string // IANA time zone of the site (default: browser zone)
  bortle?: number // sky darkness 1 (darkest) .. 9, for exposure estimates
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

/**
 * Parallactic angle (deg, -180..180): position angle, east of north, of the direction to the zenith at an object.
 * An alt-az mount keeps the sensor's "up" on the zenith, so this is the frame's rotation on the sky at that moment.
 */
export function parallacticAngle(l: Location, raDeg: number, decDeg: number, t: Date): number {
  return parallacticFromLst(l.lat, lstHours(l, t), raDeg, decDeg)
}

/** Local sidereal time in hours; the costly part of a parallactic angle, so callers with many targets/frames can reuse it. */
export const lstHours = (l: Location, t: Date) => Astronomy.SiderealTime(t) + l.lon / 15

export function parallacticFromLst(latDeg: number, lst: number, raDeg: number, decDeg: number): number {
  const d = Math.PI / 180
  const H = (lst * 15 - raDeg) * d
  const lat = latDeg * d, dec = decDeg * d
  return Math.atan2(Math.sin(H), Math.tan(lat) * Math.cos(dec) - Math.sin(dec) * Math.cos(H)) / d
}

/** Moon illuminated fraction 0..1. */
export const moonIllum = (t: Date) => Astronomy.Illumination(Astronomy.Body.Moon, t).phase_fraction

/** Angular separation in degrees between two RA/Dec positions (degrees). */
export function separation(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const d = Math.PI / 180
  const c = Math.sin(dec1 * d) * Math.sin(dec2 * d) + Math.cos(dec1 * d) * Math.cos(dec2 * d) * Math.cos((ra1 - ra2) * d)
  return Math.acos(Math.min(1, Math.max(-1, c))) / d
}

export interface NightSample { t: Date; alt: number; az: number; sun: number; moon: number; usable: boolean }

/** Samples a night from 17:00 site time on `day` (its y/m/d fields) to 08:00 the next day, every `stepMin` minutes. */
export function sampleNight(l: Location, ra: number, dec: number, day: Date, stepMin = 10, minAlt = 25): NightSample[] {
  const start = new Date(zonedEpoch(tzOf(l), day.getFullYear(), day.getMonth() + 1, day.getDate(), 17))
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

/**
 * Parses "azimuth altitude" lines (N.I.N.A. .hzn, Stellarium horizon lists, CSV). Lines starting with # ; // or text are skipped.
 * `southZero`: azimuths are counted from the south instead of the north.
 */
export function parseHorizonFile(text: string, opts: { southZero?: boolean } = {}): HorizonPoint[] {
  const byAz = new Map<number, number>()
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || /^(#|;|\/\/)/.test(t)) continue
    const m = t.match(/^(-?\d+(?:\.\d+)?)[\s,;]+(-?\d+(?:\.\d+)?)/)
    if (!m) continue
    let az = +m[1] + (opts.southZero ? 180 : 0)
    az = Math.round((((az % 360) + 360) % 360) * 10) / 10
    byAz.set(az, Math.max(0, Math.round(+m[2] * 10) / 10))
  }
  return thinHorizon([...byAz.entries()].sort((a, b) => a[0] - b[0]) as HorizonPoint[])
}

/** Ramer–Douglas–Peucker: drops points within `tol` degrees of the simplified line, loosening tol until at most `max` remain. */
export function thinHorizon(pts: HorizonPoint[], tol = 0.5, max = 120): HorizonPoint[] {
  if (pts.length <= max) return pts
  const simplify = (p: HorizonPoint[], eps: number): HorizonPoint[] => {
    if (p.length <= 2) return p
    const [a0, v0] = p[0], [a1, v1] = p[p.length - 1]
    let worst = -1, at = 0
    for (let i = 1; i < p.length - 1; i++) {
      const interp = a1 === a0 ? v0 : v0 + ((v1 - v0) * (p[i][0] - a0)) / (a1 - a0)
      const err = Math.abs(interp - p[i][1])
      if (err > worst) { worst = err; at = i }
    }
    if (worst <= eps) return [p[0], p[p.length - 1]]
    return [...simplify(p.slice(0, at + 1), eps).slice(0, -1), ...simplify(p.slice(at), eps)]
  }
  let out = simplify(pts, tol)
  for (let t = tol * 1.5; out.length > max; t *= 1.5) out = simplify(pts, t)
  return out
}

export const horizonToText = (pts: HorizonPoint[]) => `# azimuth(deg, N=0 E=90) altitude(deg)\n${pts.map(([a, v]) => `${a} ${v}`).join('\n')}\n`
