import type { HorizonPoint, Location } from './astro'
import { tzFromCoords } from './tz'

/**
 * A site as a link anyone can open: everything the site page needs rides in the URL (/site?n=…&lat=…&lon=…), so there is
 * nothing stored and no account needed. The horizon goes as az_alt pairs joined by ~ (characters a URL leaves alone).
 */
const validTz = (tz: string | null) => { if (!tz) return undefined; try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz } catch { return undefined } }
const num = (v: string | null) => (v == null || v === '' || !Number.isFinite(+v) ? undefined : +v)

export function siteSharePath(l: Location): string {
  const q: [string, string | number | undefined][] = [
    ['n', l.name], ['lat', l.lat.toFixed(4)], ['lon', l.lon.toFixed(4)], ['el', Math.round(l.elevation)],
    ['tz', l.tz], ['s', l.seeing], ['b', l.bortle],
    ['hz', l.horizon.length ? l.horizon.map(([a, v]) => `${+a.toFixed(1)}_${+v.toFixed(1)}`).join('~') : undefined],
  ]
  return `/site?${q.filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}`
}

export const siteShareUrl = (l: Location) => `${window.location.origin}${siteSharePath(l)}`

/** The site a /site link describes, or null when the coordinates are missing or out of range. */
export function siteFromQuery(q: URLSearchParams): Location | null {
  const lat = num(q.get('lat')), lon = num(q.get('lon'))
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  const horizon = (q.get('hz') ?? '').split('~').map((p) => p.split('_').map(Number)).filter((p): p is HorizonPoint => p.length === 2 && p.every(Number.isFinite) && p[0] >= 0 && p[0] < 360 && p[1] >= -10 && p[1] <= 90).sort((a, b) => a[0] - b[0])
  const b = num(q.get('b')), s = num(q.get('s'))
  return {
    id: `shared:${lat},${lon}`, name: (q.get('n') ?? '').trim().slice(0, 80) || `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
    lat, lon, elevation: num(q.get('el')) ?? 0, horizon, tz: validTz(q.get('tz')) ?? tzFromCoords(lat, lon),
    seeing: s != null && s > 0 && s < 10 ? s : undefined, bortle: b != null && b >= 1 && b <= 9 ? Math.round(b) : undefined,
  }
}
