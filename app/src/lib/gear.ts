import { findCamera, PRESETS, SCOPES, type Optics } from './optics'

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6
const bare = (label: string) => label.replace(/ \(.*\)$/, '')

/** A readable name for a telescope + camera combination, e.g. "Seestar S50 Pro" or "Newton 200/1000 + Nikon D600". */
export function setupLabel(optics: Optics, presetId?: string): string {
  const unit = PRESETS.find((p) => p.id === presetId && p.id !== 'custom')
  if (unit) return unit.label.replace(/ \(.*\)$/, '')
  const scope = SCOPES.find((t) => near(t.apertureMm, optics.apertureMm) && near(t.focalLengthMm, optics.focalLengthMm))
  const cam = findCamera(optics)
  const reducer = optics.reducer !== 1 ? ` ×${optics.reducer}` : ''
  return `${scope ? bare(scope.label) : `${optics.apertureMm}/${optics.focalLengthMm} mm`}${reducer} + ${cam ? bare(cam.label) : `${optics.sensorWmm}×${optics.sensorHmm} mm sensor`}`
}

/**
 * Searchable names for the gear in use: the all-in-one unit, else the telescope and camera when they are named models
 * (generic entries such as "Newton 200/1000" or "Lens 135 mm" would only add noise to a search).
 */
export function gearNames(optics: Optics, presetId?: string): string[] {
  const unit = PRESETS.find((p) => p.id === presetId && p.id !== 'custom')
  if (unit) return [bare(unit.label)]
  const scope = SCOPES.find((t) => !/^(lens|newton)-/.test(t.id) && near(t.apertureMm, optics.apertureMm) && near(t.focalLengthMm, optics.focalLengthMm))
  const cam = findCamera(optics)
  // "ZWO ASI2600MC/MM Pro" → "ZWO ASI2600MC Pro": one model per name, as AstroBin lists them
  return [scope && bare(scope.label), cam && bare(cam.label).replace(/\/\w+/g, '')].filter((x): x is string => !!x)
}

/** Names offered when logging an observation: the all-in-one units. */
export const unitLabels = () => PRESETS.filter((p) => p.id !== 'custom').map((p) => bare(p.label))
