import type { CatObject } from './catalog'
import { F0, OPTICS, SKY_MAG, estimateExposure, withSensor, type Filter } from './exposure'
import { SEEING, compute, type Optics } from './optics'

/** The night a setup is judged against: the site's sky and seeing, how well the mount tracks, and the sub length. */
export interface Conditions {
  seeing: number   // atmospheric FWHM, arcsec
  bortle: number
  moon: number     // 0 (none) .. 1 (full moon up)
  trackingRms: number // mount tracking / guiding error, arcsec RMS
  subSec: number
  filter: Filter
}

export type Sampling = 'under' | 'ok' | 'over'

/** Stand-ins for "how fast does this collect light": a faint galaxy with no filter and an emission nebula through a dual-band filter. */
const REF_GALAXY: CatObject = { id: 'ref:galaxy', m: null, type: 'G', typeName: 'Galaxy', ra: 0, dec: 0, con: '', maj: 10, min: 5, pa: null, mag: null, sb: 22.5, names: [], alt: [] }
const REF_NEBULA: CatObject = { id: 'ref:nebula', m: null, type: 'HII', typeName: 'HII region', ra: 0, dec: 0, con: '', maj: 60, min: 40, pa: null, mag: null, sb: 23.5, names: [], alt: [] }
export const REFS = { galaxy: '22.5 mag/arcsec² galaxy, no filter', nebula: 'typical emission nebula, dual-band' }

/** Star FWHM a setup records: seeing, the optics' diffraction blur and tracking error added in quadrature. */
export const diffractionFwhm = (apertureMm: number) => 116 / apertureMm // 1.03 λ/D at 550 nm, arcsec
export const starFwhm = (seeing: number, apertureMm: number, trackingRms: number) => Math.hypot(seeing, diffractionFwhm(apertureMm), 2.355 * trackingRms)

/** Two to three pixels across a star's FWHM: fewer leaves blocky stars, more spreads the light thin for no extra detail. */
export const samplingOf = (fwhmPx: number): Sampling => (fwhmPx < 2 ? 'under' : fwhmPx > 3.5 ? 'over' : 'ok')

/** Share of a star's light that lands in its brightest pixel (Gaussian star centred on a pixel). */
function peakFraction(fwhmPx: number) {
  const s = fwhmPx / 2.355
  const erf = (x: number) => { const t = 1 / (1 + 0.3275911 * x); return 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x) }
  return erf(1 / (2 * Math.SQRT2 * s)) ** 2
}

export function analyse(optics: Optics, presetId: string | undefined, c: Conditions) {
  const o = withSensor(optics, presetId)
  const r = compute(o, c.seeing)
  const qe = o.qe ?? 0.6, rn = o.readNoise ?? 2
  const bin = o.binning
  const fullWell = o.fullWell ? o.fullWell * bin * bin : undefined // binning CMOS pixels adds them up in software
  const pxW = Math.round((o.sensorWmm * 1000) / (o.pixelUm * bin)), pxH = Math.round((o.sensorHmm * 1000) / (o.pixelUm * bin))

  const fwhm = starFwhm(c.seeing, o.apertureMm, c.trackingRms)
  const fwhmPx = fwhm / r.scale
  const tiers = SEEING.map((s) => ({ ...s, sampling: samplingOf(starFwhm(s.v, o.apertureMm, c.trackingRms) / r.scale) }))
  const advice =
    fwhmPx < 1.5 && o.drizzle === 1 ? 'Undersampled: drizzle 2× to round out the stars (needs dithering).'
    : fwhmPx > 5 && bin === 1 ? 'Well oversampled: bin 2× (or downsample) — same detail, a 4× cleaner pixel.'
    : fwhmPx > 3.5 && bin === 1 ? 'Slightly oversampled: fine on good nights; bin 2× if seeing is usually this soft.'
    : fwhmPx < 2 ? 'A touch undersampled: stars may look blocky up close; drizzle helps if you dither.'
    : 'Matched to the seeing.'

  // light: photons per second from a unit surface brightness, per pixel and per square arcsecond of sky
  const area = Math.PI * (o.apertureMm / 2000) ** 2 // m²
  const perArcsec = area * OPTICS * qe              // relative: same for any focal length
  const perPixel = perArcsec * r.scale ** 2

  const est = (ref: CatObject, f: Filter) => estimateExposure(ref, o, c.bortle, c.subSec, f, c.moon)
  const galaxy = est(REF_GALAXY, 'none'), nebula = est(REF_NEBULA, 'dual')
  const sky = est(REF_GALAXY, c.filter)!.sky // e-/s/px under the chosen filter

  // sub length: long enough for sky noise to bury the read noise (sky ≥ 10·RN² electrons per sub), short enough not to fill the wells
  const minSub = (10 * rn * rn) / sky
  const skyFill = fullWell ? (sky * c.subSec) / fullWell : undefined
  const peak = peakFraction(fwhmPx)
  const starRate = F0 * area * OPTICS * qe // e-/s from a magnitude-0 star
  const satMag = fullWell && sky * c.subSec < fullWell ? -2.5 * Math.log10((fullWell - sky * c.subSec) / (peak * starRate * c.subSec)) : undefined

  const N = r.fNumber
  return {
    optics: o, r, pxW, pxH, mp: (pxW * pxH) / 1e6,
    fwhm, fwhmPx, sampling: samplingOf(fwhmPx), tiers, advice, diffraction: diffractionFwhm(o.apertureMm),
    areaCm2: area * 1e4, perArcsec, perPixel,
    galaxyHours: galaxy?.hours.good, nebulaHours: nebula?.hours.good,
    qe, rn, fullWell, bits: o.bits,
    dynamicRange: fullWell ? Math.log2(fullWell / rn) : undefined,
    sky, minSub, skyFill, satMag,
    skyMag: SKY_MAG[Math.min(9, Math.max(1, Math.round(c.bortle)))],
    cfz: 4.88 * 0.55 * N * N, // critical focus zone, µm
    npf: (35 * N + 30 * o.pixelUm) / r.effectiveFl, // untracked exposure before stars trail (NPF rule), s
    gbPerHour: (pxW * pxH * 2 * (3600 / c.subSec)) / 1e9, // 16-bit FITS
  }
}
export type Analysis = ReturnType<typeof analyse>
