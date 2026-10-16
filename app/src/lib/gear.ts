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
 * (generic entries such as "Newton 200/1000", "Lens 135 mm" or a bare sensor would only add noise to a search).
 */
export function gearNames(optics: Optics, presetId?: string): string[] {
  const unit = PRESETS.find((p) => p.id === presetId && p.id !== 'custom')
  if (unit) return [bare(unit.label)]
  const scope = SCOPES.find((t) => !/^(lens|newton)-/.test(t.id) && near(t.apertureMm, optics.apertureMm) && near(t.focalLengthMm, optics.focalLengthMm))
  const cam = findCamera(optics)
  const named = cam && !cam.id.startsWith('sensor-') ? cam : undefined
  // "ZWO ASI2600MC/MM Pro" → "ZWO ASI2600MC Pro": one model per name, as AstroBin lists them
  return [scope && bare(scope.label), named && bare(named.label).replace(/\/\w+/g, '')].filter((x): x is string => !!x)
}

/** Names offered when logging an observation: the all-in-one units. */
export const unitLabels = () => PRESETS.filter((p) => p.id !== 'custom').map((p) => bare(p.label))

export const SETUPS_KEY = 'astroplanner.gear.setups'

/** The setups compared in the gear planner (kept in this browser), or null when none were saved yet. */
export function savedSetups<T extends { presetId: string; optics: Optics }>(): T[] | null {
  try { const v = localStorage.getItem(SETUPS_KEY); return v ? JSON.parse(v) : null } catch { return null }
}

/** A telescope + camera combination the user owns (their account's "my gear"); `name` is optional, e.g. "Backyard rig". */
export interface GearItem { id: string; name?: string; presetId: string; optics: Optics; mount?: string; guided?: boolean }
type ScopeLike = { presetId: string; optics: Optics }
type GearSettings = { scope?: ScopeLike; gear?: GearItem[] }

export const gearName = (g: GearItem) => g.name?.trim() || setupLabel(g.optics, g.presetId)
export const sameGear = (a: ScopeLike, b: ScopeLike) => a.presetId === b.presetId && JSON.stringify(a.optics) === JSON.stringify(b.optics)

/** The user's gear in their order; accounts from before "my gear" have just their default scope. */
export const myGear = (s: GearSettings): GearItem[] => (s.gear?.length ? s.gear : s.scope ? [{ id: 'default', ...s.scope }] : [])

/** The same, the default first (for pickers and summaries). */
export function gearDefaultFirst(s: GearSettings): GearItem[] {
  const list = myGear(s), d = s.scope && list.find((g) => sameGear(g, s.scope!))
  return d ? [d, ...list.filter((g) => g !== d)] : list
}

/** Settings patch that makes a setup the default, adding it to my gear when it is not there yet. */
export function defaultPatch(s: GearSettings, scope: ScopeLike): GearSettings {
  const list = myGear(s)
  const has = list.some((g) => sameGear(g, scope))
  return { scope: { presetId: scope.presetId, optics: scope.optics }, gear: has ? list : [...list, { id: crypto.randomUUID(), presetId: scope.presetId, optics: scope.optics }] }
}
