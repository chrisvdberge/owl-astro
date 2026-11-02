// Survey cutouts for the app: colour from CDS hips2fits when it answers, else one band from NASA SkyView.
// Served from our own origin either way, so canvases and fetch() keep working (SkyView sends no CORS headers).
// Used by the worker in production and by a Vite middleware in dev.
import { SURVEYS, type Survey } from '../src/lib/surveys.ts'

const CDS_TIMEOUT = 6000
const SKYVIEW_TIMEOUT = 30000
const RETRY_CDS_AFTER = 5 * 60 * 1000
const MONTH = 30 * 24 * 3600
const DAY = 24 * 3600

/** After CDS fails, skip it for a while instead of making every image wait for its timeout. */
let cdsDownUntil = 0

function hips2fits(s: Survey, ra: number, dec: number, fov: number, w: number, h: number): string {
  const q = new URLSearchParams({
    hips: s.hips.startsWith('P/') ? `CDS/${s.hips}` : s.hips, width: String(w), height: String(h), fov: fov.toFixed(4),
    projection: 'TAN', coordsys: 'icrs', ra: ra.toFixed(5), dec: dec.toFixed(5), format: 'jpg',
  })
  return `https://alasky.cds.unistra.fr/hips-image-services/hips2fits?${q}`
}

/** The same field from SkyView: TAN, north up, `fov` degrees wide with square pixels. */
function skyview(s: Survey, ra: number, dec: number, fov: number, w: number, h: number): string {
  const q = new URLSearchParams({
    Survey: s.skyview, Position: `${ra.toFixed(5)},${dec.toFixed(5)}`, Coordinates: 'J2000', Projection: 'Tan',
    Size: `${fov.toFixed(4)},${((fov * h) / w).toFixed(4)}`, Pixels: `${w},${h}`, Return: 'JPEG',
  })
  return `https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl?${q}`
}

function image(res: Response, source: string, maxAge: number): Response {
  return new Response(res.body, {
    headers: { 'content-type': res.headers.get('content-type') ?? 'image/jpeg', 'cache-control': `public, max-age=${maxAge}`, 'x-cutout-source': source },
  })
}

/** `?survey=&ra=&dec=&fov=&w=&h=` → a JPEG of that field. */
export async function cutout(params: URLSearchParams): Promise<Response> {
  const survey = SURVEYS.find((s) => s.id === params.get('survey')) ?? SURVEYS[0]
  const [ra, dec, fov, w, h] = ['ra', 'dec', 'fov', 'w', 'h'].map((k) => Number(params.get(k)))
  if (![ra, dec, fov, w, h].every(Number.isFinite) || fov <= 0 || fov > 180 || w < 1 || h < 1 || w > 2000 || h > 2000) {
    return new Response('bad cutout request', { status: 400 })
  }
  if (Date.now() >= cdsDownUntil) {
    try {
      const res = await fetch(hips2fits(survey, ra, dec, fov, w, h), { signal: AbortSignal.timeout(CDS_TIMEOUT) })
      if (res.ok) return image(res, 'cds', MONTH)
      if (res.status < 500) return new Response(`CDS ${res.status}`, { status: res.status })
    } catch { /* unreachable or too slow */ }
    cdsDownUntil = Date.now() + RETRY_CDS_AFTER
  }
  try {
    // a day only, so the colour image comes back soon after CDS does
    const res = await fetch(skyview(survey, ra, dec, fov, Math.round(w), Math.round(h)), { signal: AbortSignal.timeout(SKYVIEW_TIMEOUT) })
    if (res.ok) return image(res, 'skyview', DAY)
  } catch { /* fall through */ }
  return new Response('no survey service answered', { status: 502 })
}
