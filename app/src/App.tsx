import { useEffect, useMemo, useRef, useState } from 'react'
import A from 'aladin-lite'
import { CATALOGS, catalogTag, customObject, isCustom, loadCatalog, searchCatalog, sexa, type CatObject, type CustomTarget } from './lib/catalog'
import { PRESETS, compute, framingFit, mosaicPanels, type Optics } from './lib/optics'
import { SURVEYS, defaultSurvey } from './lib/surveys'
import * as Astronomy from 'astronomy-engine'
import { sampleNight, separation, type Location } from './lib/astro'
import { useStore, type Status } from './lib/store'
import { tzFromCoords, tzOf, todayIn } from './lib/tz'
import { useAuth } from './lib/auth'
import Account from './components/Account'
import HorizonEditor from './components/HorizonEditor'
import AltitudeChart from './components/AltitudeChart'
import Planner from './components/Planner'

const SEEING = [
  { v: 1.5, l: '1.5″ — Excellent' }, { v: 2, l: '2″ — Good' }, { v: 3, l: '3″ — Average backyard' },
  { v: 4, l: '4″ — Poor' }, { v: 5, l: '5″ — Bad' },
]

const nameOf = (o: CatObject) => (isCustom(o.id) ? o.names[0] : o.m ?? o.id)
const hips = (id: string) => SURVEYS.find((s) => s.id === id)!.hips

export default function App() {
  const viewRef = useRef<HTMLDivElement>(null)
  const aladin = useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
  const overlay = useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
  const [catalog, setCatalog] = useState<CatObject[]>([])
  const [query, setQuery] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [searchFocus, setSearchFocus] = useState(false)
  const [target, setTarget] = useState<{ ra: number; dec: number; label: string; obj?: CatObject }>({ ra: 83.82, dec: -5.39, label: 'M 42', })
  const [presetId, setPresetId] = useState('seestar-s50-pro')
  const [optics, setOptics] = useState<Optics>(PRESETS[0].optics)
  const [rotation, setRotation] = useState(0)
  const [survey, setSurvey] = useState('dss2')
  const [overlayId, setOverlayId] = useState('none')
  const [opacity, setOpacity] = useState(0.4)
  const [mosaic, setMosaic] = useState<{ cols: number; rows: number }>({ cols: 1, rows: 1 })
  const [frame, setFrame] = useState<{ ra: number; dec: number }>({ ra: 83.82, dec: -5.39 })
  const [menu, setMenu] = useState<{ x: number; y: number; ra: number; dec: number } | null>(null)
  const [toast, setToast] = useState('')
  const [coordIn, setCoordIn] = useState('')
  const [ready, setReady] = useState(false)
  const auth = useAuth()
  const store = useStore(auth.user?.id ?? null)
  const loc = store.active
  const [night, setNight] = useState(() => todayIn(tzOf(loc)))
  const minAlt = store.settings.minAlt
  const [view, setView] = useState<'sky' | 'planner'>('sky')
  const [hzOpen, setHzOpen] = useState(false)
  const [panel, setPanel] = useState<'left' | 'right' | null>(null)

  const seeing = loc.seeing ?? 3
  const wish = target.obj ? store.wishlist.find((w) => w.id === target.obj!.id) : undefined
  const res = useMemo(() => compute(optics, seeing), [optics, seeing])
  const fit = target.obj ? framingFit(target.obj.maj, target.obj.min, res.fovW, res.fovH) : null
  const hits = useMemo(() => searchCatalog(catalog, query, 12, catFilter), [catalog, query, catFilter])

  const samples = useMemo(() => {
    const [y, m, d] = night.split('-').map(Number)
    return sampleNight(loc, target.ra, target.dec, new Date(y, m - 1, d), 10, minAlt)
  }, [loc, target.ra, target.dec, night, minAlt])

  const patchLoc = (patch: Partial<Location>) => store.saveLocation({ ...loc, ...patch })
  function newLoc() {
    const name = prompt('Name for the new location?')
    if (name) store.saveLocation({ ...loc, id: crypto.randomUUID(), name, horizon: [] })
  }
  function here() {
    navigator.geolocation?.getCurrentPosition((p) => patchLoc({ lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4), tz: tzFromCoords(p.coords.latitude, p.coords.longitude) ?? loc.tz, elevation: Math.round(p.coords.altitude ?? loc.elevation) }))
  }

  useEffect(() => { loadCatalog().then(setCatalog) }, [])

  useEffect(() => {
    let dead = false
    A.init.then(() => {
      if (dead || !viewRef.current || aladin.current) return
      aladin.current = A.aladin(viewRef.current, {
        survey: hips('dss2'), target: '83.82 -5.39', fov: 3.5,
        showReticle: false, showCooGrid: false, showFullscreenControl: false, showSimbadPointerControl: false,
        showLayersControl: false, showGotoControl: false, showProjectionControl: false,
      })
      aladin.current.gotoRaDec(83.82, -5.39)
      aladin.current.setFoV(3.5)
      overlay.current = A.graphicOverlay({ color: '#38bdf8', lineWidth: 2 })
      aladin.current.addOverlay(overlay.current)
      setReady(true)
    })
    const ro = new ResizeObserver(() => aladin.current?.view?.fixLayoutDimensions?.())
    if (viewRef.current) ro.observe(viewRef.current)
    return () => { dead = true; ro.disconnect() }
  }, [])

  useEffect(() => { if (ready) aladin.current.setBaseImageLayer(hips(survey)) }, [ready, survey])

  useEffect(() => {
    if (!ready) return
    if (overlayId === 'none') aladin.current.removeImageLayer?.('overlay')
    else {
      const layer = aladin.current.setOverlayImageLayer(A.imageHiPS(hips(overlayId)), 'overlay')
      layer?.setOpacity?.(opacity)
    }
  }, [ready, overlayId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (ready && overlayId !== 'none') aladin.current.getOverlayImageLayer?.('overlay')?.setOpacity?.(opacity)
  }, [ready, opacity, overlayId])

  useEffect(() => {
    if (!ready) return
    overlay.current.removeAll()
    for (const corners of mosaicPanels(frame.ra, frame.dec, res.fovW, res.fovH, rotation, mosaic.cols, mosaic.rows)) overlay.current.add(A.polygon(corners))
  }, [ready, frame, res.fovW, res.fovH, rotation, mosaic])

  // right-click on the sky: offer to save the frame at that position
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const onMenu = (e: MouseEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      let w: [number, number] | undefined
      try { w = aladin.current?.pix2world?.(e.clientX - r.left, e.clientY - r.top) } catch { /* click outside the projected sky */ }
      if (w) setMenu({ x: e.clientX, y: e.clientY, ra: w[0], dec: w[1] })
    }
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    // Aladin treats right-button drags as brightness/contrast adjustment; our menu eats the button release, so keep it out of Aladin
    const noRightDrag = (e: Event) => { if ((e as MouseEvent).button === 2) e.stopPropagation() }
    const rightEvents = ['mousedown', 'pointerdown', 'mouseup', 'pointerup'] as const
    for (const t of rightEvents) el.addEventListener(t, noRightDrag, true)
    el.addEventListener('contextmenu', onMenu)
    el.addEventListener('wheel', close, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => { for (const t of rightEvents) el.removeEventListener(t, noRightDrag, true); el.removeEventListener('contextmenu', onMenu); el.removeEventListener('wheel', close); window.removeEventListener('keydown', onKey) }
  }, [])

  function goTo(t: typeof target, zoom = true, fid?: string) {
    setTarget(t)
    const fr = t.obj ? store.wishlist.find((w) => w.id === t.obj!.id)?.framings : undefined
    const saved = fr?.find((f) => f.id === fid) ?? fr?.[0]
    setFrame({ ra: saved?.ra ?? t.ra, dec: saved?.dec ?? t.dec })
    if (saved) {
      setRotation(saved.rotation); setMosaic({ cols: saved.cols, rows: saved.rows }); setSurvey(saved.survey)
      if (saved.optics) { setOptics(saved.optics); setPresetId(saved.presetId ?? 'custom') }
    } else {
      const f = t.obj ? framingFit(t.obj.maj, t.obj.min, res.fovW, res.fovH) : null
      setMosaic(f?.kind === 'mosaic' ? { cols: f.cols, rows: f.rows } : { cols: 1, rows: 1 })
      if (t.obj) { setSurvey(defaultSurvey(t.obj)); setRotation(0) }
    }
    aladin.current?.gotoRaDec(saved?.ra ?? t.ra, saved?.dec ?? t.dec)
    if (saved?.viewFov) aladin.current?.setFoV(saved.viewFov)
    else if (zoom) {
      const size = Math.max(res.fovW * 1.4, t.obj?.maj ? (t.obj.maj / 60) * 1.6 : 0)
      aladin.current?.setFoV(Math.min(Math.max(size, 0.5), 60))
    }
  }

  function show(o: CatObject, fid?: string) { setView('sky'); pick(o, fid) }

  function pick(o: CatObject, fid?: string) {
    setQuery(''); goTo({ ra: o.ra, dec: o.dec, label: nameOf(o), obj: o }, true, fid)
  }

  function goCoords() {
    const m = coordIn.trim().match(/^(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)$/)
    if (m) goTo({ ra: +m[1], dec: +m[2], label: `${m[1]} ${m[2]}` })
  }

  /** Catalog object a frame at (ra, dec) is about: the current target if it is in frame, else the most prominent nearby. */
  function objectAt(ra: number, dec: number): CatObject | undefined {
    const reach = Math.hypot(res.fovW * (1 + (mosaic.cols - 1) * 0.8), res.fovH * (1 + (mosaic.rows - 1) * 0.8)) / 2
    const near = catalog.map((o) => ({ o, d: separation(ra, dec, o.ra, o.dec) })).filter((x) => x.d <= reach)
    const cur = near.find((x) => x.o.id === target.obj?.id)
    if (cur) return cur.o
    const big = near.filter((x) => (x.o.maj ?? 0) >= 3 || (x.o.mag ?? 99) <= 10)
    return (big.length ? big : near).sort((a, b) => a.d - b.d)[0]?.o
  }

  /** Small JPEG of the sky view as currently shown (frame included), cropped to 16:9. */
  async function snapshot(): Promise<string | undefined> {
    try {
      const url: string = await Promise.race([
        aladin.current.getViewDataURL({ format: 'image/jpeg', logo: false }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
      ])
      const img = new Image()
      img.src = url
      await img.decode()
      const W = 480, H = 270
      const sw = Math.min(img.width, (img.height * 16) / 9), sh = (sw * 9) / 16
      const c = document.createElement('canvas')
      c.width = W; c.height = H
      c.getContext('2d')!.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, W, H)
      return c.toDataURL('image/jpeg', 0.72)
    } catch (e) { console.error('snapshot failed', e); return undefined }
  }

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500) }

  /**
   * Saves the target (if new) plus the current framing and a snapshot as a new framing, or over `replace`.
   * The frame is saved where it is (never moved by the click); `custom` forces a named custom field instead of the catalog object in frame.
   */
  async function saveFraming(status: Status, opts: { custom?: boolean; replace?: string } = {}) {
    setMenu(null)
    const { custom = false, replace } = opts
    const c = frame
    let obj = custom ? undefined : objectAt(c.ra, c.dec) ?? target.obj
    let customTarget: CustomTarget | undefined
    if (!obj) {
      // nothing catalogued in frame: name the field, suggesting constellation + nearest well-known object
      const con = Astronomy.Constellation(c.ra / 15, c.dec).name
      const near = catalog.filter((o) => o.m || o.names[0]).map((o) => ({ o, d: separation(c.ra, c.dec, o.ra, o.dec) })).sort((a, b) => a.d - b.d)[0]
      const hint = near && near.d < 15 ? ` (near ${near.o.names[0] ?? near.o.m})` : ''
      const name = prompt('Name for this field?', `${con} field${hint}`)?.trim()
      if (!name) return
      customTarget = { name, ra: c.ra, dec: c.dec, con }
      obj = customObject(`custom:${crypto.randomUUID()}`, customTarget)
    }
    if (obj.id !== target.obj?.id) setTarget({ ra: obj.ra, dec: obj.dec, label: nameOf(obj), obj })
    await new Promise((r) => setTimeout(r, 200)) // let the overlay redraw before the snapshot
    const data = {
      rotation, cols: mosaic.cols, rows: mosaic.rows, survey, ra: c.ra, dec: c.dec,
      viewFov: aladin.current.getFov?.()[0], optics, presetId,
    }
    store.addWish(obj.id, { status, custom: customTarget })
    const existing = store.wishlist.find((w) => w.id === obj.id)?.framings ?? []
    const fid = replace ?? crypto.randomUUID()
    if (replace) store.patchFraming(obj.id, fid, data)
    else store.addFraming(obj.id, { ...data, id: fid, name: `Framing ${existing.length + 1}`, created: new Date().toISOString().slice(0, 10) })
    // the snapshot follows once the canvas hands it over; a stalled render must not block the save
    snapshot().then((thumb) => thumb && store.patchFraming(obj.id, fid, { thumb }))
    flash(replace ? `${nameOf(obj)}: framing replaced` : `${nameOf(obj)} ${status === 'progress' ? 'added to the planner' : 'saved'} with a new framing`)
  }

  const setO = (k: keyof Optics) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setPresetId('custom'); setOptics({ ...optics, [k]: Number(e.target.value) })
  }
  const num = (k: keyof Optics, label: string, step = 'any') => (
    <label className="f"><span>{label}</span><input type="number" step={step} value={optics[k]} onChange={setO(k)} /></label>
  )

  const left = (
    <>
      <section>
        <h3>Navigate</h3>
        <label className="f"><span>Catalog</span>
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>{CATALOGS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        </label>
        <div className="search">
          <input placeholder={catFilter === 'all' ? 'M31, NGC 7000, Tulip…' : 'Search or browse…'} value={query}
            onChange={(e) => setQuery(e.target.value)} onFocus={() => setSearchFocus(true)} onBlur={() => setSearchFocus(false)} />
          {hits.length > 0 && (query.length >= 2 || searchFocus) && (
            <ul>{hits.map((o) => (
              <li key={o.id} onMouseDown={(e) => { e.preventDefault(); pick(o) }}>
                <b>{o.m ? `${o.m} · ${o.id}` : o.id}</b> <small>{o.names[0] ?? o.typeName}</small>
                <i className="ctag">{catalogTag(o)}</i>
              </li>
            ))}</ul>
          )}
        </div>
        <div className="chips">{['M31', 'M42', 'M45', 'M51', 'M81', 'M101', 'NGC 7000', 'NGC 6888'].map((q) => (
          <button key={q} onClick={() => { const o = searchCatalog(catalog, q, 1)[0]; if (o) pick(o) }}>{q}</button>
        ))}</div>
        <div className="row">
          <input placeholder="RA Dec in degrees" value={coordIn} onChange={(e) => setCoordIn(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && goCoords()} />
          <button onClick={goCoords}>Go</button>
        </div>
      </section>
      <section>
        <h3>Optics</h3>
        <label className="f"><span>Preset</span>
          <select value={presetId} onChange={(e) => { setPresetId(e.target.value); setOptics(PRESETS.find((p) => p.id === e.target.value)!.optics) }}>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        {num('apertureMm', 'Aperture mm')}{num('focalLengthMm', 'Focal length mm')}
        {num('sensorWmm', 'Sensor width mm')}{num('sensorHmm', 'Sensor height mm')}{num('pixelUm', 'Pixel µm')}
        <label className="f"><span>Binning</span>
          <select value={optics.binning} onChange={(e) => { setPresetId('custom'); setOptics({ ...optics, binning: +e.target.value }) }}>{[1, 2, 3, 4].map((b) => <option key={b} value={b}>{b}×</option>)}</select>
        </label>
        <label className="f"><span>Drizzle</span>
          <select value={optics.drizzle} onChange={(e) => { setPresetId('custom'); setOptics({ ...optics, drizzle: +e.target.value }) }}>{[1, 2, 3].map((b) => <option key={b} value={b}>{b}×</option>)}</select>
        </label>
        {num('reducer', 'Reducer / barlow ×')}
        <label className="f"><span>Rotation °</span>
          <input type="range" min={-90} max={90} value={rotation} onChange={(e) => setRotation(+e.target.value)} /><em>{rotation}°</em>
        </label>
      </section>
      <section>
        <h3>Location</h3>
        <label className="f"><span>Site</span>
          <select value={loc.id} onChange={(e) => store.setActive(e.target.value)}>{store.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        </label>
        <label className="f"><span>Name</span><input value={loc.name} onChange={(e) => patchLoc({ name: e.target.value })} /></label>
        <label className="f"><span>Latitude °N</span><input type="number" step="0.0001" value={loc.lat} onChange={(e) => patchLoc({ lat: +e.target.value, tz: tzFromCoords(+e.target.value, loc.lon) ?? loc.tz })} /></label>
        <label className="f"><span>Longitude °E</span><input type="number" step="0.0001" value={loc.lon} onChange={(e) => patchLoc({ lon: +e.target.value, tz: tzFromCoords(loc.lat, +e.target.value) ?? loc.tz })} /></label>
        <label className="f"><span>Time zone</span><input value={loc.tz ?? tzOf(loc)} onChange={(e) => patchLoc({ tz: e.target.value })} /></label>
        <label className="f"><span>Elevation m</span><input type="number" value={loc.elevation} onChange={(e) => patchLoc({ elevation: +e.target.value })} /></label>
        <div className="row">
          <button onClick={here}>📍 Here</button><button onClick={newLoc}>+ New</button>
          <button onClick={() => setHzOpen(true)}>Horizon{loc.horizon.length ? ` (${loc.horizon.length})` : ''}</button>
          {store.locations.length > 1 && <button onClick={() => confirm(`Delete ${loc.name}?`) && store.deleteLocation(loc.id)}>🗑</button>}
        </div>
      </section>
      <section>
        <h3>Survey</h3>
        <label className="f"><span>Background</span>
          <select value={survey} onChange={(e) => setSurvey(e.target.value)}>{SURVEYS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        </label>
        <small className="note">{SURVEYS.find((s) => s.id === survey)?.note}</small>
        <label className="f"><span>Overlay</span>
          <select value={overlayId} onChange={(e) => setOverlayId(e.target.value)}>
            <option value="none">None</option>{SURVEYS.filter((s) => s.id !== survey).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        {overlayId !== 'none' && (
          <label className="f"><span>Opacity</span><input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(+e.target.value)} /></label>
        )}
      </section>
    </>
  )

  const right = (
    <>
      <section>
        <h3>Results</h3>
        <dl>
          <dt>Effective focal length</dt><dd>{res.effectiveFl.toFixed(0)} mm <small>f/{res.fNumber.toFixed(1)}</small></dd>
          <dt>FOV (degrees)</dt><dd>{res.fovW.toFixed(2)}° × {res.fovH.toFixed(2)}°</dd>
          <dt>FOV (arcmin)</dt><dd>{(res.fovW * 60).toFixed(1)}′ × {(res.fovH * 60).toFixed(1)}′</dd>
          <dt>Capture scale</dt><dd>{res.scale.toFixed(2)} ″/px <small>{optics.binning}× bin</small></dd>
          <dt>Drizzled scale</dt><dd>{res.drizzledScale.toFixed(2)} ″/px <small>{optics.drizzle}× drizzle</small></dd>
          <dt>Dawes limit</dt><dd>{res.dawes.toFixed(2)} ″</dd>
        </dl>
        <label className="f"><span>Typical seeing</span>
          <select value={seeing} onChange={(e) => patchLoc({ seeing: +e.target.value })}>{SEEING.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</select>
        </label>
        <p className={`badge ${res.sampling}`}>
          {res.sampling === 'ok' ? 'Well sampled' : res.sampling === 'under' ? 'Undersampled' : 'Oversampled'}
          <small> — {res.scale.toFixed(2)}″/px vs ideal {res.idealMin.toFixed(2)}–{res.idealMax.toFixed(2)}″/px for {seeing}″ seeing</small>
        </p>
      </section>
      <section>
        <h3>Night altitude</h3>
        <label className="f"><span>Night starting</span><input type="date" value={night} onChange={(e) => setNight(e.target.value)} /></label>
        <label className="f"><span>Min altitude °</span><input type="number" min={0} max={80} value={minAlt} onChange={(e) => store.setSettings({ minAlt: +e.target.value })} /></label>
        <AltitudeChart samples={samples} loc={loc} minAlt={minAlt} />
      </section>
      <section>
        <h3>Target</h3>
        <p><b>{target.label}</b><br /><small>{sexa(target.ra, target.dec)}</small></p>
        {(
          <div className="row wrap">
            {wish && <span className="note">★ {wish.status === 'progress' ? 'In the planner' : 'On your wishlist'}</span>}
            {!wish && <button onClick={() => saveFraming('wishlist')}>☆ Add to wishlist</button>}
            {!wish && <button onClick={() => saveFraming('progress')}>＋ Add to planner</button>}
            {wish && <button onClick={() => saveFraming(wish.status)} title="Save the current frame position, rotation, mosaic and a snapshot as an additional framing">📷 Save as new framing</button>}
          </div>
        )}
        {wish?.framings?.map((f) => (
          <div key={f.id} className="fri">
            {f.thumb && <img className="thumb" src={f.thumb} alt={f.name} title="Load this framing" onClick={() => goTo(target, true, f.id)} />}
            <div className="row">
              <button className="lnk" onClick={() => goTo(target, true, f.id)}>{f.name}</button>
              <span className="sp" />
              <button title="Replace this framing with the current view" onClick={() => saveFraming(wish.status, { replace: f.id })}>↻ Replace</button>
              <button title="Rename" onClick={() => { const n = prompt('Name for this framing?', f.name)?.trim(); if (n) store.patchFraming(wish.id, f.id, { name: n }) }}>✎</button>
              <button title="Delete" onClick={() => confirm(`Delete ${f.name}?`) && store.removeFraming(wish.id, f.id)}>✕</button>
            </div>
          </div>
        ))}
        {target.obj && (
          <>
            <p><small>{target.obj.typeName}{target.obj.names[0] ? ` · ${target.obj.names[0]}` : ''} · {target.obj.con}
              {target.obj.mag != null ? ` · mag ${target.obj.mag}` : ''}
              {target.obj.maj ? ` · ${target.obj.maj}′${target.obj.min ? ` × ${target.obj.min}′` : ''}` : ''}</small></p>
            {fit && (
              <p className={`badge ${fit.kind}`}>
                {fit.kind === 'fits' && 'Fits in one frame'}
                {fit.kind === 'small' && 'Too small — only ' + Math.round(fit.ratio * 100) + '% of the frame'}
                {fit.kind === 'mosaic' && `Needs a mosaic: ${fit.cols} × ${fit.rows} panels`}
              </p>
            )}
            <div className="row wrap">
              <label className="f inl"><span>Mosaic</span>
                <input type="number" min={1} max={8} value={mosaic.cols} onChange={(e) => setMosaic({ ...mosaic, cols: Math.max(1, +e.target.value) })} />×
                <input type="number" min={1} max={8} value={mosaic.rows} onChange={(e) => setMosaic({ ...mosaic, rows: Math.max(1, +e.target.value) })} /></label>
            </div>
            {mosaic.cols * mosaic.rows > 1 && <p className="note">{mosaic.cols * mosaic.rows} panels, 20% overlap: {mosaic.cols * mosaic.rows}× the imaging time for the same depth.</p>}
          </>
        )}
      </section>
    </>
  )

  return (
    <div className={`app ${view === 'planner' ? 'pv' : ''}`}>
      <header>
        <b>Astroplanner</b>
        <span className="nav">
          <button className={view === 'sky' ? 'on' : ''} onClick={() => setView('sky')}>Sky</button>
          <button className={view === 'planner' ? 'on' : ''} onClick={() => setView('planner')}>Planner{store.wishlist.length ? ` (${store.wishlist.length})` : ''}</button>
        </span>
        <span className="tgt">{target.label} · {sexa(target.ra, target.dec)} · {res.fovW.toFixed(2)}°×{res.fovH.toFixed(2)}°</span>
        <Account auth={auth} status={store.syncStatus} />
        <span className="tabs">
          <button onClick={() => setPanel(panel === 'left' ? null : 'left')}>Setup</button>
          <button onClick={() => setPanel(panel === 'right' ? null : 'right')}>Results</button>
        </span>
      </header>
      {view === 'planner' && <main className="pmain"><Planner store={store} catalog={catalog} onShow={show} /></main>}
      <aside className={`l ${panel === 'left' ? 'open' : ''}`}>{left}</aside>
      <div className="view" ref={viewRef} />
      {menu && (() => {
        const o = objectAt(frame.ra, frame.dec) // saves use the frame where it is; only “Move frame here” follows the click
        return (
          <div className="ctx" style={{ left: Math.min(menu.x, window.innerWidth - 250), top: Math.min(menu.y, window.innerHeight - 150) }} onClick={(e) => e.stopPropagation()}>
            <small>{o ? `${o.m ?? o.id}${o.names[0] ? ` · ${o.names[0]}` : ''}` : 'No catalog object in frame — saves as a named field'}</small>
            <button onClick={() => { setFrame({ ra: menu.ra, dec: menu.dec }); setMenu(null) }}>⌖ Move frame here</button>
            {(() => {
              const w = o && store.wishlist.find((x) => x.id === o.id)
              return w ? (
                <>
                  <button onClick={() => saveFraming(w.status)}>＋ Save as new framing</button>
                  {w.framings?.map((f) => <button key={f.id} onClick={() => saveFraming(w.status, { replace: f.id })}>↻ Replace “{f.name}”</button>)}
                </>
              ) : (
                <>
                  <button onClick={() => saveFraming('wishlist')}>☆ Add to wishlist with this framing</button>
                  <button onClick={() => saveFraming('progress')}>＋ Add to planner with this framing</button>
                </>
              )
            })()}
            {o && <button onClick={() => saveFraming('wishlist', { custom: true })}>✎ Save as custom named field…</button>}
          </div>
        )
      })()}
      {menu && <div className="ctxbg" onMouseDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />}
      {toast && <div className="toast">{toast}</div>}
      <aside className={`r ${panel === 'right' ? 'open' : ''}`}>{right}</aside>
      {hzOpen && (
        <div className="modal" onClick={() => setHzOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <h2>Horizon — {loc.name}<button onClick={() => setHzOpen(false)}>Done</button></h2>
            <HorizonEditor points={loc.horizon} onChange={(horizon) => patchLoc({ horizon })} />
          </div>
        </div>
      )}
    </div>
  )
}
