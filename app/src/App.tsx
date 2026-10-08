import { useEffect, useMemo, useRef, useState } from 'react'
import A from 'aladin-lite'
import { CATALOGS, catalogTag, customObject, isCustom, loadCatalog, searchCatalog, sexa, type CatObject, type CustomTarget } from './lib/catalog'
import { PRESETS, compute, framingFit, mosaicPanels, rectCorners, sessionCrop, type Optics } from './lib/optics'
import { SURVEYS, defaultSurvey } from './lib/surveys'
import * as Astronomy from 'astronomy-engine'
import { lstHours, parallacticAngle, parallacticFromLst, sampleNight, separation, targetAltAz, type Location } from './lib/astro'
import { useStore, type Status } from './lib/store'
import { clockIn, localNow, tzFromCoords, tzOf, zonedEpoch } from './lib/tz'
import { useAuth } from './lib/auth'
import Account from './components/Account'
import HorizonEditor from './components/HorizonEditor'
import AltitudeChart from './components/AltitudeChart'
import Planner from './components/Planner'
import TargetInfo from './components/TargetInfo'

const SEEING = [
  { v: 1.5, l: '1.5″ — Excellent' }, { v: 2, l: '2″ — Good' }, { v: 3, l: '3″ — Average backyard' },
  { v: 4, l: '4″ — Poor' }, { v: 5, l: '5″ — Bad' },
]

const nameOf = (o: CatObject) => (isCustom(o.id) ? o.names[0] : o.m ?? o.id)
const LOOK_KEY = 'astroplanner.look'
const NEUTRAL = { brightness: 0, contrast: 0, saturation: 0, gamma: 1 }
type Look = typeof NEUTRAL
const loadLook = (): Look => { try { return { ...NEUTRAL, ...JSON.parse(localStorage.getItem(LOOK_KEY) ?? '{}') } } catch { return NEUTRAL } }
/** Night + minutes after 17:00 for the current moment; by day, tonight at 22:00. */
function nightNow(tz: string) {
  const { date, minutes } = localNow(tz)
  const [y, m, d] = date.split('-').map(Number)
  const ymd = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
  if (minutes >= 17 * 60) return { night: date, tmin: minutes - 17 * 60 }
  if (minutes < 8 * 60) return { night: ymd(new Date(y, m - 1, d - 1)), tmin: minutes + 7 * 60 }
  return { night: date, tmin: 5 * 60 }
}
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
  const [look, setLook] = useState<Look>(loadLook)
  const [overlayId, setOverlayId] = useState('none')
  const [opacity, setOpacity] = useState(0.4)
  const [mosaic, setMosaic] = useState<{ cols: number; rows: number }>({ cols: 1, rows: 1 })
  const [frame, setFrame] = useState<{ ra: number; dec: number }>({ ra: 83.82, dec: -5.39 })
  const [frameSel, setFrameSel] = useState(false)
  const [plan, setPlan] = useState(false)
  const [sess, setSess] = useState<[number, number] | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; ra: number; dec: number } | null>(null)
  const [toast, setToast] = useState('')
  const [coordIn, setCoordIn] = useState('')
  const [ready, setReady] = useState(false)
  const auth = useAuth()
  const store = useStore(auth.user?.id ?? null)
  const loc = store.active
  // the moment being viewed: a night (starting 17:00 site time) and minutes into it; defaults to right now / tonight at 22:00
  const [{ night, tmin }, setMoment] = useState(() => nightNow(tzOf(loc)))
  const setNight = (n: string) => setMoment((m) => ({ ...m, night: n }))
  const setTmin = (t: number) => setMoment((m) => ({ ...m, tmin: t }))
  const [mount, setMount] = useState<'altaz' | 'eq'>(() => { try { return localStorage.getItem('astroplanner.mount') === 'eq' ? 'eq' : 'altaz' } catch { return 'altaz' } })
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

  const base = useMemo(() => {
    const [y, m, d] = night.split('-').map(Number)
    return zonedEpoch(tzOf(loc), y, m, d, 17)
  }, [night, loc])
  const when = useMemo(() => new Date(base + tmin * 60000), [base, tmin])
  // alt-az: the sensor keeps the horizon level, so the frame's sky angle is the parallactic angle at that moment; EQ: the manual rotation
  const pa = mount === 'altaz' ? parallacticAngle(loc, frame.ra, frame.dec, when) : rotation
  const at = useMemo(() => targetAltAz(loc, target.ra, target.dec, when), [loc, target.ra, target.dec, when])
  // session plan (alt-az): the frame turned to every moment of the session, and the crop that survives them all
  const usableRange = useMemo<[number, number] | null>(() => {
    const first = samples.findIndex((x) => x.usable)
    if (first < 0) return null
    return [first * 10, samples.findLastIndex((x) => x.usable) * 10]
  }, [samples])
  const range: [number, number] = sess ?? usableRange ?? [tmin, tmin]
  const session = useMemo(() => {
    if (mount !== 'altaz') return null
    const lo = Math.min(...range), hi = Math.max(...range)
    const mins: number[] = []
    for (let m = lo; m <= hi; m += 10) mins.push(m)
    const angles = mins.map((m) => parallacticFromLst(loc.lat, lstHours(loc, new Date(base + m * 60000)), frame.ra, frame.dec))
    const ghostIdx = [...new Set(Array.from({ length: Math.min(8, mins.length) }, (_, i) => Math.round((i * (mins.length - 1)) / Math.max(1, Math.min(8, mins.length) - 1))))]
    const crop = mosaic.cols * mosaic.rows === 1 ? sessionCrop(res.fovW, res.fovH, angles) : null
    return { lo, hi, ghosts: ghostIdx.map((i) => ({ min: mins[i], angle: angles[i] })), crop, angles }
  }, [mount, range[0], range[1], loc, base, frame.ra, frame.dec, mosaic.cols, mosaic.rows, res.fovW, res.fovH]) // eslint-disable-line react-hooks/exhaustive-deps
  const sweep = useMemo(() => {
    const u = samples.filter((x) => x.usable)
    if (!u.length) return null
    const q = (t: Date) => parallacticAngle(loc, frame.ra, frame.dec, t)
    return { from: q(u[0].t), to: q(u[u.length - 1].t), peak: Math.max(...u.map((x) => x.alt)) }
  }, [samples, loc, frame.ra, frame.dec])

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

  // brightness / contrast / saturation / gamma of the background survey (replaces Aladin's right-drag adjustment)
  useEffect(() => {
    if (!ready) return
    const layer = aladin.current.getBaseImageLayer?.()
    layer?.setBrightness?.(look.brightness); layer?.setContrast?.(look.contrast)
    layer?.setSaturation?.(look.saturation); layer?.setGamma?.(look.gamma)
    try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)) } catch { /* ignore */ }
  }, [ready, survey, look])

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
    if (plan && session) {
      const g = session.ghosts
      g.forEach((x, i) => {
        const color = `hsl(${Math.round(270 - (g.length > 1 ? (i / (g.length - 1)) * 240 : 0))} 80% 65%)`
        for (const corners of mosaicPanels(frame.ra, frame.dec, res.fovW, res.fovH, x.angle, mosaic.cols, mosaic.rows)) overlay.current.add(A.polygon(corners, { color, lineWidth: 1 }))
      })
      if (session.crop) overlay.current.add(A.polygon(rectCorners(frame.ra, frame.dec, session.crop.w, session.crop.h, session.crop.ref), { color: '#4ade80', lineWidth: 3 }))
    }
    for (const corners of mosaicPanels(frame.ra, frame.dec, res.fovW, res.fovH, pa, mosaic.cols, mosaic.rows)) overlay.current.add(A.polygon(corners, { color: frameSel ? '#fbbf24' : '#38bdf8', lineWidth: frameSel ? 3 : 2 }))
  }, [ready, frame, res.fovW, res.fovH, pa, mosaic, frameSel, plan, session])

  // click the frame to select it, then drag it; unselected, the sky pans as usual
  const live = useRef({ frame, fovW: res.fovW, fovH: res.fovH, rotation: pa, mosaic, sel: frameSel })
  useEffect(() => { live.current = { frame, fovW: res.fovW, fovH: res.fovH, rotation: pa, mosaic, sel: frameSel } })
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const local = (e: MouseEvent) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const }
    /** 'edge' within a few px of an outline (the line is thin, so it gets a generous target), 'in' inside a panel, else null. */
    const hit = (x: number, y: number): 'edge' | 'in' | null => {
      const L = live.current
      const EDGE = 8
      let result: 'edge' | 'in' | null = null
      try {
        for (const poly of mosaicPanels(L.frame.ra, L.frame.dec, L.fovW, L.fovH, L.rotation, L.mosaic.cols, L.mosaic.rows)) {
          const pts: number[][] = poly.map(([ra, dec]) => aladin.current.world2pix(ra, dec))
          if (pts.some((p) => !p)) continue
          let inPoly = false
          for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const [xi, yi] = pts[i], [xj, yj] = pts[j]
            if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inPoly = !inPoly
            const dx = xj - xi, dy = yj - yi
            const t = Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / (dx * dx + dy * dy || 1)))
            if (Math.hypot(x - (xi + t * dx), y - (yi + t * dy)) <= EDGE) return 'edge'
          }
          if (inPoly) result = 'in'
        }
      } catch { return null }
      return result
    }
    let down: { x: number; y: number } | null = null
    let grab: { dx: number; dy: number } | null = null
    let moved = false
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const [x, y] = local(e)
      down = { x, y }; moved = false
      const h = hit(x, y)
      // a selected frame drags from anywhere on it; grabbing the outline of an unselected one selects and drags it in one go
      if (h && (live.current.sel || h === 'edge')) {
        if (!live.current.sel) { live.current.sel = true; setFrameSel(true) }
        try {
          const c = aladin.current.world2pix(live.current.frame.ra, live.current.frame.dec)
          grab = { dx: x - c[0], dy: y - c[1] }
          el.classList.add('dragging')
          e.stopPropagation() // keep Aladin from panning the sky
        } catch { grab = null }
      }
    }
    // Aladin listens to mouse and touch events as well; block those for the duration of a frame drag
    const block = (e: Event) => { if (grab) e.stopPropagation() }
    const onMove = (e: PointerEvent) => {
      const [x, y] = local(e)
      if (down && Math.hypot(x - down.x, y - down.y) > 4) moved = true
      if (grab) {
        try {
          const w = aladin.current.pix2world(x - grab.dx, y - grab.dy)
          if (w) setFrame({ ra: w[0], dec: w[1] })
        } catch { /* cursor left the projected sky */ }
      } else if (!down) el.classList.toggle('overframe', hit(x, y) === 'edge' || (live.current.sel && hit(x, y) === 'in'))
    }
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !down) return
      const wasDrag = !!grab
      if (!moved && !wasDrag) { const [x, y] = local(e); setFrameSel(hit(x, y) !== null) }
      grab = null; down = null
      el.classList.remove('dragging')
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFrameSel(false)
    const stoppers = ['mousedown', 'touchstart', 'mousemove', 'touchmove'] as const
    el.addEventListener('pointerdown', onDown, true)
    for (const t of stoppers) el.addEventListener(t, block, true)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('pointerdown', onDown, true)
      for (const t of stoppers) el.removeEventListener(t, block, true)
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('keydown', onKey)
    }
  }, [])

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
      setRotation(saved.rotation); setMount(saved.mount ?? 'eq'); if (saved.tmin !== undefined) setTmin(saved.tmin); setSess(saved.sess ?? null); setMosaic({ cols: saved.cols, rows: saved.rows }); setSurvey(saved.survey)
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
      rotation: Math.round(pa * 10) / 10, mount, tmin, sess: sess ?? undefined, cols: mosaic.cols, rows: mosaic.rows, survey, ra: c.ra, dec: c.dec,
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
        <label className="f"><span>Mount</span>
          <select value={mount} onChange={(e) => { const m = e.target.value as 'altaz' | 'eq'; setMount(m); try { localStorage.setItem('astroplanner.mount', m) } catch { /* ignore */ } }}>
            <option value="altaz">Alt-az (field rotates)</option><option value="eq">Equatorial (fixed angle)</option></select>
        </label>
        <label className="f"><span>Rotation °</span>
          <input type="range" min={-180} max={180} disabled={mount === 'altaz'} value={Math.round(pa)} onChange={(e) => setRotation(+e.target.value)} /><em>{Math.round(pa)}°</em>
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
        {([['brightness', 'Brightness', -1, 1, 0.05], ['contrast', 'Contrast', -1, 1, 0.05], ['saturation', 'Saturation', -1, 1, 0.05], ['gamma', 'Gamma', 0.3, 3, 0.05]] as const).map(([k, l, min, max, step]) => (
          <label key={k} className="f"><span>{l}</span>
            <input type="range" min={min} max={max} step={step} value={look[k]} onChange={(e) => setLook({ ...look, [k]: +e.target.value })} onDoubleClick={() => setLook({ ...look, [k]: NEUTRAL[k] })} /><em>{look[k].toFixed(2)}</em></label>
        ))}
        {JSON.stringify(look) !== JSON.stringify(NEUTRAL) && <button onClick={() => setLook(NEUTRAL)}>Reset image adjustments</button>}
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
        <label className="f"><span>Time</span>
          <input type="range" min={0} max={900} step={10} value={tmin} onChange={(e) => setTmin(+e.target.value)} /><em>{clockIn(tzOf(loc), when.getTime())}</em></label>
        <div className="row"><button onClick={() => setMoment(nightNow(tzOf(loc)))}>Now</button>
          <small className="note">{target.label} at {Math.round(at.alt)}° alt, {Math.round(at.az)}° az</small></div>
        <AltitudeChart samples={samples} loc={loc} minAlt={minAlt} marker={tmin} onScrub={setTmin} />
        {mount === 'altaz' && (
          <p className="note">Alt-az field rotation: <b>{Math.round(pa)}°</b> now{sweep ? <> · sweeps {Math.round(sweep.from)}° → {Math.round(sweep.to)}° over the usable window{sweep.peak > 80 ? ' · ⚠ passes near the zenith, rotation is fast there' : ''}</> : ''}</p>
        )}
      </section>
      <section>
        <h3>Session plan</h3>
        {mount !== 'altaz' ? <p className="note">An equatorial mount keeps the field fixed: nothing to crop.</p> : (
          <>
            <label className="note"><input type="checkbox" checked={plan} onChange={(e) => setPlan(e.target.checked)} /> Show the frame over the session</label>
            <label className="f"><span>Start</span><input type="range" min={0} max={900} step={10} value={range[0]} onChange={(e) => setSess([+e.target.value, range[1]])} /><em>{clockIn(tzOf(loc), base + range[0] * 60000)}</em></label>
            <label className="f"><span>End</span><input type="range" min={0} max={900} step={10} value={range[1]} onChange={(e) => setSess([range[0], +e.target.value])} /><em>{clockIn(tzOf(loc), base + range[1] * 60000)}</em></label>
            <div className="row wrap">
              <button disabled={!sess} onClick={() => setSess(null)} title="Use the time the target is above the minimum altitude and the sun is below −12°">Use usable window</button>
              <button onClick={() => setSess([tmin, range[1] < tmin ? tmin : range[1]])} title="Start the session at the time shown on the Time slider">Start = now</button>
            </div>
            {session && (
              <p className="note">
                {Math.abs(range[1] - range[0]) / 60 >= 0.1 ? `${(Math.abs(range[1] - range[0]) / 60).toFixed(1)} h` : 'Instant'} · field turns <b>{Math.abs(Math.max(...session.angles) - Math.min(...session.angles)).toFixed(0)}°</b>
                {session.crop ? (
                  <> → crop to <b>{(session.crop.w * 60).toFixed(0)}′ × {(session.crop.h * 60).toFixed(0)}′</b> (keeps {Math.round(session.crop.scale * 100)}% of each side, {Math.round(session.crop.scale ** 2 * 100)}% of the area), tilted {session.crop.ref.toFixed(0)}° on the sky</>
                ) : <> · crop is worked out for single frames only</>}
              </p>
            )}
            {plan && <p className="note">Violet = start of session, orange = end; green = what every frame covers.</p>}
          </>
        )}
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
            <TargetInfo o={target.obj} />
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
      {frameSel && <div className="fhint">Frame selected — drag to move it · click elsewhere or Esc to release</div>}
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
