import { useEffect, useMemo, useState } from 'react'
import { customObject, isCustom, type CatObject } from '../lib/catalog'
import TargetInfo from './TargetInfo'
import type { ObsPrefill } from './ObservationForm'
import type { useStore } from '../lib/store'
import { tzOf, todayIn } from '../lib/tz'
import { cloudAt, meanCloud, useCloud, type Cloud } from '../lib/weather'
import { bestPeriods, defaultMoonTolerance, rankBonus, ephemeris, scoreNights, weekly, type EphemNight, type NightResult } from '../lib/suitability'

type Store = ReturnType<typeof useStore>
const DAYS = 365

const scoreColor = (s: number) => {
  if (s <= 0) return '#1b2436'
  const t = Math.min(1, Math.max(0, (s - 25) / 70))
  return `hsl(${Math.round(t * 135)} 65% ${30 + t * 8}%)`
}
const label = (o: CatObject) => (isCustom(o.id) ? o.names[0] : o.m ? `${o.m} · ${o.id}` : o.id)
const fmt = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

export default function Planner({ store, catalog, onShow, onDetails, onLog }: { store: Store; catalog: CatObject[]; onShow: (o: CatObject, fid?: string) => void; onDetails: (o: CatObject) => void; onLog: (p: ObsPrefill) => void }) {
  const [tab, setTab] = useState<'wishlist' | 'calendar'>('calendar')
  const [nights, setNights] = useState<EphemNight[] | null>(null)
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [picked, setPicked] = useState<number>(0)
  const [onlyOpen, setOnlyOpen] = useState(true)
  const [useWx, setUseWx] = useState(true)
  const { active: loc, settings, wishlist } = store

  const { cloud, error: wxError } = useCloud(loc)
  const byId = useMemo(() => new Map(catalog.map((o) => [o.id, o])), [catalog])
  const tz = tzOf(loc)
  const start = useMemo(() => { const [y, m, d] = todayIn(tz).split('-').map(Number); return new Date(y, m - 1, d) }, [tz])

  // sun/moon for the next year: heavy, so computed after first paint
  useEffect(() => {
    setNights(null)
    const h = setTimeout(() => setNights(ephemeris(loc, start, DAYS)), 30)
    return () => clearTimeout(h)
  }, [loc.lat, loc.lon, loc.elevation, tz]) // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(
    () => wishlist.map((w) => ({ w, o: byId.get(w.id) ?? (w.custom ? customObject(w.id, w.custom) : undefined) })).filter((x): x is { w: typeof x.w; o: CatObject } => !!x.o),
    [wishlist, byId],
  )

  const results = useMemo(() => {
    const m = new Map<string, NightResult[]>()
    if (!nights) return m
    for (const { w, o } of items) m.set(w.id, scoreNights(loc, o, nights, settings, w.moon))
    return m
  }, [nights, items, loc, settings])

  const active = items.filter((x) => x.w.status !== 'done')

  return (
    <div className="planner">
      <div className="ptabs">
        <button className={tab === 'calendar' ? 'on' : ''} onClick={() => setTab('calendar')}>Calendar</button>
        <button className={tab === 'wishlist' ? 'on' : ''} onClick={() => setTab('wishlist')}>Wishlist ({wishlist.length})</button>
        <span className="note">{loc.name} · {wxError ? 'forecast unavailable' : cloud ? 'forecast loaded' : 'loading forecast…'} · min alt {settings.minAlt}° · ≥ {settings.minHours} h</span>
        <label className="f inl"><span>Min altitude</span><input type="number" value={settings.minAlt} onChange={(e) => store.setSettings({ minAlt: +e.target.value })} /></label>
        <label className="f inl"><span>Min hours</span><input type="number" step="0.5" value={settings.minHours} onChange={(e) => store.setSettings({ minHours: +e.target.value })} /></label>
      </div>

      {!nights && items.length > 0 && <p className="note">Calculating a year of nights…</p>}
      {items.length === 0 && <p className="empty">Your wishlist is empty. Pick an object on the sky view and press “☆ Add to wishlist”.</p>}

      {tab === 'wishlist' && items.map(({ w, o }) => {
        const r = results.get(w.id)
        const wk = r ? weekly(r) : []
        const tol = w.moon ?? defaultMoonTolerance(o.type)
        return (
          <div key={w.id} className="card">
            <div className="ch">
              <button className="title" onClick={() => onDetails(o)} title="Details"><b>{label(o)}</b></button> <small>{o.names[0] ?? o.typeName}</small>{w.priority && <span className={`dot ${w.priority}`} title={`${w.priority} priority`} />}
              <span className="sp" />
              <button onClick={() => onShow(o)}>Show</button>
              <button onClick={() => confirm(`Remove ${o.id}?`) && store.removeWish(w.id)}>✕</button>
            </div>
            {r && (
              <>
                <svg viewBox="0 0 530 26" className="strip">
                  {wk.map((x, i) => <rect key={i} x={i * 10} y={0} width={9} height={22} rx={2} fill={scoreColor(x.score)}><title>{fmt(x.start)}: {Math.round(x.score)}</title></rect>)}
                  {wk.map((x, i) => (x.start.getDate() <= 7 ? <text key={i} x={i * 10} y={25} fontSize={7} fill="#8b97ab">{x.start.toLocaleDateString('en-GB', { month: 'short' })}</text> : null))}
                </svg>
                <p className="note">Best: {bestPeriods(r)}</p>
              </>
            )}
            <div className="row wrap">
              <label className="f inl"><span>Status</span>
                <select value={w.status} onChange={(e) => store.patchWish(w.id, { status: e.target.value as typeof w.status })}>
                  <option value="wishlist">Wishlist</option><option value="progress">In progress</option><option value="done">Done</option>
                </select></label>
              <label className="f inl"><span>Moon</span>
                <select value={w.moon ?? ''} onChange={(e) => store.patchWish(w.id, { moon: (e.target.value || undefined) as typeof w.moon })}>
                  <option value="">Auto ({tol === 'tolerant' ? 'tolerant' : 'needs dark'})</option><option value="tolerant">Tolerant</option><option value="dark">Needs dark sky</option>
                </select></label>
              <label className="f inl"><span>Goal h</span>
                <input type="number" min={0} step="0.5" value={w.goalHours ?? ''} placeholder="—" onChange={(e) => store.patchWish(w.id, { goalHours: e.target.value ? +e.target.value : undefined })} /></label>
            </div>
            {!!w.framings?.length && (
              <div className="frs">{w.framings.map((f) => f.thumb
                ? <figure key={f.id} onClick={() => onShow(o, f.id)} title="Open this framing on the sky"><img className="thumb sm" src={f.thumb} alt={f.name} /><figcaption>{f.name}</figcaption></figure>
                : <button key={f.id} className="lnk" onClick={() => onShow(o, f.id)}>{f.name}</button>)}</div>
            )}
            <More title="About & example images"><TargetInfo o={o} /></More>
            <input className="notes" placeholder="Notes" value={w.notes} onChange={(e) => store.patchWish(w.id, { notes: e.target.value })} />
            <Sessions w={w} store={store} onLog={onLog} />
          </div>
        )
      })}

      {tab === 'calendar' && items.length > 0 && nights && (
        <CalendarView {...{ month, setMonth, picked, setPicked, onlyOpen, setOnlyOpen, start, results, active: onlyOpen ? active : items, onShow, onDetails, nights, cloud, useWx, setUseWx }} />
      )}
    </div>
  )
}

/** Collapsed by default; the content (and its network requests) only mount once opened. */
function More({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return <details className="more" onToggle={(e) => setOpen(e.currentTarget.open)}><summary>{title}</summary>{open && children}</details>
}

type Item = { w: Store['wishlist'][number]; o: CatObject }

function CalendarView({ month, setMonth, picked, setPicked, onlyOpen, setOnlyOpen, start, results, active, onShow, onDetails, nights, cloud, useWx, setUseWx }: {
  month: Date; setMonth: (d: Date) => void; picked: number; setPicked: (i: number) => void
  onlyOpen: boolean; setOnlyOpen: (b: boolean) => void; start: Date
  results: Map<string, NightResult[]>; active: Item[]; onShow: (o: CatObject) => void; onDetails: (o: CatObject) => void
  nights: EphemNight[]; cloud: Cloud | null; useWx: boolean; setUseWx: (b: boolean) => void
}) {
  const dayIdx = (d: Date) => Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()) / 86400000)
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const lead = (first.getDay() + 6) % 7
  const dim = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells: (Date | null)[] = [...Array(lead).fill(null), ...Array.from({ length: dim }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))]

  const best = (idx: number) => {
    let n = 0, sum = 0
    for (const x of active) {
      const r = results.get(x.w.id)?.[idx]
      if (r?.suitable) n++
      sum += r?.score ?? 0
    }
    return { n, top: active.length ? sum / active.length : 0 }
  }

  const darkCloud = (idx: number) =>
    cloud && nights[idx] ? meanCloud(cloud, nights[idx].samples.filter((e) => e.sun < -12).map((e) => e.t)) : undefined
  const eff = (r: NightResult, idx: number) => {
    const c = useWx && cloud && nights[idx] ? meanCloud(cloud, nights[idx].samples.filter((_, i) => r.usable[i]).map((e) => e.t)) : undefined
    return c === undefined ? r.score : r.score * (1 - c / 100)
  }

  // unfinished projects first, then by the priority the user gave

  const rows = active
    .map((x) => ({ ...x, r: results.get(x.w.id)?.[picked] }))
    .filter((x): x is typeof x & { r: NightResult } => !!x.r)
    .sort((a, b) => eff(b.r, picked) + rankBonus(b.w) - (eff(a.r, picked) + rankBonus(a.w)))

  const pickedDate = new Date(start.getFullYear(), start.getMonth(), start.getDate() + picked)

  return (
    <>
      <div className="mhead">
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
        <b>{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b>
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
        <label className="note"><input type="checkbox" checked={useWx} onChange={(e) => setUseWx(e.target.checked)} /> rank by forecast</label>
        <label className="note"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> hide done</label>
      </div>
      <div className="cal">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <div key={d} className="dow">{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />
          const idx = dayIdx(d)
          if (idx < 0 || idx >= DAYS) return <div key={i} className="day off">{d.getDate()}</div>
          const { n, top } = best(idx)
          return (
            <button key={i} className={`day ${idx === picked ? 'sel' : ''}`} style={{ background: scoreColor(top) }} onClick={() => setPicked(idx)}>
              {d.getDate()}{n > 0 && <i>{n}</i>}
              {darkCloud(idx) !== undefined && <em className="wx">☁ {Math.round(darkCloud(idx)!)}%</em>}
            </button>
          )
        })}
      </div>
      <h3>{fmt(pickedDate)} — ranked candidates</h3>
      {rows.length === 0 && <p className="note">Nothing on the list for this night.</p>}
      {rows.map(({ w, o, r }) => (
        <div key={w.id} className={`cand ${r.suitable ? '' : 'no'}`}>
          <div className="ch"><button className="title" onClick={() => onDetails(o)} title="Details"><b>{label(o)}</b></button> <small>{o.names[0] ?? o.typeName}</small>{w.status === 'progress' && <span className="tag">in progress</span>}
            <span className="sp" /><b className="sc" style={{ color: scoreColor(Math.max(r.score, 30)) }}>{r.score}</b></div>
          <div className="tl">{r.usable.map((u, i) => <span key={i} className={u ? 'u' : ''} />)}</div>
          {cloud && nights[picked] && nights[picked].samples.some((e) => cloudAt(cloud, e.t) !== undefined) && (
            <div className="tl cl" title="Cloud cover forecast">{nights[picked].samples.map((e, i) => {
              const c = cloudAt(cloud, e.t)
              return <span key={i} style={{ background: c === undefined ? 'transparent' : `rgba(148,163,184,${0.12 + (c / 100) * 0.85})` }} />
            })}</div>
          )}
          <div className="tlx"><span>17h</span><span>20h</span><span>23h</span><span>02h</span><span>05h</span><span>08h</span></div>
          <p className="note">{r.rawHours.toFixed(1)} h usable · peak {r.peakAlt.toFixed(0)}° · moon {Math.round(r.moonIllum * 100)}%{r.moonPenalty > 0.3 ? ' ⚠ moon' : ''}
            {(() => { const c = cloud && nights[picked] ? meanCloud(cloud, nights[picked].samples.filter((_, i) => r.usable[i]).map((e) => e.t)) : undefined; return c === undefined ? '' : ` · cloud ${Math.round(c)}%` })()}
            {!r.suitable && ' · below min window'} <button className="lnk" onClick={() => onShow(o)}>Show on sky</button></p>
        </div>
      ))}
    </>
  )
}

function Sessions({ w, store, onLog }: { w: Item['w']; store: Store; onLog: (p: ObsPrefill) => void }) {
  const sessions = [...(w.sessions ?? [])].sort((a, b) => b.date.localeCompare(a.date))
  const total = sessions.reduce((a, x) => a + x.hours, 0)
  const pct = w.goalHours ? Math.min(100, (total / w.goalHours) * 100) : 0
  return (
    <div className="ses">
      <p className="note">
        <b>{total.toFixed(1)} h</b> captured{w.goalHours ? ` of ${w.goalHours} h (${Math.round(pct)}%)` : ''} · {sessions.length} session{sessions.length === 1 ? '' : 's'}
      </p>
      {w.goalHours ? <div className="bar"><span style={{ width: `${pct}%` }} /></div> : null}
      {sessions.map((x) => (
        <p key={x.id} className="note srow"><span>{x.date} · {x.hours.toFixed(2).replace(/\.?0+$/, '')} h{x.frames && x.exposure ? ` (${x.frames}×${x.exposure}s)` : ''}{x.setup ? ` · ${x.setup}` : ''}{x.note ? ` · ${x.note}` : ''}</span>
          <span><button className="lnk" onClick={() => onLog({ targetId: w.id, sessionId: x.id })}>edit</button>
          <button className="lnk" onClick={() => store.removeSession(w.id, x.id)}>remove</button></span></p>
      ))}
      <div className="row"><button onClick={() => onLog({ targetId: w.id })}>＋ Log observation</button></div>
    </div>
  )
}
