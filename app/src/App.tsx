import { useEffect, useMemo, useRef, useState } from 'react'
import A from 'aladin-lite'
import { loadCatalog, searchCatalog, sexa, type CatObject } from './lib/catalog'
import { PRESETS, compute, framingFit, mosaicPanels, type Optics } from './lib/optics'
import { SURVEYS, defaultSurvey } from './lib/surveys'
import { sampleNight, type Location } from './lib/astro'
import { useStore } from './lib/store'
import HorizonEditor from './components/HorizonEditor'
import AltitudeChart from './components/AltitudeChart'
import Planner from './components/Planner'

const SEEING = [
  { v: 1.5, l: '1.5″ — Excellent' }, { v: 2, l: '2″ — Good' }, { v: 3, l: '3″ — Average backyard' },
  { v: 4, l: '4″ — Poor' }, { v: 5, l: '5″ — Bad' },
]

const hips = (id: string) => SURVEYS.find((s) => s.id === id)!.hips

export default function App() {
  const viewRef = useRef<HTMLDivElement>(null)
  const aladin = useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
  const overlay = useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
  const [catalog, setCatalog] = useState<CatObject[]>([])
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<{ ra: number; dec: number; label: string; obj?: CatObject }>({ ra: 83.82, dec: -5.39, label: 'M 42', })
  const [presetId, setPresetId] = useState('seestar-s50-pro')
  const [optics, setOptics] = useState<Optics>(PRESETS[0].optics)
  const [rotation, setRotation] = useState(0)
  const [seeing, setSeeing] = useState(3)
  const [survey, setSurvey] = useState('dss2')
  const [overlayId, setOverlayId] = useState('none')
  const [opacity, setOpacity] = useState(0.4)
  const [mosaic, setMosaic] = useState<{ cols: number; rows: number }>({ cols: 1, rows: 1 })
  const [coordIn, setCoordIn] = useState('')
  const [ready, setReady] = useState(false)
  const store = useStore()
  const loc = store.active
  const [night, setNight] = useState(() => new Date().toISOString().slice(0, 10))
  const minAlt = store.settings.minAlt
  const [view, setView] = useState<'sky' | 'planner'>('sky')
  const [hzOpen, setHzOpen] = useState(false)
  const [panel, setPanel] = useState<'left' | 'right' | null>(null)

  const res = useMemo(() => compute(optics, seeing), [optics, seeing])
  const fit = target.obj ? framingFit(target.obj.maj, target.obj.min, res.fovW, res.fovH) : null
  const hits = useMemo(() => searchCatalog(catalog, query), [catalog, query])

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
    navigator.geolocation?.getCurrentPosition((p) => patchLoc({ lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4), elevation: Math.round(p.coords.altitude ?? loc.elevation) }))
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
    for (const corners of mosaicPanels(target.ra, target.dec, res.fovW, res.fovH, rotation, mosaic.cols, mosaic.rows)) overlay.current.add(A.polygon(corners))
  }, [ready, target, res.fovW, res.fovH, rotation, mosaic])

  function goTo(t: typeof target, zoom = true) {
    setTarget(t)
    const f = t.obj ? framingFit(t.obj.maj, t.obj.min, res.fovW, res.fovH) : null
    setMosaic(f?.kind === 'mosaic' ? { cols: f.cols, rows: f.rows } : { cols: 1, rows: 1 })
    if (t.obj) setSurvey(defaultSurvey(t.obj))
    aladin.current?.gotoRaDec(t.ra, t.dec)
    if (zoom) {
      const size = Math.max(res.fovW * 1.4, t.obj?.maj ? (t.obj.maj / 60) * 1.6 : 0)
      aladin.current?.setFoV(Math.min(Math.max(size, 0.5), 60))
    }
  }

  function show(o: CatObject) { setView('sky'); pick(o) }

  function pick(o: CatObject) {
    setQuery(''); goTo({ ra: o.ra, dec: o.dec, label: o.m ?? o.id, obj: o })
  }

  function goCoords() {
    const m = coordIn.trim().match(/^(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)$/)
    if (m) goTo({ ra: +m[1], dec: +m[2], label: `${m[1]} ${m[2]}` })
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
        <div className="search">
          <input placeholder="M31, NGC 7000, Pacman…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {hits.length > 0 && (
            <ul>{hits.map((o) => (
              <li key={o.id} onClick={() => pick(o)}>
                <b>{o.m ? `${o.m} · ${o.id}` : o.id}</b> <small>{o.names[0] ?? o.typeName}</small>
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
        <label className="f"><span>Latitude °N</span><input type="number" step="0.0001" value={loc.lat} onChange={(e) => patchLoc({ lat: +e.target.value })} /></label>
        <label className="f"><span>Longitude °E</span><input type="number" step="0.0001" value={loc.lon} onChange={(e) => patchLoc({ lon: +e.target.value })} /></label>
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
          <select value={seeing} onChange={(e) => setSeeing(+e.target.value)}>{SEEING.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</select>
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
        {target.obj && (store.wishlist.some((w) => w.id === target.obj!.id)
          ? <p className="note">★ On your wishlist</p>
          : <button onClick={() => store.addWish(target.obj!.id)}>☆ Add to wishlist</button>)}
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
        <span className="tabs">
          <button onClick={() => setPanel(panel === 'left' ? null : 'left')}>Setup</button>
          <button onClick={() => setPanel(panel === 'right' ? null : 'right')}>Results</button>
        </span>
      </header>
      {view === 'planner' && <main className="pmain"><Planner store={store} catalog={catalog} onShow={show} /></main>}
      <aside className={`l ${panel === 'left' ? 'open' : ''}`}>{left}</aside>
      <div className="view" ref={viewRef} />
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
