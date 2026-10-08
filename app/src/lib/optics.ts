export interface Optics {
  apertureMm: number
  focalLengthMm: number
  sensorWmm: number
  sensorHmm: number
  pixelUm: number
  binning: number
  drizzle: number
  reducer: number // focal multiplier, e.g. 0.63
}

export interface Preset { id: string; label: string; optics: Optics }

export const PRESETS: Preset[] = [
  {
    id: 'seestar-s50-pro',
    label: 'Seestar S50 Pro',
    // 3840x2160 @ 2.9 µm, 260 mm f/5.2
    optics: { apertureMm: 50, focalLengthMm: 260, sensorWmm: 11.136, sensorHmm: 6.264, pixelUm: 2.9, binning: 1, drizzle: 1, reducer: 1 },
  },
  {
    id: 'seestar-s50',
    label: 'Seestar S50',
    // Sony IMX462 1920x1080 @ 2.9 µm (5.568 x 3.132 mm), 250 mm f/5, 50 mm aperture
    optics: { apertureMm: 50, focalLengthMm: 250, sensorWmm: 5.568, sensorHmm: 3.132, pixelUm: 2.9, binning: 1, drizzle: 1, reducer: 1 },
  },
  {
    id: 'seestar-s30-pro',
    label: 'Seestar S30 Pro',
    // Sony IMX585 3840x2160 @ 2.9 µm (11.136 x 6.264 mm), 160 mm f/5.3, 30 mm aperture
    optics: { apertureMm: 30, focalLengthMm: 160, sensorWmm: 11.136, sensorHmm: 6.264, pixelUm: 2.9, binning: 1, drizzle: 1, reducer: 1 },
  },
  {
    id: 'dwarf-mini',
    label: 'Dwarf Mini (telephoto)',
    // Sony IMX662 1920x1080 @ 2.9 µm (5.568 x 3.132 mm), 150 mm f/5, 30 mm aperture
    optics: { apertureMm: 30, focalLengthMm: 150, sensorWmm: 5.568, sensorHmm: 3.132, pixelUm: 2.9, binning: 1, drizzle: 1, reducer: 1 },
  },
  {
    id: 'custom',
    label: 'Custom',
    optics: { apertureMm: 100, focalLengthMm: 550, sensorWmm: 23.5, sensorHmm: 15.7, pixelUm: 3.76, binning: 1, drizzle: 1, reducer: 1 },
  },
]

/** Bare cameras: choosing one fills in the sensor of the current optics (focal length and aperture come from your lens or scope). */
export interface Camera { id: string; label: string; sensorWmm: number; sensorHmm: number; pixelUm: number }
export const CAMERAS: Camera[] = [
  { id: 'nikon-d600', label: 'Nikon D600 (full frame)', sensorWmm: 35.9, sensorHmm: 24, pixelUm: 5.95 }, // 6016 x 4016
]

const RAD = 180 / Math.PI

export function compute(o: Optics, seeingArcsec: number) {
  const fl = o.focalLengthMm * o.reducer
  const fovW = 2 * Math.atan(o.sensorWmm / (2 * fl)) * RAD
  const fovH = 2 * Math.atan(o.sensorHmm / (2 * fl)) * RAD
  const scale = (206.265 * o.pixelUm * o.binning) / fl
  const idealMin = seeingArcsec / 3
  const idealMax = seeingArcsec / 2
  const sampling: 'under' | 'ok' | 'over' = scale > idealMax ? 'under' : scale < idealMin ? 'over' : 'ok'
  return {
    effectiveFl: fl,
    fNumber: fl / o.apertureMm,
    fovW, fovH,
    scale,
    drizzledScale: scale / o.drizzle,
    sampling, idealMin, idealMax,
    dawes: 116 / o.apertureMm,
  }
}

/** Sky position (deg) of a tangent-plane offset (x east, y north, in degrees) from (ra0, dec0), rotated by pa (deg east of north). */
export function offsetPoint(ra0: number, dec0: number, x: number, y: number, pa: number): [number, number] {
  const d2r = Math.PI / 180
  const th = pa * d2r
  const xi = (x * Math.cos(th) + y * Math.sin(th)) * d2r
  const eta = (-x * Math.sin(th) + y * Math.cos(th)) * d2r
  const a0 = ra0 * d2r, d0 = dec0 * d2r
  const rho = Math.hypot(xi, eta)
  if (rho === 0) return [ra0, dec0]
  const c = Math.atan(rho)
  const dec = Math.asin(Math.cos(c) * Math.sin(d0) + (eta * Math.sin(c) * Math.cos(d0)) / rho)
  const ra = a0 + Math.atan2(xi * Math.sin(c), rho * Math.cos(d0) * Math.cos(c) - eta * Math.sin(d0) * Math.sin(c))
  return [(((ra / d2r) % 360) + 360) % 360, dec / d2r]
}

/** Corners (deg) of a fovW x fovH rectangle centred on (ra0, dec0), rotated by pa. */
export function rectCorners(ra0: number, dec0: number, fovW: number, fovH: number, pa: number): [number, number][] {
  const hw = fovW / 2, hh = fovH / 2
  return ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as const).map(([x, y]) => offsetPoint(ra0, dec0, x, y, pa))
}

/** Panel rectangles of a cols x rows mosaic centred on (ra0, dec0); panels overlap by `overlap` of the frame. */
export function mosaicPanels(ra0: number, dec0: number, fovW: number, fovH: number, pa: number, cols: number, rows: number, overlap = 0.2) {
  const out: [number, number][][] = []
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const [cra, cdec] = offsetPoint(ra0, dec0, (i - (cols - 1) / 2) * fovW * (1 - overlap), (j - (rows - 1) / 2) * fovH * (1 - overlap), pa)
      out.push(rectCorners(cra, cdec, fovW, fovH, pa))
    }
  return out
}

export type Fit = { kind: 'small' | 'fits' | 'mosaic'; cols: number; rows: number; ratio: number }

/** Compare object size (arcmin) to the FOV (deg). Mosaic panels assume 20% overlap. */
export function framingFit(majArcmin: number | null, minArcmin: number | null, fovW: number, fovH: number): Fit | null {
  if (!majArcmin) return null
  const maj = majArcmin / 60
  const min = (minArcmin ?? majArcmin) / 60
  const ratio = maj / Math.max(fovW, fovH)
  if (maj <= fovW * 0.9 && min <= fovH * 0.9) {
    return { kind: ratio < 0.1 ? 'small' : 'fits', cols: 1, rows: 1, ratio }
  }
  const cols = Math.max(1, Math.ceil((maj - fovW * 0.2) / (fovW * 0.8)))
  const rows = Math.max(1, Math.ceil((min - fovH * 0.2) / (fovH * 0.8)))
  return { kind: cols * rows > 1 ? 'mosaic' : 'fits', cols, rows, ratio }
}

/**
 * What an alt-az session leaves you with. Every sub-frame is the same rectangle turned about the frame centre by that
 * moment's field angle; the stack is only complete where all of them overlap. Returns the largest centred rectangle of
 * the sensor's aspect ratio, oriented at the middle of the angle range, that fits inside every frame.
 * Angles are position angles in degrees; a rectangle repeats every 180 degrees, so they are unwrapped modulo 180.
 */
export function sessionCrop(fovW: number, fovH: number, angles: number[]) {
  if (!angles.length) return null
  const un: number[] = []
  for (const a of angles) {
    let v = a
    if (un.length) { const p = un[un.length - 1]; while (v - p > 90) v -= 180; while (v - p < -90) v += 180 }
    un.push(v)
  }
  const lo = Math.min(...un), hi = Math.max(...un)
  const ref = (lo + hi) / 2
  const r = Math.PI / 180
  let scale = 1
  for (const a of un) {
    const c = Math.abs(Math.cos((a - ref) * r)), s = Math.abs(Math.sin((a - ref) * r))
    scale = Math.min(scale, fovW / (fovW * c + fovH * s), fovH / (fovW * s + fovH * c))
  }
  return { ref, spread: hi - lo, scale, w: fovW * scale, h: fovH * scale }
}
