import { useEffect, useMemo, useRef, useState } from 'react'
import A from 'aladin-lite'
import { CATALOGS, catalogTag, customObject, extraObject, extraOf, findBySlug, isCustom, loadCatalog, searchCatalog, sexa, slugOf, type CatObject, type CustomTarget } from './lib/catalog'
import { CAMERAS, findCamera, PRESETS, SCOPES, SEEING, compute, framingFit, mosaicPanels, rectCorners, sessionCrop, type Optics } from './lib/optics'
import { scopeName } from './components/FramingPreview'
import { SURVEYS, defaultSurvey } from './lib/surveys'
import * as Astronomy from 'astronomy-engine'
import { altAzToRaDec, glowAlt, horizonAlt, limitAlt, lstHours, parallacticAngle, parallacticFromLst, sampleNight, separation, targetAltAz, type Location } from './lib/astro'
import { useStore, type Status } from './lib/store'
import { clockIn, momentAt, nightNow, tzFromCoords, tzOf, zonedEpoch } from './lib/tz'
import { useAuth } from './lib/auth'
import { AccountButton } from './components/Account'
import HorizonEditor from './components/HorizonEditor'
import AltitudeChart from './components/AltitudeChart'
import Planner from './components/Planner'
import TargetInfo from './components/TargetInfo'
import TargetDetail from './components/TargetDetail'
import Tonight from './components/Tonight'
import PwaStatus from './components/PwaStatus'
import { useOnline } from './lib/online'
import Catalogue from './components/Catalogue'
import Comets from './components/Comets'
import Events from './components/Events'
import type { SkyEvent } from './lib/events'
import { cometObject, isComet, loadComets, loadSightings, loadedComet } from './lib/comets'
import DepthMap from './components/DepthMap'
import { DEFAULT_BORTLE } from './lib/exposure'
import { cropAtDepth } from './lib/depth'
import Observations from './components/Observations'
import Inspector from './components/Inspector'
import BestIso from './components/BestIso'
import BestGain from './components/BestGain'
import ImageReview from './components/ImageReview'
import SharedReview from './components/SharedReview'
import GearPlanner from './components/GearPlanner'
import SiteView from './components/SiteView'
import AccountHome from './components/AccountHome'
import MyGear from './components/MyGear'
import GuideComments from './components/GuideComments'
import { ACCOUNT, TOOLS, ToolsMenu, SiteSwitcher, TabBar } from './components/Nav'
import { Link, navigate, useRoute, withQuery } from './lib/router'
import ObservationForm, { type ObsPrefill } from './components/ObservationForm'
import { defaultPatch, gearNames, setupLabel } from './lib/gear'
import { analyseSite } from './lib/lightpollution'


type View = 'tonight' | 'sky' | 'targets' | 'browse' | 'comets' | 'events' | 'plan' | 'log' | 'gear' | 'sites' | 'inspector' | 'review' | 'shared' | 'iso' | 'gain' | 'account' | 'mygear' | 'comments'
const nameOf = (o: CatObject) => (isCustom(o.id) ? o.names[0] : o.m ?? o.id)
/** One-line summary for identifying an object on the sky: type, magnitude, size. */
const objFacts = (o: CatObject) => [o.typeName, o.mag != null && `${o.mag.toFixed(1)} mag`, o.maj != null && `${+o.maj.toFixed(1)}′${o.min != null && o.min !== o.maj ? `×${+o.min.toFixed(1)}′` : ''}`].filter(Boolean).join(' · ')
const LOOK_KEY = 'astroplanner.look'
const NEUTRAL = { brightness: 0, contrast: 0, saturation: 0, gamma: 1 }
type Look = typeof NEUTRAL
const loadLook = (): Look => { try { return { ...NEUTRAL, ...JSON.parse(localStorage.getItem(LOOK_KEY) ?? '{}') } } catch { return NEUTRAL } }
const hips = (id: string) => SURVEYS.find((s) => s.id === id)!.hips

export default function App() {
  const viewRef = useRef<HTMLDivElement>(null)
  const aladin = useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
  const overlay = useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
  const ground = useRef<any[]>([]) // eslint-disable-line @typescript-eslint/no-explicit-any
  const domes = useRef<any[]>([]) // eslint-disable-line @typescript-eslint/no-explicit-any
  const figures = useRef<any[]>([]) // eslint-disable-line @typescript-eslint/no-explicit-any
  const cometLayers = useRef<any[]>([]) // eslint-disable-line @typescript-eslint/no-explicit-any
  const solar = useRef<any[]>([]) // eslint-disable-line @typescript-eslint/no-explicit-any
  const cometMarks = useRef<{ ra: number; dec: number; t: number; mag?: number }[]>([]) // the daily dots on a comet's path, for hover tips
  const [catalog, setCatalog] = useState<CatObject[]>([])
  const [query, setQuery] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [searchFocus, setSearchFocus] = useState(false)
  const [target, setTarget] = useState<{ ra: number; dec: number; label: string; obj?: CatObject }>({ ra: 83.82, dec: -5.39, label: 'M 42', })
  const [presetId, setPresetId] = useState('seestar-s50-pro')
  const [blocked, setBlocked] = useState<'scope' | 'camera'>('camera') // which list an all-in-one locks
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
  const [obs, setObs] = useState<ObsPrefill | null>(null)
  const [sess, setSess] = useState<[number, number] | null>(null)
  const [depthMin, setDepthMin] = useState(100) // keep only the area covered by at least this % of the session's frames
  const [menu, setMenu] = useState<{ x: number; y: number; ra: number; dec: number } | null>(null)
  const [hover, setHover] = useState<{ o: CatObject; x: number; y: number } | null>(null) // object under the cursor
  const [picked, setPicked] = useState<{ o: CatObject; x: number; y: number } | null>(null) // object clicked on the sky
  const [pickedCon, setPickedCon] = useState<{ id: string; name: string; x: number; y: number } | null>(null) // constellation clicked on the sky
  const [markTip, setMarkTip] = useState<{ t: number; mag?: number; x: number; y: number } | null>(null) // a comet path dot under the cursor
  const [toast, setToast] = useState('')
  const [coordIn, setCoordIn] = useState('')
  const [ready, setReady] = useState(false)
  const auth = useAuth()
  const online = useOnline()
  const store = useStore(auth.user?.id ?? null)
  const loc = store.active
  // the moment being viewed: a night (starting 17:00 site time) and minutes into it; defaults to right now / tonight at 22:00
  const [{ night, tmin }, setMoment] = useState(() => nightNow(tzOf(loc)))
  const setNight = (n: string) => setMoment((m) => ({ ...m, night: n }))
  const setTmin = (t: number) => setMoment((m) => ({ ...m, tmin: t }))
  const [mount, setMount] = useState<'altaz' | 'eq'>(() => { try { return localStorage.getItem('astroplanner.mount') === 'eq' ? 'eq' : 'altaz' } catch { return 'altaz' } })
  const minAlt = store.settings.minAlt
  // the page comes from the URL: /tonight[/date], /sky[/target], /targets[/browse|comets|events], /plan, /log, /account[/gear|sites], /tools/{gear,inspector,review,iso[/camera],gain[/camera]}
  const route = useRoute()
  const [p0, p1] = route.path
  const view: View = p0 === 'sky' ? 'sky' : p0 === 'targets' ? (p1 === 'browse' ? 'browse' : p1 === 'comets' ? 'comets' : p1 === 'events' ? 'events' : 'targets') : p0 === 'plan' ? 'plan' : p0 === 'log' ? 'log' : p0 === 'r' && p1 ? 'shared'
    : p0 === 'account' ? (p1 === 'gear' ? 'mygear' : p1 === 'sites' ? 'sites' : p1 === 'comments' ? 'comments' : 'account') : p0 === 'tools' ? (p1 === 'inspector' ? 'inspector' : p1 === 'review' ? 'review' : p1 === 'iso' ? 'iso' : p1 === 'gain' ? 'gain' : 'gear') : 'tonight'
  const section = view === 'browse' || view === 'comets' || view === 'events' ? 'targets' : ['account', 'mygear', 'sites', 'comments'].includes(view) ? 'account' : ['gear', 'inspector', 'review', 'iso', 'gain'].includes(view) ? 'tools' : view
  // addresses from before the account pages (bookmarks, the installed app)
  useEffect(() => {
    if (p0 !== 'setup') return
    navigate(p1 === 'gear' ? '/tools/gear' : p1 === 'inspector' ? '/tools/inspector' : p1 === 'sites' ? '/account/sites' : '/account', { replace: true })
  }, [p0, p1])
  // the bare address opens on Tonight once there is something to plan, otherwise on the sky
  useEffect(() => { if (!p0) navigate(store.wishlist.some((w) => w.status !== 'done') ? '/tonight' : '/sky', { replace: true }) }, [p0]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (view !== 'sky') { setFrameSel(false); setMenu(null); setHover(null); setPicked(null); setPickedCon(null); setMarkTip(null) } }, [view])
  const skyPath = target.obj ? `/sky/${encodeURIComponent(slugOf(target.obj))}` : '/sky'
  const NAV: [string, string, string, string][] = [['tonight', '/tonight', 'Tonight', '☾'], ['sky', skyPath, 'Sky', '✦'], ['targets', '/targets', 'Targets', '☆'], ['plan', '/plan', 'Plan', '▦'], ['log', '/log', 'Log', '✎']]
  const goView = (v: 'sites') => navigate(`/account/${v}`)
  // custom fields are targets too (found by their id in URLs)
  const routed = useRef('') // the /sky/<target>?framing route last put on the sky
  const [cometsTick, setCometsTick] = useState(0) // bumps when the MPC list arrives for a comet linked directly
  const customs = useMemo(() => {
    const own = store.wishlist.flatMap((w) => { const o = extraObject(w); return o ? [o] : [] })
    // a comet opened from the comet list (or a shared link) before it is one of your targets
    const slugs = [route.query.get('target'), p0 === 'sky' ? p1 : null].filter((x): x is string => !!x && isComet(x) && !own.some((o) => o.id === x))
    return [...own, ...slugs.flatMap((id) => { const c = loadedComet(id); return c ? [cometObject(c)] : [] })]
  }, [store.wishlist, route.query, p0, p1, cometsTick]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const ids = [route.query.get('target'), p0 === 'sky' ? p1 : null].filter((x): x is string => !!x && isComet(x))
    if (ids.some((id) => !customs.some((o) => o.id === id))) Promise.all([loadComets(), loadSightings()]).then(() => setCometsTick((n) => n + 1)).catch(() => {})
  }, [route.query, p0, p1, customs])
  // target details open over any page as ?target=m31: back closes them and the link can be shared
  const detailSlug = route.query.get('target')
  const detail = useMemo(() => (detailSlug && catalog.length ? findBySlug(catalog, detailSlug, customs) ?? null : null), [detailSlug, catalog, customs])
  const setDetail = (o: CatObject | null) => {
    if (o) navigate(withQuery({ target: slugOf(o) }), { state: { overlay: true } })
    else if ((history.state as { overlay?: boolean } | null)?.overlay) history.back()
    else navigate(withQuery({ target: null }), { replace: true })
  }
  const [hzOpen, setHzOpen] = useState(false)
  const [showCon, setShowCon] = useState(() => { try { return localStorage.getItem('astroplanner.showConstellations') === '1' } catch { return false } })
  const [showHz, setShowHz] = useState(() => { try { return localStorage.getItem('astroplanner.showHorizon') !== '0' } catch { return true } })
  const [showDomes, setShowDomes] = useState(() => { try { return localStorage.getItem('astroplanner.showDomes') !== '0' } catch { return true } })
  // the light domes of the active site, estimated from the atlas (the saved profile, when there is one, is what planning uses)
  const [domeEst, setDomeEst] = useState<{ id: string; lat: number; lon: number; alt: number[] } | null>(null)
  const [panel, setPanel] = useState<'left' | 'right' | null>(null)

  const seeing = loc.seeing ?? 3
  // all-in-one units (Seestar, Dwarf…) appear in both lists; choosing one fills both and locks the list that was not used
  const AIO = PRESETS.filter((p) => p.id !== 'custom')
  const aio = AIO.find((p) => p.id === presetId)
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6
  const scopeSel = aio?.id ?? SCOPES.find((t) => near(t.apertureMm, optics.apertureMm) && near(t.focalLengthMm, optics.focalLengthMm))?.id ?? ''
  const cameraSel = aio?.id ?? findCamera(optics)?.id ?? ''
  function pickGear(side: 'scope' | 'camera', id: string) {
    const unit = AIO.find((p) => p.id === id)
    if (unit) { setPresetId(unit.id); setOptics(unit.optics); setBlocked(side === 'scope' ? 'camera' : 'scope'); return }
    setPresetId('custom') // leaving an all-in-one unlocks both lists; the other part keeps its current values until changed
    if (side === 'scope') {
      const t = SCOPES.find((x) => x.id === id)
      if (t) setOptics({ ...optics, apertureMm: t.apertureMm, focalLengthMm: t.focalLengthMm, reducer: 1 })
    } else {
      const c = CAMERAS.find((x) => x.id === id)
      if (c) setOptics({ ...optics, sensorWmm: c.sensorWmm, sensorHmm: c.sensorHmm, pixelUm: c.pixelUm, qe: c.qe, readNoise: c.readNoise, fullWell: c.fullWell, bits: c.bits })
    }
  }
  // the account's default telescope + camera; the Seestar S50 Pro until the user picks another
  const defaultScope = store.settings.scope ?? { presetId: PRESETS[0].id, optics: PRESETS[0].optics }
  const scopeIsDefault = presetId === defaultScope.presetId && JSON.stringify(optics) === JSON.stringify(defaultScope.optics)
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
    const crop = mosaic.cols * mosaic.rows === 1 ? (depthMin >= 100 ? sessionCrop(res.fovW, res.fovH, angles) : cropAtDepth(res.fovW, res.fovH, angles, depthMin / 100)) : null
    return { lo, hi, ghosts: ghostIdx.map((i) => ({ min: mins[i], angle: angles[i] })), crop, angles }
  }, [mount, range[0], range[1], loc, base, frame.ra, frame.dec, mosaic.cols, mosaic.rows, res.fovW, res.fovH, depthMin]) // eslint-disable-line react-hooks/exhaustive-deps
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

  // follow the account's default scope (also after it arrives from sync)
  useEffect(() => {
    const sc = store.settings.scope
    if (sc) { setOptics(sc.optics); setPresetId(sc.presetId) }
  }, [store.settings.scope])

  useEffect(() => {
    let dead = false, loaded = false
    // Aladin is created the first time the sky view is visible: made inside a hidden (zero-size) element it keeps a broken zoom and aspect
    const start = () => {
      if (dead || !loaded || !viewRef.current?.clientWidth || aladin.current) return
      aladin.current = A.aladin(viewRef.current, {
        survey: hips('dss2'), target: '83.82 -5.39', fov: 3.5,
        showReticle: false, showCooGrid: false, showFullscreenControl: false, showSimbadPointerControl: false,
        showLayersControl: false, showGotoControl: false, showProjectionControl: false,
      })
      aladin.current.gotoRaDec(83.82, -5.39)
      aladin.current.setFoV(3.5)
      // constellation stick figures and names, filled once constellations.json arrives
      figures.current = [
        A.graphicOverlay({ name: 'constellations', color: 'rgba(148,163,184,0.45)', lineWidth: 1 }),
        A.catalog({ name: 'constellation names', shape: 'circle', sourceSize: 6, color: 'rgba(0,0,0,0)', displayLabel: true, labelColumn: 'name', labelColor: 'rgba(148,163,184,0.85)', labelFont: '12px sans-serif' }),
      ]
      aladin.current.addOverlay(figures.current[0]); aladin.current.addCatalog(figures.current[1])
      // ground below the site's horizon, its outline, and the minimum altitude (drawn under the frame)
      ground.current = [
        A.graphicOverlay({ name: 'ground', color: 'rgba(0,0,0,0)', lineWidth: 1 }),
        A.graphicOverlay({ name: 'horizon', color: '#f97316', lineWidth: 2 }),
        A.graphicOverlay({ name: 'min altitude', color: 'rgba(249,115,22,0.7)', lineWidth: 1, lineDash: [6, 5] }),
      ]
      for (const o of ground.current) aladin.current.addOverlay(o)
      // light domes over the site's towns: a band from the horizon up to where each dome fades, and its upper edge
      domes.current = [
        A.graphicOverlay({ name: 'light domes', color: 'rgba(0,0,0,0)', lineWidth: 1 }),
        A.graphicOverlay({ name: 'light dome edge', color: '#fbbf24', lineWidth: 1.5, lineDash: [4, 4] }),
      ]
      for (const o of domes.current) aladin.current.addOverlay(o)
      // a comet's path over the weeks around the viewed moment, with date marks
      cometLayers.current = [
        A.graphicOverlay({ name: 'comet path', color: 'rgba(163,230,53,0.75)', lineWidth: 1.5 }),
        A.catalog({ name: 'comet dates', shape: 'circle', sourceSize: 6, color: '#a3e635', displayLabel: true, labelColumn: 'name', labelColor: '#d9f99d', labelFont: '11px sans-serif' }),
      ]
      aladin.current.addOverlay(cometLayers.current[0]); aladin.current.addCatalog(cometLayers.current[1])
      // the Moon (its disc) and the planets at the viewed moment
      solar.current = [
        A.graphicOverlay({ name: 'moon', color: 'rgba(229,231,235,0.9)', lineWidth: 1.5 }),
        A.catalog({ name: 'planets', shape: 'circle', sourceSize: 9, color: '#fde68a', displayLabel: true, labelColumn: 'name', labelColor: '#fde68a', labelFont: '12px sans-serif' }),
      ]
      aladin.current.addOverlay(solar.current[0]); aladin.current.addCatalog(solar.current[1])
      overlay.current = A.graphicOverlay({ color: '#38bdf8', lineWidth: 2 })
      aladin.current.addOverlay(overlay.current)
      setReady(true)
    }
    A.init.then(() => { loaded = true; start() })
    const ro = new ResizeObserver(() => { start(); aladin.current?.view?.fixLayoutDimensions?.() })
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

  // the comet's path: −10 … +30 days around the viewed moment, a mark per day, dated every 5 days and at the moment itself
  const day = Math.floor(when.getTime() / 86400000)
  useEffect(() => {
    if (!ready) return
    const [line, marks] = cometLayers.current
    line.removeAll(); marks.removeAll(); line.reportChange?.()
    cometMarks.current = []
    const track = target.obj?.track, magAt = target.obj?.magAt
    if (!track) return
    const t0 = when.getTime(), pts: [number, number][] = []
    for (let h = -240; h <= 720; h += 6) pts.push(track(new Date(t0 + h * 3600000)))
    // split where the path crosses RA 0/360 so the line does not wrap around the sky
    let run: [number, number][] = []
    for (const p of pts) { if (run.length && Math.abs(p[0] - run[run.length - 1][0]) > 180) { line.add(A.polyline(run)); run = [] } run.push(p) }
    if (run.length > 1) line.add(A.polyline(run))
    const date = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    marks.addSources(Array.from({ length: 41 }, (_, k) => k - 10).map((d) => {
      const t = t0 + d * 86400000, [ra, dec] = track(new Date(t))
      cometMarks.current.push({ ra, dec, t, mag: magAt?.(new Date(t)) })
      return A.source(ra, dec, { name: d === 0 ? `● ${date(t)} ${clockIn(tzOf(loc), t)}` : d % 5 === 0 ? date(t) : '' })
    }))
  }, [ready, target.obj, day, loc]) // eslint-disable-line react-hooks/exhaustive-deps

  // the Moon and planets where they are at the viewed moment, seen from the site (the Moon's parallax is up to a degree)
  useEffect(() => {
    if (!ready) return
    const [disc, labels] = solar.current
    disc.removeAll(); labels.removeAll(); disc.reportChange?.()
    const obs = new Astronomy.Observer(loc.lat, loc.lon, loc.elevation)
    const m = Astronomy.Equator(Astronomy.Body.Moon, when, obs, false, true)
    const sd = Math.asin(1737.4 / (m.dist * 149597870.7)) * (180 / Math.PI)
    disc.add(A.circle(m.ra * 15, m.dec, sd, { color: 'rgba(229,231,235,0.9)', fillColor: 'rgba(229,231,235,0.12)' }))
    const illum = Math.round(Astronomy.Illumination(Astronomy.Body.Moon, when).phase_fraction * 100)
    const bodies = [Astronomy.Body.Mercury, Astronomy.Body.Venus, Astronomy.Body.Mars, Astronomy.Body.Jupiter, Astronomy.Body.Saturn, Astronomy.Body.Uranus, Astronomy.Body.Neptune]
    labels.addSources([
      A.source(m.ra * 15, m.dec + sd, { name: `Moon ${illum}%` }),
      ...bodies.map((b) => { const e = Astronomy.Equator(b, when, obs, false, true); return A.source(e.ra * 15, e.dec, { name: b }) }),
    ])
  }, [ready, when, loc])

  const [conData, setConData] = useState<{ id: string; name: string; label: [number, number]; lines: [number, number][][] }[] | null>(null)
  const conLive = useRef<{ show: boolean; data: typeof conData }>({ show: false, data: null })
  useEffect(() => { conLive.current = { show: showCon, data: conData } }, [showCon, conData])
  useEffect(() => { if (showCon && !conData) fetch('/constellations.json').then((r) => r.json()).then(setConData).catch(() => {}) }, [showCon, conData])
  useEffect(() => {
    if (!ready || !conData) return
    const [lines, names] = figures.current // filled once: the data never changes
    for (const c of conData) for (const l of c.lines) lines.add(A.polyline(l))
    names.addSources(conData.map((c) => A.source(c.label[0], c.label[1], { name: c.name })))
  }, [ready, conData])
  useEffect(() => {
    if (!ready) return
    for (const o of figures.current) { if (showCon) o.show(); else o.hide() }
    try { localStorage.setItem('astroplanner.showConstellations', showCon ? '1' : '0') } catch { /* ignore */ }
  }, [ready, showCon])

  // the local horizon at the viewed moment, projected onto the sky; follows the time slider and the site's horizon profile
  useEffect(() => {
    if (!ready) return
    const [fill, line, min] = ground.current
    for (const o of ground.current) { o.removeAll(); o.reportChange() } // removeAll alone does not redraw
    try { localStorage.setItem('astroplanner.showHorizon', showHz ? '1' : '0') } catch { /* ignore */ }
    if (!showHz) return
    const STEP = 3, SEG = 15 // degrees of azimuth per vertex / per shaded strip (each strip runs from the horizon down to the nadir)
    const sky = (alt: number, az: number) => altAzToRaDec(loc, alt, az, when)
    const hz = (az: number) => horizonAlt(loc.horizon, az)
    for (let a0 = 0; a0 < 360; a0 += SEG) {
      const azs: number[] = []
      for (let az = a0; az <= a0 + SEG; az += STEP) azs.push(az)
      const top = azs.map((az) => sky(hz(az), az))
      const side = (az: number) => Array.from({ length: 8 }, (_, i) => sky(hz(az) + (-89.9 - hz(az)) * ((i + 1) / 8), az))
      fill.add(A.polygon([...top, ...side(a0 + SEG), ...side(a0).reverse()], { fill: true, fillColor: 'rgba(120,60,15,0.32)', color: 'rgba(0,0,0,0)' }))
      line.add(A.polyline(top))
      if (minAlt > 0) {
        min.add(A.polyline(azs.map((az) => sky(limitAlt(loc, az, minAlt), az))))
      }
    }
  }, [ready, showHz, loc, when, minAlt])

  useEffect(() => {
    if (!showDomes || (domeEst && domeEst.lat === loc.lat && domeEst.lon === loc.lon)) return
    let live = true
    analyseSite(loc.lat, loc.lon).then((r) => { if (live && r) setDomeEst({ id: loc.id, lat: loc.lat, lon: loc.lon, alt: r.domeAlt }) }).catch(() => {})
    return () => { live = false }
  }, [showDomes, loc.id, loc.lat, loc.lon]) // eslint-disable-line react-hooks/exhaustive-deps
  const estDomes = domeEst && domeEst.lat === loc.lat && domeEst.lon === loc.lon ? domeEst.alt : undefined
  const domeProfile = loc.glow?.length ? loc.glow : estDomes
  const domesUsed = !!loc.glow?.length

  // the light domes projected onto the sky at the viewed moment, above the local horizon
  useEffect(() => {
    if (!ready) return
    const [band, edge] = domes.current
    for (const o of domes.current) { o.removeAll(); o.reportChange() }
    try { localStorage.setItem('astroplanner.showDomes', showDomes ? '1' : '0') } catch { /* ignore */ }
    if (!showDomes || !domeProfile) return
    const STEP = 3
    const sky = (alt: number, az: number) => altAzToRaDec(loc, alt, az, when)
    const base = (az: number) => horizonAlt(loc.horizon, az)
    const top = (az: number) => glowAlt(domeProfile, az)
    const fill = domesUsed ? 'rgba(251,191,36,0.16)' : 'rgba(251,191,36,0.09)'
    let run: number[] = []
    const flush = () => {
      if (run.length > 1) {
        edge.add(A.polyline(run.map((az) => sky(top(az), az))))
        // vertical strips keep each polygon small and convex enough for the projection
        for (let i = 0; i < run.length - 1; i++) {
          const a = run[i], b = run[i + 1]
          band.add(A.polygon([sky(base(a), a), sky(top(a), a), sky(top(b), b), sky(base(b), b)], { fill: true, fillColor: fill, color: 'rgba(0,0,0,0)' }))
        }
      }
      run = []
    }
    for (let az = 0; az <= 360; az += STEP) {
      if (top(az) > base(az) + 0.5) run.push(az)
      else flush()
    }
    flush()
  }, [ready, showDomes, domeProfile, domesUsed, loc, when])

  // click the frame to select it, then drag it; unselected, the sky pans as usual
  const live = useRef({ frame, fovW: res.fovW, fovH: res.fovH, rotation: pa, mosaic, sel: frameSel })
  useEffect(() => { live.current = { frame, fovW: res.fovW, fovH: res.fovH, rotation: pa, mosaic, sel: frameSel } })
  const catRef = useRef<CatObject[]>([])
  useEffect(() => { catRef.current = catalog }, [catalog])
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
    /** Constellation whose stick figure (or name) is within a few px of a view position, when the figures are shown. */
    const conUnder = (x: number, y: number) => {
      const { show, data } = conLive.current
      if (!show || !data) return undefined
      const pix = (p: [number, number]): [number, number] | undefined => { try { return aladin.current?.world2pix?.(p[0], p[1]) ?? undefined } catch { return undefined } }
      let best: (typeof data)[number] | undefined, bestD = 5
      for (const c of data) {
        const lab = pix(c.label)
        if (lab && Math.hypot(lab[0] - x, lab[1] - y) < 14) return c
        for (const l of c.lines) {
          let a = pix(l[0])
          for (let i = 1; i < l.length; i++) {
            const b = pix(l[i])
            if (a && b) {
              const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy
              const t = len ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len)) : 0
              const d = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)
              if (d < bestD && len < 4e6) { bestD = d; best = c } // skip segments torn across the projection edge
            }
            a = b
          }
        }
      }
      return best
    }
    /** A dot on the comet's path within a few px of a view position. */
    const markUnder = (x: number, y: number) => {
      let best, bestD = 8
      for (const m of cometMarks.current) {
        let p: [number, number] | undefined
        try { p = aladin.current?.world2pix?.(m.ra, m.dec) } catch { continue }
        const d = p ? Math.hypot(p[0] - x, p[1] - y) : Infinity
        if (d < bestD) { bestD = d; best = m }
      }
      return best
    }
    /** Catalog object at a view position: a marker within a few px of the cursor, else the smallest object whose extent covers it. */
    const objectUnder = (x: number, y: number): CatObject | undefined => {
      let w: [number, number] | undefined
      try { w = aladin.current?.pix2world?.(x, y) } catch { return undefined }
      if (!w) return undefined
      const perPx = (aladin.current.getFov?.()[0] ?? 1) / (el.clientWidth || 1)
      const tol = 10 * perPx
      let best: CatObject | undefined, bestScore = Infinity
      for (const o of catRef.current) {
        const r = (o.maj ?? 0) / 120 // radius in degrees
        const reach = Math.max(tol, r)
        if (Math.abs(o.dec - w[1]) > reach) continue
        const d = separation(w[0], w[1], o.ra, o.dec)
        if (d > reach) continue
        // close markers win (Messier slightly favoured), then the tightest extent around the cursor
        const score = d <= tol ? d / tol - (o.m ? 0.3 : 0) : 1 + r
        if (score < bestScore) { bestScore = score; best = o }
      }
      return best
    }
    let hoverFrame = 0
    let down: { x: number; y: number } | null = null
    let grab: { dx: number; dy: number } | null = null
    let moved = false
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const [x, y] = local(e)
      down = { x, y }; moved = false
      const h = hit(x, y)
      // a selected frame drags from anywhere on it; grabbing the outline of an unselected one selects and drags it in one go
      setHover(null); setPicked(null); setPickedCon(null); setMarkTip(null)
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
      } else if (!down) {
        const h = hit(x, y)
        const onFrame = h === 'edge' || (live.current.sel && h === 'in')
        el.classList.toggle('overframe', onFrame)
        if (e.pointerType !== 'mouse') return
        const inside = el.contains(e.target as Node) && !onFrame
        cancelAnimationFrame(hoverFrame)
        hoverFrame = requestAnimationFrame(() => {
          const m = inside ? markUnder(x, y) : undefined
          setMarkTip(m ? { t: m.t, mag: m.mag, x: e.clientX, y: e.clientY } : null)
          const o = inside && !m ? objectUnder(x, y) : undefined
          setHover((prev) => (o ? (prev?.o === o && Math.hypot(prev.x - e.clientX, prev.y - e.clientY) < 2 ? prev : { o, x: e.clientX, y: e.clientY }) : null))
        })
      }
    }
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !down) return
      const wasDrag = !!grab
      if (!moved && !wasDrag) {
        const [x, y] = local(e)
        const h = hit(x, y)
        // a constellation line or name wins over the objects behind it; then catalog objects
        const c = h !== 'edge' ? conUnder(x, y) : undefined
        const o = h !== 'edge' && !c ? objectUnder(x, y) : undefined
        if (c) { setPickedCon({ id: c.id, name: c.name, x: e.clientX, y: e.clientY }); setHover(null) }
        if (o) { setPicked({ o, x: e.clientX, y: e.clientY }); setHover(null) }
        if (!(o || c) || !h) setFrameSel(h !== null) // clicking an object inside the frame identifies it rather than selecting the frame
      }
      grab = null; down = null
      el.classList.remove('dragging')
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setFrameSel(false); setPicked(null); setPickedCon(null) } }
    const onLeave = () => { cancelAnimationFrame(hoverFrame); setHover(null); setMarkTip(null) }
    const onWheel = () => { setHover(null); setPicked(null); setPickedCon(null); setMarkTip(null) }
    const stoppers = ['mousedown', 'touchstart', 'mousemove', 'touchmove'] as const
    el.addEventListener('pointerdown', onDown, true)
    for (const t of stoppers) el.addEventListener(t, block, true)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      cancelAnimationFrame(hoverFrame)
      el.removeEventListener('pointerleave', onLeave); el.removeEventListener('wheel', onWheel)
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

  /** Opens a target on the sky view (by URL, so it can be linked and the back button returns). */
  function show(o: CatObject, fid?: string) { routed.current = ''; navigate(`/sky/${encodeURIComponent(slugOf(o))}${fid ? `?framing=${encodeURIComponent(fid)}` : ''}`) }

  function pick(o: CatObject, fid?: string) {
    const [ra, dec] = o.track ? o.track(when) : [o.ra, o.dec] // moving targets: where they are at the viewed moment
    setQuery(''); goTo({ ra, dec, label: nameOf(o), obj: o }, true, fid)
  }  // /sky/<target>[?framing=id] puts that target (and framing) on the sky
  useEffect(() => {
    if (view !== 'sky' || !p1 || !catalog.length || !ready) return
    const fid = route.query.get('framing') ?? undefined
    const key = `${p1}|${fid ?? ''}`
    if (routed.current === key) return
    const o = findBySlug(catalog, p1, customs)
    if (!o) return
    routed.current = key
    pick(o, fid)
  }, [view, p1, route.query, catalog, customs, ready]) // eslint-disable-line react-hooks/exhaustive-deps


  /** Opens the sky at an event: the moment, centred on the pair, zoomed to show both. */
  function showEvent(e: SkyEvent) {
    const fov = Math.min(30, Math.max(e.span * 2, 1))
    routed.current = ''
    navigate(`/sky?at=${Math.round(e.t)}&ra=${e.ra.toFixed(4)}&dec=${e.dec.toFixed(4)}&fov=${fov.toFixed(2)}&label=${encodeURIComponent(e.title)}`)
  }
  // /sky?at=<ms>&ra&dec[&fov&label]: the sky at a moment, centred somewhere (events link here)
  useEffect(() => {
    if (view !== 'sky' || p1 || !ready) return
    const q = route.query, at = Number(q.get('at')), ra = Number(q.get('ra')), dec = Number(q.get('dec'))
    if (!at || !Number.isFinite(ra) || !Number.isFinite(dec) || routed.current === route.href) return
    routed.current = route.href
    setMoment(momentAt(tzOf(loc), at))
    goTo({ ra, dec, label: q.get('label') ?? `${ra.toFixed(2)} ${dec.toFixed(2)}` }, false)
    aladin.current?.setFoV(Number(q.get('fov')) || 2)
  }, [view, p1, ready, route]) // eslint-disable-line react-hooks/exhaustive-deps

  function goCoords() {
    const m = coordIn.trim().match(/^(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)$/)
    if (m) { goTo({ ra: +m[1], dec: +m[2], label: `${m[1]} ${m[2]}` }); routed.current = ''; navigate('/sky', { replace: true }) }
  }

  /** Catalog object a frame at (ra, dec) is about: the current target if it is in frame, else the most prominent nearby. */
  function objectAt(ra: number, dec: number): CatObject | undefined {
    const reach = Math.hypot(res.fovW * (1 + (mosaic.cols - 1) * 0.8), res.fovH * (1 + (mosaic.rows - 1) * 0.8)) / 2
    if (target.obj && !catalog.includes(target.obj) && separation(ra, dec, target.ra, target.dec) <= reach) return target.obj
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
    store.addWish(obj.id, { status, ...extraOf(obj) })
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
              <li key={o.id} onMouseDown={(e) => { e.preventDefault(); setQuery(''); show(o) }}>
                <b>{o.m ? `${o.m} · ${o.id}` : o.id}</b> <small>{o.names[0] ?? o.typeName}</small>
                <i className="ctag">{catalogTag(o)}</i>
              </li>
            ))}</ul>
          )}
        </div>
        <div className="chips">{['M31', 'M42', 'M45', 'M51', 'M81', 'M101', 'NGC 7000', 'NGC 6888'].map((q) => (
          <button key={q} onClick={() => { const o = searchCatalog(catalog, q, 1)[0]; if (o) show(o) }}>{q}</button>
        ))}</div>
        <div className="row">
          <input placeholder="RA Dec in degrees" value={coordIn} onChange={(e) => setCoordIn(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && goCoords()} />
          <button onClick={goCoords}>Go</button>
        </div>
      </section>
      <section>
        <h3>Optics</h3>
        <label className="f"><span>Telescope / lens</span>
          <select value={scopeSel} disabled={!!aio && blocked === 'scope'} onChange={(e) => pickGear('scope', e.target.value)}>
            {!scopeSel && <option value="">Custom (edit below)</option>}
            <optgroup label="All-in-one smart telescopes">{AIO.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
            <optgroup label="Telescopes & lenses">{SCOPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</optgroup>
          </select>
        </label>
        <label className="f"><span>Camera</span>
          <select value={cameraSel} disabled={!!aio && blocked === 'camera'} onChange={(e) => pickGear('camera', e.target.value)}>
            {!cameraSel && <option value="">Custom (edit below)</option>}
            <optgroup label="All-in-one smart telescopes">{AIO.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
            <optgroup label="Cameras">{CAMERAS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</optgroup>
          </select>
        </label>
        {aio && <small className="note">{aio.label} is one unit: telescope and camera go together. Pick something else in the {blocked === 'camera' ? 'telescope' : 'camera'} list to separate them.</small>}
        {num('apertureMm', 'Aperture mm')}{num('focalLengthMm', 'Focal length mm')}
        {num('sensorWmm', 'Sensor width mm')}{num('sensorHmm', 'Sensor height mm')}{num('pixelUm', 'Pixel µm')}
        <label className="f"><span>Binning</span>
          <select value={optics.binning} onChange={(e) => { setPresetId('custom'); setOptics({ ...optics, binning: +e.target.value }) }}>{[1, 2, 3, 4].map((b) => <option key={b} value={b}>{b}×</option>)}</select>
        </label>
        <label className="f"><span>Drizzle</span>
          <select value={optics.drizzle} onChange={(e) => { setPresetId('custom'); setOptics({ ...optics, drizzle: +e.target.value }) }}>{[1, 2, 3].map((b) => <option key={b} value={b}>{b}×</option>)}</select>
        </label>
        {num('reducer', 'Reducer / barlow ×')}
        <div className="row wrap">
          <button disabled={scopeIsDefault} onClick={() => store.setSettings(defaultPatch(store.settings, { presetId, optics }))} title="Used for framing previews in target cards and as the starting setup">★ Make default scope</button>
          <small className="note">Default: {scopeName(defaultScope)}</small>
        </div>
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
          <select value={loc.id} onChange={(e) => store.setActive(e.target.value)}>{store.locations.map((l) => <option key={l.id} value={l.id}>{l.id === store.homeId ? '★ ' : ''}{l.name}</option>)}</select>
        </label>
        <label className="f"><span>Name</span><input value={loc.name} onChange={(e) => patchLoc({ name: e.target.value })} /></label>
        <label className="f"><span>Latitude °N</span><input type="number" step="0.0001" value={loc.lat} onChange={(e) => patchLoc({ lat: +e.target.value, tz: tzFromCoords(+e.target.value, loc.lon) ?? loc.tz })} /></label>
        <label className="f"><span>Longitude °E</span><input type="number" step="0.0001" value={loc.lon} onChange={(e) => patchLoc({ lon: +e.target.value, tz: tzFromCoords(loc.lat, +e.target.value) ?? loc.tz })} /></label>
        <label className="f"><span>Time zone</span><input value={loc.tz ?? tzOf(loc)} onChange={(e) => patchLoc({ tz: e.target.value })} /></label>
        <label className="f"><span>Sky (Bortle)</span>
          <select value={loc.bortle ?? ''} onChange={(e) => patchLoc({ bortle: e.target.value ? +e.target.value : undefined })}>
            <option value="">Not set (assume {DEFAULT_BORTLE})</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((b) => <option key={b} value={b}>{b}{b <= 2 ? ' — excellent dark' : b <= 4 ? ' — rural' : b <= 6 ? ' — suburban' : b === 7 ? ' — bright suburban' : ' — city'}</option>)}
          </select>
        </label>
        <label className="f"><span>Elevation m</span><input type="number" value={loc.elevation} onChange={(e) => patchLoc({ elevation: +e.target.value })} /></label>
        <div className="row">
          <button onClick={here}>📍 Here</button><button onClick={newLoc}>+ New</button>
          <button onClick={() => setHzOpen(true)}>Horizon{loc.horizon.length ? ` (${loc.horizon.length})` : ''}</button>
          {store.locations.length > 1 && <button onClick={() => confirm(`Delete ${loc.name}?`) && store.deleteLocation(loc.id)}>🗑</button>}
          <button onClick={() => goView('sites')} title="Home site, add sites, light pollution">Sites…</button>
        </div>
      </section>
      <section>
        <h3>Survey</h3>
        <label className="f"><span>Background</span>
          <select value={survey} onChange={(e) => setSurvey(e.target.value)}>{SURVEYS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        </label>
        <small className="note">{SURVEYS.find((s) => s.id === survey)?.note}</small>
        <div><label className="note"><input type="checkbox" checked={showCon} onChange={(e) => setShowCon(e.target.checked)} /> Show constellations</label></div>
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
        <label className="note"><input type="checkbox" checked={showHz} onChange={(e) => setShowHz(e.target.checked)} /> Show the horizon on the sky</label>
        <label className="note"><input type="checkbox" checked={showDomes} onChange={(e) => setShowDomes(e.target.checked)} /> Show light domes</label>
        {showDomes && (domeProfile
          ? domeProfile.every((a) => a === 0) ? <p className="note">No light domes stand out at {loc.name}.</p>
          : domesUsed ? <p className="note">✓ Light domes count as planning limits here (Tonight, planner, altitude chart).{estDomes && estDomes.some((a, i) => a !== loc.glow![i]) && <> <button className="lnk" onClick={() => patchLoc({ glow: estDomes })}>Update from the atlas</button></>}</p>
          : <p className="note">Light domes estimated from the atlas; not yet used in planning. <button className="lnk" onClick={() => patchLoc({ glow: domeProfile })}>Use as planning limits</button></p>
          : <p className="note">Reading the light-pollution atlas…</p>)}
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
                  <> → crop to <b>{(session.crop.w * 60).toFixed(0)}′ × {(session.crop.h * 60).toFixed(0)}′</b> (keeps {Math.round(session.crop.scale * 100)}% of each side, {Math.round(session.crop.scale ** 2 * 100)}% of the area{depthMin < 100 ? `, every pixel has ≥ ${depthMin}% of the integration` : ''}), tilted {session.crop.ref.toFixed(0)}° on the sky</>
                ) : <> · crop is worked out for single frames only</>}
              </p>
            )}
            {session?.crop && (
              <>
                <label className="f"><span>Keep depth ≥</span>
                  <input type="range" min={50} max={100} step={5} value={depthMin} onChange={(e) => setDepthMin(+e.target.value)} /><em>{depthMin}%</em></label>
                <DepthMap fovW={res.fovW} fovH={res.fovH} angles={session.angles} crop={session.crop} />
              </>
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
            <button onClick={() => setDetail(target.obj!)}>ⓘ Details &amp; images</button>
            <TargetInfo o={target.obj} gear={gearNames(optics, presetId)} />
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
    <div className={`app ${view !== 'sky' ? 'pv' : ''}`}>
      <header>
        <Link to="/tonight" className="brand"><img src="/favicon.svg" alt="" width={26} height={26} />Owl Astro</Link>
        <nav className="nav">{NAV.map(([id, to, name]) => <Link key={id} to={to} className={section === id ? 'on' : ''}>{name}{id === 'targets' && store.wishlist.length ? <small>{store.wishlist.length}</small> : null}</Link>)}</nav>
        <span className="here">{view === 'browse' || view === 'comets' || view === 'events' ? 'Targets' : view === 'sites' ? 'My sites' : view === 'mygear' ? 'My gear' : view === 'comments' ? 'Comments' : view === 'account' ? 'Account' : view === 'gear' ? 'Gear planner' : view === 'inspector' ? 'Inspector' : view === 'review' ? 'Image review' : view === 'shared' ? 'Shared review' : view === 'iso' ? 'Best ISO' : view === 'gain' ? 'Best gain' : NAV.find(([id]) => id === view)?.[2]}</span>
        <span className="sp" />
        {!online && <span className="offline" title="No connection: planning works, forecasts, survey images and sync resume when you are back online">Offline</span>}
        <SiteSwitcher store={store} />
        <ToolsMenu active={section === 'tools'} />
        <span className="acctslot"><AccountButton auth={auth} status={store.syncStatus} /></span>
      </header>
      <TabBar items={NAV.slice(0, 4)} current={['tonight', 'sky', 'targets', 'plan'].includes(section) ? section : 'more'} more={<>
        <Link to="/log" className={view === 'log' ? 'on' : ''}><b>Log</b><small>Your observations</small></Link>
        {[...ACCOUNT, ...TOOLS].map(([to, name, sub]) => <Link key={to} to={to} className={route.path.join('/') === to.slice(1) ? 'on' : ''}><b>{name}</b><small>{to === '/account' && auth.user ? auth.user.email : sub}</small></Link>)}
      </>} />
      {view === 'sky' && <div className="skytgt">{target.label} · {sexa(target.ra, target.dec)} · {res.fovW.toFixed(2)}°×{res.fovH.toFixed(2)}°</div>}
      {view === 'sky' && (
        <div className="fchips">
          <button onClick={() => setPanel(panel === 'left' ? null : 'left')}>Setup</button>
          <button onClick={() => setPanel(panel === 'right' ? null : 'right')}>Results</button>
        </div>
      )}
      {view === 'tonight' && <main className="pmain"><Tonight store={store} catalog={catalog} scope={defaultScope} onShow={show} onDetails={setDetail} onSky={() => navigate(skyPath)} onLog={setObs}
        night={p1} onNight={(n) => navigate(n ? `/tonight/${n}` : '/tonight', { replace: true })} /></main>}
      {(view === 'targets' || view === 'browse' || view === 'comets' || view === 'events') && (
        <main className="pmain">
          <div className="subnav"><h2 className="th">Targets</h2>
            <Link to="/targets" className={view === 'targets' ? 'on' : ''}>Your targets{store.wishlist.length ? ` (${store.wishlist.length})` : ''}</Link>
            <Link to="/targets/browse" className={view === 'browse' ? 'on' : ''}>Browse catalogue</Link>
            <Link to="/targets/comets" className={view === 'comets' ? 'on' : ''}>Comets</Link>
            <Link to="/targets/events" className={view === 'events' ? 'on' : ''}>Events</Link></div>
          {view === 'targets'
            ? <Planner mode="wishlist" store={store} catalog={catalog} onShow={show} onDetails={setDetail} onLog={setObs} />
            : view === 'comets' ? <Comets store={store} onDetails={setDetail} onShow={show} />
            : view === 'events' ? <Events store={store} catalog={catalog} scope={defaultScope} onShow={showEvent} />
            : <Catalogue key={route.query.get('con') ?? ''} con={route.query.get('con') ?? undefined} store={store} catalog={catalog} scope={defaultScope} onDetails={setDetail} onShow={show} />}
        </main>
      )}
      {view === 'plan' && <main className="pmain"><div className="subnav"><h2 className="th">Plan <small>the year ahead for your targets</small></h2></div><Planner mode="calendar" store={store} catalog={catalog} onShow={show} onDetails={setDetail} onLog={setObs} /></main>}
      {view === 'log' && <main className="pmain"><Observations store={store} catalog={catalog} onDetails={setDetail} onAdd={() => setObs({})} onEdit={setObs} /></main>}
      {view === 'inspector' && <main className="pmain"><Inspector store={store} catalog={catalog} scope={defaultScope} /></main>}
      {view === 'review' && <main className="pmain"><ImageReview user={auth.user} store={store} catalog={catalog} /></main>}
      {view === 'shared' && <main className="pmain"><SharedReview token={p1} catalog={catalog} /></main>}
      {view === 'iso' && <main className="pmain"><BestIso store={store} cameraId={route.path[2]} /></main>}
      {view === 'gain' && <main className="pmain"><BestGain store={store} cameraId={route.path[2]} /></main>}
      {section === 'account' && (
        <main className="pmain">
          <div className="subnav"><h2 className="th">Account</h2>
            {ACCOUNT.map(([to, name]) => <Link key={to} to={to} className={route.path.join('/') === to.slice(1) ? 'on' : ''}>{name}</Link>)}</div>
          {view === 'account' && <AccountHome store={store} auth={auth} />}
          {view === 'mygear' && <MyGear store={store} />}
          {view === 'sites' && <SiteView store={store} />}
          {view === 'comments' && <GuideComments user={auth.user} />}
        </main>
      )}
      {view === 'gear' && <main className="pmain"><GearPlanner store={store} catalog={catalog} scope={defaultScope} /></main>}
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
            {o && <button onClick={() => { setDetail(o); setMenu(null) }}>ⓘ View details for {nameOf(o)}</button>}
            {o && <button onClick={() => saveFraming('wishlist', { custom: true })}>✎ Save as custom named field…</button>}
          </div>
        )
      })()}
      {markTip && target.obj && !picked && !menu && (
        <div className="skytip" style={{ left: Math.min(markTip.x + 14, window.innerWidth - 260), top: markTip.y + 16 }}>
          <b className="tipmag">{markTip.mag != null ? `mag ${markTip.mag.toFixed(1)}` : 'mag ?'}</b>
          <small>{new Date(markTip.t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} {clockIn(tzOf(loc), markTip.t)}{markTip.mag != null && target.obj.comet?.dm == null ? ' · predicted' : ''}</small>
        </div>
      )}
      {hover && !picked && !menu && (
        <div className="skytip" style={{ left: Math.min(hover.x + 14, window.innerWidth - 260), top: hover.y + 16 }}>
          <b>{nameOf(hover.o)}</b>{hover.o.names[0] && <> · {hover.o.names[0]}</>}<small>{objFacts(hover.o)}</small>
        </div>
      )}
      {picked && !menu && (
        <div className="ctx" style={{ left: Math.min(picked.x, window.innerWidth - 250), top: Math.min(picked.y, window.innerHeight - 170) }}>
          <b>{nameOf(picked.o)}{picked.o.names[0] && <> · {picked.o.names[0]}</>}</b>
          <small>{[objFacts(picked.o), picked.o.m && picked.o.id, picked.o.con].filter(Boolean).join(' · ')}</small>
          <button onClick={() => { setDetail(picked.o); setPicked(null) }}>ⓘ View details</button>
          {picked.o.id !== target.obj?.id && <button onClick={() => { show(picked.o); setPicked(null) }}>◎ Make this the target</button>}
          <button onClick={() => { setFrame({ ra: picked.o.ra, dec: picked.o.dec }); setPicked(null) }}>⌖ Centre frame on it</button>
        </div>
      )}
      {pickedCon && !menu && (() => {
        const n = catalog.filter((o) => o.con === pickedCon.id).length
        return (
          <div className="ctx" style={{ left: Math.min(pickedCon.x, window.innerWidth - 250), top: Math.min(pickedCon.y, window.innerHeight - 120) }}>
            <b>{pickedCon.name}</b>
            <small>Constellation · {n.toLocaleString()} catalogued objects</small>
            <button onClick={() => { setPickedCon(null); navigate(`/targets/browse?con=${encodeURIComponent(pickedCon.id)}`) }}>☰ Browse targets in {pickedCon.name}</button>
          </div>
        )
      })()}
      {menu && <div className="ctxbg" onMouseDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />}
      {detail && (
        <TargetDetail o={detail} store={store} scope={defaultScope} onClose={() => setDetail(null)}
          onShow={(fid) => show(detail, fid)}
          onPlanner={() => navigate('/targets')} onLog={() => { setObs({ targetId: detail.id }); setDetail(null) }} />
      )}
      {obs && (
        <ObservationForm store={store} catalog={catalog} setup={setupLabel(optics, presetId)} prefill={obs} onClose={() => setObs(null)} />
      )}
      <PwaStatus />
      {frameSel && view === 'sky' && <div className="fhint">Frame selected — drag to move it · click elsewhere or Esc to release</div>}
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
