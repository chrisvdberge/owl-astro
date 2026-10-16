export interface Optics {
  apertureMm: number
  focalLengthMm: number
  sensorWmm: number
  sensorHmm: number
  pixelUm: number
  binning: number
  drizzle: number
  reducer: number // focal multiplier, e.g. 0.63
  /** rough sensor characteristics for exposure estimates: average quantum efficiency over the visible band (0..1) and read noise (e-) */
  qe?: number
  readNoise?: number
  /** full well capacity (e-) and ADC bit depth, for dynamic range, star saturation and file sizes */
  fullWell?: number
  bits?: number
}

export interface Preset { id: string; label: string; optics: Optics }

export const PRESETS: Preset[] = [
  {
    id: 'seestar-s50-pro',
    label: 'Seestar S50 Pro',
    // 3840x2160 @ 2.9 µm, 260 mm f/5.2
    optics: { apertureMm: 50, focalLengthMm: 260, sensorWmm: 11.136, sensorHmm: 6.264, pixelUm: 2.9, binning: 1, drizzle: 1, reducer: 1, qe: 0.7, readNoise: 1.2, fullWell: 40000, bits: 12 },
  },
  {
    id: 'seestar-s50',
    label: 'Seestar S50',
    // Sony IMX462 1920x1080 @ 2.9 µm (5.568 x 3.132 mm), 250 mm f/5, 50 mm aperture
    optics: { apertureMm: 50, focalLengthMm: 250, sensorWmm: 5.568, sensorHmm: 3.132, pixelUm: 2.9, binning: 1, drizzle: 1, reducer: 1, qe: 0.6, readNoise: 1.5, fullWell: 12000, bits: 12 },
  },
  {
    id: 'seestar-s30-pro',
    label: 'Seestar S30 Pro',
    // Sony IMX585 3840x2160 @ 2.9 µm (11.136 x 6.264 mm), 160 mm f/5.3, 30 mm aperture
    optics: { apertureMm: 30, focalLengthMm: 160, sensorWmm: 11.136, sensorHmm: 6.264, pixelUm: 2.9, binning: 1, drizzle: 1, reducer: 1, qe: 0.7, readNoise: 1.2, fullWell: 40000, bits: 12 },
  },
  {
    id: 'dwarf-mini',
    label: 'Dwarf Mini (telephoto)',
    // Sony IMX662 1920x1080 @ 2.9 µm (5.568 x 3.132 mm), 150 mm f/5, 30 mm aperture
    optics: { apertureMm: 30, focalLengthMm: 150, sensorWmm: 5.568, sensorHmm: 3.132, pixelUm: 2.9, binning: 1, drizzle: 1, reducer: 1, qe: 0.65, readNoise: 1.0, fullWell: 38000, bits: 12 },
  },
  {
    id: 'dwarf-3',
    label: 'Dwarf 3 (telephoto)',
    // Sony IMX678 3840x2160 @ 2 µm (7.68 x 4.32 mm), 150 mm f/4.3, 35 mm aperture
    optics: { apertureMm: 35, focalLengthMm: 150, sensorWmm: 7.68, sensorHmm: 4.32, pixelUm: 2, binning: 1, drizzle: 1, reducer: 1, qe: 0.7, readNoise: 1.0, fullWell: 11000, bits: 12 },
  },
  {
    id: 'custom',
    label: 'Custom',
    optics: { apertureMm: 100, focalLengthMm: 550, sensorWmm: 23.5, sensorHmm: 15.7, pixelUm: 3.76, binning: 1, drizzle: 1, reducer: 1 },
  },
]

/** Bare cameras: choosing one fills in the sensor of the current optics (focal length and aperture come from your lens or scope). */
export interface Camera { id: string; label: string; sensorWmm: number; sensorHmm: number; pixelUm: number; qe: number; readNoise: number; fullWell: number; bits: number }
export const CAMERAS: Camera[] = [
  { id: 'zwo-asi533mc', label: 'ZWO ASI533MC Pro (1″, 3008²)', sensorWmm: 11.31, sensorHmm: 11.31, pixelUm: 3.76, qe: 0.8, readNoise: 1.5, fullWell: 50000, bits: 14 },
  // generic entry for any camera built around the Sony IMX585 (Player One Uranus-C, SVBony SV705C, QHY5III585, ToupTek, …);
  // the exact sensor size keeps it apart from the ZWO entry when looking a camera up by its figures
  { id: 'sensor-imx585', label: 'Sony IMX585 sensor (any camera, 1/1.2″, 3840×2160)', sensorWmm: 11.136, sensorHmm: 6.264, pixelUm: 2.9, qe: 0.7, readNoise: 1.2, fullWell: 40000, bits: 12 },
  { id: 'zwo-asi585mc', label: 'ZWO ASI585MC (1/1.2″, 3840×2160)', sensorWmm: 11.14, sensorHmm: 6.26, pixelUm: 2.9, qe: 0.7, readNoise: 1.2, fullWell: 40000, bits: 12 },
  { id: 'zwo-asi294mc', label: 'ZWO ASI294MC Pro (4/3″)', sensorWmm: 19.1, sensorHmm: 13, pixelUm: 4.63, qe: 0.75, readNoise: 1.6, fullWell: 63700, bits: 14 },
  { id: 'zwo-asi2600', label: 'ZWO ASI2600MC/MM Pro (APS-C)', sensorWmm: 23.5, sensorHmm: 15.7, pixelUm: 3.76, qe: 0.8, readNoise: 2.0, fullWell: 50000, bits: 16 },
  { id: 'zwo-asi183', label: 'ZWO ASI183MC/MM Pro (1″)', sensorWmm: 13.2, sensorHmm: 8.8, pixelUm: 2.4, qe: 0.75, readNoise: 2.0, fullWell: 15000, bits: 12 },
  { id: 'canon-aps-c', label: 'Canon APS-C DSLR (600D/700D/…)', sensorWmm: 22.3, sensorHmm: 14.9, pixelUm: 4.3, qe: 0.4, readNoise: 6, fullWell: 26000, bits: 14 },
  { id: 'canon-6d', label: 'Canon EOS 6D (full frame)', sensorWmm: 35.8, sensorHmm: 23.9, pixelUm: 6.54, qe: 0.45, readNoise: 4.5, fullWell: 77000, bits: 14 },
  { id: 'sony-a7iii', label: 'Sony A7 III (full frame)', sensorWmm: 35.6, sensorHmm: 23.8, pixelUm: 5.9, qe: 0.55, readNoise: 3.5, fullWell: 50000, bits: 14 },
  { id: 'nikon-d7000', label: 'Nikon D7000 (APS-C)', sensorWmm: 23.6, sensorHmm: 15.6, pixelUm: 4.78, qe: 0.45, readNoise: 4, fullWell: 49000, bits: 14 }, // 4928 x 3264
  { id: 'nikon-d600', label: 'Nikon D600 (full frame)', sensorWmm: 35.9, sensorHmm: 24, pixelUm: 5.95, qe: 0.45, readNoise: 5, fullWell: 76000, bits: 14 }, // 6016 x 4016
  { id: 'zwo-asi678mc', label: 'ZWO ASI678MC (1/1.8″, 3840×2160)', sensorWmm: 7.68, sensorHmm: 4.32, pixelUm: 2, qe: 0.75, readNoise: 1.0, fullWell: 11000, bits: 12 },
  { id: 'zwo-asi071mc', label: 'ZWO ASI071MC Pro (APS-C)', sensorWmm: 23.6, sensorHmm: 15.6, pixelUm: 4.78, qe: 0.5, readNoise: 2.3, fullWell: 46000, bits: 14 },
  { id: 'zwo-asi6200', label: 'ZWO ASI6200MC/MM Pro (full frame)', sensorWmm: 36, sensorHmm: 24, pixelUm: 3.76, qe: 0.8, readNoise: 1.5, fullWell: 51000, bits: 16 },
]

/** The catalogue scope or lens with this aperture and focal length. */
export const findScope = (o: Pick<Optics, 'apertureMm' | 'focalLengthMm'>) => SCOPES.find((t) => Math.abs(t.apertureMm - o.apertureMm) < 1e-6 && Math.abs(t.focalLengthMm - o.focalLengthMm) < 1e-6)

/** The catalogue camera behind a sensor's figures. Some cameras share a sensor size and pixel, so QE and read noise break the tie. */
export function findCamera(o: Pick<Optics, 'sensorWmm' | 'sensorHmm' | 'pixelUm' | 'qe' | 'readNoise'>): Camera | undefined {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6
  const same = CAMERAS.filter((c) => near(c.sensorWmm, o.sensorWmm) && near(c.sensorHmm, o.sensorHmm) && near(c.pixelUm, o.pixelUm))
  return same.find((c) => c.qe === o.qe && c.readNoise === o.readNoise) ?? same[0]
}

/**
 * Common imaging scopes and lenses: choosing one fills in aperture and focal length (nominal, no reducer).
 * `circle` is the approximate well-corrected image circle (mm) with the usual flattener / corrector (`needs`), for judging
 * whether a sensor is covered without dark or deformed corners.
 */
export interface Scope { id: string; label: string; apertureMm: number; focalLengthMm: number; circle?: number; needs?: string }
export const SCOPES: Scope[] = [
  { id: 'newton-200', label: 'Newton 200/1000 (f/5)', apertureMm: 200, focalLengthMm: 1000, circle: 44, needs: 'coma corrector' },
  { id: 'ts-quad-80', label: 'TS-Optics Quadruplet 80/480 (f/6)', apertureMm: 80, focalLengthMm: 480, circle: 44 },
  { id: 'wo-redcat51', label: 'William Optics RedCat 51 (250 mm f/4.9)', apertureMm: 51, focalLengthMm: 250, circle: 44 },
  { id: 'askar-fra400', label: 'Askar FRA400 (400 mm f/5.6)', apertureMm: 72, focalLengthMm: 400, circle: 44 },
  { id: 'sw-evostar72ed', label: 'Sky-Watcher Evostar 72ED (420 mm f/5.8)', apertureMm: 72, focalLengthMm: 420, circle: 28, needs: 'flattener' },
  { id: 'sw-evostar80ed', label: 'Sky-Watcher Evostar 80ED (600 mm f/7.5)', apertureMm: 80, focalLengthMm: 600, circle: 28, needs: 'flattener' },
  { id: 'sw-esprit100ed', label: 'Sky-Watcher Esprit 100ED (550 mm f/5.5)', apertureMm: 100, focalLengthMm: 550, circle: 44, needs: 'flattener' },
  { id: 'apm-107-700', label: 'APM 107/700 APO (f/6.5)', apertureMm: 107, focalLengthMm: 700, circle: 44, needs: 'flattener' },
  { id: 'tak-fsq106', label: 'Takahashi FSQ-106EDX4 (530 mm f/5)', apertureMm: 106, focalLengthMm: 530, circle: 88 },
  { id: 'sw-130pds', label: 'Sky-Watcher 130PDS (650 mm f/5)', apertureMm: 130, focalLengthMm: 650, circle: 30, needs: 'coma corrector' },
  { id: 'celestron-rasa8', label: 'Celestron RASA 8 (400 mm f/2)', apertureMm: 203, focalLengthMm: 400, circle: 22 },
  { id: 'celestron-edge8', label: 'Celestron EdgeHD 8 (2032 mm f/10)', apertureMm: 203, focalLengthMm: 2032, circle: 42 },
  { id: 'lens-24', label: 'Lens 24 mm f/1.4', apertureMm: 17.1, focalLengthMm: 24, circle: 43.3, needs: 'stopping down a stop or two' },
  { id: 'lens-135', label: 'Lens 135 mm f/2', apertureMm: 67.5, focalLengthMm: 135, circle: 43.3 },
  { id: 'lens-200', label: 'Lens 200 mm f/2.8', apertureMm: 71.4, focalLengthMm: 200, circle: 43.3 },
]

const RAD = 180 / Math.PI

/** Seeing (star FWHM from the atmosphere, arcsec) in the steps a site's typical night is described with. */
export const SEEING = [
  { v: 1.5, l: '1.5″ — Excellent (rare)', short: 'Excellent' }, { v: 2, l: '2″ — Good', short: 'Good' }, { v: 3, l: '3″ — Average', short: 'Average' },
  { v: 4, l: '4″ — Below average', short: 'Below avg' }, { v: 5, l: '5″ — Poor', short: 'Poor' },
]

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
