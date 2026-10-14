import { SKY_MAG } from './exposure'

/**
 * Light pollution from David Lorenz's Light Pollution Atlas (VIIRS night lights through a sky-glow model), read from his
 * binary tiles: 5° × 5° tiles of 600 × 600 points (1/120°), each the ratio of artificial to natural zenith brightness.
 * Format as decoded by the atlas's own page: a gzipped Int8 stream; the south-west corner is a 2-byte value, then each byte
 * is the change from the neighbouring point (going north along the first column, then east along each row).
 */
export const LP_YEAR = 2025
export const LP_CREDIT = `Light Pollution Atlas ${LP_YEAR} — David J. Lorenz (VIIRS data: Earth Observation Group)`
const BASE = `https://djlorenz.github.io/astronomy/binary_tiles/${LP_YEAR}`
export const LP_TILES = `https://djlorenz.github.io/astronomy/image_tiles/tiles${LP_YEAR}/tile_{z}_{x}_{y}.png`
const N = 600, RES = 120

const tiles = new Map<string, Promise<Float32Array | null>>()

async function loadTile(tx: number, ty: number): Promise<Float32Array | null> {
  if (ty < 1 || ty > 28) return null // the atlas covers 65°S to 75°N
  const res = await fetch(`${BASE}/binary_tile_${tx}_${ty}.dat.gz`)
  if (!res.ok) return null
  const raw = new Int8Array(await new Response(res.body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
  const out = new Float32Array(N * N)
  let col0 = 128 * raw[0] + raw[1]
  for (let r = 0; r < N; r++) {
    if (r > 0) col0 += raw[N * r + 1]
    let v = col0
    out[r * N] = ratioOf(v)
    for (let c = 1; c < N; c++) { v += raw[N * r + 1 + c]; out[r * N + c] = ratioOf(v) }
  }
  return out
}
const ratioOf = (x: number) => (5 / 195) * (Math.exp(0.0195 * x) - 1)

function tile(tx: number, ty: number) {
  const k = `${tx}_${ty}`
  if (!tiles.has(k)) tiles.set(k, loadTile(tx, ty).catch(() => { tiles.delete(k); return null }))
  return tiles.get(k)!
}

const mod = (n: number, m: number) => ((n % m) + m) % m
const tileOf = (lat: number, lon: number) => ({ tx: Math.floor(mod(lon + 180, 360) / 5) + 1, ty: Math.floor((lat + 65) / 5) + 1 })

/** Artificial / natural zenith brightness at a point (null outside the atlas or offline). */
export async function lpRatio(lat: number, lon: number): Promise<number | null> {
  const { tx, ty } = tileOf(lat, lon)
  const t = await tile(tx, ty)
  if (!t) return null
  const r = Math.min(N - 1, Math.floor((lat + 65 - 5 * (ty - 1)) * RES)), c = Math.min(N - 1, Math.floor((mod(lon + 180, 360) - 5 * (tx - 1)) * RES))
  return t[r * N + c]
}

/** Zenith sky brightness (mag/arcsec²): natural sky 22.0 brightened by the artificial ratio. */
export const sqmOf = (ratio: number) => 22 - 2.5 * Math.log10(1 + ratio)

/** Bortle class matching an SQM on the scale the exposure estimates use (fractional, 1–9). */
export function bortleOf(sqm: number) {
  if (sqm >= SKY_MAG[1]) return 1
  for (let b = 1; b < 9; b++) if (sqm >= SKY_MAG[b + 1]) return b + (SKY_MAG[b] - sqm) / (SKY_MAG[b] - SKY_MAG[b + 1])
  return 9
}

/** The atlas's own zones (it avoids Bortle on purpose: Bortle describes what you see, not a measured brightness). */
const ZONES: [number, string, string][] = [
  [0.01, '0', '#000000'], [0.06, '1a', '#222222'], [0.11, '1b', '#424242'], [0.19, '2a', '#142f72'], [0.33, '2b', '#2154d8'], [0.58, '3a', '#0f5714'],
  [1, '3b', '#1fa12a'], [1.73, '4a', '#6e641e'], [3, '4b', '#b8a625'], [5.2, '5a', '#bf641e'], [9, '5b', '#fd9650'], [15.59, '6a', '#fb5a49'], [27, '6b', '#fb998a'],
  [46.77, '7a', '#a0a0a0'], [Infinity, '7b', '#f2f2f2'],
]
export const zoneOf = (ratio: number) => { const z = ZONES.find(([max]) => ratio < max)!; return { zone: z[1], color: z[2] } }

/** Naked-eye limiting magnitude at the zenith for a sky brightness (Schaefer's relation as used for SQM readings). */
export const nelmOf = (sqm: number) => 7.93 - 5 * Math.log10(10 ** (4.316 - sqm / 5) + 1)
/** Rough count of stars visible to the eye: stars brighter than the limit over the half of the sky above you, thinned by haze low down. */
export const starsOf = (nelm: number) => 0.3 * 10 ** (0.5 * nelm + 0.7)
export function milkyWayOf(sqm: number) {
  if (sqm >= 21.7) return 'Spectacular: structure, dark lanes, casts shadows of contrast'
  if (sqm >= 21.3) return 'Clearly structured, horizon to horizon'
  if (sqm >= 20.8) return 'Visible with some structure, washed out low down'
  if (sqm >= 20.3) return 'Visible but lacks detail'
  if (sqm >= 19.6) return 'Faint, only high up on good nights'
  return 'Not visible'
}

export interface Dome { az: number; distKm: number; lat: number; lon: number; peak: number; weight: number; name?: string }
export interface SiteSky {
  ratio: number; sqm: number
  /** brightness the light domes add at an azimuth and altitude (deg), in units of the natural zenith sky */
  glow: (az: number, alt: number) => number
  /** altitude (deg) a light dome reaches per 10° of azimuth (0, 10, … 350): where it fades into the general sky */
  domeAlt: number[]
  domes: Dome[]
}

const KM_PER_DEG = 111.2
const MIN_KM = 3, MAX_KM = 150
/** Domes look this much brighter low down than the zenith glow they cause. */
const HORIZON_GAIN = 5
/**
 * A dome fades with altitude by e every a0 degrees, and a0 depends on distance: light scattered a few km up over a town
 * stands high in the sky from nearby and low from far away (a0 ≈ the angle of SCATTER_KM at that distance, at least A0_MIN).
 */
const SCATTER_KM = 2, A0_MIN = 7
const DIST_BINS = [3, 6, 12, 25, 50, 100, 150]
const a0Of = (km: number) => Math.max(A0_MIN, (Math.atan(SCATTER_KM / km) * 180) / Math.PI)
/** A dome counts where it adds at least this share to the sky behind it (≈ +0.45 mag: a gradient you see in a stack). */
export const DOME_LEVEL = 0.5

/** Brightness of the natural plus uniform artificial sky at an altitude, relative to the natural zenith (van Rhijn: longer path low down). */
export const vanRhijn = (alt: number) => 1 / Math.sqrt(1 - 0.93 * Math.cos((alt * Math.PI) / 180) ** 2)

/**
 * The sky around a site: zenith brightness from the atlas, and where the light domes are. Every grid point within 150 km that
 * is brighter than the site counts as a source in its direction, weighted by its excess brightness over the site and Walker's
 * law (glow ∝ distance^-2.5). The share of each direction in that sum is scaled to the site's own artificial glow, so a site
 * under a dark sky gets low domes and one near a city high ones; nearby towns' domes reach higher than distant ones. Rough by nature: the atlas is already smoothed, and terrain,
 * shielding and haze are not modelled.
 */
export async function analyseSite(lat: number, lon: number): Promise<SiteSky | null> {
  const ratio = await lpRatio(lat, lon)
  if (ratio == null) return null
  const dLat = MAX_KM / KM_PER_DEG, kmLon = KM_PER_DEG * Math.cos((lat * Math.PI) / 180), dLon = MAX_KM / kmLon
  const keys = new Map<string, { tx: number; ty: number }>()
  for (const la of [lat - dLat, lat, lat + dLat]) for (const lo of [lon - dLon, lon, lon + dLon]) { const t = tileOf(la, lo); keys.set(`${t.tx}_${t.ty}`, t) }
  const loaded = await Promise.all([...keys.values()].map(async (k) => ({ ...k, data: await tile(k.tx, k.ty) })))

  const NB = DIST_BINS.length - 1
  const bins = new Float64Array(NB * 360)
  const binOf = (km: number) => { let k = 0; while (k < NB - 1 && km >= DIST_BINS[k + 1]) k++; return k }
  const peaks: Dome[] = []
  for (const { tx, ty, data } of loaded) {
    if (!data) continue
    const lat0 = -65 + 5 * (ty - 1), lon0 = -180 + 5 * (tx - 1)
    const r0 = Math.max(0, Math.floor((lat - dLat - lat0) * RES)), r1 = Math.min(N - 1, Math.ceil((lat + dLat - lat0) * RES))
    const c0 = Math.max(0, Math.floor((lon - dLon - lon0) * RES)), c1 = Math.min(N - 1, Math.ceil((lon + dLon - lon0) * RES))
    for (let r = r0; r <= r1; r++) {
      const plat = lat0 + (r + 0.5) / RES, dy = (plat - lat) * KM_PER_DEG
      for (let c = c0; c <= c1; c++) {
        const v = data[r * N + c]
        if (v <= ratio) continue
        const plon = lon0 + (c + 0.5) / RES, dx = mod(plon - lon + 180, 360) - 180
        const d = Math.hypot(dx * kmLon, dy)
        if (d < MIN_KM || d > MAX_KM) continue
        const w = (v - ratio) * d ** -2.5
        const az = mod((Math.atan2(dx * kmLon, dy) * 180) / Math.PI, 360)
        bins[binOf(d) * 360 + (Math.floor(az) % 360)] += w
        // local maxima (over the 5 × 5 neighbourhood) are the towns behind the domes
        if (r > 1 && r < N - 2 && c > 1 && c < N - 2 && v > Math.max(1, ratio * 1.3)) {
          let top = true
          for (let i = -2; i <= 2 && top; i++) for (let j = -2; j <= 2; j++) if ((i || j) && data[(r + i) * N + c + j] > v) { top = false; break }
          if (top) peaks.push({ az, distKm: d, lat: plat, lon: plon, peak: v, weight: 0 })
        }
      }
    }
  }
  const total = bins.reduce((a, b) => a + b, 0)
  // spread each degree over ±8° (a town is not a point, and the eye blends neighbouring domes); scale to the site's own glow
  const g0 = new Float32Array(NB * 360)
  if (total > 0) for (let k = 0; k < NB; k++) for (let a = 0; a < 360; a++) {
    let sum = 0, n = 0
    for (let t = -8; t <= 8; t++) { const wt = 1 - Math.abs(t) / 9; sum += bins[k * 360 + mod(a + t, 360)] * wt; n += wt }
    g0[k * 360 + a] = ratio * HORIZON_GAIN * 360 * (sum / n / total)
  }
  const a0s = DIST_BINS.slice(0, NB).map((d, k) => a0Of(Math.sqrt(d * DIST_BINS[k + 1])))
  const glow = (az: number, alt: number) => {
    const x = mod(az, 360), a = Math.floor(x) % 360, b = (a + 1) % 360, f = x - Math.floor(x)
    let g = 0
    for (let k = 0; k < NB; k++) g += (g0[k * 360 + a] * (1 - f) + g0[k * 360 + b] * f) * Math.exp(-alt / a0s[k])
    return g
  }
  const domeAlt = Array.from({ length: 36 }, (_, i) => {
    // the highest altitude where any azimuth in this 10° step still carries a dome
    let alt = 0
    for (let az = i * 10 - 5; az < i * 10 + 5; az++) for (let a = alt + 1; a <= 80; a++) if (glow(az, a) > DOME_LEVEL * (1 + ratio) * vanRhijn(a)) alt = a
    return alt
  })
  // one dome per direction: keep the strongest peak, weighted by what it adds to the glow, and drop others within 12° of it
  for (const p of peaks) p.weight = (p.peak - ratio) * p.distKm ** -2.5 * Math.min(p.peak, 50)
  peaks.sort((a, b) => b.weight - a.weight)
  const domes: Dome[] = []
  for (const p of peaks) {
    if (domes.some((q) => Math.abs(mod(q.az - p.az + 180, 360) - 180) < 12)) continue
    domes.push(p)
    if (domes.length >= 6) break
  }
  return { ratio, sqm: sqmOf(ratio), glow, domeAlt, domes: domes.filter((d) => d.weight > domes[0].weight * 0.08) }
}

/** Compass point for an azimuth. */
export const compass = (az: number) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(mod(az, 360) / 22.5) % 16]

/** Town name near a point, from OpenStreetMap's Nominatim (cached; at most one lookup a second, as its usage policy asks). */
let last = 0
export async function placeName(lat: number, lon: number): Promise<string | undefined> {
  const key = `astroplanner.place.${lat.toFixed(2)},${lon.toFixed(2)}`
  try { const v = localStorage.getItem(key); if (v) return v } catch { /* ignore */ }
  const wait = last + 1100 - Date.now()
  last = Math.max(Date.now(), last + 1100)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`)
    const j = await r.json()
    const a = j.address ?? {}
    const name: string | undefined = a.city ?? a.town ?? a.village ?? a.municipality ?? j.name
    if (name) try { localStorage.setItem(key, name) } catch { /* ignore */ }
    return name
  } catch { return undefined }
}
