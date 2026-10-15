import * as Astronomy from 'astronomy-engine'
import type { CatObject } from './catalog'

/**
 * Comets from the Minor Planet Center's orbital elements (CometEls.txt, served with CORS). Positions are two-body orbits
 * around the sun, good to an arcminute or so for weeks around the epoch; brightness is the MPC's H + 5 log Δ + 2.5 G log r
 * prediction, which real comets often miss by a magnitude or two.
 */
export interface CometElements {
  q: number    // perihelion distance (AU)
  e: number    // eccentricity
  w: number    // argument of perihelion (deg, J2000 ecliptic)
  node: number // longitude of the ascending node (deg)
  i: number    // inclination (deg)
  tp: number   // perihelion time, epoch ms (TT taken as UTC)
  H: number    // absolute magnitude
  G: number    // slope parameter (2.5 G log r)
}
/**
 * A comet as stored with a target: its designation, MPC name and elements. `dm`: observed minus predicted magnitude when
 * it was added (from COBS), so the MPC curve is shifted onto what observers actually see.
 */
export interface CometTarget { desig: string; name: string; el: CometElements; dm?: number }

export const MPC_URL = 'https://www.minorplanetcenter.net/iau/MPCORB/CometEls.txt'
const CACHE_KEY = 'astroplanner.comets'
const DAY = 86400000
const K = 0.01720209895 // Gaussian gravitational constant
const D = Math.PI / 180
const EPS = 23.4392911 * D

export const isComet = (id: string) => id.startsWith('comet:')
/** Target id of a comet: URL-safe, e.g. comet:12p, comet:c2023a3. */
export const cometId = (desig: string) => `comet:${desig.toLowerCase().replace(/[^a-z0-9]+/g, '')}`

/** One line of CometEls.txt (fixed columns, see the MPC's export format notes). */
export function parseLine(l: string): CometTarget | null {
  const num = (a: number, b: number) => parseFloat(l.slice(a - 1, b))
  const y = num(15, 18), m = num(20, 21), d = num(23, 29)
  const el = { q: num(31, 39), e: num(42, 49), w: num(52, 59), node: num(62, 69), i: num(72, 79), H: num(92, 95), G: num(97, 100), tp: Date.UTC(y, m - 1, 1) + (d - 1) * DAY }
  const name = l.slice(102, 158).trim()
  if (!name || [el.q, el.e, el.w, el.node, el.i, el.H, el.tp].some((v) => !Number.isFinite(v))) return null
  if (!Number.isFinite(el.G)) el.G = 4
  // "12P/Pons-Brooks" → 12P; "C/2023 A3 (Tsuchinshan-ATLAS)" → C/2023 A3
  const desig = /^\d+[PDI]\//.test(name) ? name.split('/')[0] : name.replace(/\s*\(.*$/, '')
  return { desig, name, el }
}

export const parseCometEls = (text: string) => text.split('\n').map(parseLine).filter((c): c is CometTarget => !!c)

let loaded: CometTarget[] | null = null
let pending: Promise<CometTarget[]> | null = null

/** All comets in the MPC file; fetched at most once a day, the last copy is used when offline. */
export function loadComets(): Promise<CometTarget[]> {
  if (loaded) return Promise.resolve(loaded)
  pending ??= (async () => {
    let cached: { at: number; text: string } | null = null
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') } catch { /* storage unavailable */ }
    let text = cached && Date.now() - cached.at < DAY ? cached.text : null
    if (!text) {
      try {
        const res = await fetch(MPC_URL)
        if (!res.ok) throw new Error(`MPC ${res.status}`)
        text = await res.text()
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), text })) } catch { /* too big or unavailable */ }
      } catch (err) {
        if (!cached) { pending = null; throw err }
        text = cached.text
      }
    }
    loaded = parseCometEls(text)
    return loaded
  })()
  return pending
}
/** Latest observed brightness of a comet (COBS, cobs.si). */
export interface CometSighting { mag: number; peak: number | null; peakDate: string | null }

let sightings: Promise<Map<string, CometSighting>> | null = null
let sighted: Map<string, CometSighting> | null = null
/** Observed magnitudes by comet target id (fetched once); empty when COBS cannot be reached. */
export function loadSightings(): Promise<Map<string, CometSighting>> {
  sightings ??= fetchSightings().then((m) => { sighted = m; if (!m.size) sightings = null; return m })
  return sightings
}

/** Production gets a trimmed list from the worker, dev the raw COBS one. */
async function fetchSightings(): Promise<Map<string, CometSighting>> {
  try {
    const res = await fetch('/api/cobs/comets')
    if (!res.ok) return new Map()
    const data = await res.json()
    type Raw = { name: string; current_mag?: string | null; peak_mag?: string | null; peak_mag_date?: string | null; mag?: number; peak?: number | null; peakDate?: string | null }
    const rows: Raw[] = Array.isArray(data) ? data : data.objects ?? []
    const out = new Map<string, CometSighting>()
    for (const o of rows) {
      const mag = o.mag ?? (o.current_mag ? +o.current_mag : NaN)
      if (Number.isFinite(mag)) out.set(cometId(o.name), { mag, peak: o.peak ?? (o.peak_mag ? +o.peak_mag : null), peakDate: o.peakDate ?? o.peak_mag_date ?? null })
    }
    return out
  } catch { return new Map() }
}

const recent = new Map<string, CometTarget>()
/** Keeps a comet opened from the list (with its observed offset) so its details and sky view can find it by id. */
export const remember = (c: CometTarget) => recent.set(cometId(c.desig), c)
/** A comet that is not a target yet, by id: one opened from the list, else from the last loaded MPC list. */
export function loadedComet(id: string): CometTarget | undefined {
  const hit = recent.get(id)
  if (hit) return hit
  const c = loaded?.find((x) => cometId(x.desig) === id)
  const obs = sighted?.get(id)
  return c && obs ? { ...c, dm: +(obs.mag - cometPos(c.el, Date.now()).mag).toFixed(2) } : c
}

/** Heliocentric position (AU, J2000 equatorial) at epoch ms `t`. */
function helio(el: CometElements, t: number): [number, number, number] {
  const dt = (t - el.tp) / DAY
  const { q, e } = el
  let x: number, y: number
  if (Math.abs(e - 1) < 1e-6) {
    // parabola: Barker's equation
    const W = (3 * K * dt) / (Math.SQRT2 * q ** 1.5)
    const Y = Math.cbrt(W / 2 + Math.sqrt((W * W) / 4 + 1))
    const s = Y - 1 / Y
    x = q * (1 - s * s); y = 2 * q * s
  } else if (e < 1) {
    const a = q / (1 - e)
    const M = (((K / a ** 1.5) * dt) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI
    let E = e > 0.9 && Math.abs(M) < 0.5 ? Math.cbrt(6 * M) : M + e * Math.sin(M)
    for (let k = 0; k < 60; k++) {
      const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E))
      E -= dE
      if (Math.abs(dE) < 1e-12) break
    }
    x = a * (Math.cos(E) - e); y = a * Math.sqrt(1 - e * e) * Math.sin(E)
  } else {
    const a = q / (e - 1)
    const M = (K / a ** 1.5) * dt
    let H = Math.abs(M) < 1 ? Math.cbrt(6 * M) : Math.sign(M) * Math.log((2 * Math.abs(M)) / e + 1.8)
    for (let k = 0; k < 60; k++) {
      const dH = (e * Math.sinh(H) - H - M) / (e * Math.cosh(H) - 1)
      H -= dH
      if (Math.abs(dH) < 1e-12) break
    }
    x = a * (e - Math.cosh(H)); y = a * Math.sqrt(e * e - 1) * Math.sinh(H)
  }
  const cw = Math.cos(el.w * D), sw = Math.sin(el.w * D), cn = Math.cos(el.node * D), sn = Math.sin(el.node * D), ci = Math.cos(el.i * D), si = Math.sin(el.i * D)
  const X = x * (cn * cw - sn * sw * ci) - y * (cn * sw + sn * cw * ci)
  const Yc = x * (sn * cw + cn * sw * ci) - y * (sn * sw - cn * cw * ci)
  const Z = x * sw * si + y * cw * si
  return [X, Yc * Math.cos(EPS) - Z * Math.sin(EPS), Yc * Math.sin(EPS) + Z * Math.cos(EPS)]
}

export interface CometPos { ra: number; dec: number; r: number; delta: number; mag: number; elong: number }

/** Astrometric position (J2000, light-time corrected), distances, predicted magnitude and elongation from the sun. */
export function cometPos(el: CometElements, at: Date | number): CometPos {
  const t = typeof at === 'number' ? at : at.getTime()
  const E = Astronomy.HelioVector(Astronomy.Body.Earth, new Date(t))
  let p = helio(el, t), g = [p[0] - E.x, p[1] - E.y, p[2] - E.z]
  const delta0 = Math.hypot(g[0], g[1], g[2])
  p = helio(el, t - (delta0 / 173.1446) * DAY) // light time
  g = [p[0] - E.x, p[1] - E.y, p[2] - E.z]
  const delta = Math.hypot(g[0], g[1], g[2]), r = Math.hypot(p[0], p[1], p[2])
  const ra = ((Math.atan2(g[1], g[0]) / D) + 360) % 360, dec = Math.asin(g[2] / delta) / D
  const sunDist = Math.hypot(E.x, E.y, E.z)
  const elong = Math.acos(Math.min(1, Math.max(-1, -(g[0] * E.x + g[1] * E.y + g[2] * E.z) / (delta * sunDist)))) / D
  return { ra, dec, r, delta, mag: el.H + 5 * Math.log10(delta) + 2.5 * el.G * Math.log10(r), elong }
}

export const constellationOf = (ra: number, dec: number) => Astronomy.Constellation(ra / 15, dec).symbol

/** Catalog-shaped comet at a moment (default now) whose `track` follows it across nights. */
export function cometObject(c: CometTarget, at: Date = new Date()): CatObject {
  const p = cometPos(c.el, at)
  return {
    id: cometId(c.desig), m: null, type: 'Comet', typeName: 'Comet', ra: p.ra, dec: p.dec, con: constellationOf(p.ra, p.dec),
    maj: null, min: null, pa: null, mag: +(p.mag + (c.dm ?? 0)).toFixed(1), sb: null, names: [c.name], alt: [c.desig],
    comet: c, track: (t: Date) => { const q = cometPos(c.el, t); return [q.ra, q.dec] }, magAt: (t: Date) => cometPos(c.el, t).mag + (c.dm ?? 0),
  }
}
