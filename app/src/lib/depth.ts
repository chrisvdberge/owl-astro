import { sessionCrop } from './optics'

const R = Math.PI / 180

/** Every sub-frame is the same fovW × fovH rectangle turned about the frame centre; angles are position angles in degrees. */
export function makeDepth(fovW: number, fovH: number, angles: number[]) {
  const cs = angles.map((a) => [Math.cos(a * R), Math.sin(a * R)] as const)
  /** Share (0..1) of the session's frames that cover the sky point (xi east, eta north, degrees from the centre). */
  return (xi: number, eta: number) => {
    let n = 0
    for (const [c, s] of cs) if (Math.abs(xi * c - eta * s) <= fovW / 2 + 1e-9 && Math.abs(xi * s + eta * c) <= fovH / 2 + 1e-9) n++
    return n / cs.length
  }
}

/** Depth over the area the frames sweep: a nx × ny grid (north up, east to the left), plus the half-extent in degrees. */
export function depthGrid(fovW: number, fovH: number, angles: number[], nx = 120) {
  const thin = angles.length > 72 ? angles.filter((_, i) => i % Math.ceil(angles.length / 72) === 0) : angles
  const depth = makeDepth(fovW, fovH, thin)
  let hw = fovW / 2, hh = fovH / 2
  for (const a of thin) {
    const c = Math.abs(Math.cos(a * R)), s = Math.abs(Math.sin(a * R))
    hw = Math.max(hw, (fovW / 2) * c + (fovH / 2) * s)
    hh = Math.max(hh, (fovW / 2) * s + (fovH / 2) * c)
  }
  const ny = Math.max(2, Math.round((nx * hh) / hw))
  const grid = new Float32Array(nx * ny)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const xi = -(((i + 0.5) / nx) * 2 - 1) * hw // east is to the left
      const eta = (1 - ((j + 0.5) / ny) * 2) * hh
      grid[j * nx + i] = depth(xi, eta)
    }
  const cell = ((2 * hw) / nx) * ((2 * hh) / ny)
  return { grid, nx, ny, hw, hh, cell }
}

/** Share of one frame's area that gets at least `min` of the session's depth. */
export function areaAtDepth(g: ReturnType<typeof depthGrid>, fovW: number, fovH: number, min: number): number {
  let n = 0
  for (const v of g.grid) if (v >= min - 1e-6) n++
  return Math.min(1, (n * g.cell) / (fovW * fovH))
}

/**
 * Largest centred rectangle of the sensor's aspect ratio (at the orientation `sessionCrop` picks) in which every point
 * has at least `minDepth` of the session's frames. At 1 it is exactly sessionCrop; lower values trade depth for area.
 * (Depth only falls with distance from the centre, so checking the rectangle's outline is enough.)
 */
export function cropAtDepth(fovW: number, fovH: number, angles: number[], minDepth: number) {
  const base = sessionCrop(fovW, fovH, angles)
  if (!base || minDepth >= 0.999) return base
  const depth = makeDepth(fovW, fovH, angles)
  const th = base.ref * R, c = Math.cos(th), s = Math.sin(th)
  const fits = (k: number) => {
    const hw = (k * fovW) / 2, hh = (k * fovH) / 2
    for (let i = 0; i <= 48; i++) {
      const t = i / 48
      for (const [u, v] of [[-hw + 2 * hw * t, -hh], [-hw + 2 * hw * t, hh], [-hw, -hh + 2 * hh * t], [hw, -hh + 2 * hh * t]] as const) {
        if (depth(u * c + v * s, -u * s + v * c) < minDepth - 1e-9) return false
      }
    }
    return true
  }
  let lo = base.scale, hi = 1.5
  for (let i = 0; i < 28; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid }
  return { ...base, scale: lo, w: fovW * lo, h: fovH * lo }
}
