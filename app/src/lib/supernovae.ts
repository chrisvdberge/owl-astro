import type { CatObject } from './catalog'
import { constellationOf } from './comets'

/**
 * Bright supernovae from David Bishop's active list (rochesterastronomy.org), trimmed by the worker (worker/supernovae.ts).
 * A supernova is a fixed point, so as a target it is a custom field (`custom:sn-2026ahvu`): it syncs and plans like one.
 */
export interface Supernova {
  name: string; host: string | null; ra: number; dec: number
  mag: number; last: string; type: string; peak: number | null; peakDate: string | null; found: string
}

export const isSupernova = (id: string) => id.startsWith('custom:sn-')
export const snId = (name: string) => `custom:sn-${name.toLowerCase()}`
export const snTitle = (s: Pick<Supernova, 'name' | 'host'>) => `SN ${s.name}${s.host ? ` (${s.host})` : ''}`

export function snObject(s: Supernova): CatObject {
  return {
    id: snId(s.name), m: null, type: 'SN', typeName: `Supernova ${s.type}`, ra: s.ra, dec: s.dec, con: constellationOf(s.ra, s.dec),
    maj: null, min: null, pa: null, mag: s.mag, sb: null, names: [snTitle(s)], alt: [`SN ${s.name}`, ...(s.host ? [s.host] : [])], sn: s,
  }
}

let loaded: Supernova[] | null = null
let pending: Promise<Supernova[]> | null = null
/** The list (fetched once per session); empty when it cannot be reached. */
export function loadSupernovae(): Promise<Supernova[]> {
  pending ??= fetch('/api/supernovae')
    .then((r) => (r.ok ? r.json() : []))
    .then((rows: Supernova[]) => { loaded = Array.isArray(rows) ? rows : []; if (!loaded.length) pending = null; return loaded })
    .catch(() => { pending = null; return [] })
  return pending
}

/** A supernova by target id, from the loaded list. */
export const loadedSupernova = (id: string) => loaded?.find((s) => snId(s.name) === id)

const DAY = 86400000
/** Days since a YYYY-MM-DD date. */
export const daysSince = (ymd: string) => Math.floor((Date.now() - Date.parse(ymd)) / DAY)
