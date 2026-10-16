/**
 * Image review: a scripted critique of a processed (stretched) astrophoto from its pixels alone, no gear or exposure needed.
 * Background level, colour and gradients; noise at fine and coarse scale; clipping; star size, shape and colour; and what
 * calibration left behind (dust motes, amp glow, banding, walking noise, hot pixels). Brightness values are on the 0–255 scale.
 * Pure functions on RGBA pixels, so it runs in a worker (and under Node for tests).
 */

export interface RgbaImage { width: number; height: number; data: Uint8ClampedArray }
export interface Spread { median: number; p10: number; p90: number }
/** A dark round spot: centre and diameter as fractions of the image width and height, depth in levels below the background. */
export interface DustSpot { x: number; y: number; d: number; depth: number }

export interface Review {
  version: 1
  image: { width: number; height: number; scale: number; mono: boolean }
  background: {
    level: number                      // median background brightness
    colour: [number, number, number] | null
    cast: string | null                // 'green', 'magenta', … when the channels differ noticeably
    castSpread: number                 // largest channel difference
    grid: (number | null)[][]          // tile background minus the level; null where the object fills the tile
    objectPct: number                  // share of tiles the object brightens
    reliable: boolean                  // false when the object fills nearly the whole frame
    gradient: { peakToPeak: number; linear: number; direction: number; radial: number; colour: number }
  }
  noise: { fine: number | null; coarse: number | null; chroma: number | null; lumaBin2: number | null; posterized: number }
  clipping: { blackPct: number; blackBgPct: number; blackChannelPct: number[]; whitePct: number; whiteChannelPct: number[]; largestWhite: number; extendedWhite: number; colourClipPct: number }
  stars: {
    detected: number; measured: number; saturated: number
    fwhm: Spread | null; eccentricity: Spread | null; coveragePct: number
    grid: { fwhm: (number | null)[][]; eccentricity: (number | null)[][] }
    colour: { chroma: number; whitePct: number; redBlue: number; redBlueSpread: number; green: number } | null
    halo: { blue: number; bluePct: number; ringPct: number; measured: number } | null
  }
  artefacts: {
    dust: DustSpot[]
    ampGlow: { corner: string; levels: number } | null
    banding: { rows: number; rowsRatio: number; cols: number; colsRatio: number }
    streaks: { direction: number; strength: number } | null
    specksPerMp: number
  }
  object: { coveragePct: number; saturation: number; hue: number; hueName: string } | null
  warnings: string[]
}

const LV = 255

const sortedQ = (s: Float64Array, q: number) => { const k = (s.length - 1) * q, lo = Math.floor(k), hi = Math.ceil(k); return s[lo] + (s[hi] - s[lo]) * (k - lo) }
export const quantile = (a: ArrayLike<number>, q: number) => (a.length ? sortedQ(Float64Array.from(a).sort(), q) : NaN)
const median = (a: ArrayLike<number>) => quantile(a, 0.5)
/** Robust standard deviation: 1.4826 × the median absolute deviation. */
function mad(a: ArrayLike<number>, m = median(a)) {
  const d = new Float64Array(a.length)
  for (let i = 0; i < a.length; i++) d[i] = Math.abs(a[i] - m)
  return 1.4826 * median(d)
}
function spread(a: ArrayLike<number>): Spread | null {
  if (!a.length) return null
  const s = Float64Array.from(a).sort()
  return { median: sortedQ(s, 0.5), p10: sortedQ(s, 0.1), p90: sortedQ(s, 0.9) }
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Least squares by the normal equations; null when singular. */
function lsq(rows: number[][], vals: number[]): number[] | null {
  const k = rows[0]?.length ?? 0
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0))
  rows.forEach((r, n) => { for (let i = 0; i < k; i++) { for (let j = 0; j < k; j++) A[i][j] += r[i] * r[j]; A[i][k] += r[i] * vals[n] } })
  for (let c = 0; c < k; c++) {
    let p = c
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    if (Math.abs(A[p][c]) < 1e-12) return null
    ;[A[c], A[p]] = [A[p], A[c]]
    for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j] }
  }
  return A.map((r, i) => r[k] / r[i])
}

/** The background surface: offset, linear tilt (u, v from −1 to 1 across the frame) and a radial term that is 1 in the corners. */
type Coef = [number, number, number, number]
type Pos = [number, number, number]
const surf = (c: Coef, p: Pos) => c[0] + c[1] * p[0] + c[2] * p[1] + c[3] * p[2]
const fitRows = (P: Pos[], ids: number[], radial: boolean) => ids.map((i) => (radial ? [1, P[i][0], P[i][1], P[i][2]] : [1, P[i][0], P[i][1]]))
function fitFixed(vals: number[], P: Pos[], ids: number[]): Coef {
  const radial = ids.length >= 12
  const sol = ids.length >= 4 ? lsq(fitRows(P, ids, radial), ids.map((i) => vals[i])) : null
  return sol ? [sol[0], sol[1], sol[2], radial ? sol[3] : 0] : [median(ids.map((i) => vals[i])), 0, 0, 0]
}
/** Fit the surface to tile backgrounds, dropping tiles the object brightens (and the odd dark one) until the set settles. */
function robustFit(vals: number[], P: Pos[]) {
  // start from the darkest tiles: in a finished image the background is the darkest thing in it (dark nebulae aside)
  const q10 = quantile(vals, 0.1), cut = Math.max(quantile(vals, 0.25), q10 + Math.max(8 / LV, 0.3 * q10))
  let inl = vals.map((v) => v <= cut), coef: Coef = [median(vals), 0, 0, 0], s = 0
  for (let it = 0; it < 8; it++) {
    const ids = inl.flatMap((k, i) => (k ? [i] : []))
    coef = fitFixed(vals, P, ids)
    const res = vals.map((v, i) => v - surf(coef, P[i]))
    s = Math.max(mad(ids.map((i) => res[i])), 0.4 / LV)
    const next = res.map((r) => r <= 2.5 * s && r >= -3.5 * s)
    if (next.filter(Boolean).length < 4 || next.every((k, i) => k === inl[i])) break
    inl = next
  }
  return { coef, inl, s }
}

interface Tiles { nx: number; ny: number; tw: number; th: number; L: Float64Array; S: Float64Array; C: Float64Array[] }

/** Background per tile: a sigma-clipped median of luminance (stars and the brightest object parts clipped), its noise, and each channel. */
function tileStats(L: Float32Array, d: Uint8ClampedArray, W: number, H: number): Tiles {
  const long = 16
  const nx = W >= H ? long : Math.max(4, Math.round((long * W) / H)), ny = W >= H ? Math.max(4, Math.round((long * H) / W)) : long
  const tw = W / nx, th = H / ny
  const T: Tiles = { nx, ny, tw, th, L: new Float64Array(nx * ny), S: new Float64Array(nx * ny), C: [0, 1, 2].map(() => new Float64Array(nx * ny)) }
  for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
    const x0 = Math.floor(tx * tw), x1 = Math.floor((tx + 1) * tw), y0 = Math.floor(ty * th), y1 = Math.floor((ty + 1) * th)
    const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 2500)))
    let keep: number[] = []
    for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) keep.push(y * W + x)
    let v = keep.map((i) => L[i]), m = median(v), s = Math.max(mad(v, m), 0.25 / LV)
    for (let it = 0; it < 5; it++) {
      const lo = m - 4 * s, hi = m + 2.5 * s
      const k2 = keep.filter((i) => L[i] >= lo && L[i] <= hi)
      if (k2.length < 20) break
      keep = k2; v = keep.map((i) => L[i]); m = median(v); s = Math.max(mad(v, m), 0.25 / LV)
    }
    const t = ty * nx + tx
    T.L[t] = m; T.S[t] = s
    for (let c = 0; c < 3; c++) T.C[c][t] = median(keep.map((i) => d[4 * i + c] / LV))
  }
  return T
}

/** Bilinear interpolation of a tile grid at a pixel. */
function interp(g: Float64Array, t: Tiles, x: number, y: number) {
  const fx = clamp((x + 0.5) / t.tw - 0.5, 0, t.nx - 1), fy = clamp((y + 0.5) / t.th - 0.5, 0, t.ny - 1)
  const x0 = Math.min(Math.floor(fx), t.nx - 2), y0 = Math.min(Math.floor(fy), t.ny - 2), ax = fx - x0, ay = fy - y0, i = y0 * t.nx + x0
  return (g[i] * (1 - ax) + g[i + 1] * ax) * (1 - ay) + (g[i + t.nx] * (1 - ax) + g[i + t.nx + 1] * ax) * ay
}
/** The same for a whole row at once. */
function interpRow(g: Float64Array, t: Tiles, y: number, out: Float32Array, col: Float64Array) {
  const fy = clamp((y + 0.5) / t.th - 0.5, 0, t.ny - 1), y0 = Math.min(Math.floor(fy), t.ny - 2), ay = fy - y0
  for (let tx = 0; tx < t.nx; tx++) col[tx] = g[y0 * t.nx + tx] * (1 - ay) + g[(y0 + 1) * t.nx + tx] * ay
  for (let x = 0; x < out.length; x++) {
    const fx = clamp((x + 0.5) / t.tw - 0.5, 0, t.nx - 1), x0 = Math.min(Math.floor(fx), t.nx - 2), ax = fx - x0
    out[x] = col[x0] * (1 - ax) + col[x0 + 1] * ax
  }
}

/** Pixel noise from the difference with the four neighbours, over the pixels `ok` accepts (white noise: σ² × 1.25). */
function lapNoise(A: Float32Array, w: number, h: number, ok: (x: number, y: number) => boolean, max = 250000) {
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / max)))
  const d: number[] = []
  for (let y = 1; y < h - 1; y += step) for (let x = 1; x < w - 1; x += step) {
    if (!ok(x, y)) continue
    const i = y * w + x
    d.push(A[i] - (A[i - 1] + A[i + 1] + A[i - w] + A[i + w]) / 4)
  }
  return d.length < 50 ? null : mad(d) / Math.sqrt(1.25)
}

function bin(A: Float32Array, w: number, h: number, k: number) {
  const bw = Math.floor(w / k), bh = Math.floor(h / k), out = new Float32Array(bw * bh)
  for (let y = 0; y < bh * k; y++) { const row = ((y / k) | 0) * bw; for (let x = 0; x < bw * k; x++) out[row + ((x / k) | 0)] += A[y * w + x] }
  for (let i = 0; i < out.length; i++) out[i] /= k * k
  return { a: out, w: bw, h: bh }
}

/** Box blur of radius r by running sums, rows then columns. */
function boxBlur(A: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(A.length), out = new Float32Array(A.length)
  for (let y = 0; y < h; y++) {
    let s = 0, n = 0
    for (let x = -r; x < w; x++) {
      if (x + r < w) { s += A[y * w + x + r]; n++ }
      if (x - r - 1 >= 0) { s -= A[y * w + x - r - 1]; n-- }
      if (x >= 0) tmp[y * w + x] = s / n
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0, n = 0
    for (let y = -r; y < h; y++) {
      if (y + r < h) { s += tmp[(y + r) * w + x]; n++ }
      if (y - r - 1 >= 0) { s -= tmp[(y - r - 1) * w + x]; n-- }
      if (y >= 0) out[y * w + x] = s / n
    }
  }
  return out
}

/**
 * Pixels 4-connected to the seed that pass `test`, within R of the seed. `edge` is set when the region wants to grow
 * past that window (or the image border): an extended object rather than a star.
 */
function grow(seed: number, W: number, H: number, R: number, test: (j: number) => boolean, vis: Uint8Array) {
  const sx = seed % W, sy = (seed / W) | 0, ws = 2 * R + 1
  vis.fill(0, 0, ws * ws)
  const stack = [seed], px: number[] = []
  let edge = false
  vis[R * ws + R] = 1
  while (stack.length) {
    const j = stack.pop()!
    px.push(j)
    const x = j % W, y = (j / W) | 0
    for (let n = 0; n < 4; n++) {
      const nx = n === 0 ? x - 1 : n === 1 ? x + 1 : x, ny = n === 2 ? y - 1 : n === 3 ? y + 1 : y
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) { edge = true; continue }
      const nj = ny * W + nx, lx = nx - sx + R, ly = ny - sy + R
      if (lx < 0 || ly < 0 || lx >= ws || ly >= ws) { if (test(nj)) edge = true; continue }
      const k = ly * ws + lx
      if (vis[k]) continue
      vis[k] = 1
      if (test(nj)) stack.push(nj)
    }
  }
  return { px, edge }
}

/** Connected groups of set pixels in a mask (4-connected), as lists of indices. */
function components(mask: Uint8Array, w: number, h: number) {
  const seen = new Uint8Array(mask.length), out: number[][] = []
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue
    const comp: number[] = [], stack = [i]
    seen[i] = 1
    while (stack.length) {
      const j = stack.pop()!
      comp.push(j)
      const x = j % w, y = (j / w) | 0
      if (x > 0 && mask[j - 1] && !seen[j - 1]) { seen[j - 1] = 1; stack.push(j - 1) }
      if (x < w - 1 && mask[j + 1] && !seen[j + 1]) { seen[j + 1] = 1; stack.push(j + 1) }
      if (y > 0 && mask[j - w] && !seen[j - w]) { seen[j - w] = 1; stack.push(j - w) }
      if (y < h - 1 && mask[j + w] && !seen[j + w]) { seen[j + w] = 1; stack.push(j + w) }
    }
    out.push(comp)
  }
  return out
}

function hueOf(r: number, g: number, b: number) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn
  if (c <= 0) return 0
  const h = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4
  return (h * 60 + 360) % 360
}
export function hueName(h: number) {
  return h < 15 || h >= 345 ? 'red' : h < 40 ? 'orange' : h < 70 ? 'yellow' : h < 160 ? 'green' : h < 200 ? 'cyan' : h < 250 ? 'blue' : h < 290 ? 'violet' : 'magenta'
}
/** Name the tint of a background from its channel offsets. */
function castName(rgb: [number, number, number]) {
  const m = (rgb[0] + rgb[1] + rgb[2]) / 3, [r, g, b] = rgb.map((v) => v - m)
  return hueName(hueOf(r, g, b)).replace('violet', 'purple')
}

/** Brightest stars to measure; more add time without changing the statistics. */
const MAX_STARS = 3000
/** Stars whose wings and surroundings are profiled for halos and rings. */
const PROFILE_STARS = 120

export function analyze(img: RgbaImage, scale = 1): Review {
  const { width: W, height: H, data: d } = img
  const N = W * H
  const warnings: string[] = []

  // luminance, and whether the image is really colour
  const L = new Float32Array(N)
  for (let i = 0; i < N; i++) L[i] = (0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2]) / LV
  let grey = 0, sampled = 0
  for (let i = 0; i < N; i += Math.max(1, Math.floor(N / 20000))) { sampled++; if (Math.abs(d[4 * i] - d[4 * i + 1]) <= 2 && Math.abs(d[4 * i + 2] - d[4 * i + 1]) <= 2) grey++ }
  const mono = grey >= 0.99 * sampled

  // background: tile medians, then a smooth surface through the tiles that are background rather than object
  const T = tileStats(L, d, W, H)
  const nT = T.nx * T.ny
  const P: Pos[] = Array.from({ length: nT }, (_, t) => {
    const u = (((t % T.nx) + 0.5) * T.tw - W / 2) / (W / 2), v = ((Math.floor(t / T.nx) + 0.5) * T.th - H / 2) / (H / 2)
    return [u, v, ((u * W) ** 2 + (v * H) ** 2) / (W * W + H * H)]
  })
  const tileL = Array.from(T.L)
  const { coef, inl, s: tileRes } = robustFit(tileL, P)
  const inIds = inl.flatMap((k, i) => (k ? [i] : []))
  const reliable = inIds.length >= 0.2 * nT
  const level = median(inIds.map((i) => T.L[i]))
  const objectTile = tileL.map((v, i) => v - surf(coef, P[i]) > 3 * tileRes)
  const lattice: Pos[] = []
  for (let a = 0; a <= 8; a++) for (let b = 0; b <= 8; b++) { const u = a / 4 - 1, v = b / 4 - 1; lattice.push([u, v, ((u * W) ** 2 + (v * H) ** 2) / (W * W + H * H)]) }
  const model = lattice.map((p) => surf(coef, p))
  const peakToPeak = Math.max(...model) - Math.min(...model)
  const colourBg: [number, number, number] | null = mono ? null : [0, 1, 2].map((c) => median(inIds.map((i) => T.C[c][i])) * LV) as [number, number, number]
  let colourGrad = 0
  if (!mono) {
    const chan = [0, 1, 2].map((c) => fitFixed(Array.from(T.C[c]), P, inIds))
    const sp = lattice.map((p) => { const v = chan.map((k) => surf(k, p)); return Math.max(...v) - Math.min(...v) })
    colourGrad = (Math.max(...sp) - Math.min(...sp)) * LV
  }
  const castSpread = colourBg ? Math.max(...colourBg) - Math.min(...colourBg) : 0
  const grid = Array.from({ length: T.ny }, (_, ty) => Array.from({ length: T.nx }, (_, tx) => { const t = ty * T.nx + tx; return objectTile[t] ? null : (T.L[t] - level) * LV }))

  const tileOf = (x: number, y: number) => Math.min(T.ny - 1, Math.floor(y / T.th)) * T.nx + Math.min(T.nx - 1, Math.floor(x / T.tw))
  const isBg = (x: number, y: number, i: number) => { const t = tileOf(x, y); return inl[t] && L[i] <= T.L[t] + 3 * T.S[t] && L[i] >= T.L[t] - 4 * T.S[t] }

  // noise at the pixel scale, at 4 px (blotches) and in colour at 2 px
  const fine = lapNoise(L, W, H, (x, y) => isBg(x, y, y * W + x))
  const b2 = bin(L, W, H, 2), b4 = bin(b2.a, b2.w, b2.h, 2)
  const bgAt = (k: number) => (x: number, y: number) => { const X = x * k + (k >> 1), Y = y * k + (k >> 1); return isBg(X, Y, Y * W + X) }
  const lumaBin2 = lapNoise(b2.a, b2.w, b2.h, bgAt(2))
  const coarse = lapNoise(b4.a, b4.w, b4.h, bgAt(4))
  let chroma: number | null = null
  if (!mono) {
    const rg = new Float32Array(N), bg = new Float32Array(N)
    for (let i = 0; i < N; i++) { rg[i] = (d[4 * i] - d[4 * i + 1]) / LV; bg[i] = (d[4 * i + 2] - d[4 * i + 1]) / LV }
    const a = bin(rg, W, H, 2), b = bin(bg, W, H, 2)
    const na = lapNoise(a.a, a.w, a.h, bgAt(2)), nb = lapNoise(b.a, b.w, b.h, bgAt(2))
    // a difference of two channels carries √2 times one channel's noise
    if (na != null && nb != null) chroma = Math.sqrt((na * na + nb * nb) / 2) / Math.SQRT2
  }

  // one pass over every pixel: clipping, background histograms (for posterisation) and row/column means (for banding)
  const hist = [0, 1, 2].map(() => new Uint32Array(256))
  const rowS = new Float64Array(H), rowN = new Uint32Array(H), colS = new Float64Array(W), colN = new Uint32Array(W)
  const black = [0, 0, 0], white = [0, 0, 0]
  let blackAny = 0, whiteAny = 0, colourClip = 0, bgN = 0, bgBlack = 0
  const whiteMask = new Uint8Array(N)
  const rowBg = new Float32Array(W), scratch = new Float64Array(T.nx)
  for (let y = 0; y < H; y++) {
    interpRow(T.L, T, y, rowBg, scratch)
    for (let x = 0; x < W; x++) {
      const i = y * W + x, r = d[4 * i], g = d[4 * i + 1], b = d[4 * i + 2]
      const mn = Math.min(r, g, b), mx = Math.max(r, g, b)
      if (mn <= 1) { blackAny++; if (r <= 1) black[0]++; if (g <= 1) black[1]++; if (b <= 1) black[2]++ }
      if (mx >= 254) {
        whiteAny++; whiteMask[i] = 1
        if (r >= 254) white[0]++; if (g >= 254) white[1]++; if (b >= 254) white[2]++
        if (!mono && mn < 204) colourClip++
      }
      if (!isBg(x, y, i)) continue
      bgN++
      if (mn <= 1) bgBlack++
      hist[0][r]++; hist[1][g]++; hist[2][b]++
      const res = L[i] - rowBg[x]
      rowS[y] += res; rowN[y]++; colS[x] += res; colN[x]++
    }
  }
  let posterized = 0
  for (const h of mono ? [hist[1]] : hist) {
    const tot = h.reduce((a, b) => a + b, 0)
    if (tot < 1000) continue
    let cum = 0, lo = 0, hi = 255
    for (let v = 0; v < 256; v++) { cum += h[v]; if (cum < tot * 0.01) lo = v + 1; if (cum <= tot * 0.99) hi = v + 1 }
    hi = Math.min(hi, 255)
    if (hi - lo < 6) continue
    let empty = 0
    for (let v = lo; v <= hi; v++) if (!h[v]) empty++
    posterized = Math.max(posterized, empty / (hi - lo + 1))
  }
  const whiteBlobs = components(whiteMask, W, H).map((c) => c.length)
  const extendedArea = Math.max(600, N * 5e-4)
  const pct = (n: number) => (100 * n) / N

  // stars: local maxima well above the local background, brightest first
  const sigmaAt = (x: number, y: number) => interp(T.S, T, x, y)
  const cand: { i: number; amp: number }[] = []
  const minTile = Math.min(...tileL)
  for (let y = 2; y < H - 2; y++) {
    interpRow(T.L, T, y, rowBg, scratch)
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x, v = L[i]
      if (v < minTile + 0.03) continue
      if (!(v > L[i - 1] && v > L[i - W - 1] && v > L[i - W] && v > L[i - W + 1] && v >= L[i + 1] && v >= L[i + W - 1] && v >= L[i + W] && v >= L[i + W + 1])) continue
      const amp = v - rowBg[x]
      if (amp > Math.max(6 * sigmaAt(x, y), 0.03)) cand.push({ i, amp })
    }
  }
  cand.sort((a, b) => b.amp - a.amp)
  const claimed = new Uint8Array(N), foot = new Uint8Array(N)
  const visHalf = new Uint8Array(49 * 49), visFoot = new Uint8Array(121 * 121)
  const fwhms: number[] = [], eccs: number[] = [], chromas: number[] = [], rbs: number[] = [], greens: number[] = []
  const blueEx: number[] = []
  let ringN = 0, profiled = 0, measured = 0, saturated = 0
  const cell = Array.from({ length: 9 }, () => ({ f: [] as number[], e: [] as number[] }))
  const chanAt = (c: number, x: number, y: number) => interp(T.C[c], T, x, y)
  for (const { i } of cand.slice(0, MAX_STARS)) {
    if (claimed[i]) continue
    const x0 = i % W, y0 = (i / W) | 0
    const b = interp(T.L, T, x0, y0), s = sigmaAt(x0, y0), amp = L[i] - b, half = b + amp / 2
    const core = grow(i, W, H, 24, (j) => L[j] >= half, visHalf)
    for (const j of core.px) claimed[j] = 1
    if (core.edge || core.px.length < 3) continue
    let sat = false
    for (const j of core.px) if (Math.max(d[4 * j], d[4 * j + 1], d[4 * j + 2]) >= 254) sat = true
    // centroid and shape from brightness-weighted moments down to a quarter of the peak: sub-pixel, so small stars aren't biased
    const wide = grow(i, W, H, 24, (j) => L[j] >= b + amp / 4, visHalf).px
    let sw0 = 0, mx = 0, my = 0
    for (const j of wide) { const w = L[j] - b; sw0 += w; mx += w * (j % W); my += w * ((j / W) | 0) }
    mx /= sw0; my /= sw0
    let sxx = 0, syy = 0, sxy = 0
    for (const j of wide) { const w = (L[j] - b) / sw0, dx = (j % W) - mx, dy = ((j / W) | 0) - my; sxx += w * dx * dx; syy += w * dy * dy; sxy += w * dx * dy }
    const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det))
    const l1 = tr / 2 + disc, l2 = tr / 2 - disc
    const fwhm = 2 * Math.sqrt(core.px.length / Math.PI)
    measured++
    const ci = Math.min(2, Math.floor((3 * my) / H)) * 3 + Math.min(2, Math.floor((3 * mx) / W))
    if (sat) saturated++
    else {
      fwhms.push(fwhm); cell[ci].f.push(fwhm)
      if (fwhm >= 2.5 && amp > 20 * s) { const e = Math.sqrt(Math.max(0, 1 - l2 / l1)); eccs.push(e); cell[ci].e.push(e) }
    }
    // the visible disc: everything clearly above the background
    const vis = b + Math.max(4 * s, 0.04)
    const disc2 = vis < half ? grow(i, W, H, 60, (j) => L[j] >= vis, visFoot).px : core.px
    for (const j of disc2) foot[j] = 1
    const rF = Math.sqrt(disc2.length / Math.PI)
    const bgC = [0, 1, 2].map((c) => chanAt(c, mx, my))
    if (!mono && !sat) {
      const f = [0, 0, 0]
      for (const j of disc2) for (let c = 0; c < 3; c++) f[c] += d[4 * j + c] / LV - bgC[c]
      if (f[0] > 0 && f[1] > 0 && f[2] > 0) {
        const fm = Math.max(...f)
        chromas.push((fm - Math.min(...f)) / fm); rbs.push(Math.log2(f[0] / f[2])); greens.push(f[1] / ((f[0] + f[2]) / 2))
      }
    }
    // the brightest stars: dark rings just outside the disc, and the colour of the wing against the core
    if (profiled < PROFILE_STARS && rF >= 2) {
      profiled++
      const Rp = Math.min(40, Math.ceil(3 * rF) + 2)
      const ann: number[][] = Array.from({ length: Rp }, () => [])
      const cs = [0, 1, 2].map(() => new Float64Array(Rp))
      for (let y = Math.max(0, Math.floor(my - Rp)); y <= Math.min(H - 1, Math.ceil(my + Rp)); y++) for (let x = Math.max(0, Math.floor(mx - Rp)); x <= Math.min(W - 1, Math.ceil(mx + Rp)); x++) {
        const k = Math.floor(Math.hypot(x - mx, y - my))
        if (k >= Rp) continue
        const j = y * W + x
        ann[k].push(L[j] - b)
        for (let c = 0; c < 3; c++) cs[c][k] += d[4 * j + c] / LV - bgC[c]
      }
      let ring = false
      for (let k = Math.ceil(rF); k <= Math.min(Rp - 1, Math.ceil(2.5 * rF)); k++) {
        if (ann[k].length < 8) continue
        if (median(ann[k]) < -Math.max((5 * s) / Math.sqrt(ann[k].length), 2 / LV)) { ring = true; break }
      }
      if (ring) ringN++
      if (!mono) {
        const hr = fwhm / 2, sum = (lo: number, hi: number) => [0, 1, 2].map((c) => { let t = 0; for (let k = Math.max(0, lo); k <= Math.min(Rp - 1, hi); k++) t += Math.max(0, cs[c][k]); return t })
        const cc = sum(0, Math.max(0, Math.round(hr * 0.7))), wc = sum(Math.ceil(hr), Math.ceil(rF * 1.2))
        const ct = cc[0] + cc[1] + cc[2], wt = wc[0] + wc[1] + wc[2]
        if (ct > 0 && wt > 0.05) blueEx.push(wc[2] / wt - cc[2] / ct)
      }
    }
  }
  let coverage = 0
  for (let i = 0; i < N; i++) coverage += foot[i]

  // hot pixels and coloured specks: single pixels far above all eight neighbours, too sharp to be a star
  let specks = 0
  const chans = mono ? [1] : [0, 1, 2]
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x
    for (const c of chans) {
      const v = d[4 * i + c]
      if (v < d[4 * (i - 1) + c] + 30) continue
      const nm = Math.max(d[4 * (i - 1) + c], d[4 * (i + 1) + c], d[4 * (i - W - 1) + c], d[4 * (i - W) + c], d[4 * (i - W + 1) + c], d[4 * (i + W - 1) + c], d[4 * (i + W) + c], d[4 * (i + W + 1) + c])
      if (v - nm < 30) continue
      const t = tileOf(x, y), bc = T.C[c][t] * LV
      if (nm - bc > (mono ? 0.15 : 0.3) * (v - bc)) continue
      // a tiny star lifts every channel; a hot pixel or speck mostly one
      if (!mono && [0, 1, 2].some((o) => o !== c && d[4 * i + o] - T.C[o][t] * LV > (v - bc) / 3)) continue
      specks++
      break
    }
  }

  // a small copy (about 600 px across) for what spans many pixels: dust motes, amp glow, the object's colour
  const k = Math.max(1, Math.ceil(Math.max(W, H) / 600)), sw = Math.floor(W / k), sh = Math.floor(H / k), sn = sw * sh
  const Ls = new Float32Array(sn), Cs = [0, 1, 2].map(() => new Float32Array(sn)), sf = new Float32Array(sn)
  for (let y = 0; y < sh * k; y++) for (let x = 0; x < sw * k; x++) {
    const i = y * W + x, o = ((y / k) | 0) * sw + ((x / k) | 0)
    Ls[o] += L[i]; sf[o] += foot[i]
    for (let c = 0; c < 3; c++) Cs[c][o] += d[4 * i + c]
  }
  const res = new Float32Array(sn), sInl = new Uint8Array(sn)
  for (let o = 0; o < sn; o++) {
    Ls[o] /= k * k; sf[o] /= k * k
    for (let c = 0; c < 3; c++) Cs[c][o] /= k * k * LV
    const X = ((o % sw) + 0.5) * k, Y = (Math.floor(o / sw) + 0.5) * k, u = (X - W / 2) / (W / 2), v = (Y - H / 2) / (H / 2)
    res[o] = Ls[o] - surf(coef, [u, v, ((u * W) ** 2 + (v * H) ** 2) / (W * W + H * H)])
    sInl[o] = inl[tileOf(X, Y)] && sf[o] < 0.2 ? 1 : 0
  }
  const inlRes = Array.from(res).filter((_, o) => sInl[o])
  const sig = Math.max(mad(inlRes.length > 100 ? inlRes : Array.from(res)), 0.3 / LV)
  const smooth = boxBlur(res, sw, sh, 1)
  const inlSm = Array.from(smooth).filter((_, o) => sInl[o])
  const sigSm = Math.max(mad(inlSm.length > 100 ? inlSm : Array.from(smooth)), 0.25 / LV)

  // dust motes: round patches darker than the background around them
  const dark = new Uint8Array(sn)
  for (let o = 0; o < sn; o++) dark[o] = smooth[o] < -Math.max(3 * sigSm, 1.5 / LV) ? 1 : 0
  const dust: DustSpot[] = []
  for (const c of components(dark, sw, sh)) {
    if (c.length < 6 || c.length > 0.03 * sn) continue
    let x0 = sw, x1 = 0, y0 = sh, y1 = 0, deepest = 0, cx = 0, cy = 0
    for (const o of c) { const x = o % sw, y = Math.floor(o / sw); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); deepest = Math.min(deepest, smooth[o]); cx += x; cy += y }
    if (x0 === 0 || y0 === 0 || x1 === sw - 1 || y1 === sh - 1) continue
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, ext = Math.max(bw, bh)
    if (Math.min(bw, bh) / ext < 0.5 || c.length / ((Math.PI / 4) * ext * ext) < 0.5) continue
    if (deepest > -Math.max(5 * sigSm, 2.5 / LV)) continue
    dust.push({ x: (cx / c.length + 0.5) / sw, y: (cy / c.length + 0.5) / sh, d: ext / sw, depth: -deepest * LV })
  }
  dust.sort((a, b) => b.depth - a.depth)

  // amp glow: one corner brighter than the background surface allows
  const pw = Math.max(3, Math.round(sw * 0.08)), ph = Math.max(3, Math.round(sh * 0.08))
  const corners = [[0, 0], [sw - pw, 0], [0, sh - ph], [sw - pw, sh - ph]].map(([cx, cy]) => {
    const v: number[] = []
    for (let y = cy; y < cy + ph; y++) for (let x = cx; x < cx + pw; x++) if (sf[y * sw + x] < 0.2) v.push(res[y * sw + x])
    return v.length ? median(v) : 0
  })
  const hiC = corners.indexOf(Math.max(...corners)), others = corners.filter((_, i) => i !== hiC)
  const glow = corners[hiC] - others.reduce((a, b) => a + b, 0) / 3
  const ampGlow = glow > Math.max(3 / LV, 4 * sig) && corners[hiC] > 2 / LV ? { corner: ['top left', 'top right', 'bottom left', 'bottom right'][hiC], levels: glow * LV } : null

  // banding: row or column means of the background wandering more than the noise allows
  const noiseScale = Math.max(fine ?? 0, 4 * (coarse ?? 0))
  const band = (S: Float64Array, n: Uint32Array, len: number) => {
    const v = Array.from(S, (s, i) => (n[i] >= len / 5 ? s / n[i] : NaN))
    const dv: number[] = []
    for (let i = 0; i < v.length; i++) {
      if (Number.isNaN(v[i])) continue
      let t = 0, m = 0
      for (let j = Math.max(0, i - 12); j <= Math.min(v.length - 1, i + 12); j++) if (!Number.isNaN(v[j])) { t += v[j]; m++ }
      dv.push(v[i] - t / m)
    }
    if (dv.length < 20) return { amp: 0, ratio: 0 }
    const amp = mad(dv), nn = median(Array.from(n).filter((c) => c >= len / 5))
    return { amp: amp * LV, ratio: noiseScale > 0 ? amp / (noiseScale / Math.sqrt(nn)) : 0 }
  }
  const rb = band(rowS, rowN, W), cb = band(colS, colN, H)

  // walking noise: background noise correlated along one direction more than across it
  const hp = new Float32Array(b2.a.length), bl = boxBlur(b2.a, b2.w, b2.h, 2)
  for (let i = 0; i < hp.length; i++) hp[i] = b2.a[i] - bl[i]
  const okB2 = bgAt(2)
  const lags: [number, number, number][] = [[2, 0, 0], [2, 1, 27], [2, 2, 45], [1, 2, 63], [0, 2, 90], [-1, 2, 117], [-2, 2, 135], [-2, 1, 153]]
  const stepB = Math.max(1, Math.floor(Math.sqrt(hp.length / 200000)))
  const corr = lags.map(([dx, dy]) => {
    let sab = 0, saa = 0, sbb = 0
    for (let y = 2; y < b2.h - 3; y += stepB) for (let x = 3; x < b2.w - 3; x += stepB) {
      if (!okB2(x, y) || !okB2(x + dx, y + dy)) continue
      const a = hp[y * b2.w + x], b = hp[(y + dy) * b2.w + x + dx]
      sab += a * b; saa += a * a; sbb += b * b
    }
    return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0
  })
  let streaks: Review['artefacts']['streaks'] = null
  for (let a = 0; a < 4; a++) {
    const diff = corr[a] - corr[a + 4]
    if (!streaks || Math.abs(diff) > streaks.strength) streaks = { direction: diff > 0 ? lags[a][2] : lags[a + 4][2], strength: Math.abs(diff) }
  }

  // the object: clearly brighter than the background surface, not a star
  let object: Review['object'] = null
  if (!mono) {
    const sats: number[] = []
    let hx = 0, hy = 0, cnt = 0
    for (let o = 0; o < sn; o++) {
      if (res[o] < Math.max(5 * sig, 0.03) || sf[o] >= 0.25 || Ls[o] > 0.97) continue
      cnt++
      const r = Cs[0][o], g = Cs[1][o], b = Cs[2][o], mx = Math.max(r, g, b)
      const sat = mx > 0 ? (mx - Math.min(r, g, b)) / mx : 0, h = (hueOf(r, g, b) * Math.PI) / 180
      sats.push(sat); hx += sat * Math.cos(h); hy += sat * Math.sin(h)
    }
    if (cnt >= 0.015 * sn) {
      const hue = ((Math.atan2(hy, hx) * 180) / Math.PI + 360) % 360
      object = { coveragePct: (100 * cnt) / sn, saturation: median(sats), hue, hueName: hueName(hue) }
    }
  }

  if (level * LV < 3 && quantile(L.subarray(0, Math.min(N, 200000)), 0.99) < 0.1) warnings.push('This looks like a linear (unstretched) image. Image review is for finished images; check linear stacks with the Image inspector.')
  if (N < 500000) warnings.push('The image is small, so star and noise measurements are rough. Review the full-size export if you have it.')

  const g3 = (pick: (c: { f: number[]; e: number[] }) => number[]) => [0, 1, 2].map((r) => [0, 1, 2].map((c) => { const v = pick(cell[r * 3 + c]); return v.length >= 3 ? median(v) : null }))
  return {
    version: 1,
    image: { width: W, height: H, scale, mono },
    background: {
      level: level * LV, colour: colourBg, cast: colourBg && castSpread > 2.5 ? castName(colourBg) : null, castSpread, grid, objectPct: (100 * objectTile.filter(Boolean).length) / nT, reliable,
      gradient: { peakToPeak: peakToPeak * LV, linear: 2 * (Math.abs(coef[1]) + Math.abs(coef[2])) * LV, direction: ((Math.atan2(coef[2], coef[1]) * 180) / Math.PI + 360) % 360, radial: coef[3] * LV, colour: colourGrad },
    },
    noise: { fine: fine == null ? null : fine * LV, coarse: coarse == null ? null : coarse * LV, chroma: chroma == null ? null : chroma * LV, lumaBin2: lumaBin2 == null ? null : lumaBin2 * LV, posterized },
    clipping: {
      blackPct: pct(blackAny), blackBgPct: bgN ? (100 * bgBlack) / bgN : 0, blackChannelPct: black.map(pct), whitePct: pct(whiteAny), whiteChannelPct: white.map(pct),
      largestWhite: whiteBlobs.length ? Math.max(...whiteBlobs) : 0, extendedWhite: whiteBlobs.filter((a) => a > extendedArea).length, colourClipPct: pct(colourClip),
    },
    stars: {
      detected: cand.length, measured, saturated, fwhm: spread(fwhms), eccentricity: spread(eccs), coveragePct: pct(coverage),
      grid: { fwhm: g3((c) => c.f), eccentricity: g3((c) => c.e) },
      colour: chromas.length >= 10 ? { chroma: median(chromas), whitePct: (100 * chromas.filter((c) => c < 0.1).length) / chromas.length, redBlue: median(rbs), redBlueSpread: mad(rbs), green: median(greens) } : null,
      halo: profiled >= 8 ? { blue: blueEx.length ? median(blueEx) : 0, bluePct: blueEx.length ? (100 * blueEx.filter((v) => v > 0.03).length) / blueEx.length : 0, ringPct: (100 * ringN) / profiled, measured: profiled } : null,
    },
    artefacts: { dust: dust.slice(0, 12), ampGlow, banding: { rows: rb.amp, rowsRatio: rb.ratio, cols: cb.amp, colsRatio: cb.ratio }, streaks, specksPerMp: specks / (N / 1e6) },
    object,
    warnings,
  }
}

export type Area = 'Background' | 'Noise' | 'Clipping' | 'Stars' | 'Calibration' | 'Colour' | 'Setup'
export interface Note { area: Area; tone: 'ok' | 'info' | 'warn' | 'bad'; text: string }
export const AREAS: Area[] = ['Setup', 'Background', 'Noise', 'Clipping', 'Stars', 'Colour', 'Calibration']

const lv = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)}/255`
const compass = (deg: number) => ['right', 'lower right', 'bottom', 'lower left', 'left', 'upper left', 'top', 'upper right'][Math.round(deg / 45) % 8]
const CAST_FIX: Record<string, string> = {
  green: 'Remove it with SCNR, or redo the colour calibration (SPCC / PCC).',
  magenta: 'Usually a reaction to SCNR or a dual-band filter; neutralise the background and ease off the green removal.',
}

/**
 * Plain-language reading of a review with what to try. Thresholds are rules of thumb for finished images viewed
 * on screen, and aesthetic ones (background level, saturation) are suggestions, not errors.
 */
export function notes(r: Review, opts: { arcsecKnown?: boolean } = {}): Note[] {
  const out: Note[] = []
  const add = (area: Area, tone: Note['tone'], text: string) => out.push({ area, tone, text })
  const { background: bg, noise: n, clipping: c, stars: s, artefacts: a } = r

  // background: only where there is some to measure
  if (!bg.reliable) add('Background', 'info', 'The object fills nearly the whole frame, so there is no clear background to judge its level, colour or gradients. Those checks, and the ones for calibration leftovers, are skipped.')
  else {
    const L = bg.level
    if (L < 8) add('Background', 'warn', `The background is nearly black (${lv(L)}): faint outer detail and dust lanes get crushed. Lift the black point a little; around 20–30/255 is a common target.`)
    else if (L < 15) add('Background', 'warn', `The background is on the dark side (${lv(L)}). Fine for a dramatic look, but faint signal near the background may be lost; 20–30/255 is a common target.`)
    else if (L > 60) add('Background', 'bad', `The background is washed out (${lv(L)}): the image looks grey and low in contrast. Set the black point closer to the background peak.`)
    else if (L > 45) add('Background', 'warn', `The background is bright (${lv(L)}) and may look greyish. Darkening it a little adds contrast.`)
    else add('Background', 'ok', `Background level ${lv(L)}: in the usual range.`)
    if (bg.colour) {
      if (bg.cast && bg.castSpread > 6) add('Background', 'bad', `The background has a strong ${bg.cast} cast (channels differ by ${bg.castSpread.toFixed(0)} levels). ${CAST_FIX[bg.cast] ?? 'Neutralise the background (background neutralisation, or colour calibration with a background reference).'}`)
      else if (bg.cast) add('Background', 'warn', `The background leans ${bg.cast} (channels differ by ${bg.castSpread.toFixed(1)} levels). ${CAST_FIX[bg.cast] ?? 'A background neutralisation step will fix it.'}`)
      else add('Background', 'ok', 'Neutral background colour.')
    }
    const g = bg.gradient
    const radialMain = Math.abs(g.radial) > g.linear * 0.6
    // a large object's faint outskirts look like a bright centre too
    const big = bg.objectPct > 12
    if (g.peakToPeak > 3) {
      const tone = g.peakToPeak > 8 && !big ? 'bad' : 'warn'
      if (radialMain && g.radial < 0) add('Background', tone, `The corners are ${Math.abs(g.radial).toFixed(0)} levels darker than the centre: ${big ? 'the faint outskirts of a large object, or ' : ''}vignetting the flats didn't correct. Check the flats match the lights (same focus, rotation and filter), or remove it with gradient removal.`)
      else if (radialMain) add('Background', tone, `The corners are ${g.radial.toFixed(0)} levels brighter than the centre: the flats over-correct. Often missing flat darks or bias, or flats that don't match the lights.`)
      else add('Background', tone, `A gradient of ${g.peakToPeak.toFixed(0)} levels runs across the background, brightest towards the ${compass(g.direction)}: light pollution or the moon. Gradient removal (GraXpert, DBE/ABE, Siril's background extraction) will flatten it.`)
    } else add('Background', 'ok', `Even background (varies ${g.peakToPeak.toFixed(1)} levels across the frame).`)
    if (g.colour > 4) add('Background', 'warn', `The background colour changes across the frame (${g.colour.toFixed(0)} levels between channels): ${big ? 'the object\'s faint outskirts, or ' : ''}a colour gradient. Gradient removal per channel, before colour calibration, helps.`)
  }

  // noise
  if (n.fine != null) {
    if (n.fine > 3.5) add('Noise', 'bad', `The background is noisy (σ ${n.fine.toFixed(1)} levels per pixel). More integration helps most; otherwise noise reduction while linear (NoiseXTerminator, GraXpert denoise) and a slightly darker background.`)
    else if (n.fine > 1.5) add('Noise', 'warn', `Some grain is visible in the background (σ ${n.fine.toFixed(1)} levels per pixel).`)
    else add('Noise', 'ok', `Smooth background at pixel scale (σ ${n.fine.toFixed(1)} levels).`)
    if (n.coarse != null && n.coarse > 2 && n.coarse > 0.7 * n.fine) add('Noise', 'warn', `The background is blotchy at larger scales (σ ${n.coarse.toFixed(1)} levels at 4 px, where pure grain would be ${(n.fine / 4).toFixed(1)}): typical of strong noise reduction on thin data. More integration, or gentler noise reduction.`)
    if (n.chroma != null && n.lumaBin2 != null && n.chroma > Math.max(1, 1.3 * n.lumaBin2)) add('Noise', 'warn', `Colour noise (mottled colour blotches) is stronger than brightness noise (${n.chroma.toFixed(1)} vs ${n.lumaBin2.toFixed(1)} levels). Apply chroma noise reduction, or lower the saturation of the background.`)
    if (n.fine < 0.4 && (n.coarse ?? 0) < 0.3) add('Noise', 'info', 'The background is very smooth. Check that noise reduction hasn\'t erased faint detail along with the noise.')
  }
  if (n.posterized > 0.2) add('Noise', 'warn', `The background histogram has gaps (${(n.posterized * 100).toFixed(0)}% empty levels): it was stretched in 8-bit, which shows as steps or banding in smooth areas. Stretch in 16 or 32-bit and convert to 8-bit only at export.`)

  // clipping
  if (!bg.reliable) { if (c.blackPct > 1) add('Clipping', 'warn', `${c.blackPct.toFixed(1)}% of the image is clipped to black${worst(c.blackChannelPct)}.`) }
  else if (c.blackBgPct > 2) add('Clipping', 'bad', `${c.blackBgPct.toFixed(1)}% of the background is clipped to black: faint data is gone and the background looks blotchy. Move the black point down.`)
  else if (c.blackBgPct > 0.3) add('Clipping', 'warn', `${c.blackBgPct.toFixed(1)}% of the background is clipped to black${worst(c.blackChannelPct)}. Move the black point down a little.`)
  else add('Clipping', 'ok', `No black clipping in the background${c.blackPct > 0.1 ? ` (${c.blackPct.toFixed(2)}% of the image)` : ''}.`)
  if (c.extendedWhite > 0) add('Clipping', 'warn', `${c.extendedWhite === 1 ? 'An area' : `${c.extendedWhite} areas`} larger than a star ${c.extendedWhite === 1 ? 'is' : 'are'} clipped to white (the largest ${Math.round(2 * Math.sqrt(c.largestWhite / Math.PI) / r.image.scale)} px across): probably the core of the object. Use HDR compression, or blend in shorter exposures.`)
  if (s.measured > 20 && s.saturated > 0.3 * s.measured) add('Clipping', 'warn', `${Math.round((100 * s.saturated) / s.measured)}% of the measured stars have clipped cores, so they look flat and white. Stretch stars separately (starless processing), or ease the stretch on the highlights.`)
  if (c.colourClipPct > 0.1) add('Clipping', 'warn', `In ${c.colourClipPct.toFixed(2)}% of the image one colour channel clips while the others don't, flattening colour in the brightest parts. Reduce saturation or the highlight stretch there.`)

  // stars
  if (!s.measured) add('Stars', 'info', 'No stars measured: a starless image, or too few clear stars.')
  else {
    const e = s.eccentricity?.median
    if (e != null) {
      if (e > 0.68) add('Stars', 'bad', `Stars are clearly elongated (eccentricity ${e.toFixed(2)}): check tracking, guiding, wind and balance.`)
      else if (e > 0.55) add('Stars', 'warn', `Stars are slightly elongated (eccentricity ${e.toFixed(2)}).`)
      else add('Stars', 'ok', `Round stars (eccentricity ${e.toFixed(2)}).`)
    }
    const ge = s.grid.eccentricity, gf = s.grid.fwhm
    const cornersE = [ge[0][0], ge[0][2], ge[2][0], ge[2][2]].filter((v): v is number => v != null), ce = ge[1][1]
    if (ce != null && cornersE.length >= 3) {
      const cm = cornersE.reduce((x, y) => x + y, 0) / cornersE.length
      if (cm - ce > 0.15 && cm > 0.6) add('Stars', 'warn', `Corner stars are stretched (eccentricity ${cm.toFixed(2)} vs ${ce.toFixed(2)} in the centre): coma or field curvature. Check the flattener or reducer spacing (back focus).`)
    }
    const cornersF = [gf[0][0], gf[0][2], gf[2][0], gf[2][2]].filter((v): v is number => v != null)
    if (cornersF.length >= 3 && Math.max(...cornersF) / Math.min(...cornersF) > 1.3) add('Stars', 'warn', `Stars are ${Math.round((Math.max(...cornersF) / Math.min(...cornersF) - 1) * 100)}% larger in one corner than in another: sensor tilt.`)
    if (s.coveragePct > 5) add('Stars', 'warn', `Stars cover ${s.coveragePct.toFixed(0)}% of the image and compete with the object. Star reduction, or a gentler stretch of the stars, puts the focus back on the target.`)
    else if (s.fwhm && s.fwhm.median > 7 && !opts.arcsecKnown) add('Stars', 'warn', `Stars are large (half-maximum width ${s.fwhm.median.toFixed(1)} px). Star reduction or deconvolution will tighten them.`)
    else add('Stars', 'ok', `Stars take up ${s.coveragePct.toFixed(1)}% of the image${s.fwhm ? ` (half-maximum width ${s.fwhm.median.toFixed(1)} px)` : ''}.`)
    if (s.halo && s.halo.ringPct > 40) add('Stars', 'warn', `${s.halo.ringPct.toFixed(0)}% of the bright stars have a dark ring around them: over-sharpening, deconvolution ringing, or star reduction artefacts. Ease off, or protect the stars with a mask.`)
  }

  // colour
  if (!r.image.mono) {
    const sc = s.colour
    if (sc) {
      if (sc.chroma < 0.08 || sc.whitePct > 70) add('Colour', 'warn', `Most stars are white (${sc.whitePct.toFixed(0)}% show no colour): the stretch washed it out. A colour-preserving stretch (arcsinh, or GHS with colour protection), or boosting star saturation, brings it back.`)
      else add('Colour', 'ok', `Stars show colour (${(100 - sc.whitePct).toFixed(0)}% tinted).`)
      if (sc.redBlue > 0.9) add('Colour', 'warn', 'Stars lean orange-red overall: the colour calibration is off. Photometric colour calibration (SPCC / PCC) fixes it.')
      else if (sc.redBlue < -0.5) add('Colour', 'warn', 'Stars lean blue overall: the colour calibration is off. Photometric colour calibration (SPCC / PCC) fixes it.')
      if (sc.green > 1.12) add('Colour', 'warn', 'Stars have a green tint, which real stars don\'t. Use SCNR, or redo the colour calibration.')
    }
    if (s.halo && s.halo.bluePct > 60 && s.halo.blue > 0.03) add('Colour', 'warn', 'Bright stars have blue or violet halos: chromatic aberration (common with doublets and camera lenses). A UV/IR-cut filter helps when imaging; when processing, desaturate the halos or use a de-fringe step.')
    const o = r.object
    if (o) {
      if (o.saturation < 0.1) add('Colour', 'warn', `The object's colour is very muted (saturation ${(o.saturation * 100).toFixed(0)}%). Increase saturation, protecting the background with a mask.`)
      else add('Colour', 'info', `The object covers about ${o.coveragePct.toFixed(0)}% of the frame, mostly ${o.hueName} (saturation ${(o.saturation * 100).toFixed(0)}%).`)
    }
  }

  // calibration leftovers: measured against the background, so only when there is one
  if (!bg.reliable) { for (const w of r.warnings) add('Background', 'info', w); return out.concat(specks(a.specksPerMp)) }
  if (a.dust.length) add('Calibration', 'warn', `${a.dust.length === 1 ? 'A dark round spot' : `${a.dust.length} dark round spots`} that look like dust motes (marked on the image): the flats didn't remove them. Take flats without touching focus or rotation, and before the dust moves. Ignore any that are dark nebulae.`)
  if (a.ampGlow) add('Calibration', 'warn', `The ${a.ampGlow.corner} corner is ${a.ampGlow.levels.toFixed(0)} levels brighter than the background allows: amp glow or a light leak. Dark frames at the same gain, temperature and exposure remove amp glow.`)
  const bandBad = (amp: number, ratio: number) => amp > 0.4 && ratio > 4
  const rows = bandBad(a.banding.rows, a.banding.rowsRatio), cols = bandBad(a.banding.cols, a.banding.colsRatio)
  if (rows || cols) {
    const dir = rows && cols ? 'Horizontal and vertical' : rows ? 'Horizontal' : 'Vertical'
    add('Calibration', 'warn', `${dir} banding in the background (${Math.max(a.banding.rows, a.banding.cols).toFixed(1)} levels): sensor pattern noise. More darks or bias frames, dithering, or a banding-reduction step help.`)
  }
  // banding and a black-clipped background also correlate the noise along one axis; they're reported on their own
  const st = a.streaks, streakAxis = st ? axis(st.direction) : ''
  if (st && st.strength > 0.2 && c.blackBgPct < 5 && !(rows && streakAxis === 'horizontal') && !(cols && streakAxis === 'vertical')) add('Calibration', 'warn', `The background noise forms streaks (${streakAxis}): walking noise from fixed-pattern noise drifting with the guiding. Dither between subs.`)
  out.push(...specks(a.specksPerMp))
  if (!a.dust.length && !a.ampGlow && !out.some((x) => x.area === 'Calibration')) add('Calibration', 'ok', 'No dust motes, amp glow, banding or walking noise found.')

  for (const w of r.warnings) add('Background', 'info', w)
  return out
}

/** A direction as an axis in the image; y runs down, so angles below 90° run from top left to bottom right. */
const axis = (deg: number) => (deg < 15 || deg > 165 ? 'horizontal' : deg > 75 && deg < 105 ? 'vertical' : deg < 90 ? 'diagonal, top left to bottom right' : 'diagonal, top right to bottom left')

const specks = (perMp: number): Note[] => (perMp > 30 ? [{ area: 'Calibration', tone: 'warn', text: `About ${Math.round(perMp)} hot pixels or coloured specks per megapixel remain. Use darks, dithering and cosmetic correction.` }] : [])

function worst(chan: number[]) {
  const i = chan.indexOf(Math.max(...chan))
  return chan[i] > 2 * Math.min(...chan) + 0.05 ? `, mostly in ${['red', 'green', 'blue'][i]}` : ''
}
