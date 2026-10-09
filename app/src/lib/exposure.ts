import type { CatObject } from './catalog'
import { CAMERAS, PRESETS, compute, type Optics } from './optics'

/** Zenith sky brightness (V mag/arcsec²) by Bortle class. */
export const SKY_MAG = [0, 21.9, 21.6, 21.3, 20.8, 20.1, 19.4, 18.9, 18.4, 17.8]
export const DEFAULT_BORTLE = 5

/** Typical mean surface brightness for objects the catalogue has no figures for. */
const TYPICAL: Record<string, number> = { HII: 24, EmN: 24, Neb: 24, 'Cl+N': 24, SNR: 24.5, RfN: 23.5, PN: 22, G: 23.5, GPair: 23, GGroup: 24, GTrpl: 24, OCl: 22, GCl: 21 }

/** Mean surface brightness (mag/arcsec²): catalogued, else worked out from magnitude and size, else typical for the type. */
export function surfaceBrightness(o: CatObject): { mu: number; source: 'catalogue' | 'from magnitude and size' | 'typical for the type' } | null {
  if (o.sb != null) return { mu: o.sb, source: 'catalogue' }
  if (o.mag != null && o.maj) {
    const area = (Math.PI / 4) * o.maj * 60 * (o.min ?? o.maj) * 60
    return { mu: o.mag + 2.5 * Math.log10(area), source: 'from magnitude and size' }
  }
  const t = TYPICAL[o.type]
  return t ? { mu: t, source: 'typical for the type' } : null
}

const F0 = 3e10      // photons / s / m² from a magnitude-0 source over a ~300 nm visible band
const OPTICS = 0.85  // throughput of lenses, coatings and filters other than the one chosen
const EFFICIENCY = 0.9 // frames lost to satellites, trails, clouds and rejection
/**
 * Quality tiers: signal-to-noise per pixel in the stack, the least time worth planning (hours) however bright the target, and how
 * smooth the background must be: noise in the stack as a share of a typical (Bortle 5) sky level (25 means noise of 4% of that level).
 */
export const TIERS = [
  { id: 'decent', label: 'Decent', snr: 2, floor: 10 / 60, smooth: 25 },
  { id: 'good', label: 'Good', snr: 4, floor: 0.5, smooth: 50 },
  { id: 'great', label: 'Great', snr: 8, floor: 1, smooth: 100 },
] as const

export type Filter = 'none' | 'dual'
const EMISSION = ['HII', 'EmN', 'SNR', 'Neb', 'Cl+N', 'PN']
const CLUSTERS = ['OCl', 'GCl', '*Ass', '*', '**']

/**
 * Emission nebulae shine mostly in Hα and OIII, which a V-band surface brightness barely sees (and the catalogue's magnitudes for
 * nebulae are loose), so their line surface brightness is taken as typical for the type, in Rayleighs, and the catalogue figure
 * only nudges it. 1 Rayleigh ≈ 0.0187 photons / s / m² / arcsec².
 */
const RAYLEIGH = 1.87e-2
const LINES: Record<string, { typ: number; mu: number; nudge: number }> = {
  HII: { typ: 170, mu: 23.5, nudge: 0.3 }, EmN: { typ: 170, mu: 23.5, nudge: 0.3 }, Neb: { typ: 200, mu: 23.5, nudge: 0.3 }, 'Cl+N': { typ: 170, mu: 23, nudge: 0.3 },
  SNR: { typ: 90, mu: 24.5, nudge: 0.3 }, PN: { typ: 800, mu: 21, nudge: 1 },
}

/** A dual-band filter lets through only a few percent of the sky's light (plus its own transmission loss). */
const DUAL_SKY = 0.12 * 0.9
export const defaultFilter = (type: string): Filter => (EMISSION.includes(type) ? 'dual' : 'none')

export interface ExposureEstimate {
  kind: 'extended' | 'emission' | 'cluster'
  mu: number; muSource: string; skyMag: number
  lines?: number                    // assumed emission-line surface brightness, Rayleighs
  signal: number; sky: number      // electrons per second per pixel
  hours: Record<(typeof TIERS)[number]['id'], number>
  perSub: number                    // SNR of one sub-exposure
  skySub: number                    // one sub's SNR against the reference background level (sky shot noise + read noise)
  bgLimited: boolean                // the 'good' time is set by background smoothness, not by the target's brightness
}

/**
 * Rough integration time to reach a target signal-to-noise per pixel in the stack.
 * Photon shot noise from the object and the sky, plus read noise per sub; the sky is brightened by the moon (`moon` 0..1).
 * A guide, not a guarantee: real results depend on processing, seeing, gradients and the object's actual brightness.
 */
export function estimateExposure(o: CatObject, optics: Optics, bortle: number, subSec: number, filter: Filter, moon = 0): ExposureEstimate | null {
  const sb = surfaceBrightness(o)
  const isCluster = CLUSTERS.includes(o.type)
  if (!sb && !isCluster) return null
  const skyMag = SKY_MAG[Math.min(9, Math.max(1, Math.round(bortle)))]

  const r = compute(optics, 3)
  const area = Math.PI * (optics.apertureMm / 2000) ** 2           // m²
  const px = r.scale ** 2                                          // arcsec² per pixel
  const rate = (flux: number) => flux * area * OPTICS * (optics.qe ?? 0.6) * px
  const dual = filter === 'dual'
  const sky = rate(F0 * 10 ** (-0.4 * skyMag) * (dual ? DUAL_SKY : 1)) * (1 + moon * (dual ? 0.8 : 4))
  const rn = optics.readNoise ?? 2
  // how many subs it takes for the background to average smooth: sky shot noise and read noise both beat down as 1/sqrt(N).
  // Smooth is judged against a fixed reference level (a Bortle-5 sky), so darker skies, with less sky noise, need less time
  const refLevel = rate(F0 * 10 ** (-0.4 * SKY_MAG[5]) * (dual ? DUAL_SKY : 1))
  const skySub = (refLevel * subSec) / Math.sqrt(sky * subSec + rn * rn)
  const smoothHours = (t: (typeof TIERS)[number]) => ((t.smooth / skySub) ** 2 * subSec) / 3600 / EFFICIENCY

  const make = (perTier: (t: (typeof TIERS)[number]) => number) => Object.fromEntries(TIERS.map((t) => [t.id, Math.max(t.floor, perTier(t))])) as ExposureEstimate['hours']

  // clusters are bright point sources: they show in minutes, so the time that matters is a smooth background and clean stars
  if (isCluster) {
    return { kind: 'cluster', mu: sb?.mu ?? 0, muSource: sb?.source ?? '', skyMag, signal: 0, sky, perSub: 0, skySub, bgLimited: true, hours: make(smoothHours) }
  }

  const ln = LINES[o.type]
  const rayleighs = ln ? ln.typ * 10 ** (-0.4 * Math.max(-ln.nudge, Math.min(ln.nudge, sb!.mu - ln.mu))) : 0
  const cont = F0 * 10 ** (-0.4 * sb!.mu)
  // dual-band passes the emission lines but little continuum; without a filter the object's continuum and its lines both arrive
  const signal = dual ? rate((rayleighs * RAYLEIGH + cont * 0.08) * 0.9) : rate(cont + rayleighs * RAYLEIGH)
  const perSub = (signal * subSec) / Math.sqrt((signal + sky) * subSec + rn * rn)
  const target = (t: (typeof TIERS)[number]) => ((t.snr / perSub) ** 2 * subSec) / 3600 / EFFICIENCY
  // unfiltered, a bright target still needs the sky behind it to smooth out; with a narrowband filter the sky is dark and that stops mattering
  const hours = make((t) => (dual ? target(t) : Math.max(target(t), smoothHours(t))))
  const bgLimited = !dual && smoothHours(TIERS[1]) > target(TIERS[1])
  return { kind: ln ? 'emission' : 'extended', mu: sb!.mu, muSource: sb!.source, skyMag, lines: ln ? rayleighs : undefined, signal, sky, hours, perSub, skySub, bgLimited }
}

/** Fills in sensor characteristics (quantum efficiency, read noise) from the known unit or camera when the optics do not carry them. */
export function withSensor(optics: Optics, presetId?: string): Optics {
  if (optics.qe && optics.readNoise) return optics
  const unit = PRESETS.find((p) => p.id === presetId && p.id !== 'custom')
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6
  const cam = CAMERAS.find((c) => near(c.sensorWmm, optics.sensorWmm) && near(c.sensorHmm, optics.sensorHmm) && near(c.pixelUm, optics.pixelUm))
  return { ...optics, qe: optics.qe ?? unit?.optics.qe ?? cam?.qe, readNoise: optics.readNoise ?? unit?.optics.readNoise ?? cam?.readNoise }
}
