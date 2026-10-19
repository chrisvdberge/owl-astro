/**
 * Plate solving in the browser, with a hint: stars found in the image are matched against Gaia DR3 stars near a guessed
 * position, at a roughly known scale. Gaia comes from the CDS HiPS catalogue service (static tiles sorted by G magnitude,
 * so the shallow HEALPix orders hold the brightest stars: a cone at any density is a handful of small files).
 * Matching: triangles of neighbouring stars (shape and size) pair image and catalogue stars, each pair proposes a
 * transform, the one most stars agree with is refined to an affine and then a quadratic fit (lens distortion).
 * Pure TypeScript, so it runs in a worker and under Node.
 */

export interface RgbaImage { width: number; height: number; data: Uint8ClampedArray }
export interface Star { x: number; y: number; flux: number }
export interface CatStar { ra: number; dec: number; mag: number }
/** Where to look: a position (deg) and how far from it the image centre may be (deg). */
export interface Hint { ra: number; dec: number; radius: number }

export interface Solution {
  /** sky position of the image centre (deg) */
  ra: number; dec: number
  /** outline on the sky: corners and edge midpoints, clockwise from the top left (deg) */
  outline: [number, number][]
  /** degrees per pixel of the solved image, its width and height on the sky (deg) */
  scale: number; fieldW: number; fieldH: number
  /** where the image's up points, degrees east of north; mirrored images have east and west swapped */
  pa: number; mirrored: boolean
  matched: number; rms: number
}

const D2R = Math.PI / 180, R2D = 180 / Math.PI

/** Gnomonic (TAN) standard coordinates of (ra, dec) seen from (ra0, dec0), in degrees: xi east, eta north. */
export function project(ra0: number, dec0: number, ra: number, dec: number): [number, number] {
  const d0 = dec0 * D2R, d = dec * D2R, da = (ra - ra0) * D2R
  const c = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(da)
  return [(Math.cos(d) * Math.sin(da) / c) * R2D, ((Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(da)) / c) * R2D]
}

export function deproject(ra0: number, dec0: number, xi: number, eta: number): [number, number] {
  const x = xi * D2R, y = eta * D2R, d0 = dec0 * D2R
  const den = Math.cos(d0) - y * Math.sin(d0)
  const ra = ra0 + Math.atan2(x, den) * R2D
  return [((ra % 360) + 360) % 360, Math.atan2(Math.sin(d0) + y * Math.cos(d0), Math.hypot(x, den)) * R2D]
}

export const separation = (ra1: number, dec1: number, ra2: number, dec2: number) => {
  const a = Math.sin(((dec2 - dec1) * D2R) / 2) ** 2 + Math.cos(dec1 * D2R) * Math.cos(dec2 * D2R) * Math.sin(((ra2 - ra1) * D2R) / 2) ** 2
  return 2 * Math.asin(Math.min(1, Math.sqrt(a))) * R2D
}

// ---------------------------------------------------------------- stars in the image

/** Median and spread of 8-bit values from their histogram. */
function histStats(h: Uint32Array, n: number): [number, number] {
  const med = (hh: Uint32Array) => { let acc = 0; for (let i = 0; i < hh.length; i++) { acc += hh[i]; if (acc * 2 >= n) return i } return hh.length - 1 }
  const m = med(h)
  const dev = new Uint32Array(256)
  for (let i = 0; i < 256; i++) dev[Math.abs(i - m)] += h[i]
  return [m, med(dev) * 1.4826]
}

/**
 * Stars in a stretched 8-bit image: a smooth background from 32 px tiles (median and spread) is taken off, the
 * remainder smoothed, and every local peak well above the local noise measured (centroid and flux). Brightest first.
 */
export function detectStars(img: RgbaImage, max = 200): Star[] {
  const { width: W, height: H, data } = img
  const L = new Float32Array(W * H)
  for (let i = 0, p = 0; i < L.length; i++, p += 4) L[i] = (data[p] + data[p + 1] + data[p + 2]) / 3
  const T = 32, tw = Math.ceil(W / T), th = Math.ceil(H / T)
  const bgT = new Float32Array(tw * th), sdT = new Float32Array(tw * th)
  const hist = new Uint32Array(256)
  for (let ty = 0; ty < th; ty++)
    for (let tx = 0; tx < tw; tx++) {
      hist.fill(0)
      let n = 0
      for (let y = ty * T; y < Math.min(H, ty * T + T); y++) for (let x = tx * T; x < Math.min(W, tx * T + T); x++) { hist[Math.round(L[y * W + x])]++; n++ }
      const [m, s] = histStats(hist, n)
      bgT[ty * tw + tx] = m; sdT[ty * tw + tx] = Math.max(1, s)
    }
  // bilinear between tile centres
  const at = (g: Float32Array, x: number, y: number) => {
    const fx = Math.min(tw - 1, Math.max(0, x / T - 0.5)), fy = Math.min(th - 1, Math.max(0, y / T - 0.5))
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(tw - 1, x0 + 1), y1 = Math.min(th - 1, y0 + 1), ax = fx - x0, ay = fy - y0
    return (g[y0 * tw + x0] * (1 - ax) + g[y0 * tw + x1] * ax) * (1 - ay) + (g[y1 * tw + x0] * (1 - ax) + g[y1 * tw + x1] * ax) * ay
  }
  const R = new Float32Array(W * H), N = new Float32Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; R[i] = L[i] - at(bgT, x, y); N[i] = at(sdT, x, y) }
  const S = new Float32Array(W * H)
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    let s = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += R[(y + dy) * W + x + dx]
    S[y * W + x] = s / 9
  }
  const E = 8, cands: Star[] = []
  for (let y = E; y < H - E; y++)
    for (let x = E; x < W - E; x++) {
      const i = y * W + x, v = S[i]
      if (v < 4 * N[i] || v < 3) continue
      let peak = true
      for (let dy = -3; dy <= 3 && peak; dy++) for (let dx = -3; dx <= 3; dx++) {
        const u = S[i + dy * W + dx]
        if (u > v || (u === v && (dy < 0 || (dy === 0 && dx < 0)))) { peak = false; break }
      }
      if (!peak) continue
      let sx = 0, sy = 0, sw = 0
      for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
        if (dx * dx + dy * dy > 25) continue
        const w = R[i + dy * W + dx]
        if (w > 0) { sx += w * dx; sy += w * dy; sw += w }
      }
      if (sw > 0) cands.push({ x: x + sx / sw, y: y + sy / sw, flux: sw })
    }
  cands.sort((a, b) => b.flux - a.flux)
  // one star per blob: flat-topped (saturated) cores can have several equal peaks
  const out: Star[] = [], cell = 6, grid = new Map<number, Star[]>()
  const key = (cx: number, cy: number) => cy * 100000 + cx
  for (const s of cands) {
    const cx = Math.floor(s.x / cell), cy = Math.floor(s.y / cell)
    let near = false
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (grid.get(key(cx + dx, cy + dy))?.some((o) => Math.hypot(o.x - s.x, o.y - s.y) < cell)) { near = true; break }
    if (near) continue
    out.push(s)
    const k = key(cx, cy); grid.set(k, [...(grid.get(k) ?? []), s])
    if (out.length >= max) break
  }
  return out
}

// ---------------------------------------------------------------- Gaia from HiPS tiles

const HIPS = 'https://hipscat.cds.unistra.fr/HiPSCatService/I/355/gaiadr3'

/** HEALPix NESTED pixel of a position at an order. */
export function ang2pixNest(order: number, ra: number, dec: number): number {
  const nside = 1 << order
  const z = Math.sin(dec * D2R), za = Math.abs(z)
  const tt = ((((ra / 90) % 4) + 4) % 4)
  let face: number, ix: number, iy: number
  if (za <= 2 / 3) {
    const t1 = nside * (0.5 + tt), t2 = nside * z * 0.75
    const jp = Math.floor(t1 - t2), jm = Math.floor(t1 + t2)
    const ifp = Math.floor(jp / nside), ifm = Math.floor(jm / nside)
    face = ifp === ifm ? (ifp | 4) : ifp < ifm ? ifp : ifm + 8
    ix = jm & (nside - 1); iy = nside - (jp & (nside - 1)) - 1
  } else {
    const ntt = Math.min(3, Math.floor(tt)), tp = tt - ntt
    const tmp = nside * Math.sqrt(3 * (1 - za))
    const jp = Math.min(nside - 1, Math.floor(tp * tmp)), jm = Math.min(nside - 1, Math.floor((1 - tp) * tmp))
    if (z > 0) { face = ntt; ix = nside - jm - 1; iy = nside - jp - 1 } else { face = ntt + 8; ix = jp; iy = jm }
  }
  let ipf = 0
  for (let b = 0; b < order; b++) ipf += (((ix >> b) & 1) << (2 * b)) + (((iy >> b) & 1) << (2 * b + 1))
  return face * nside * nside + ipf
}

/** Catalogue tiles are ~50 stars each; the order whose tiles (with their parents) reach a density (stars per deg²). */
export function orderFor(density: number): number {
  let cum = 0
  for (let k = 1; k <= 11; k++) { cum += (50 * 12 * 4 ** k) / 41253; if (cum >= density) return k }
  return 11
}

/** The tiles at orders 1..k that cover a disc: sampled on a grid finer than the order's pixels. */
export function discTiles(ra: number, dec: number, radius: number, k: number): [number, number][] {
  const size = Math.sqrt(41253 / (12 * 4 ** k)), step = size / 3, r = radius + size
  const deep = new Set<number>()
  deep.add(ang2pixNest(k, ra, dec))
  for (let y = -r; y <= r; y += step) for (let x = -r; x <= r; x += step) {
    if (x * x + y * y > r * r) continue
    const [a, d] = deproject(ra, dec, x, y)
    deep.add(ang2pixNest(k, a, d))
  }
  const out = new Set<string>()
  for (const n of deep) for (let j = 1; j <= k; j++) out.add(`${j}/${n >> (2 * (k - j))}`)
  return [...out].map((s) => s.split('/').map(Number) as [number, number])
}

export function parseTile(tsv: string): CatStar[] {
  const lines = tsv.split('\n').filter((l) => l && !l.startsWith('#'))
  if (!lines.length) return []
  const head = lines[0].split('\t'), ia = head.indexOf('RAdeg'), id = head.indexOf('DEdeg'), ig = head.indexOf('Gmag')
  if (ia < 0 || id < 0 || ig < 0) return []
  const out: CatStar[] = []
  for (const l of lines.slice(1)) {
    const c = l.split('\t'), ra = +c[ia], dec = +c[id], mag = c[ig].trim() ? +c[ig] : NaN
    if (Number.isFinite(ra) && Number.isFinite(dec) && Number.isFinite(mag)) out.push({ ra, dec, mag })
  }
  return out
}

const tiles = new Map<string, Promise<CatStar[]>>()
let active = 0
const waiting: (() => void)[] = []
/** At most 6 tile requests at a time (the service speaks HTTP/1.1). */
async function limited<T>(f: () => Promise<T>): Promise<T> {
  if (active >= 6) await new Promise<void>((r) => waiting.push(r))
  active++
  try { return await f() } finally { active--; waiting.shift()?.() }
}
/** Gaia stars in a disc, down to a density (stars per deg²), brightest first; tiles are kept for the next image. */
export async function gaiaCone(ra: number, dec: number, radius: number, density: number, fetcher: typeof fetch = fetch): Promise<CatStar[]> {
  const k = orderFor(density)
  const got = await Promise.all(discTiles(ra, dec, radius, k).map(([j, n]) => {
    const key = `${j}/${n}`
    let p = tiles.get(key)
    if (!p) {
      p = limited(() => fetcher(`${HIPS}/Norder${j}/Dir${Math.floor(n / 10000) * 10000}/Npix${n}.tsv`)
        .then((r) => (r.ok ? r.text().then(parseTile) : r.status === 404 ? [] : Promise.reject(new Error(`Gaia tiles: HTTP ${r.status}`)))))
      p.catch(() => tiles.delete(key))
      tiles.set(key, p)
    }
    return p
  }))
  return got.flat().filter((s) => separation(ra, dec, s.ra, s.dec) <= radius).sort((a, b) => a.mag - b.mag)
}

// ---------------------------------------------------------------- matching

type P = [number, number]
/** image stars that check a match, and how much denser the catalogue stars they are checked against */
const NV = 60, VDENS = 3
interface Tri { v: [number, number, number]; r1: number; r2: number; L: number }

/** Triangles of each star with pairs of its nearest neighbours; vertices ordered by the side opposite them (short to long). */
function triangles(pts: P[], k = 5, minL = 0): Tri[] {
  const seen = new Set<string>(), out: Tri[] = []
  const d = (a: number, b: number) => Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1])
  for (let i = 0; i < pts.length; i++) {
    const nb = pts.map((_, j) => j).filter((j) => j !== i).sort((a, b) => d(i, a) - d(i, b)).slice(0, k)
    for (let a = 0; a < nb.length; a++) for (let b = a + 1; b < nb.length; b++) {
      const vs = [i, nb[a], nb[b]].sort((x, y) => x - y)
      const key = vs.join(',')
      if (seen.has(key)) continue
      seen.add(key)
      const opp = vs.map((v, m) => ({ v, s: d(vs[(m + 1) % 3], vs[(m + 2) % 3]) })).sort((x, y) => x.s - y.s)
      const [s0, s1, s2] = opp.map((o) => o.s)
      if (s2 < minL || s1 - s0 < 0.03 * s2 || s2 - s1 < 0.03 * s2 || (s0 + s1) / s2 < 1.08) continue
      out.push({ v: [opp[0].v, opp[1].v, opp[2].v], r1: s0 / s2, r2: s1 / s2, L: s2 })
    }
  }
  return out
}

/** A transform from normalised image coordinates to catalogue plane coordinates: affine (3 terms) or quadratic (6). */
interface Fit { cx: number[]; cy: number[] }
const basis = (u: number, v: number, n: number) => (n === 3 ? [1, u, v] : [1, u, v, u * u, u * v, v * v])
const apply = (f: Fit, u: number, v: number): P => { const b = basis(u, v, f.cx.length); let x = 0, y = 0; for (let i = 0; i < b.length; i++) { x += f.cx[i] * b[i]; y += f.cy[i] * b[i] } return [x, y] }

function lsq(rows: number[][], rhs: number[]): number[] | null {
  const n = rows[0].length, A = Array.from({ length: n }, () => new Array(n + 1).fill(0))
  rows.forEach((r, k) => { for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) A[i][j] += r[i] * r[j]; A[i][n] += r[i] * rhs[k] } })
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    if (Math.abs(A[p][c]) < 1e-12) return null
    ;[A[c], A[p]] = [A[p], A[c]]
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let j = c; j <= n; j++) A[r][j] -= f * A[c][j] }
  }
  return A.map((r, i) => r[n] / r[i])
}

function fit(src: P[], dst: P[], n: 3 | 6): Fit | null {
  const rows = src.map(([u, v]) => basis(u, v, n))
  const cx = lsq(rows, dst.map((d) => d[0])), cy = lsq(rows, dst.map((d) => d[1]))
  return cx && cy ? { cx, cy } : null
}

/** Points on a grid of buckets for nearest-neighbour lookups. */
interface Grid { pts: P[]; nearest: (p: P, r: number) => number }
function grid(pts: P[], cell: number): Grid {
  const m = new Map<number, number[]>(), key = (x: number, y: number) => (x + 50000) * 100000 + (y + 50000)
  pts.forEach((p, i) => { const k = key(Math.floor(p[0] / cell), Math.floor(p[1] / cell)); const a = m.get(k); if (a) a.push(i); else m.set(k, [i]) })
  return {
    pts,
    nearest(p, r) {
      const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), n = Math.ceil(r / cell)
      let best = -1, bd = r
      for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) for (const i of m.get(key(cx + dx, cy + dy)) ?? []) {
        const d = Math.hypot(pts[i][0] - p[0], pts[i][1] - p[1])
        if (d < bd) { bd = d; best = i }
      }
      return best
    },
  }
}

export interface SolveInput {
  width: number; height: number; stars: Star[]
  /** guessed degrees per pixel, and how far off it may be (0.2 = ±20%) */
  scale: number; scaleTol: number
}

/** Image stars matched to catalogue stars under a transform: one catalogue star each, nearest wins. */
function pairsUnder(f: Fit, img: P[], grid: Grid, r: number) {
  const used = new Map<number, { i: number; d: number }>()
  img.forEach((p, i) => {
    const q = apply(f, p[0], p[1]), j = grid.nearest(q, r)
    if (j < 0) return
    const d = Math.hypot(grid.pts[j][0] - q[0], grid.pts[j][1] - q[1]), o = used.get(j)
    if (!o || d < o.d) used.set(j, { i, d })
  })
  return [...used].map(([j, { i, d }]) => ({ i, j, d }))
}

/** Try to solve with the field centre near (ra0, dec0): within `slack` degrees, given catalogue stars around it. */
function solveAt(inp: SolveInput, cat: CatStar[], ra0: number, dec0: number, slack: number, densityFactor: number): Solution | null {
  const { width: W, height: H, scale: s0, scaleTol } = inp
  const half = Math.max(W, H) / 2, cxp = W / 2, cyp = H / 2
  // normalised image coordinates keep the quadratic fit well conditioned
  const norm = (s: Star): P => [(s.x - cxp) / half, (s.y - cyp) / half]
  const nT = Math.min(40, inp.stars.length), nV = Math.min(NV, inp.stars.length)
  const imgT = inp.stars.slice(0, nT).map((s) => [s.x, s.y] as P)
  const imgV = inp.stars.slice(0, nV).map(norm)
  const area = W * H
  const rc = Math.hypot(W, H) / 2 + slack / s0 // catalogue disc radius (px) that holds the whole field
  const plane = cat.map((c) => { const [x, y] = project(ra0, dec0, c.ra, c.dec); return [x / s0, y / s0] as P })
    .map((p, i) => ({ p, i })).filter(({ p }) => p[0] * p[0] + p[1] * p[1] <= rc * rc)
  const take = (dens: number) => plane.slice(0, Math.max(8, Math.round(dens * Math.PI * rc * rc)))
  const catT = take((nT / area) * densityFactor).map((x) => x.p)
  const catV = take((nV / area) * VDENS).map((x) => x.p)
  if (catT.length < 6 || catV.length < 8) return null
  const sep = Math.sqrt((Math.PI * rc * rc) / catV.length), r = Math.max(2, 0.1 * sep)
  const g3 = grid(catV, r * 3)
  const minL = 0.03 * Math.hypot(W, H)
  const ti = triangles(imgT, 5, minL), tc = triangles(catT, 5, minL * (1 - scaleTol))
  // image triangles bucketed by shape
  const C = 0.02, tol = 0.015, buckets = new Map<number, Tri[]>()
  for (const t of ti) { const k = Math.floor(t.r1 / C) * 1000 + Math.floor(t.r2 / C); const a = buckets.get(k); if (a) a.push(t); else buckets.set(k, [t]) }
  const need = Math.max(16, Math.round(0.35 * nV))
  let best = null as { f: Fit; n: number } | null
  for (const t of tc) {
    const k1 = Math.floor(t.r1 / C), k2 = Math.floor(t.r2 / C)
    for (let a = k1 - 1; a <= k1 + 1; a++) for (let b = k2 - 1; b <= k2 + 1; b++) for (const u of buckets.get(a * 1000 + b) ?? []) {
      if (Math.abs(u.r1 - t.r1) > tol || Math.abs(u.r2 - t.r2) > tol) continue
      const ratio = t.L / u.L
      if (ratio > 1 + scaleTol || ratio < 1 / (1 + scaleTol)) continue
      const src = u.v.map((i) => norm(inp.stars[i])), dst = t.v.map((i) => catT[i])
      const f = fit(src, dst, 3)
      if (!f) continue
      // nearly a rotation (and maybe a mirror) at the expected scale
      const [a1, b1, d1, e1] = [f.cx[1] / half, f.cx[2] / half, f.cy[1] / half, f.cy[2] / half]
      const E = (a1 + e1) / 2, F = (a1 - e1) / 2, G = (d1 + b1) / 2, Hh = (d1 - b1) / 2
      const q = Math.hypot(E, Hh), rr = Math.hypot(F, G), sv1 = q + rr, sv2 = Math.abs(q - rr)
      if (sv2 <= 0 || sv1 / sv2 > 1.08 || sv1 > 1 + scaleTol || sv2 < 1 / (1 + scaleTol)) continue
      const n = pairsUnder(f, imgV, g3, r * 2.5).length
      if (n >= 6 && (!best || n > best.n)) best = { f, n }
    }
    if (best && best.n >= nV * 0.5) break
  }
  if (!best || best.n < 6) return null
  // refine: affine on generous matches, then tighter, then quadratic when there are enough stars
  let f = best.f, pairs = pairsUnder(f, imgV, g3, r * 2.5)
  for (const [rad, terms] of [[r * 2, 3], [r * 1.5, 3], [r, 6], [r, 6]] as const) {
    const n = pairs.length < 30 ? 3 : terms
    const g = fit(pairs.map((p) => imgV[p.i]), pairs.map((p) => catV[p.j]), n)
    if (!g) break
    f = g; pairs = pairsUnder(f, imgV, g3, rad)
    if (pairs.length < 6) return null
  }
  const rms = Math.sqrt(pairs.reduce((a, p) => a + p.d * p.d, 0) / pairs.length)
  // chance matches scatter over the whole match radius; real ones sit near its middle
  if (pairs.length < need || rms > 0.45 * r) return null
  // results on the sky
  const sky = (x: number, y: number) => { const [X, Y] = apply(f, (x - cxp) / half, (y - cyp) / half); return deproject(ra0, dec0, X * s0, Y * s0) }
  const [ra, dec] = sky(cxp, cyp)
  const outline = ([[0, 0], [W / 2, 0], [W, 0], [W, H / 2], [W, H], [W / 2, H], [0, H], [0, H / 2]] as P[]).map(([x, y]) => sky(x, y))
  // local linear part at the centre, in the tangent plane at the centre
  const at = (x: number, y: number) => project(ra, dec, ...sky(x, y))
  const [ex, ey] = at(cxp + 1, cyp), [nx, ny] = at(cxp, cyp - 1) // one pixel right, one pixel up
  const det = ex * ny - ey * nx
  const sc = Math.sqrt(Math.abs(det))
  const pa = (Math.round(Math.atan2(nx, ny) * R2D * 10) / 10 + 360) % 360
  const span = (a: P, b: P) => separation(...sky(...a), ...sky(...b))
  // a normal image (north up, east left) has right = west and up = north, so det < 0
  return { ra, dec, outline, scale: sc, fieldW: span([0, cyp], [W, cyp]), fieldH: span([cxp, 0], [cxp, H]), pa, mirrored: det > 0, matched: pairs.length, rms: rms * s0 / sc }
}

/** Centres to try around a hint: a grid in its tangent plane, nearest first. */
export function candidates(h: Hint, step: number): P[] {
  const out: { p: P; d: number }[] = []
  const n = Math.ceil(h.radius / step)
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    const x = i * step, y = j * step, d = Math.hypot(x, y)
    if (d <= h.radius + step * 0.5) out.push({ p: deproject(h.ra, h.dec, x, y), d })
  }
  return out.sort((a, b) => a.d - b.d).map((o) => o.p)
}

/**
 * Solve against the catalogue near each hint in turn, trying centres nearest the hint first. `cone` fetches catalogue
 * stars around each centre tried (the Gaia tiles in the browser, a stub in tests); `progress` hears how far it got.
 */
export async function solve(inp: SolveInput, hints: Hint[], cone: (ra: number, dec: number, radius: number, density: number) => Promise<CatStar[]> = gaiaCone, progress?: (text: string) => void): Promise<Solution | null> {
  if (inp.stars.length < 12) return null
  const fw = inp.width * inp.scale, fh = inp.height * inp.scale
  const step = Math.min(fw, fh) * 0.5, slack = step * 0.75
  const nV = Math.min(NV, inp.stars.length)
  const density = ((nV * VDENS) / (fw * fh)) * 1.2 * (1 + inp.scaleTol) ** 2
  const rLocal = (Math.hypot(fw, fh) / 2) * (1 + inp.scaleTol) + slack
  const tried: P[] = []
  for (const [h, hint] of hints.entries()) {
    const cs = candidates(hint, step).filter(([ra, dec]) => !tried.some((t) => separation(ra, dec, t[0], t[1]) < step * 0.4))
    for (let i = 0; i < cs.length; i++) {
      progress?.(`Matching stars${hints.length > 1 ? ` (hint ${h + 1} of ${hints.length})` : ''}… ${Math.round((i / cs.length) * 100)}%`)
      const [ra, dec] = cs[i]
      tried.push(cs[i])
      const cat = await cone(ra, dec, rLocal, density)
      for (const factor of [1, 1.6]) {
        const s = solveAt(inp, cat, ra, dec, slack, factor)
        if (s) return s
      }
    }
  }
  return null
}
