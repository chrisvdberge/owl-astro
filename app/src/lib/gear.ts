import { CAMERAS, PRESETS, SCOPES, type Optics } from './optics'

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6
const bare = (label: string) => label.replace(/ \(.*\)$/, '')

/** A readable name for a telescope + camera combination, e.g. "Seestar S50 Pro" or "Newton 200/1000 + Nikon D600". */
export function setupLabel(optics: Optics, presetId?: string): string {
  const unit = PRESETS.find((p) => p.id === presetId && p.id !== 'custom')
  if (unit) return unit.label.replace(/ \(.*\)$/, '')
  const scope = SCOPES.find((t) => near(t.apertureMm, optics.apertureMm) && near(t.focalLengthMm, optics.focalLengthMm))
  const cam = CAMERAS.find((c) => near(c.sensorWmm, optics.sensorWmm) && near(c.sensorHmm, optics.sensorHmm) && near(c.pixelUm, optics.pixelUm))
  const reducer = optics.reducer !== 1 ? ` ×${optics.reducer}` : ''
  return `${scope ? bare(scope.label) : `${optics.apertureMm}/${optics.focalLengthMm} mm`}${reducer} + ${cam ? bare(cam.label) : `${optics.sensorWmm}×${optics.sensorHmm} mm sensor`}`
}

/** Names offered when logging an observation: the all-in-one units. */
export const unitLabels = () => PRESETS.filter((p) => p.id !== 'custom').map((p) => bare(p.label))
