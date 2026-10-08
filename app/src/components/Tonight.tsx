import { useMemo, useRef, useState } from 'react'
import * as Astronomy from 'astronomy-engine'
import { customObject, isCustom, searchCatalog, type CatObject } from '../lib/catalog'
import { targetAltAz } from '../lib/astro'
import { compute, framingFit } from '../lib/optics'
import { clockIn, nightNow, tzOf } from '../lib/tz'
import { meanCloud, useCloud } from '../lib/weather'
import { ephemeris, rankBonus, scoreNights, type NightResult } from '../lib/suitability'
import { defaultSurvey } from '../lib/surveys'
import { cutoutUrl } from '../lib/hips2fits'
import { filterShort } from '../lib/filters'
import type { PlanBlock, useStore, WishItem } from '../lib/store'
import type { Scope } from './FramingPreview'
import MoonGlyph from './MoonGlyph'

type Store = ReturnType<typeof useStore>

const SLOT = 20      // minutes per ephemeris sample
const SNAP = 10      // minutes: drag granularity
const MIN_BLOCK = 20 // minutes
const PX = 1.1       // timeline pixels per minute
const COLORS = ['#38bdf8', '#fbbf24', '#4ade80', '#c084fc', '#f87171', '#fb923c']
const FILTERS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'galaxies', label: 'Galaxies', test: (o: CatObject) => o.type.startsWith('G') },
  { id: 'nebulae', label: 'Nebulae', test: (o: CatObject) => ['HII', 'EmN', 'RfN', 'DrkN', 'Neb', 'PN', 'SNR', 'Cl+N'].includes(o.type) },
  { id: 'clusters', label: 'Clusters', test: (o: CatObject) => ['OCl', 'GCl', '*Ass', 'Cl+N'].includes(o.type) },
]

const label = (o: CatObject) => (isCustom(o.id) ? o.names[0] : o.m ? o.m.replace(' ', '') : o.id.replace(' ', ''))
const longName = (o: CatObject) => (isCustom(o.id) ? o.names[0] : o.names[0] ? `${label(o)} - ${o.names[0]}` : label(o))
const dur = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const addDays = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d) }

interface Cand { o: CatObject; w?: WishItem; r: NightResult; cloud?: number; eff: number }

/** Night planner: pick a night, browse targets that are up, and lay them out on a clickable, draggable schedule. */
export default function Tonight({ store, catalog, scope, onShow, onDetails, onSky }: {
  store: Store; catalog: CatObject[]; scope: Scope
  onShow: (o: CatObject, fid?: string) => void; onDetails: (o: CatObject) => void; onSky: () => void
}) {
  const { active: loc, settings, wishlist, plan } = store
  const tz = tzOf(loc)
  const { cloud, error: wxError } = useCloud(loc)
  const today = useMemo(() => nightNow(tz).night, [tz])
  const [night, setNight] = useState(today)
  const [stripOff, setStripOff] = useState(0)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [hideBlocked, setHideBlocked] = useState(true)
  const [picker, setPicker] = useState<{ from: number; to: number } | null>(null)
  const [draft, setDraft] = useState<{ id: string; start: number; end: number } | null>(null)
  const [msg, setMsg] = useState('')
  const drag = useRef<{ id: string; mode: 'move' | 'start' | 'end'; y0: number; s0: number; e0: number; lo: number; hi: number } | null>(null)
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  const byId = useMemo(() => new Map(catalog.map((o) => [o.id, o])), [catalog])
  const wishById = useMemo(() => new Map(wishlist.map((w) => [w.id, w])), [wishlist])
  const lookup = (id: string): CatObject | undefined => {
    const w = wishById.get(id)
    return byId.get(id) ?? (w?.custom ? customObject(w.id, w.custom) : undefined)
  }
  const fov = useMemo(() => compute(scope.optics, 3), [scope])
  const now = Date.now()

  // ---- the selected night ----
  const nights = useMemo(() => ephemeris(loc, parse(night), 1), [loc, night])
  const samples = nights[0].samples
  const base = samples[0].t // 17:00 site time, epoch ms
  const at = (min: number) => base + min * 60000
  const t = (min: number) => clockIn(tz, at(min))
  const dark = samples.map((s) => s.sun < -12)
  const darkIdx = dark.flatMap((d, i) => (d ? [i] : []))
  const d0 = darkIdx.length ? darkIdx[0] * SLOT : 0
  const d1 = darkIdx.length ? (darkIdx[darkIdx.length - 1] + 1) * SLOT : 0
  const r0 = darkIdx.length ? Math.max(0, Math.floor((d0 - 40) / 10) * 10) : 0
  const r1 = darkIdx.length ? Math.min(900, Math.ceil((d1 + 40) / 10) * 10) : 900
  const darkTimes = darkIdx.map((i) => samples[i].t)
  const darkCloud = cloud ? meanCloud(cloud, darkTimes) : undefined
  const verdict = darkCloud === undefined ? null : darkCloud < 30 ? 'go' : darkCloud < 60 ? 'maybe' : 'no'
  const clearest = useMemo(() => {
    if (!cloud || darkIdx.length < 6) return null
    let best: { i: number; c: number } | null = null
    for (let k = 0; k + 6 <= darkIdx.length; k++) {
      const c = meanCloud(cloud, darkIdx.slice(k, k + 6).map((i) => samples[i].t))
      if (c !== undefined && (!best || c < best.c)) best = { i: darkIdx[k] * SLOT, c }
    }
    return best
  }, [cloud, darkIdx, samples])

  // moon: up-ranges and rise/set marks within the visible range
  const moonUp = samples.map((s) => s.moonAlt > 0)
  const moonMarks = samples.flatMap((_, i) => (i > 0 && moonUp[i] !== moonUp[i - 1] ? [{ min: i * SLOT, rise: moonUp[i] }] : [])).filter((m) => m.min >= r0 && m.min <= r1)
  const moonRanges: [number, number][] = []
  moonUp.forEach((_, i) => { if (moonUp[i]) { const l = moonRanges[moonRanges.length - 1]; if (l && l[1] === i * SLOT) l[1] += SLOT; else moonRanges.push([i * SLOT, (i + 1) * SLOT]) } })

  // ---- night strip ----
  const strip = useMemo(() => Array.from({ length: 8 }, (_, i) => {
    const date = addDays(today, stripOff + i)
    const n = ephemeris(loc, parse(date), 1)[0]
    const dk = n.samples.filter((s) => s.sun < -12)
    const c = cloud && dk.length ? meanCloud(cloud, dk.map((s) => s.t)) : undefined
    const phase = Astronomy.MoonPhase(new Date(n.samples[14].t))
    return { date, d: parse(date), phase, hours: (dk.length * SLOT) / 60, cloud: c }
  }), [loc, today, stripOff, cloud])

  // ---- candidates ----
  const popular = useMemo(() => catalog.filter((o) => o.m || o.alt.some((a) => /^C \d+$/.test(a)) || (/^(NGC|IC) /.test(o.id) && (o.mag ?? 99) <= 9.5 && (o.maj ?? 0) >= 4)), [catalog])
  const pool = useMemo(() => {
    const seen = new Set<string>(), out: CatObject[] = []
    const add = (o?: CatObject) => { if (o && !seen.has(o.id)) { seen.add(o.id); out.push(o) } }
    if (query.trim().length >= 2) searchCatalog(catalog, query, 40).forEach(add)
    else { wishlist.filter((w) => w.status !== 'done').forEach((w) => add(lookup(w.id))); popular.forEach(add) }
    return out
  }, [catalog, query, wishlist, popular]) // eslint-disable-line react-hooks/exhaustive-deps
  const cands: Cand[] = useMemo(() => pool.map((o) => {
    const w = wishById.get(o.id)
    const r = scoreNights(loc, o, nights, settings, w?.moon)[0]
    const c = cloud ? meanCloud(cloud, samples.filter((_, i) => r.usable[i]).map((s) => s.t)) : undefined
    return { o, w, r, cloud: c, eff: (c === undefined ? r.score : r.score * (1 - c / 100)) + (w ? rankBonus(w) + 4 : 0) }
  }), [pool, wishById, loc, nights, settings, cloud, samples])
  const up = cands.filter((c) => c.r.suitable).length
  const listed = cands
    .filter((c) => FILTERS.find((f) => f.id === filter)!.test(c.o) && (!hideBlocked || c.r.suitable))
    .sort((a, b) => b.eff - a.eff).slice(0, 60)

  // ---- schedule ----
  const blocks = plan.filter((b) => b.date === night).sort((a, b) => a.start - b.start)
  const shown = (b: PlanBlock) => (draft?.id === b.id ? { ...b, start: draft.start, end: draft.end } : b)
  const gaps = useMemo(() => {
    const out: [number, number][] = []
    if (!darkIdx.length) return out
    let cur = d0
    for (const b of blocks) { if (b.start - cur >= MIN_BLOCK) out.push([cur, b.start]); cur = Math.max(cur, b.end) }
    if (d1 - cur >= MIN_BLOCK) out.push([cur, d1])
    return out
  }, [blocks, d0, d1, darkIdx.length])
  const planned = blocks.reduce((a, b) => a + (b.end - b.start), 0)
  const scheduledIds = [...new Set(blocks.map((b) => b.targetId))]
  const colorOf = (id: string) => COLORS[scheduledIds.indexOf(id) % COLORS.length]

  /** Longest stretch within [from, to] where the target is usable. */
  const bestRun = (c: Cand, from: number, to: number): [number, number] | null => {
    let best: [number, number] | null = null, start = -1
    for (let i = Math.floor(from / SLOT); i <= Math.ceil(to / SLOT); i++) {
      const ok = i < c.r.usable.length && c.r.usable[i] && (i + 1) * SLOT > from && i * SLOT < to
      if (ok && start < 0) start = i
      if ((!ok || i === Math.ceil(to / SLOT)) && start >= 0) {
        const a = Math.max(from, start * SLOT), b = Math.min(to, (ok ? i + 1 : i) * SLOT)
        if (b - a >= MIN_BLOCK && (!best || b - a > best[1] - best[0])) best = [a, b]
        start = -1
      }
    }
    return best
  }
  const put = (o: CatObject, from: number, to: number) => store.addBlock({ id: crypto.randomUUID(), date: night, targetId: o.id, start: from, end: to })

  const addTarget = (c: Cand) => {
    let best: [number, number] | null = null
    for (const [a, b] of gaps) { const r = bestRun(c, a, b); if (r && (!best || r[1] - r[0] > best[1] - best[0])) best = r }
    if (!best) { flash(`${label(c.o)} has no free usable time on this night`); return }
    put(c.o, best[0], Math.min(best[1], best[0] + 120))
  }
  const fillGap = (c: Cand, from: number, to: number) => {
    const r = bestRun(c, from, to)
    if (r) { put(c.o, r[0], r[1]); setPicker(null) }
  }
  const autoFill = () => {
    const pickFrom = cands.filter((c) => c.r.suitable && (c.w || cands.every((x) => !x.w))).sort((a, b) => b.eff - a.eff).slice(0, 6)
    if (!pickFrom.length) { flash('No suitable targets to schedule'); return }
    const free = samples.map((_, i) => dark[i] && !blocks.some((b) => b.start < (i + 1) * SLOT && b.end > i * SLOT))
    const run = (c: Cand, i: number) => { let n = 0; while (i + n < samples.length && free[i + n] && c.r.usable[i + n]) n++; return n }
    // stay on a target while it is usable, but at most 4 h at a time; the next pick favours targets with the least time so far
    const total = new Map<string, number>()
    let cur: Cand | null = null, from = 0
    const flush = (to: number) => { if (cur && to - from >= 2) { put(cur.o, from * SLOT, to * SLOT); total.set(cur.o.id, (total.get(cur.o.id) ?? 0) + (to - from)) } }
    for (let i = 0; i <= samples.length; i++) {
      if (i < samples.length && cur && free[i] && cur.r.usable[i] && i - from < 12) continue
      flush(i)
      const prev = cur as Cand | null
      cur = null
      if (i >= samples.length) break
      const avail: Cand[] = pickFrom.filter((c) => free[i] && c.r.usable[i]).sort((a, b) => (total.get(a.o.id) ?? 0) - (total.get(b.o.id) ?? 0) || b.eff - a.eff)
      const others: Cand[] = avail.filter((c) => c.o.id !== prev?.o.id)
      const pool2: Cand[] = others.length ? others : avail
      cur = pool2.find((c) => run(c, i) >= 3) ?? pool2.sort((a, b) => run(b, i) - run(a, i))[0] ?? null
      from = i
    }
  }

  // drag / resize (times snap to SNAP minutes and stay inside the neighbours and the dark window)
  const y = (min: number) => (min - r0) * PX
  const down = (e: React.PointerEvent, b: PlanBlock, mode: 'move' | 'start' | 'end') => {
    e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const i = blocks.findIndex((x) => x.id === b.id)
    drag.current = { id: b.id, mode, y0: e.clientY, s0: b.start, e0: b.end, lo: blocks[i - 1]?.end ?? d0, hi: blocks[i + 1]?.start ?? d1 }
    setDraft({ id: b.id, start: b.start, end: b.end })
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dm = Math.round((e.clientY - d.y0) / PX / SNAP) * SNAP
    const len = d.e0 - d.s0
    let s = d.s0, en = d.e0
    if (d.mode === 'move') { s = Math.min(Math.max(d.s0 + dm, d.lo), d.hi - len); en = s + len }
    else if (d.mode === 'start') s = Math.min(Math.max(d.s0 + dm, d.lo), d.e0 - MIN_BLOCK)
    else en = Math.max(Math.min(d.e0 + dm, d.hi), d.s0 + MIN_BLOCK)
    setDraft({ id: d.id, start: s, end: en })
  }
  const up_ = () => {
    if (drag.current && draft && (draft.start !== drag.current.s0 || draft.end !== drag.current.e0)) store.patchBlock(draft.id, { start: draft.start, end: draft.end })
    drag.current = null; setDraft(null)
  }

  // ---- altitude chart ----
  const alt = useMemo(() => scheduledIds.map((id) => {
    const o = lookup(id)
    if (!o) return null
    const pts: [number, number][] = []
    for (let m = r0; m <= r1; m += 10) pts.push([m, targetAltAz(loc, o.ra, o.dec, new Date(at(m))).alt])
    return { id, o, pts }
  }).filter((x): x is NonNullable<typeof x> => !!x), [scheduledIds.join('|'), loc, r0, r1, night]) // eslint-disable-line react-hooks/exhaustive-deps
  const CW = 860, CH = 190, P = { l: 32, r: 8, t: 8, b: 30 }
  const cx = (m: number) => P.l + ((m - r0) / (r1 - r0)) * (CW - P.l - P.r)
  const cy = (a: number) => P.t + (1 - Math.max(0, a) / 90) * (CH - P.t - P.b)

  const hourMarks: number[] = []
  for (let m = r0; m <= r1; m += 10) if (clockIn(tz, at(m)).endsWith(':00')) hourMarks.push(m)
  const nowMin = (now - base) / 60000
  const isToday = night === today && nowMin >= r0 && nowMin <= r1

  const thumbFor = (o: CatObject, w?: WishItem) => w?.framings?.[0]?.thumb ?? (isCustom(o.id) ? undefined : cutoutUrl(defaultSurvey(o), o.ra, o.dec, Math.max(fov.fovW * 1.5, ((o.maj ?? 0) / 60) * 1.4), 128, 72))
  const fitBadge = (o: CatObject) => {
    const f = framingFit(o.maj, o.min, fov.fovW, fov.fovH)
    if (!f) return null
    if (f.kind === 'mosaic') return { text: `Mosaic ${f.cols}×${f.rows}`, cls: 'warn' }
    if (f.kind === 'small') return { text: 'Tiny', cls: 'mute' }
    return f.ratio > 0.75 ? { text: 'Tight crop', cls: 'warn' } : { text: 'Fits', cls: 'ok' }
  }

  return (
    <div className="np">
      {/* night strip */}
      <div className="nstrip">
        <button className="nav" disabled={stripOff <= 0} onClick={() => setStripOff(Math.max(0, stripOff - 7))}>‹</button>
        {strip.map((n, i) => {
          const q = n.cloud === undefined ? 'var(--line)' : n.cloud < 30 ? 'var(--ok)' : n.cloud < 60 ? 'var(--warn)' : 'var(--bad)'
          return (
            <button key={n.date} className={`night ${n.date === night ? 'sel' : ''}`} onClick={() => setNight(n.date)} title={n.cloud === undefined ? 'no forecast' : `${Math.round(n.cloud)}% cloud in the dark`}>
              <small>{stripOff === 0 && i === 0 ? 'TONIGHT' : n.d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase()}</small>
              <span><b>{n.d.getDate()}</b><MoonGlyph phase={n.phase} size={16} /></span>
              <i style={{ background: q, width: `${Math.min(100, (n.hours / 11) * 100)}%` }} />
            </button>
          )
        })}
        <button className="nav" onClick={() => setStripOff(stripOff + 7)}>›</button>
        <label className="nav cal" title="Pick any date"><input type="date" value={night} onChange={(e) => e.target.value && setNight(e.target.value)} /></label>
        <span className="sp" />
        <button onClick={() => { setStripOff(0); setNight(today) }} disabled={night === today && stripOff === 0}>Tonight</button>
      </div>

      <div className="ncols">
        {/* targets */}
        <section className="ntargets">
          <div className="ch"><h3>Targets</h3><span className="sp" /><small className="note">{up} up this night</small></div>
          <input className="nsearch" placeholder="Search M81, NGC 7000, Orion…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="chips">
            {FILTERS.map((f) => <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>{f.label}</button>)}
          </div>
          <label className="note"><input type="checkbox" checked={hideBlocked} onChange={(e) => setHideBlocked(e.target.checked)} /> Hide targets that are not observable this night</label>
          {wishlist.length === 0 && !query && <p className="note">Popular picks for this night. Star a target to keep it on your wishlist, or add it to the schedule with ＋.</p>}
          <div className="nlist">
            {listed.length === 0 && <p className="note">Nothing matches. {query ? 'Try another search.' : 'Untick “hide” to see what is below the horizon.'}</p>}
            {listed.map((c) => {
              const inPlan = blocks.some((b) => b.targetId === c.o.id)
              const badge = fitBadge(c.o)
              const thumb = thumbFor(c.o, c.w)
              return (
                <div key={c.o.id} className={`nrow ${c.r.suitable ? '' : 'no'}`}>
                  {thumb ? <img src={thumb} alt="" loading="lazy" onClick={() => onShow(c.o, c.w?.framings?.[0]?.id)} /> : <span className="ph" />}
                  <div className="nmeta">
                    <button className="title" onClick={() => onDetails(c.o)}><b>{longName(c.o)}</b></button>
                    <small>{c.o.typeName}{c.o.mag != null ? ` · mag ${c.o.mag}` : ''}</small>
                    <small className="nchips">
                      {c.r.suitable ? <>↑ {Math.round(c.r.peakAlt)}° · {clockIn(tz, c.r.peakAt)}</> : <>below {settings.minAlt}° / no dark time</>}
                      {badge && <em className={`badge2 ${badge.cls}`}>{badge.text}</em>}
                      <em className="badge2 mute">{filterShort(c.o.type)}</em>
                      {c.r.moonPenalty > 0.3 && <em className="badge2 warn">moon</em>}
                    </small>
                  </div>
                  <button className={`star ${c.w ? 'on' : ''}`} title={c.w ? 'On your wishlist' : 'Add to wishlist'} onClick={() => (c.w ? confirm(`Remove ${label(c.o)} from your wishlist?`) && store.removeWish(c.o.id) : store.addWish(c.o.id))}>{c.w ? '★' : '☆'}</button>
                  <button title="Details" onClick={() => onDetails(c.o)}>ⓘ</button>
                  {inPlan
                    ? <button className="plus done" title="Scheduled — click to remove" onClick={() => store.removeBlocksFor(night, c.o.id)}>✓</button>
                    : <button className="plus" title="Add to this night" disabled={!c.r.suitable} onClick={() => addTarget(c)}>＋</button>}
                </div>
              )
            })}
          </div>
        </section>

        {/* schedule */}
        <section className="nsched">
          <div className="ch wrap">
            <h3>Night schedule</h3>
            <small className="note">{dur(planned)} of {dur(d1 - d0)} planned · {scheduledIds.length} target{scheduledIds.length === 1 ? '' : 's'}</small>
            <span className="sp" />
            {verdict && <span className={`vchip ${verdict}`}>{verdict === 'go' ? 'Go' : verdict === 'maybe' ? 'Maybe' : 'Unlikely'} · {Math.round(darkCloud!)}% cloud</span>}
            {!verdict && wxError && <span className="note">forecast unavailable</span>}
            {clearest && <small className="note">Clearest {t(clearest.i)} to {t(clearest.i + 120)}</small>}
            <small className="note">Dark {darkIdx.length ? `${t(d0)} to ${t(d1)} (${((d1 - d0) / 60).toFixed(1)}h)` : 'never (sun too high)'}</small>
            <button onClick={autoFill} disabled={!darkIdx.length}>✨ Auto-fill</button>
            <button onClick={() => blocks.length && confirm('Clear the schedule for this night?') && blocks.forEach((b) => store.removeBlock(b.id))} disabled={!blocks.length}>Clear</button>
          </div>
          {msg && <p className="note nmsg">{msg}</p>}
          {wishlist.length === 0 && blocks.length === 0 && <p className="note">Add targets with ＋, or click a free slot on the timeline to see what fits there. <button className="lnk" onClick={onSky}>Frame something on the sky view</button> to save its exact framing.</p>}

          {!darkIdx.length ? <p className="empty">No astronomical darkness on this date at {loc.name}.</p> : (
            <div className="tline" style={{ height: (r1 - r0) * PX }}>
              <div className="tl-night" style={{ top: y(d0), height: (d1 - d0) * PX }} />
              {hourMarks.map((m) => <div key={m} className="hline" style={{ top: y(m) }}><span>{t(m)}</span></div>)}
              {moonRanges.map(([a, b], i) => { const s = Math.max(a, r0), e = Math.min(b, r1); return e > s ? <div key={i} className="moonband" style={{ top: y(s), height: (e - s) * PX }} title="Moon above the horizon" /> : null })}
              {moonMarks.map((m, i) => <span key={i} className="moonmark" style={{ top: y(m.min) }}>☾ Moon{m.rise ? 'rise' : 'set'} {t(m.min)}</span>)}
              {isToday && <div className="nowl" style={{ top: y(nowMin) }}><em>now</em></div>}

              {gaps.map(([a, b]) => (
                <button key={a} className="gap" style={{ top: y(a) + 2, height: (b - a) * PX - 4 }} onClick={() => setPicker({ from: a, to: b })} title={`Fill ${t(a)}–${t(b)}`}>
                  ＋ {dur(b - a)} free · fill it
                </button>
              ))}

              {blocks.map((raw) => {
                const b = shown(raw)
                const o = lookup(b.targetId)
                if (!o) return null
                const w = wishById.get(o.id)
                const thumb = thumbFor(o, w)
                return (
                  <div key={b.id} className="block" style={{ top: y(b.start), height: (b.end - b.start) * PX - 2, borderLeftColor: colorOf(b.targetId) }}>
                    <div className="grip s" onPointerDown={(e) => down(e, raw, 'start')} onPointerMove={move} onPointerUp={up_} />
                    <div className="bbody" onPointerDown={(e) => down(e, raw, 'move')} onPointerMove={move} onPointerUp={up_}>
                      {thumb && (b.end - b.start) * PX > 50 && <img src={thumb} alt="" draggable={false} />}
                      <div><b>{longName(o)}</b><small>{t(b.start)} to {t(b.end)} · {dur(b.end - b.start)}</small></div>
                    </div>
                    <div className="bbtn"><button title="Details" onPointerDown={(e) => e.stopPropagation()} onClick={() => onDetails(o)}>ⓘ</button>
                      <button title="Remove from the night" onPointerDown={(e) => e.stopPropagation()} onClick={() => store.removeBlock(raw.id)}>✕</button></div>
                    <div className="grip e" onPointerDown={(e) => down(e, raw, 'end')} onPointerMove={move} onPointerUp={up_} />
                  </div>
                )
              })}
            </div>
          )}

          {darkIdx.length > 0 && (
            <svg viewBox={`0 0 ${CW} ${CH}`} className="nalt">
              <rect x={cx(d0)} y={P.t} width={cx(d1) - cx(d0)} height={CH - P.t - P.b} className="nightbg" />
              {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90].map((a) => <g key={a}><line x1={P.l} x2={CW - P.r} y1={cy(a)} y2={cy(a)} className="grid" /><text x={P.l - 4} y={cy(a) + 3} textAnchor="end">{a}°</text></g>)}
              {hourMarks.map((m) => <text key={m} x={cx(m)} y={CH - 16} textAnchor="middle">{t(m)}</text>)}
              <line x1={P.l} x2={CW - P.r} y1={cy(settings.minAlt)} y2={cy(settings.minAlt)} className="minl" />
              {alt.map((a) => {
                const col = colorOf(a.id)
                return (
                  <g key={a.id}>
                    <polyline points={a.pts.map(([m, v]) => `${cx(m)},${cy(v)}`).join(' ')} fill="none" stroke={col} strokeOpacity={0.3} strokeWidth={1.5} />
                    {blocks.filter((b) => b.targetId === a.id).map((b) => {
                      const seg = a.pts.filter(([m]) => m >= b.start && m <= b.end)
                      return (
                        <g key={b.id}>
                          <rect x={cx(b.start)} y={P.t} width={cx(b.end) - cx(b.start)} height={CH - P.t - P.b} fill={col} fillOpacity={0.1} />
                          <polyline points={seg.map(([m, v]) => `${cx(m)},${cy(v)}`).join(' ')} fill="none" stroke={col} strokeWidth={3} />
                          <text x={(cx(b.start) + cx(b.end)) / 2} y={CH - 4} textAnchor="middle" fill={col}>{label(a.o)}</text>
                        </g>
                      )
                    })}
                  </g>
                )
              })}
              {isToday && <line x1={cx(nowMin)} x2={cx(nowMin)} y1={P.t} y2={CH - P.b} className="nowsvg" />}
            </svg>
          )}
        </section>
      </div>

      {picker && (
        <div className="modal" onClick={() => setPicker(null)}>
          <div className="pick" onClick={(e) => e.stopPropagation()}>
            <h2>Fill {t(picker.from)} – {t(picker.to)} <small>({dur(picker.to - picker.from)})</small><button onClick={() => setPicker(null)}>Close</button></h2>
            {(() => {
              const fits = cands.map((c) => ({ c, run: bestRun(c, picker.from, picker.to) })).filter((x) => x.run).sort((a, b) => (b.run![1] - b.run![0]) + b.c.eff - ((a.run![1] - a.run![0]) + a.c.eff)).slice(0, 8)
              return fits.length === 0 ? <p className="note">Nothing in the list is usable in this window.</p> : fits.map(({ c, run }) => (
                <div key={c.o.id} className="nrow">
                  <span className="ph" />
                  <div className="nmeta"><b>{longName(c.o)}</b><small>{c.o.typeName} · usable {t(run![0])} – {t(run![1])} ({dur(run![1] - run![0])}) · peak {Math.round(c.r.peakAlt)}°</small></div>
                  <button className="plus" onClick={() => fillGap(c, picker.from, picker.to)}>＋</button>
                </div>
              ))
            })()}
            <p className="note">Not in the list? Search for it on the left, then add it with ＋.</p>
          </div>
        </div>
      )}
    </div>
  )
}
