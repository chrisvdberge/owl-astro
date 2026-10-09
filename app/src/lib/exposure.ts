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
export const TIERS = [{ id: 'decent', label: 'Decent', snr: 4 }, { id: 'good', label: 'Good', snr: 8 }, { id: 'great', label: 'Great', snr: 16 }] as const

export type Filter = 'none' | 'dual'
const EMISSION = ['HII', 'EmN', 'SNR', 'Neb', 'Cl+N', 'PN']

/** How a dual-band filter changes object signal and sky: emission objects keep much of their light, the sky loses most of it. */
const filterFactors = (type: string) => ({ signal: (type === 'PN' ? 0.7 : EMISSION.includes(type) ? 0.55 : 0.08) * 0.9, sky: 0.12 * 0.9 })
export const defaultFilter = (type: string): Filter => (EMISSION.includes(type) ? 'dual' : 'none')

export interface ExposureEstimate {
  mu: number; muSource: string; skyMag: number
  signal: number; sky: number      // electrons per second per pixel
  hours: Record<(typeof TIERS)[number]['id'], number>
  perSub: number                    // SNR of one sub-exposure
}

/**
 * Rough integration time to reach a target signal-to-noise per pixel in the stack.
 * Photon shot noise from the object and the sky, plus read noise per sub; the sky is brightened by the moon (`moon` 0..1).
 * A guide, not a guarantee: real results depend on processing, seeing, gradients and the object's actual brightness.
 */
export function estimateExposure(o: CatObject, optics: Optics, bortle: number, subSec: number, filter: Filter, moon = 0): ExposureEstimate | null {
  const sb = surfaceBrightness(o)
  if (!sb) return null
  const r = compute(optics, 3)
  const area = Math.PI * (optics.apertureMm / 2000) ** 2           // m²
  const px = r.scale ** 2                                          // arcsec² per pixel
  const rate = (mag: number, extra: number) => F0 * 10 ** (-0.4 * mag) * area * OPTICS * (optics.qe ?? 0.6) * px * extra
  const f = filter === 'dual' ? filterFactors(o.type) : { signal: 1, sky: 1 }
  const skyMag = SKY_MAG[Math.min(9, Math.max(1, Math.round(bortle)))]
  const signal = rate(sb.mu, f.signal)
  const sky = rate(skyMag, f.sky) * (1 + moon * (filter === 'dual' ? 0.8 : 4))
  const rn = optics.readNoise ?? 2
  const perSub = (signal * subSec) / Math.sqrt((signal + sky) * subSec + rn * rn)
  const hours = Object.fromEntries(TIERS.map((t) => [t.id, ((t.snr / perSub) ** 2 * subSec) / 3600 / EFFICIENCY])) as ExposureEstimate['hours']
  return { mu: sb.mu, muSource: sb.source, skyMag, signal, sky, hours, perSub }
}

/** Fills in sensor characteristics (quantum efficiency, read noise) from the known unit or camera when the optics do not carry them. */
export function withSensor(optics: Optics, presetId?: string): Optics {
  if (optics.qe && optics.readNoise) return optics
  const unit = PRESETS.find((p) => p.id === presetId && p.id !== 'custom')
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6
  const cam = CAMERAS.find((c) => near(c.sensorWmm, optics.sensorWmm) && near(c.sensorHmm, optics.sensorHmm) && near(c.pixelUm, optics.pixelUm))
  return { ...optics, qe: optics.qe ?? unit?.optics.qe ?? cam?.qe, readNoise: optics.readNoise ?? unit?.optics.readNoise ?? cam?.readNoise }
}
