// Remote observatory tracking (owlastro.com/remote). A cron trigger (wrangler.jsonc) runs poll() every 10 minutes;
// each observatory is polled only while the Sun is below the horizon there, and every poll, failed or not, is stored
// in Supabase through remote_record() (supabase/migrations/0019_remote_observatories.sql).
// Needs SUPABASE_URL (var) and SUPABASE_SECRET_KEY (secret: `npx wrangler secret put SUPABASE_SECRET_KEY`).

const STALE_MS = 30 * 60e3 // a reading older than this means the feed is stuck: counted as an outage

/** ASCOM Alpaca ObservingConditions names → remote_weather columns */
const ALPACA_WEATHER = {
  Temperature: 'temperature', Humidity: 'humidity', DewPoint: 'dew_point', Pressure: 'pressure',
  WindSpeed: 'wind_speed', WindGust: 'wind_gust', WindDirection: 'wind_dir', RainRate: 'rain_rate',
  SkyTemperature: 'sky_temp', SkyBrightness: 'sky_brightness', SkyQuality: 'sky_quality', StarFWHM: 'fwhm',
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'OwlAstro remote tracker (owlastro.com/remote)' }, signal: AbortSignal.timeout(15e3) })
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`)
  return res.json()
}

/** Starfront (status.starfront.space): roof state per building and the site weather station, both public Alpaca JSON */
async function starfront() {
  const api = 'https://alpaca-api.tx.starfront.space/api/v1'
  const [roofState, conditions] = await Promise.all([getJson(`${api}/roof/state`), getJson(`${api}/observingconditions/1/devicestate`)])
  const now = Date.now()
  const utc = (s) => Date.parse(s.endsWith('Z') ? s : s + 'Z')
  const newest = Math.max(...roofState.map((r) => utc(r.state_update)))
  if (!(now - newest < STALE_MS)) throw new Error('roof state is stale')
  const roofs = roofState.map((r) => ({ building: r.name, is_open: !!r.is_open }))

  const values = Object.fromEntries(conditions.Value.map((v) => [v.Name, v.Value]))
  let weather = null
  if (values.Timestamp && now - Date.parse(values.Timestamp) < STALE_MS) {
    weather = {}
    for (const [name, col] of Object.entries(ALPACA_WEATHER)) if (typeof values[name] === 'number') weather[col] = values[name]
    // no published cloud limit: the usual IR-sensor rule, sky at least 15 °C colder than the air
    if (weather.temperature != null && weather.sky_temp != null) weather.clear = weather.temperature - weather.sky_temp >= 15
  }
  return { roofs, weather }
}

/** Obstech, El Sauce (api.obstech.cl/help): weather with SQM and DIMM seeing, and every roof's status, in one call */
async function obstech() {
  const d = await getJson('https://api.obstech.cl/weather/last')
  const now = Date.now()
  const utc = (s) => Date.parse(s.endsWith('Z') ? s : s + 'Z')
  if (!(now - utc(d.date) < STALE_MS)) throw new Error('weather is stale')
  // roofs whose status hasn't been refreshed in a day are retired buildings
  const roofs = (d.roofs ?? []).filter((r) => now - utc(r.updated_at) < 864e5)
    .map((r) => ({ building: r.roof_name.replace(/^Roof/, 'Roof '), is_open: r.status_txt === 'Open' }))
  if (!roofs.length) throw new Error('no current roof status')
  const last = (k) => (typeof d[k]?.last === 'number' ? d[k].last : undefined)
  const weather = {
    temperature: last('temperature_exterior') ?? last('temperature'), humidity: last('humidity'), dew_point: last('dew_point'),
    pressure: last('pressure'), wind_speed: last('wind_speed'), wind_gust: last('wind_speed_max'),
    sky_temp: last('temperature_sky_uncalibrated'), sky_quality: last('sky_brightness'), fwhm: last('dimm_seeing') ?? last('seeing'),
  }
  // Obstech's own cloud limit: the (uncalibrated) sky temperature below limits.skytemp
  if (weather.sky_temp != null && typeof d.limits?.skytemp === 'number') weather.clear = weather.sky_temp < d.limits.skytemp
  return { roofs, weather }
}

const SRO = { lat: 37.07, lon: -119.41, tz: 'America/Los_Angeles' }

/** "M/D/YYYY h:mm:ss AM" read as UTC (ms) */
function usDateUtc(s) {
  const m = s.trim().match(/^(\d+)\/(\d+)\/(\d{4}),?\s+(\d+):(\d+)(?::(\d+))?\s*(AM|PM)$/i)
  if (!m) return NaN
  const h = (+m[4] % 12) + (m[7].toUpperCase() === 'PM' ? 12 : 0)
  return Date.UTC(+m[3], +m[1] - 1, +m[2], h, +m[5], +(m[6] ?? 0))
}

/** Offset of a time zone from UTC at a moment, in ms (local wall clock − UTC) */
function tzOffset(date, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    .formatToParts(date).map((x) => [x.type, x.value]))
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(date.getTime() / 1000) * 1000
}

/**
 * Sierra Remote Observatories (sierra-remote.com/weather.html, /seeing-data--darkness.html). No roof status or cloud
 * sensor is published: weather comes from the Rainwise station page, seeing from the two Alcor monitors' latest-reading
 * files. The Alcor only measures when it sees stars, so a fresh reading after dark counts as "clear".
 */
async function sro() {
  const base = 'https://sroftp2.com/SRODATA'
  const text = async (url) => {
    const res = await fetch(url, { headers: { 'user-agent': 'OwlAstro remote tracker (owlastro.com/remote)' }, signal: AbortSignal.timeout(15e3) })
    if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`)
    return res.text()
  }
  const now = Date.now()
  const [rainwise, ...alcor] = await Promise.all([
    text(`${base}/WeatherWatch/sierra-remote-obs-rainwise.html`),
    ...['AlcorSM', 'AlcorSM2'].map((d) => text(`${base}/${d}/Last_Seeing_Data.txt`).catch(() => '')),
  ])

  // "UTC time | local time | JD | … | seeing (arcsec) | …"
  const seeing = alcor.map((line) => line.split('|').map((x) => x.trim()))
    .filter((f) => f.length >= 5 && now - usDateUtc(f[0]) < 20 * 60e3 && +f[4] > 0 && +f[4] < 10).map((f) => +f[4])

  const t = rainwise.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ')
  const num = (re) => { const m = t.match(re); return m ? +m[1] : undefined }
  const updated = t.match(/Updated \w+, (\d+\/\d+\/\d{4}, \d+:\d+ [AP]M)/)
  // the station page shows SRO's wall clock: shift to UTC with the zone's offset
  const stationAt = updated ? usDateUtc(updated[1]) - tzOffset(new Date(), SRO.tz) : NaN
  let weather = null
  if (now - stationAt < STALE_MS) {
    const f2c = (f) => (f == null ? undefined : Math.round(((f - 32) * 5) / 9 * 10) / 10)
    const mph = (v) => (v == null ? undefined : Math.round(v * 0.44704 * 10) / 10)
    const inHg = num(/Sea Level P\. ([\d.]+) inHg/)
    weather = {
      temperature: f2c(num(/Temperature ([-\d.]+) °F/)), humidity: num(/Humidity ([\d.]+) %/), dew_point: f2c(num(/Dewpoint ([-\d.]+) °F/)),
      pressure: inHg == null ? undefined : Math.round(inHg * 33.8639 * 10) / 10,
      wind_speed: mph(num(/Wind ([\d.]+) mph/)), wind_gust: mph(num(/Wind Gust ([\d.]+) mph/)),
    }
  }
  if (!weather && !seeing.length) throw new Error('no fresh weather or seeing data')
  weather ??= {}
  if (seeing.length) weather.fwhm = Math.round((seeing.reduce((a, b) => a + b) / seeing.length) * 100) / 100
  // the monitors start once the Sun is 5° down: before that, no reading says nothing about clouds
  if (sunAltitude(new Date(now), SRO.lat, SRO.lon) < -6) weather.clear = seeing.length > 0
  return { roofs: null, weather }
}

/**
 * Nebula Nest (nebulanest.online): the site's AAG CloudWatcher Solo as JSON, refreshed every 2 minutes. No roof status
 * is published. "clear" is the CloudWatcher's own cloud verdict (cloudsSafe, by the limit set on the unit).
 */
async function nebulaNest() {
  const d = await getJson('https://weather.nebulanest.online/')
  // "2026/11/18 06:28:26", UTC
  const at = Date.parse(`${String(d.dataGMTTime).replace(/\//g, '-').replace(' ', 'T')}Z`)
  if (!(Date.now() - at < STALE_MS)) throw new Error('weather is stale')
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const kmh = (v) => (n(v) == null ? undefined : Math.round((v / 3.6) * 10) / 10)
  const weather = {
    temperature: n(d.temp), humidity: n(d.hum), dew_point: n(d.dewp), pressure: n(d.relpress),
    wind_speed: kmh(d.wind), wind_gust: kmh(d.gust),
    // "clouds" is sky minus ambient: the sky temperature is the sum
    sky_temp: n(d.clouds) != null && n(d.temp) != null ? Math.round((d.clouds + d.temp) * 10) / 10 : undefined,
    // the light sensor reads mag/arcsec² only in the dark; in daylight it bottoms out around 10
    sky_quality: n(d.lightmpsas) > 15 ? d.lightmpsas : undefined,
  }
  if (typeof d.cloudsSafe === 'string') weather.clear = d.cloudsSafe === 'Safe'
  return { roofs: null, weather }
}

// slug must match remote_observatories and the site's src/content/observatories/<slug>
export const OBSERVATORIES = [
  { slug: 'starfront', lat: 31.546934, lon: -99.381944, read: starfront },
  { slug: 'obstech-el-sauce', lat: -30.471, lon: -70.765, read: obstech },
  { slug: 'sierra-remote-observatories', lat: SRO.lat, lon: SRO.lon, read: sro },
  { slug: 'nebula-nest', lat: -36.30, lon: 142.05, read: nebulaNest },
]

/** Solar altitude in degrees (low-precision, ~0.1°: plenty to tell day from night) */
export function sunAltitude(date, lat, lon) {
  const d = date.getTime() / 864e5 - 10957.5 // days since J2000.0
  const rad = Math.PI / 180
  const g = (357.529 + 0.98560028 * d) * rad
  const q = 280.459 + 0.98564736 * d
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad
  const e = (23.439 - 0.00000036 * d) * rad
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L))
  const dec = Math.asin(Math.sin(e) * Math.sin(L))
  const gmst = (280.46061837 + 360.98564736629 * d) * rad
  const ha = gmst + lon * rad - ra
  return Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha)) / rad
}

async function record(env, body) {
  const key = env.SUPABASE_SECRET_KEY
  const headers = { apikey: key, 'content-type': 'application/json' }
  if (key.startsWith('ey')) headers.authorization = `Bearer ${key}` // legacy service_role JWT
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/remote_record`, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`remote_record ${res.status}: ${await res.text()}`)
}

/** One cron tick: poll every observatory where the Sun is down (or all of them with force, for testing) */
export async function poll(env, { force = false } = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY not set')
  const now = new Date()
  const due = OBSERVATORIES.filter((o) => force || sunAltitude(now, o.lat, o.lon) < 0)
  return Promise.all(due.map(async (o) => {
    let body
    try {
      const { roofs, weather } = await o.read()
      body = { observatory: o.slug, ok: true, roofs, weather }
    } catch (err) {
      body = { observatory: o.slug, ok: false, error: String(err?.message ?? err) }
    }
    await record(env, body)
    return body
  }))
}
