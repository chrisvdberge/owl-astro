// Bright supernovae for the app: David Bishop's list of active supernovae (rochesterastronomy.org), which is meant to be
// parsed but is a 2 MB HTML page without CORS headers. Trimmed here to the confirmed supernovae an amateur can image.
// Used by the worker in production and by a Vite middleware in dev.

export const ROCHESTER = 'https://www.rochesterastronomy.org/snimages/snactive.html'
const MAX_MAG = 17
const SIX_HOURS = 6 * 3600

export interface SupernovaRow {
  name: string          // 2026ahvu (the TNS name, without the SN prefix)
  host: string | null   // NGC 1433; null when there is no catalogued host
  ra: number; dec: number // degrees, J2000
  mag: number           // latest reported magnitude
  last: string          // date of that magnitude, YYYY-MM-DD
  type: string          // Ia, II, Ib/c…
  peak: number | null; peakDate: string | null
  found: string         // first observed, YYYY-MM-DD
}

const strip = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
const sexa = (s: string, mul: number) => {
  const m = /^([+-]?)(\d+):(\d+):([\d.]+)$/.exec(s.trim())
  return m ? (m[1] === '-' ? -1 : 1) * mul * (+m[2] + +m[3] / 60 + +m[4] / 3600) : NaN
}
const day = (s: string) => s.trim().replace(/\//g, '-')

/** Rows of the active list: confirmed supernovae (no "AT" transients or novae) at or brighter than `maxMag`. */
export function parseSupernovae(html: string, maxMag = MAX_MAG): SupernovaRow[] {
  const out = new Map<string, SupernovaRow>()
  for (const [, row] of html.matchAll(/<tr><td>(.*?)<\/td><\/tr>/g)) {
    const c = row.split(/<\/td><td>/).map(strip)
    if (c.length < 12) continue
    const [name, host, ra, dec, , latest, last, type, , peak, peakDate, found] = c
    if (!/^\d{4}[a-z]+$/.test(name) || type === 'EGN' || type === 'unk') continue
    const row2: SupernovaRow = {
      name, host: host && host !== 'none' ? host : null, ra: sexa(ra, 15), dec: sexa(dec, 1),
      mag: parseFloat(latest), last: day(last), type, peak: Number.isFinite(parseFloat(peak)) ? parseFloat(peak) : null,
      peakDate: peakDate ? day(peakDate) : null, found: day(found),
    }
    if (!Number.isFinite(row2.ra) || !Number.isFinite(row2.dec) || !(row2.mag <= maxMag)) continue
    out.set(name, row2)
  }
  return [...out.values()].sort((a, b) => a.mag - b.mag)
}

/** The trimmed list as JSON. */
export async function supernovae(): Promise<Response> {
  const res = await fetch(ROCHESTER)
  if (!res.ok) return new Response(`rochesterastronomy.org ${res.status}`, { status: 502 })
  return Response.json(parseSupernovae(await res.text()), { headers: { 'cache-control': `public, max-age=${SIX_HOURS}` } })
}
