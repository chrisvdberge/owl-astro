import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { horizonAlt, type Location } from '../lib/astro'
import { DOME_LEVEL, LP_CREDIT, LP_TILES, analyseSite, bortleOf, compass, lpRatio, milkyWayOf, nelmOf, placeName, sqmOf, starsOf, vanRhijn, zoneOf, type SiteSky } from '../lib/lightpollution'
import { tzFromCoords, tzOf } from '../lib/tz'
import { elevationAt, searchPlaces, type Place } from '../lib/places'
import { DEFAULT_BORTLE } from '../lib/exposure'
import { SEEING } from '../lib/optics'
import HorizonEditor from './HorizonEditor'
import type { useStore } from '../lib/store'

type Store = ReturnType<typeof useStore>
const fmtN = (n: number) => (n >= 1000 ? `${Math.round(n / 100) * 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : `${Math.round(n / 10) * 10}`)
const OPACITY_KEY = 'astroplanner.site.lpOpacity'
const MODE_KEY = 'astroplanner.site.domeMode'

type RGB = [number, number, number]
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const ramp = (stops: [number, string][]) => {
  const st = stops.map(([v, h]) => [v, hex(h)] as [number, RGB])
  return (v: number): RGB => {
    if (v <= st[0][0]) return st[0][1]
    for (let i = 1; i < st.length; i++) if (v <= st[i][0]) { const [v0, c0] = st[i - 1], [v1, c1] = st[i], f = (v - v0) / (v1 - v0); return [0, 1, 2].map((k) => c0[k] + (c1[k] - c0[k]) * f) as RGB }
    return st[st.length - 1][1]
  }
}
/** The atlas colours, continuous in log brightness and extended past its brightest zone so city skies still show their domes. */
const atlasColor = ((r) => (ratio: number) => r(Math.log10(1 + ratio)))(ramp(([[0, '#000000'], [0.03, '#222222'], [0.085, '#424242'], [0.15, '#142f72'], [0.26, '#2154d8'], [0.45, '#0f5714'], [0.78, '#1fa12a'], [1.35, '#6e641e'], [2.3, '#b8a625'], [4, '#bf641e'], [7, '#fd9650'], [12, '#fb5a49'], [21, '#fb998a'], [36, '#a0a0a0'], [60, '#f2f2f2'], [250, '#fff3b0']] as [number, string][]).map(([v, h]) => [Math.log10(1 + v), h])))
/** How much the light domes brighten the sky (magnitudes) over a dome-free sky at the same altitude: dark blue for nothing, green at a dome's edge (+0.45), white at +2 mag. */
const contrastColor = ramp([[0, '#0b1a3a'], [0.15, '#1d4ed8'], [0.45, '#16a34a'], [1, '#facc15'], [2, '#fff7d6']])

/** Zenith sky quality figures for one point. */
function Quality({ ratio, compact }: { ratio: number; compact?: boolean }) {
  const sqm = sqmOf(ratio), z = zoneOf(ratio), b = bortleOf(sqm), nelm = nelmOf(sqm)
  return (
    <div className={`squal ${compact ? 'compact' : ''}`}>
      <div className="sbig"><b>{sqm.toFixed(2)}</b><small>mag/arcsec² (SQM)</small></div>
      <div className="sbig"><b>{b.toFixed(1)}</b><small>Bortle (≈)</small></div>
      <div className="sbar"><i style={{ width: `${Math.min(100, ((22 - sqm) / 5) * 100)}%` }} /></div>
      <dl>
        <dt>Atlas zone</dt><dd><span className="szone" style={{ background: z.color }} /> {z.zone} · artificial light {ratio < 0.1 ? ratio.toFixed(2) : ratio.toFixed(1)}× the natural sky</dd>
        {!compact && <><dt>Milky Way</dt><dd>{milkyWayOf(sqm)}</dd>
          <dt>Naked eye</dt><dd>stars to mag {nelm.toFixed(1)} · ≈ {fmtN(starsOf(nelm))} visible</dd></>}
      </dl>
    </div>
  )
}

/**
 * The site's sky as an all-sky compass, laid out like the map (north up, east right; the horizon on the rim, the zenith in the
 * middle): light domes from the atlas on top of the sky, which brightens towards the horizon anyway. The physical horizon is
 * shaded; the dashed amber line is the altitude each dome reaches.
 */
function DomeChart({ sky, loc, minAlt, mode }: { sky: SiteSky; loc: Location; minAlt: number; mode: 'atlas' | 'contrast' }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const S = 360, R = 170, C = S / 2
  useEffect(() => {
    const g = ref.current?.getContext('2d')
    if (!g) return
    const img = g.createImageData(S, S)
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = x - C, dy = y - C, rr = Math.hypot(dx, dy)
      if (rr > R) continue
      const alt = 90 - (rr / R) * 90
      const az = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360 // north up, east right, like the map
      const bg = (1 + sky.ratio) * vanRhijn(alt), total = bg + sky.glow(az, alt)
      const col = mode === 'atlas' ? atlasColor(total - 1) : contrastColor(2.5 * Math.log10(total / bg))
      const k = alt < horizonAlt(loc.horizon, az) ? 0.25 : 1
      const i = (y * S + x) * 4
      img.data[i] = col[0] * k; img.data[i + 1] = col[1] * k; img.data[i + 2] = col[2] * k; img.data[i + 3] = 255
    }
    g.putImageData(img, 0, 0)
  }, [sky, loc.horizon, C, mode])
  const pt = (az: number, alt: number) => { const r = ((90 - alt) / 90) * R, a = (az * Math.PI) / 180; return [C + r * Math.sin(a), C - r * Math.cos(a)] }
  const ring = (alt: number) => ((90 - alt) / 90) * R
  const domeLine = Array.from({ length: 73 }, (_, i) => { const az = i * 5, a0 = sky.domeAlt[Math.floor(az / 10) % 36], a1 = sky.domeAlt[(Math.floor(az / 10) + 1) % 36], f = (az % 10) / 10; return pt(az, a0 * (1 - f) + a1 * f).join(',') }).join(' ')
  return (
    <div className="sdome">
      <canvas ref={ref} width={S} height={S} />
      <svg viewBox={`0 0 ${S} ${S}`}>
        {[30, 60].map((a) => <circle key={a} cx={C} cy={C} r={ring(a)} className="sring" />)}
        <circle cx={C} cy={C} r={ring(minAlt)} className="smin" />
        <polyline points={domeLine} className="sdl" />
        {[['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([l, az]) => { const [x, y] = pt(+az, -7); return <text key={l} x={x} y={y} className="scmp">{l}</text> })}
        {[30, 60].map((a) => <text key={a} x={C + 3} y={C - ring(a) + 11} className="salt">{a}°</text>)}
      </svg>
    </div>
  )
}

const validTz = (tz: string) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true } catch { return false } }

/** Everything stored about the active site, editable in place. */
function SiteDetails({ loc, store }: { loc: Location; store: Store }) {
  const patch = (p: Partial<Location>) => store.saveLocation({ ...loc, ...p })
  const isHome = store.homeId === loc.id
  const [busy, setBusy] = useState(false)
  const coords = (lat: number, lon: number) => patch({ lat, lon, tz: tzFromCoords(lat, lon) ?? loc.tz })
  return (
    <section className="card sdet">
      <div className="ch wrap"><h3>Site details</h3><span className="sp" />
        <button className={isHome ? 'shome on' : 'shome'} onClick={() => store.setHome(isHome ? undefined : loc.id)} title="The app opens on your home site">{isHome ? '★ Home site' : '☆ Make home'}</button></div>
      <label className="f"><span>Name</span><input value={loc.name} onChange={(e) => patch({ name: e.target.value })} /></label>
      <label className="f"><span>Latitude °N</span><input type="number" step="0.0001" value={loc.lat} onChange={(e) => coords(+e.target.value, loc.lon)} /></label>
      <label className="f"><span>Longitude °E</span><input type="number" step="0.0001" value={loc.lon} onChange={(e) => coords(loc.lat, +e.target.value)} /></label>
      <label className="f el"><span>Elevation m</span><input type="number" value={loc.elevation} onChange={(e) => patch({ elevation: +e.target.value })} />
        <button className="gx" disabled={busy} title="Look up the ground height here" onClick={async () => { setBusy(true); const e = await elevationAt(loc.lat, loc.lon); setBusy(false); if (e != null) patch({ elevation: e }) }}>↻</button></label>
      <label className="f"><span>Time zone</span><input value={loc.tz ?? tzOf(loc)} onChange={(e) => patch({ tz: e.target.value })} /></label>
      {loc.tz && !validTz(loc.tz) && <div className="row wrap"><small className="gt warn">“{loc.tz}” is not a time zone (e.g. Europe/Amsterdam).</small>
        {tzFromCoords(loc.lat, loc.lon) && <button onClick={() => patch({ tz: tzFromCoords(loc.lat, loc.lon) })}>Use {tzFromCoords(loc.lat, loc.lon)}</button>}</div>}
      <label className="f"><span>Typical seeing</span>
        <select value={loc.seeing ?? 3} onChange={(e) => patch({ seeing: +e.target.value })}>{SEEING.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}</select></label>
      <label className="f"><span>Sky (Bortle)</span>
        <select value={loc.bortle ?? ''} onChange={(e) => patch({ bortle: e.target.value ? +e.target.value : undefined })}>
          <option value="">Not set (assume {DEFAULT_BORTLE})</option>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((b) => <option key={b} value={b}>Bortle {b}</option>)}</select></label>
      <details className="shz"><summary className="note">Horizon profile ({loc.horizon.length ? `${loc.horizon.length} points` : 'flat'}) — trees, buildings, hills</summary>
        <HorizonEditor points={loc.horizon} onChange={(horizon) => patch({ horizon })} /></details>
      <div className="row wrap">
        <button disabled={store.locations.length < 2} onClick={() => confirm(`Delete ${loc.name}? Its horizon and settings go with it.`) && store.deleteLocation(loc.id)}>🗑 Delete site</button>
      </div>
    </section>
  )
}

/** Adds a site: ground height from Open-Meteo and sky darkness from the atlas are filled in. */
async function makeSite(name: string, lat: number, lon: number): Promise<Location> {
  const [ratio, elevation] = await Promise.all([lpRatio(lat, lon).catch(() => null), elevationAt(lat, lon)])
  return { id: crypto.randomUUID(), name, lat: +lat.toFixed(4), lon: +lon.toFixed(4), elevation: elevation ?? 0, horizon: [], seeing: 3, tz: tzFromCoords(lat, lon), bortle: ratio != null ? Math.round(bortleOf(sqmOf(ratio))) : undefined }
}

export default function SiteView({ store }: { store: Store }) {
  const loc = store.active
  const minAlt = store.settings.minAlt
  const [sky, setSky] = useState<SiteSky | null | 'loading'>('loading')
  const [names, setNames] = useState<Record<string, string>>({})
  const [probe, setProbe] = useState<{ lat: number; lon: number; ratio: number | null } | null>(null)
  const [opacity, setOpacity] = useState(() => { try { return +(localStorage.getItem(OPACITY_KEY) ?? 0.55) } catch { return 0.55 } })
  const [others, setOthers] = useState<Record<string, number | null>>({})
  const [mode, setMode] = useState<'atlas' | 'contrast'>(() => { try { return localStorage.getItem(MODE_KEY) === 'atlas' ? 'atlas' : 'contrast' } catch { return 'contrast' } })
  const pickMode = (m: 'atlas' | 'contrast') => { setMode(m); try { localStorage.setItem(MODE_KEY, m) } catch { /* ignore */ } }

  useEffect(() => {
    let live = true
    setSky('loading'); setNames({})
    analyseSite(loc.lat, loc.lon).then(async (s) => {
      if (!live) return
      setSky(s)
      for (const d of s?.domes ?? []) {
        const n = await placeName(d.lat, d.lon)
        if (!live) return
        if (n) setNames((m) => ({ ...m, [`${d.lat},${d.lon}`]: n }))
      }
    }).catch(() => live && setSky(null))
    return () => { live = false }
  }, [loc.lat, loc.lon])

  useEffect(() => {
    let live = true
    Promise.all(store.locations.map(async (l) => [l.id, await lpRatio(l.lat, l.lon).catch(() => null)] as const)).then((r) => live && setOthers(Object.fromEntries(r)))
    return () => { live = false }
  }, [store.locations])

  // the map: dark base, the atlas on top, the site, its domes and a probe point
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const lp = useRef<L.TileLayer | null>(null)
  const marks = useRef<L.LayerGroup | null>(null)
  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([loc.lat, loc.lon], 10)
    const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_'
    L.tileLayer(`${esri}Base/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16, attribution: 'Base map © Esri, HERE, Garmin, © OpenStreetMap contributors' }).addTo(m)
    lp.current = L.tileLayer(LP_TILES, { minZoom: 2, maxNativeZoom: 8, maxZoom: 18, tileSize: 1024, zoomOffset: -2, opacity, attribution: `<a href="https://djlorenz.github.io/astronomy/lp/">${LP_CREDIT}</a>` }).addTo(m)
    // place names above the atlas colours
    m.createPane('labels').style.zIndex = '450'
    L.tileLayer(`${esri}Reference/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16, pane: 'labels' }).addTo(m)
    marks.current = L.layerGroup().addTo(m)
    m.on('click', async (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng
      setProbe({ lat, lon: lng, ratio: null })
      const r = await lpRatio(lat, lng).catch(() => null)
      setProbe({ lat, lon: lng, ratio: r })
    })
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current)
    return () => { ro.disconnect(); m.remove(); map.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { map.current?.setView([loc.lat, loc.lon], map.current.getZoom()); setProbe(null) }, [loc.lat, loc.lon])
  useEffect(() => { lp.current?.setOpacity(opacity); try { localStorage.setItem(OPACITY_KEY, String(opacity)) } catch { /* ignore */ } }, [opacity])
  useEffect(() => {
    const g = marks.current
    if (!g) return
    g.clearLayers()
    const s = sky !== 'loading' ? sky : null
    // a wedge per 10° that has a dome above the planning minimum, as long as the dome is high
    if (s) {
      const kmLat = 1 / 111.2, kmLon = 1 / (111.2 * Math.cos((loc.lat * Math.PI) / 180))
      s.domeAlt.forEach((alt, i) => {
        if (alt < 5) return
        const len = 4 + alt * 0.6 // km
        const p = (az: number, d: number): L.LatLngTuple => [loc.lat + d * kmLat * Math.cos((az * Math.PI) / 180), loc.lon + d * kmLon * Math.sin((az * Math.PI) / 180)]
        L.polygon([p(0, 0), p(i * 10 - 5, len), p(i * 10, len * 1.02), p(i * 10 + 5, len)], { color: alt > minAlt ? '#fbbf24' : '#94a3b8', weight: 0, fillOpacity: alt > minAlt ? 0.35 : 0.15 })
          .bindTooltip(`Light dome ${compass(i * 10)} (${i * 10}°): up to ~${alt}° — ${alt > minAlt ? `above your ${minAlt}° minimum` : `below your ${minAlt}° minimum`}`, { sticky: true }).addTo(g)
      })
      for (const d of s.domes) L.circleMarker([d.lat, d.lon], { radius: 5, color: '#fbbf24', weight: 2, fillOpacity: 0 }).bindTooltip(`${names[`${d.lat},${d.lon}`] ?? 'Light source'} · ${Math.round(d.distKm)} km ${compass(d.az)}`).addTo(g)
    }
    L.circleMarker([loc.lat, loc.lon], { radius: 7, color: '#38bdf8', weight: 3, fillColor: '#0b0f17', fillOpacity: 1 }).bindTooltip(loc.name).addTo(g)
    if (probe) L.circleMarker([probe.lat, probe.lon], { radius: 6, color: '#f472b6', weight: 3, fillOpacity: 0 }).addTo(g)
  }, [sky, loc, probe, names, minAlt])

  const s = sky !== 'loading' ? sky : null
  const roundB = s ? Math.round(bortleOf(s.sqm)) : undefined
  const glowSet = !!loc.glow?.length
  const sameGlow = s && glowSet && loc.glow!.every((v, i) => v === s.domeAlt[i])
  const highDomes = s ? s.domes.map((d) => ({ ...d, alt: s.domeAlt[Math.round(d.az / 10) % 36] })) : []
  const above = s ? s.domeAlt.filter((a) => a > minAlt).length : 0
  const distKm = probe ? Math.hypot((probe.lat - loc.lat) * 111.2, (probe.lon - loc.lon) * 111.2 * Math.cos((loc.lat * Math.PI) / 180)) : 0
  const sorted = useMemo(() => [...store.locations].sort((a, b) => (others[b.id] == null ? -1 : others[a.id] == null ? 1 : others[a.id]! - others[b.id]!)), [store.locations, others])

  function moveSite() {
    if (!probe) return
    store.saveLocation({ ...loc, lat: +probe.lat.toFixed(4), lon: +probe.lon.toFixed(4), tz: tzFromCoords(probe.lat, probe.lon) ?? loc.tz, horizon: [], glow: undefined, bortle: probe.ratio != null ? Math.round(bortleOf(sqmOf(probe.ratio))) : loc.bortle })
  }
  async function addAt(lat: number, lon: number, suggested?: string) {
    const name = prompt('Name for the new site', suggested ?? (await placeName(lat, lon)) ?? 'New site')
    if (!name) return
    store.addLocation(await makeSite(name, lat, lon))
    setProbe(null); setHits(null); setQ('')
  }
  const newSite = () => probe && addAt(probe.lat, probe.lon)
  // add a site by place name or by where you are
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Place[] | null>(null)
  const [msg, setMsg] = useState('')
  async function search() {
    if (!q.trim()) return
    setMsg('Searching…'); setHits(null)
    try { const h = await searchPlaces(q.trim()); setHits(h); setMsg(h.length ? '' : 'Nothing found.') } catch (e) { setMsg(e instanceof Error ? e.message : 'Search failed') }
  }
  function mine() {
    if (!navigator.geolocation) return setMsg('This device cannot report its location.')
    setMsg('Finding you…')
    navigator.geolocation.getCurrentPosition((p) => { setMsg(''); void addAt(p.coords.latitude, p.coords.longitude) }, (e) => setMsg(e.message), { enableHighAccuracy: true, timeout: 15000 })
  }
  const home = store.locations.find((l) => l.id === store.homeId)
  const kmFrom = (a: Location, b: Location) => Math.hypot((a.lat - b.lat) * 111.2, (a.lon - b.lon) * 111.2 * Math.cos((a.lat * Math.PI) / 180))

  return (
    <div className="site">
      <div className="ch wrap"><h2 className="th">Site <small>light pollution · light domes</small></h2><span className="sp" />
        <select value={loc.id} onChange={(e) => store.setActive(e.target.value)}>{store.locations.map((l) => <option key={l.id} value={l.id}>{l.id === store.homeId ? '★ ' : ''}{l.name}</option>)}</select></div>

      <div className="sgrid">
        <section className="card smap">
          <div ref={el} className="smapel" />
          <div className="row wrap"><small className="note"><span className="sleg grey" /> light dome below your {minAlt}° minimum · <span className="sleg amber" /> dome above it (longer = higher) · <span className="sleg ring" /> town behind a dome · click the map to check any spot</small><span className="sp" />
            <label className="note">Atlas overlay <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(+e.target.value)} /></label></div>
        </section>

        <div className="scol">
          <section className="card">
            <h3>{loc.name} <small>{loc.lat.toFixed(4)}, {loc.lon.toFixed(4)}</small></h3>
            {sky === 'loading' ? <p className="note">Reading the light-pollution atlas…</p>
              : !s ? <p className="note">No atlas data here (it covers 65°S–75°N) or no connection.</p>
              : <>
                <Quality ratio={s.ratio} />
                {roundB !== loc.bortle && <div className="row wrap"><small className="note">Exposure estimates use {loc.bortle ? `Bortle ${loc.bortle}` : 'an assumed Bortle 5'} for this site.</small>
                  <button onClick={() => store.saveLocation({ ...loc, bortle: roundB })}>Use Bortle {roundB}</button></div>}
              </>}
          </section>

          {probe && (
            <section className="card sprobe">
              <div className="ch"><h3>Spot on the map <small>{probe.lat.toFixed(4)}, {probe.lon.toFixed(4)} · {distKm.toFixed(1)} km {compass((Math.atan2((probe.lon - loc.lon) * Math.cos((loc.lat * Math.PI) / 180), probe.lat - loc.lat) * 180) / Math.PI)} of {loc.name}</small></h3><span className="sp" /><button className="gx" onClick={() => setProbe(null)}>✕</button></div>
              {probe.ratio == null ? <p className="note">Reading…</p> : <>
                <Quality ratio={probe.ratio} compact />
                {s && <p className="note">{Math.abs(sqmOf(probe.ratio) - s.sqm) < 0.05 ? 'About the same sky as your site.'
                  : sqmOf(probe.ratio) > s.sqm ? <><b className="gt ok">{(sqmOf(probe.ratio) - s.sqm).toFixed(2)} mag darker</b>: the sky background is {Math.round((1 - 10 ** (-0.4 * (sqmOf(probe.ratio) - s.sqm))) * 100)}% fainter, so unfiltered exposures get there up to ~{(10 ** (0.4 * (sqmOf(probe.ratio) - s.sqm))).toFixed(1)}× sooner.</>
                  : <><b className="gt bad">{(s.sqm - sqmOf(probe.ratio)).toFixed(2)} mag brighter</b> than your site.</>}</p>}
                <div className="row wrap"><button onClick={newSite}>+ Save as new site</button><button onClick={moveSite}>Move {loc.name} here</button></div>
              </>}
            </section>
          )}
        </div>
      </div>

      {s && (
        <div className="sgrid">
          <section className="card">
            <div className="ch wrap"><h3>Light domes <small>where to stay higher</small></h3><span className="sp" />
              <span className="ptabs sseg">{(['contrast', 'atlas'] as const).map((m) => <button key={m} className={mode === m ? 'on' : ''} onClick={() => pickMode(m)}>{m === 'contrast' ? 'Local contrast' : 'Atlas scale'}</button>)}</span></div>
            <DomeChart sky={s} loc={loc} minAlt={minAlt} mode={mode} />
            <div className="slegend"><i style={{ background: mode === 'contrast' ? 'linear-gradient(90deg,#0b1a3a,#1d4ed8 7.5%,#16a34a 22.5%,#facc15 50%,#fff7d6)' : 'linear-gradient(90deg,#000,#142f72,#1fa12a,#b8a625,#fd9650,#fb5a49,#a0a0a0,#f2f2f2,#fff3b0)' }} />
              <small>{mode === 'contrast' ? <><span>no dome</span><span>+0.45 dome edge</span><span>+1</span><span>+2 mag brighter</span></> : <><span>22 (natural)</span><span>20</span><span>18</span><span>16 mag/″²</span></>}</small></div>
            <p className="note fine">Laid out like the map: north up, east right, horizon on the rim, straight up in the middle. {mode === 'contrast' ? 'Colour: how much the light domes add to the sky at that height.' : 'Colours: total sky brightness on the atlas scale (the sky also brightens towards the horizon on its own).'} Dashed blue circle: your {minAlt}° planning minimum; amber line: how high the light domes reach; shaded: your horizon profile.</p>
          </section>
          <section className="card">
            <h3>Directions</h3>
            {highDomes.length === 0 ? <p className="note">No town nearby stands out: the sky is about evenly lit all round. Image wherever the target is highest.</p> : (
              <ul className="sdirs">
                {highDomes.map((d) => (
                  <li key={`${d.lat},${d.lon}`}>
                    <b>{compass(d.az)}</b><span>{Math.round(d.az)}°</span>
                    <span>{names[`${d.lat},${d.lon}`] ?? 'Light source'} · {Math.round(d.distKm)} km</span>
                    <em className={d.alt > minAlt ? 'gt warn' : 'note'}>{d.alt > minAlt ? `keep above ~${d.alt}°` : d.alt > 0 ? `dome to ~${d.alt}°, below your ${minAlt}°` : 'faint'}</em>
                  </li>
                ))}
              </ul>
            )}
            <p className="note">{above === 0 ? `Your ${minAlt}° minimum already clears every light dome here.` : <>Domes reach above your {minAlt}° minimum over about {above * 10}° of the horizon; the {minAlt}° circle is enough elsewhere.</>}</p>
            <div className="row wrap">
              {!sameGlow && <button onClick={() => store.saveLocation({ ...loc, glow: s.domeAlt })} title="Targets count as usable only above the light domes (in addition to the horizon and minimum altitude)">{glowSet ? '↻ Update planning limits' : 'Use domes as planning limits'}</button>}
              {glowSet && <button onClick={() => store.saveLocation({ ...loc, glow: undefined })}>Stop using domes</button>}
              {glowSet && <small className="note">{sameGlow ? '✓ Tonight, the planner and the altitude charts' : 'Saved limits differ from this reading'} keep targets above the domes.</small>}
            </div>
            <p className="note fine">A rough model: towns brighter than your site count by their excess brightness and distance (glow ∝ d^−2.5) and are scaled to your site’s own sky glow; a nearby town’s dome stands higher than a distant city’s. A dome counts up to where it adds {Math.round(DOME_LEVEL * 100)}% to the sky behind it (≈ +{(2.5 * Math.log10(1 + DOME_LEVEL)).toFixed(2)} mag). Terrain, trees, local lights and haze are not included, and on hazy nights domes reach higher. Town names: © OpenStreetMap contributors.</p>
          </section>
        </div>
      )}

      <div className="sgrid">
        <section className="card">
          <h3>Your sites</h3>
          <table className="ssites"><thead><tr><th /><th>Site</th><th>SQM</th><th>Bortle ≈</th><th>Set</th><th>{home ? `From ${home.name}` : ''}</th></tr></thead><tbody>
            {sorted.map((l) => {
              const r = others[l.id], isHome = l.id === store.homeId
              return (
                <tr key={l.id} className={l.id === loc.id ? 'on' : ''} onClick={() => store.setActive(l.id)}>
                  <td><button className={`sstar ${isHome ? 'on' : ''}`} title={isHome ? 'Home site (the app opens here)' : 'Make this your home site'} onClick={(e) => { e.stopPropagation(); store.setHome(isHome ? undefined : l.id) }}>{isHome ? '★' : '☆'}</button></td>
                  <td>{l.name}</td>
                  <td>{r == null ? '–' : <><span className="szone" style={{ background: zoneOf(r).color }} /> {sqmOf(r).toFixed(2)}</>}</td>
                  <td>{r == null ? '–' : bortleOf(sqmOf(r)).toFixed(1)}</td><td>{l.bortle ?? '–'}</td>
                  <td>{home && !isHome ? `${Math.round(kmFrom(home, l))} km` : ''}</td>
                </tr>
              )
            })}
          </tbody></table>
          {!home && <p className="note">Mark your home site with ☆: the app opens there, whichever site you looked at last.</p>}
          <h3 className="sadd">Add a site</h3>
          <div className="row">
            <input placeholder="Town, park, address…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
            <button onClick={search}>Search</button><button onClick={mine} title="Add the place you are now">📍 Here</button>
          </div>
          {msg && <p className="note">{msg}</p>}
          {hits && hits.length > 0 && <ul className="shits">{hits.map((h) => <li key={`${h.lat},${h.lon}`} onClick={() => addAt(h.lat, h.lon, h.name)}><b>{h.name}</b> <small>{h.detail}</small></li>)}</ul>}
          <p className="note fine">Or click the map and choose “Save as new site”. Elevation, time zone and sky darkness are filled in for you. Place search: © OpenStreetMap contributors.</p>
        </section>
        <SiteDetails loc={loc} store={store} />
      </div>
      <p className="note fine">Sky brightness: <a href="https://djlorenz.github.io/astronomy/lp/" target="_blank" rel="noreferrer">{LP_CREDIT}</a>. Zenith values, moonless and clear; real nights vary with haze, snow and the time of night.</p>
    </div>
  )
}
