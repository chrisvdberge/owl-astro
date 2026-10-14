import type { CatObject } from './catalog'
import { F0, OPTICS, SKY_MAG, estimateExposure, withSensor, type Filter } from './exposure'
import { PRESETS, SEEING, compute, findScope, type Optics } from './optics'

/** The night a setup is judged against: the site's sky and seeing, the target's declination and the sub length. */
export interface Conditions {
  seeing: number   // atmospheric FWHM, arcsec
  bortle: number
  moon: number     // 0 (none) .. 1 (full moon up)
  lat: number      // site latitude, for alt-az field rotation
  dec: number      // target declination, for untracked drift
  subSec: number
  filter: Filter
}

/**
 * Mount classes with rough unguided behaviour: periodic error (peak to peak, arcsec) over its worm / gear period (s),
 * the polar-alignment error a typical user ends up with (arcsec), the residual error when guided, and the jitter left
 * over even when tracking is perfect (wind, gears, focus shifts). Typical figures, not a specific unit's test report.
 */
export interface Mount { id: string; label: string; pe: number; period: number; polar: number; guidedRms?: number; baseRms: number; altaz?: boolean; fixed?: boolean }
export const MOUNTS: Mount[] = [
  { id: 'smart-altaz', label: 'Smart scope, alt-az', pe: 10, period: 600, polar: 0, baseRms: 0.8, altaz: true },
  { id: 'smart-eq', label: 'Smart scope on a wedge (EQ)', pe: 20, period: 600, polar: 600, baseRms: 0.8 },
  { id: 'tripod', label: 'Fixed tripod (no tracking)', pe: 0, period: 1, polar: 0, baseRms: 0.5, fixed: true },
  { id: 'tracker', label: 'Star tracker (Star Adventurer, MSM…)', pe: 60, period: 480, polar: 900, guidedRms: 1.5, baseRms: 0.8 },
  { id: 'eq-entry', label: 'Entry EQ (EQ5, EQM-35, HEQ5)', pe: 35, period: 640, polar: 300, guidedRms: 0.9, baseRms: 0.6 },
  { id: 'eq-mid', label: 'Mid EQ (EQ6-R, CEM40, GEM45)', pe: 20, period: 480, polar: 300, guidedRms: 0.6, baseRms: 0.5 },
  { id: 'strain', label: 'Strain wave (ZWO AM3/AM5, Rainbow)', pe: 40, period: 288, polar: 300, guidedRms: 0.5, baseRms: 0.5 },
  { id: 'encoder', label: 'With encoders (AM5N, 10Micron, …)', pe: 1, period: 600, polar: 120, guidedRms: 0.3, baseRms: 0.3 },
]
export const defaultMount = (presetId?: string) => (PRESETS.some((p) => p.id === presetId && p.id !== 'custom') ? 'smart-altaz' : 'eq-mid')

export type Sampling = 'under' | 'ok' | 'over'
export type Tone = 'ok' | 'warn' | 'bad'

/** Stand-ins for "how fast does this collect light": a faint galaxy with no filter and an emission nebula through a dual-band filter. */
const REF_GALAXY: CatObject = { id: 'ref:galaxy', m: null, type: 'G', typeName: 'Galaxy', ra: 0, dec: 0, con: '', maj: 10, min: 5, pa: null, mag: null, sb: 22.5, names: [], alt: [] }
const REF_NEBULA: CatObject = { id: 'ref:nebula', m: null, type: 'HII', typeName: 'HII region', ra: 0, dec: 0, con: '', maj: 60, min: 40, pa: null, mag: null, sb: 23.5, names: [], alt: [] }
export const REFS = { galaxy: '22.5 mag/arcsec² galaxy, no filter', nebula: 'typical emission nebula, dual-band' }

const SIDEREAL = 7.292e-5 // rad/s
const MAX_SUB = 600       // beyond ten minutes the mount stops being the limit: satellites, clouds and clipped stars are
const SWAMP = 10          // a sub is long enough once the sky gives 10 × RN² electrons: read noise then adds ~10% time

/** Star FWHM a setup records: seeing, the optics' diffraction blur and tracking error added in quadrature. */
export const diffractionFwhm = (apertureMm: number) => 116 / apertureMm // 1.03 λ/D at 550 nm, arcsec
export const starFwhm = (seeing: number, apertureMm: number, trackingRms: number) => Math.hypot(seeing, diffractionFwhm(apertureMm), 2.355 * trackingRms)

/** Two to three and a half pixels across a star's FWHM: fewer leaves blocky stars, more spreads the light thin for no extra detail. */
export const samplingOf = (fwhmPx: number): Sampling => (fwhmPx < 2 ? 'under' : fwhmPx > 3.5 ? 'over' : 'ok')

/** Share of a star's light that lands in its brightest pixel (Gaussian star centred on a pixel). */
function peakFraction(fwhmPx: number) {
  const s = fwhmPx / 2.355
  const erf = (x: number) => { const t = 1 / (1 + 0.3275911 * x); return 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x) }
  return erf(1 / (2 * Math.SQRT2 * s)) ** 2
}

/** Whether the scope's corrected image circle covers the sensor diagonal. */
function coverage(optics: Optics, presetId: string | undefined, fl: number) {
  const diag = Math.hypot(optics.sensorWmm, optics.sensorHmm)
  if (PRESETS.some((p) => p.id === presetId && p.id !== 'custom')) return { diag, tone: 'ok' as Tone, text: 'Built for its sensor' }
  const scope = findScope(optics)
  if (!scope?.circle) return { diag, tone: undefined, text: `Unknown scope (sensor diagonal ${diag.toFixed(1)} mm)` }
  // a reducer squeezes the image circle with the focal length (as far as the reducer's own design allows)
  const circle = scope.circle * Math.min(1, optics.reducer)
  const r = diag / circle
  const needs = scope.needs ? ` · needs a ${scope.needs}` : ''
  const fieldDeg = 2 * Math.atan(circle / 2 / fl) * (180 / Math.PI)
  if (r <= 0.85) return { diag, circle, fieldDeg, r, tone: 'ok' as Tone, text: `Covered: ${diag.toFixed(0)} of ${circle.toFixed(0)} mm${needs}` }
  if (r <= 1) return { diag, circle, fieldDeg, r, tone: 'warn' as Tone, text: `Just covered (${diag.toFixed(0)} of ${circle.toFixed(0)} mm): expect vignetting, take flats${needs}` }
  return { diag, circle, fieldDeg, r, tone: 'bad' as Tone, text: `Sensor exceeds the ${circle.toFixed(0)} mm circle: dark, stretched stars in the corners — crop ~${Math.round((1 - 1 / r) * 100)}%${needs}` }
}

export function analyse(optics: Optics, presetId: string | undefined, c: Conditions, mountId: string, guided: boolean) {
  const o = withSensor(optics, presetId)
  const r = compute(o, c.seeing)
  const qe = o.qe ?? 0.6, rn = o.readNoise ?? 2
  const bin = o.binning
  const fullWell = o.fullWell ? o.fullWell * bin * bin : undefined // binning CMOS pixels adds them up in software
  const pxW = Math.round((o.sensorWmm * 1000) / (o.pixelUm * bin)), pxH = Math.round((o.sensorHmm * 1000) / (o.pixelUm * bin))

  // light: photons per second from a unit surface brightness, per pixel and per square arcsecond of sky
  const area = Math.PI * (o.apertureMm / 2000) ** 2 // m²
  const perArcsec = area * OPTICS * qe              // relative: same for any focal length
  const perPixel = perArcsec * r.scale ** 2

  const est = (ref: CatObject, f: Filter) => estimateExposure(ref, o, c.bortle, c.subSec, f, c.moon)
  const galaxy = est(REF_GALAXY, 'none'), nebula = est(REF_NEBULA, 'dual')
  const sky = est(REF_GALAXY, c.filter)!.sky // e-/s/px under the chosen filter
  const skyMag = SKY_MAG[Math.min(9, Math.max(1, Math.round(c.bortle)))]

  // read noise against light pollution: the extra integration time read noise costs, and the sub that makes it negligible
  const rnCost = (t: number, skyRate = sky) => (rn * rn) / (skyRate * t)
  const minSub = (SWAMP * rn * rn) / sky
  const byBortle = [1, 3, 5, 7, 9].map((b) => {
    const s = sky * 10 ** (-0.4 * (SKY_MAG[b] - skyMag))
    return { b, minSub: (SWAMP * rn * rn) / s, cost: rnCost(c.subSec, s) }
  })

  // mount: how long a sub can be before stars stretch past ~1.15:1 — a smear of 0.8 × the star's width (or a pixel when undersampled)
  const mount = MOUNTS.find((m) => m.id === mountId) ?? MOUNTS[0]
  const canGuide = mount.guidedRms != null
  const isGuided = guided && canGuide
  const sharp = Math.hypot(c.seeing, diffractionFwhm(o.apertureMm))
  const tolerance = Math.max(r.scale, 0.8 * sharp)
  const dec = Math.cos((Math.min(89, Math.abs(c.dec)) * Math.PI) / 180)
  let drift: number // arcsec/s at the frame centre
  let unguidedMax: number
  let rotationMax: number | undefined
  if (mount.fixed) {
    drift = 15.04 * dec
    unguidedMax = (35 * r.fNumber + 30 * o.pixelUm) / r.effectiveFl // NPF rule: untracked stars stay round on screen
  } else {
    drift = (2 * mount.pe) / mount.period + mount.polar * SIDEREAL // average slope of the periodic error, plus polar drift
    unguidedMax = tolerance / drift
    if (mount.altaz) {
      // field rotation turns the frame about its centre; corners move fastest. Taken on the meridian at 50° altitude
      const w = SIDEREAL * Math.cos((c.lat * Math.PI) / 180) / Math.cos((50 * Math.PI) / 180)
      const corner = (Math.hypot(r.fovW, r.fovH) / 2) * 3600
      rotationMax = tolerance / (w * corner)
      unguidedMax = Math.min(unguidedMax, rotationMax)
    }
  }
  unguidedMax = Math.min(unguidedMax, MAX_SUB)
  const subMax = isGuided ? MAX_SUB : unguidedMax
  // tracking error inside one sub (at the sub length the mount allows): guided residual, or the drift as an RMS (a smear of length L has RMS L/√12)
  const trackingRms = isGuided ? mount.guidedRms! : Math.hypot(mount.baseRms, (drift * Math.min(c.subSec, unguidedMax)) / Math.sqrt(12))
  const trails = !isGuided && c.subSec > unguidedMax * 1.05

  let guiding: { tone: Tone; text: string }
  if (mount.fixed) guiding = { tone: rnCost(unguidedMax) > 0.25 ? 'bad' : 'warn', text: `Untracked: subs up to ~${fmtS(unguidedMax)}, where read noise adds +${pct(rnCost(unguidedMax))} time. A tracker changes everything here.` }
  else if (isGuided) guiding = { tone: 'ok', text: `Guided (~${mount.guidedRms}″ RMS): the mount no longer limits sub length.` }
  else if (mount.altaz) guiding = { tone: unguidedMax >= minSub ? 'ok' : 'warn', text: `Field rotation caps subs at ~${fmtS(rotationMax!)} at the corners (meridian, 50° alt; shorter near the zenith).${unguidedMax < minSub ? ` Read noise then adds +${pct(rnCost(unguidedMax))} time: an EQ wedge allows longer subs.` : ' That is long enough for this sky.'}` }
  else if (unguidedMax >= Math.max(minSub, c.subSec)) guiding = { tone: 'ok', text: `Not needed: unguided subs of ~${fmtS(unguidedMax)} stay round, longer than this sky needs.` }
  else if (unguidedMax >= minSub) guiding = { tone: 'warn', text: `Optional: unguided ~${fmtS(unguidedMax)} already buries the read noise; your ${fmtS(c.subSec)} subs would trail. Shorten them or guide.` }
  else guiding = { tone: 'bad', text: `Recommended: unguided only ~${fmtS(unguidedMax)}, where read noise adds +${pct(rnCost(unguidedMax))} time${canGuide ? '' : ' (this mount cannot guide)'}.` }

  const fwhm = starFwhm(c.seeing, o.apertureMm, trackingRms)
  const fwhmPx = fwhm / r.scale
  const tierRms = isGuided ? mount.guidedRms! : mount.baseRms
  const tiers = SEEING.map((s) => ({ ...s, sampling: samplingOf(starFwhm(s.v, o.apertureMm, tierRms) / r.scale) }))
  const advice =
    fwhmPx < 1.5 && o.drizzle === 1 ? 'Undersampled: drizzle 2× to round out the stars (needs dithering).'
    : fwhmPx > 5 && bin === 1 ? 'Well oversampled: bin 2× (or downsample) — same detail, a 4× cleaner pixel.'
    : fwhmPx > 3.5 && bin === 1 ? 'Slightly oversampled: fine on good nights; bin 2× if seeing is usually this soft.'
    : fwhmPx < 2 ? 'A touch undersampled: stars may look blocky up close; drizzle helps if you dither.'
    : 'Matched to the seeing.'

  // sub length: from where read noise stops mattering up to what the mount allows (and ten minutes at most)
  const subRange = { lo: Math.min(minSub, MAX_SUB), hi: subMax, ok: subMax >= minSub }

  // full wells: how much of a well the sky fills, and which stars clip
  const skyFill = fullWell ? (sky * c.subSec) / fullWell : undefined
  const peak = peakFraction(fwhmPx)
  const starRate = F0 * area * OPTICS * qe // e-/s from a magnitude-0 star
  const satMag = fullWell && sky * c.subSec < fullWell ? -2.5 * Math.log10((fullWell - sky * c.subSec) / (peak * starRate * c.subSec)) : undefined

  const N = r.fNumber
  return {
    optics: o, r, pxW, pxH, mp: (pxW * pxH) / 1e6, coverage: coverage(o, presetId, r.effectiveFl),
    fwhm, fwhmPx, sampling: samplingOf(fwhmPx), tiers, advice, diffraction: diffractionFwhm(o.apertureMm), trackingRms,
    areaCm2: area * 1e4, perArcsec, perPixel,
    galaxyHours: galaxy?.hours.good, nebulaHours: nebula?.hours.good,
    qe, rn, fullWell, bits: o.bits,
    dynamicRange: fullWell ? Math.log2(fullWell / rn) : undefined,
    sky, skyMag, minSub, rnCostNow: rnCost(c.subSec), byBortle, subRange,
    mount, canGuide, isGuided, unguidedMax, rotationMax, trails, guiding,
    skyFill, satMag,
    cfz: 4.88 * 0.55 * N * N, // critical focus zone, µm
    gbPerHour: (pxW * pxH * 2 * (3600 / c.subSec)) / 1e9, // 16-bit FITS
  }
}
export type Analysis = ReturnType<typeof analyse>

export const fmtS = (s: number) => (s < 1 ? '< 1 s' : s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(s < 600 ? 1 : 0)} min`)
export const pct = (x: number) => (x < 0.01 ? '<1%' : `${Math.round(x * 100)}%`)
