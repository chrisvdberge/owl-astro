import { deproject, project } from './platesolve'

/**
 * Geometry of solved frames for the mosaic check: all outlines in one tangent plane (degrees, xi east, eta north),
 * their overlaps and the sky they cover together. Areas are in the tangent plane: square degrees to within a few
 * percent for mosaics up to some 20° across.
 */
export type P = [number, number]

export interface Layout { ra0: number; dec0: number; polys: P[][]; halfW: number; halfH: number }

const unit = (ra: number, dec: number) => { const a = (ra * Math.PI) / 180, d = (dec * Math.PI) / 180; return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)] }

/** One tangent plane for all outlines, centred on the box around them (so a survey cutout centred there lines up). */
export function layout(outlines: P[][]): Layout {
  const v = [0, 0, 0]
  for (const o of outlines) for (const [ra, dec] of o) unit(ra, dec).forEach((c, i) => (v[i] += c))
  let ra0 = ((Math.atan2(v[1], v[0]) * 180) / Math.PI + 360) % 360, dec0 = (Math.atan2(v[2], Math.hypot(v[0], v[1])) * 180) / Math.PI
  let polys: P[][] = []
  for (let pass = 0; pass < 2; pass++) {
    polys = outlines.map((o) => o.map(([ra, dec]) => project(ra0, dec0, ra, dec)))
    const b = box(polys)
    ;[ra0, dec0] = deproject(ra0, dec0, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
  }
  polys = outlines.map((o) => ccw(o.map(([ra, dec]) => project(ra0, dec0, ra, dec))))
  const b = box(polys)
  return { ra0, dec0, polys, halfW: Math.max(-b[0], b[2]), halfH: Math.max(-b[1], b[3]) }
}

function box(polys: P[][]): [number, number, number, number] {
  const xs = polys.flat().map((p) => p[0]), ys = polys.flat().map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

export const area = (p: P[]) => Math.abs(signed(p))
const signed = (p: P[]) => p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]; return a + q[0] * r[1] - r[0] * q[1] }, 0) / 2
const ccw = (p: P[]) => (signed(p) < 0 ? [...p].reverse() : p)

/** Intersection of two (near-)convex polygons, both counter-clockwise (Sutherland–Hodgman). */
export function clip(subject: P[], by: P[]): P[] {
  let out = subject
  for (let i = 0; i < by.length && out.length; i++) {
    const a = by[i], b = by[(i + 1) % by.length]
    const inside = (p: P) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0
    const cut = (p: P, q: P): P => {
      const dx = q[0] - p[0], dy = q[1] - p[1], ex = b[0] - a[0], ey = b[1] - a[1]
      const t = (ex * (p[1] - a[1]) - ey * (p[0] - a[0])) / (ey * dx - ex * dy)
      return [p[0] + t * dx, p[1] + t * dy]
    }
    const inp = out
    out = []
    inp.forEach((p, k) => {
      const q = inp[(k + 1) % inp.length]
      if (inside(q)) { if (!inside(p)) out.push(cut(p, q)); out.push(q) } else if (inside(p)) out.push(cut(p, q))
    })
  }
  return out
}

export function inside(p: P, poly: P[]): boolean {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

export interface Overlap { a: number; b: number; poly: P[]; area: number; ofA: number; ofB: number; ofSmaller: number }

export function overlaps(polys: P[][]): Overlap[] {
  const out: Overlap[] = []
  for (let a = 0; a < polys.length; a++) for (let b = a + 1; b < polys.length; b++) {
    const poly = clip(polys[a], polys[b]), ar = poly.length >= 3 ? area(poly) : 0
    if (ar <= 0) continue
    const aa = area(polys[a]), ab = area(polys[b])
    out.push({ a, b, poly, area: ar, ofA: ar / aa, ofB: ar / ab, ofSmaller: ar / Math.min(aa, ab) })
  }
  return out
}

/** Sky covered by at least one frame (sampled on a fine grid). */
export function unionArea(polys: P[][], n = 360): number {
  if (!polys.length) return 0
  const [x0, y0, x1, y1] = box(polys), dx = (x1 - x0) / n, ny = Math.max(1, Math.ceil((y1 - y0) / dx))
  let hit = 0
  for (let j = 0; j < ny; j++) for (let i = 0; i < n; i++) {
    const p: P = [x0 + (i + 0.5) * dx, y0 + (j + 0.5) * dx]
    if (polys.some((q) => inside(p, q))) hit++
  }
  return hit * dx * dx
}

/** Groups of frames joined by overlaps of at least `min` (fraction of the smaller frame). */
export function groups(n: number, ov: Overlap[], min = 0.02): number[][] {
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (const o of ov) if (o.ofSmaller >= min) parent[find(o.a)] = find(o.b)
  const m = new Map<number, number[]>()
  for (let i = 0; i < n; i++) { const r = find(i); m.set(r, [...(m.get(r) ?? []), i]) }
  return [...m.values()]
}

/** Smallest difference between two position angles of a rectangle (a frame turned 180° looks the same). */
export const paDiff = (a: number, b: number) => { const d = Math.abs(((a - b) % 180 + 180) % 180); return Math.min(d, 180 - d) }
