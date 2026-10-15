// Serves the static app (./dist) and a few small proxies for data sources that do not send CORS headers.

const COBS = 'https://cobs.si/api/comet_list.api?is-active=true'
const SIX_HOURS = 6 * 3600

/** Observed brightness of the currently observed comets from COBS (cobs.si), trimmed to what the app uses. */
async function cobsComets(request, ctx) {
  const cache = caches.default
  const hit = await cache.match(request)
  if (hit) return hit
  const res = await fetch(COBS, { headers: { accept: 'application/json' } })
  if (!res.ok) return new Response(`COBS ${res.status}`, { status: 502 })
  const { objects } = await res.json()
  const out = objects.filter((o) => o.current_mag != null && o.current_mag !== '').map((o) => ({
    name: o.name, fullname: o.fullname, mag: +o.current_mag, peak: o.peak_mag != null ? +o.peak_mag : null, peakDate: o.peak_mag_date ?? null,
  }))
  const body = Response.json(out, { headers: { 'cache-control': `public, max-age=${SIX_HOURS}` } })
  ctx.waitUntil(cache.put(request, body.clone()))
  return body
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname === '/api/cobs/comets') return cobsComets(request, ctx)
    return env.ASSETS.fetch(request)
  },
}
