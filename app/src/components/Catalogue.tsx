import { useEffect, useMemo, useRef, useState } from 'react'
import { CATALOGS, catalogTag, searchCatalog, type CatObject } from '../lib/catalog'
import { compute, framingFit } from '../lib/optics'
import { defaultSurvey } from '../lib/surveys'
import { cutoutUrl } from '../lib/hips2fits'
import { filterShort } from '../lib/filters'
import { clockIn, nightNow, tzOf } from '../lib/tz'
import { ephemeris, scoreNights } from '../lib/suitability'
import { placeOnNight } from '../lib/schedule'
import type { useStore } from '../lib/store'
import { panelPolygons, type Scope } from './FramingPreview'

type Store = ReturnType<typeof useStore>

const PAGE = 48
const GROUPS: { id: string; label: string; test: (o: CatObject) => boolean }[] = [
  { id: 'deep', label: 'All deep-sky', test: (o) => o.type !== '*' && o.type !== '**' },
  { id: 'galaxies', label: 'Galaxies', test: (o) => o.type.startsWith('G') },
  { id: 'emission', label: 'Emission nebulae', test: (o) => ['HII', 'EmN', 'SNR', 'Neb', 'Cl+N'].includes(o.type) },
  { id: 'reflection', label: 'Reflection', test: (o) => o.type === 'RfN' },
  { id: 'planetary', label: 'Planetary', test: (o) => o.type === 'PN' },
  { id: 'dark', label: 'Dark nebulae', test: (o) => o.type === 'DrkN' },
  { id: 'clusters', label: 'Clusters', test: (o) => ['OCl', 'GCl', '*Ass'].includes(o.type) },
]
const MAGS = [{ v: 99, l: 'Any magnitude' }, { v: 6, l: 'Brighter than 6' }, { v: 8, l: 'Brighter than 8' }, { v: 10, l: 'Brighter than 10' }, { v: 12, l: 'Brighter than 12' }]
const SIZES = [{ v: 0, l: 'Any size' }, { v: 5, l: '≥ 5′' }, { v: 15, l: '≥ 15′' }, { v: 30, l: '≥ 30′' }, { v: 60, l: '≥ 1°' }]
const SORTS = [{ id: 'bright', label: 'Brightest' }, { id: 'large', label: 'Largest' }, { id: 'name', label: 'Name' }, { id: 'tonight', label: 'Best tonight' }]

const title = (o: CatObject) => (o.m ? `${o.m.replace(' ', '')} · ${o.id}` : o.id)
const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

/** The catalogue as a grid of information cards: filter, sort, star, open details. */
export default function Catalogue({ store, catalog, scope, onDetails, onShow }: {
  store: Store; catalog: CatObject[]; scope: Scope
  onDetails: (o: CatObject) => void; onShow: (o: CatObject, fid?: string) => void
}) {
  const { active: loc, settings, wishlist } = store
  const tz = tzOf(loc)
  const [cat, setCat] = useState('messier')
  const [group, setGroup] = useState('deep')
  const [con, setCon] = useState('')
  const [mag, setMag] = useState(99)
  const [size, setSize] = useState(0)
  const [sort, setSort] = useState('bright')
  const [query, setQuery] = useState('')
  const [onlyUp, setOnlyUp] = useState(false)
  const [shown, setShown] = useState(PAGE)
  const [msg, setMsg] = useState('')
  const sentinel = useRef<HTMLDivElement>(null)
  const night = useMemo(() => nightNow(tz).night, [tz])
  const addTonight = (o: CatObject) => {
    const err = placeOnNight({ loc, settings, plan: store.plan, night, o, moon: wishById.get(o.id)?.moon, add: store.addBlock })
    setMsg(err ? `${o.m ?? o.id}: ${err}` : `${o.m ?? o.id} added to tonight's schedule`)
    setTimeout(() => setMsg(''), 3500)
  }

  const wishById = useMemo(() => new Map(wishlist.map((w) => [w.id, w])), [wishlist])
  const fov = useMemo(() => compute(scope.optics, 3), [scope])
  const constellations = useMemo(() => [...new Set(catalog.map((o) => o.con))].filter(Boolean).sort(), [catalog])
  const nights = useMemo(() => {
    const [y, m, d] = nightNow(tz).night.split('-').map(Number)
    return ephemeris(loc, new Date(y, m - 1, d), 1)
  }, [loc, tz])

  const filtered = useMemo(() => {
    const q = query.trim()
    const base = q.length >= 2 ? searchCatalog(catalog, q, 400, cat) : catalog.filter((o) => CATALOGS.find((c) => c.id === cat)!.test(o))
    const g = GROUPS.find((x) => x.id === group)!
    return base.filter((o) => g.test(o) && (!con || o.con === con) && (mag >= 99 || (o.mag ?? 99) <= mag) && (!size || (o.maj ?? 0) >= size))
  }, [catalog, query, cat, group, con, mag, size])

  // "best tonight" scores every listed object, so it is only offered for lists short enough to score quickly
  const canScore = filtered.length <= 1000
  const scores = useMemo(() => {
    if (!(sort === 'tonight' || onlyUp) || !canScore) return null
    const m = new Map<string, ReturnType<typeof scoreNights>[number]>()
    for (const o of filtered) m.set(o.id, scoreNights(loc, o, nights, settings, wishById.get(o.id)?.moon)[0])
    return m
  }, [sort, onlyUp, canScore, filtered, loc, nights, settings, wishById])

  const rows = useMemo(() => {
    let r = scores && onlyUp ? filtered.filter((o) => scores.get(o.id)!.suitable) : filtered
    r = [...r]
    if (sort === 'bright') r.sort((a, b) => (a.mag ?? 99) - (b.mag ?? 99) || natural(a.id, b.id))
    else if (sort === 'large') r.sort((a, b) => (b.maj ?? 0) - (a.maj ?? 0))
    else if (sort === 'name') r.sort((a, b) => natural(a.m ?? a.id, b.m ?? b.id))
    else if (scores) r.sort((a, b) => scores.get(b.id)!.score - scores.get(a.id)!.score)
    return r
  }, [filtered, sort, scores, onlyUp])

  useEffect(() => setShown(PAGE), [rows])
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setShown((n) => n + PAGE), { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [rows])

  return (
    <div className="cat">
      <div className="catbar">
        <input className="nsearch" placeholder="Search the catalogue — name, M31, NGC 7000, Sh2-155…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>{CATALOGS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        <select value={con} onChange={(e) => setCon(e.target.value)}><option value="">All constellations</option>{constellations.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select value={mag} onChange={(e) => setMag(+e.target.value)}>{MAGS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}</select>
        <select value={size} onChange={(e) => setSize(+e.target.value)}>{SIZES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</select>
      </div>
      <div className="catbar">
        <div className="chips">{GROUPS.map((g) => <button key={g.id} className={group === g.id ? 'on' : ''} onClick={() => setGroup(g.id)}>{g.label}</button>)}</div>
        <span className="sp" />
        <label className="note" title={canScore ? '' : 'Narrow the list below 1000 objects to use this'}>
          <input type="checkbox" checked={onlyUp} disabled={!canScore} onChange={(e) => setOnlyUp(e.target.checked)} /> Up tonight
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map((s) => <option key={s.id} value={s.id} disabled={s.id === 'tonight' && !canScore}>{s.label}{s.id === 'tonight' && !canScore ? ' (narrow the list first)' : ''}</option>)}</select>
        <small className="note">{rows.length.toLocaleString()} objects</small>
      </div>

      <div className="cgrid">
        {rows.slice(0, shown).map((o) => card(o))}
      </div>
      {rows.length === 0 && <p className="empty">Nothing matches these filters.</p>}
      {msg && <div className="toast">{msg}</div>}
      <div ref={sentinel} style={{ height: 1 }} />
    </div>
  )

  /** A plain render function, not a component: the cards must keep their identity (and loaded images) across re-renders. */
  function card(o: CatObject) {
    const w = wishById.get(o.id)
    const r = scores?.get(o.id) ?? scoreNights(loc, o, nights, settings, w?.moon)[0]
    const f = framingFit(o.maj, o.min, fov.fovW, fov.fovH)
    const badge = !f ? null : f.kind === 'mosaic' ? { t: `Mosaic ${f.cols}×${f.rows}`, c: 'warn' } : f.kind === 'small' ? { t: 'Tiny', c: 'mute' } : f.ratio > 0.75 ? { t: 'Tight crop', c: 'warn' } : { t: 'Fits', c: 'ok' }
    const cols = f?.cols ?? 1, rows_ = f?.rows ?? 1
    const view = Math.min(20, Math.max(Math.hypot(fov.fovW * (1 + (cols - 1) * 0.8), fov.fovH * (1 + (rows_ - 1) * 0.8)) * 1.15, ((o.maj ?? 0) / 60) * 1.4, 0.6))
    const polys = panelPolygons(view, fov.fovW, fov.fovH, 0, cols, rows_, 320, 180)
    return (
      <article key={o.id} className="ccard">
        <div className="cthumb" onClick={() => onDetails(o)}>
          <img src={cutoutUrl(defaultSurvey(o), o.ra, o.dec, view, 320, 180)} alt="" loading="lazy" />
          <svg viewBox="0 0 320 180">{polys.map((p, i) => <polygon key={i} points={p.map((q) => q.join(',')).join(' ')} />)}</svg>
        </div>
        <div className="cbody">
          <div className="ch"><button className="title" onClick={() => onDetails(o)}><b>{title(o)}</b></button><span className="sp" />
            <button className={`star ${w ? 'on' : ''}`} title={w ? 'On your wishlist' : 'Add to wishlist'} onClick={() => (w ? confirm(`Remove ${o.id} from your wishlist?`) && store.removeWish(o.id) : store.addWish(o.id))}>{w ? '★' : '☆'}</button>
            <button title="Details" onClick={() => onDetails(o)}>ⓘ</button></div>
          {o.names[0] && <p className="cname">{o.names[0]}</p>}
          <p className="note">{o.typeName} · {o.con}{o.mag != null ? ` · mag ${o.mag}` : ''}{o.maj ? ` · ${o.maj}′${o.min ? `×${o.min}′` : ''}` : ''}</p>
          <p className="nchips">
            {badge && <em className={`badge2 ${badge.c}`}>{badge.t}</em>}
            <em className="badge2 mute">{filterShort(o.type)}</em>
            <em className="badge2 mute">{catalogTag(o)}</em>
            {r.suitable ? <em className="badge2 ok" title="Tonight">↑ {Math.round(r.peakAlt)}° · {clockIn(tz, r.peakAt)}</em> : <em className="badge2 mute">not up tonight</em>}
          </p>
          <div className="row"><button onClick={() => onShow(o, w?.framings?.[0]?.id)}>Show on sky</button>
            {store.plan.some((b) => b.date === night && b.targetId === o.id)
              ? <button className="plus done" title="On tonight's schedule — click to remove" onClick={() => store.removeBlocksFor(night, o.id)}>✓ Tonight</button>
              : <button disabled={!r.suitable} title={r.suitable ? "Add to tonight's schedule" : 'Not observable tonight'} onClick={() => addTonight(o)}>＋ Tonight</button>}</div>
        </div>
      </article>
    )
  }
}

