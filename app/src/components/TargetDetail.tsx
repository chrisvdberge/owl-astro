import { useMemo } from 'react'
import { catalogTag, isCustom, sexa, type CatObject } from '../lib/catalog'
import type { useStore, Priority } from '../lib/store'
import { sampleNight, targetAltAz } from '../lib/astro'
import { compute, framingFit } from '../lib/optics'
import { bestMonths, compass, monthlyPeaks, monthName } from '../lib/monthly'
import { clockIn, nightNow, tzOf } from '../lib/tz'
import { useSummary } from '../lib/wiki'
import AltitudeChart from './AltitudeChart'
import TargetInfo from './TargetInfo'
import { filterAdvice } from '../lib/filters'
import FramingPreview, { type Scope } from './FramingPreview'

type Store = ReturnType<typeof useStore>

const PRIORITIES: { id: Priority; label: string; color: string }[] = [
  { id: 'high', label: 'High', color: 'var(--bad)' }, { id: 'medium', label: 'Medium', color: 'var(--warn)' }, { id: 'low', label: 'Low', color: 'var(--mute)' },
]

export default function TargetDetail({ o, store, scope, onClose, onShow, onPlanner, onLog }: {
  o: CatObject; store: Store; scope: Scope
  onClose: () => void; onShow: (fid?: string) => void; onPlanner: () => void; onLog: () => void
}) {
  const { active: loc, settings, wishlist } = store
  const wish = wishlist.find((w) => w.id === o.id)
  const { summary, loading } = useSummary(o)
  const tz = tzOf(loc)
  const fov = useMemo(() => compute(scope.optics, 3), [scope])
  const fit = framingFit(o.maj, o.min, fov.fovW, fov.fovH)
  const minAlt = settings.minAlt

  const night = useMemo(() => nightNow(tz), [tz])
  const samples = useMemo(() => {
    const [y, m, d] = night.night.split('-').map(Number)
    return sampleNight(loc, o.ra, o.dec, new Date(y, m - 1, d), 10, minAlt)
  }, [loc, o.ra, o.dec, night.night, minAlt])
  const now = targetAltAz(loc, o.ra, o.dec, new Date())
  const dark = samples.filter((s) => s.sun < -12)
  const peak = dark.length ? dark.reduce((a, b) => (b.alt > a.alt ? b : a)) : null
  const peaks = useMemo(() => monthlyPeaks(loc, o.ra, o.dec, new Date()), [loc, o.ra, o.dec])
  const best = bestMonths(peaks, minAlt)
  const top = Math.max(60, ...peaks.map((p) => p.alt))
  const advice = filterAdvice(o.type)
  const title = isCustom(o.id) ? o.names[0] : o.m ?? o.id
  const sub = isCustom(o.id) ? '' : o.names[0] ?? ''

  return (
    <div className="modal" onClick={onClose}>
      <div className="detail" onClick={(e) => e.stopPropagation()}>
        <header className="dh">
          <div>
            <h2><b>{title}</b> {sub && <span>{sub}</span>}
              {fit?.kind === 'mosaic' && <em className="tag warn">Mosaic {fit.cols}×{fit.rows}</em>}
              {fit?.kind === 'small' && <em className="tag warn">Small</em>}
              {fit?.kind === 'fits' && <em className="tag ok">Fits</em>}
            </h2>
            <p className="note">{o.typeName}{!isCustom(o.id) && ` · ${catalogTag(o)}`} · {o.con}{o.mag != null && ` · mag ${o.mag}`}{o.maj ? ` · ${o.maj}′${o.min ? ` × ${o.min}′` : ''}` : ''} · {sexa(o.ra, o.dec)}</p>
            {wish && (
              <div className="pills">{PRIORITIES.map((p) => (
                <button key={p.id} className={wish.priority === p.id ? 'on' : ''} onClick={() => store.patchWish(o.id, { priority: wish.priority === p.id ? undefined : p.id })}>
                  <i style={{ background: p.color }} />{p.label}</button>
              ))}</div>
            )}
          </div>
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {!isCustom(o.id) && (
          <section className="about">
            {summary?.thumb && <img src={summary.thumb} alt={summary.title} />}
            <div>
              {loading && <p className="note">Loading description…</p>}
              {summary && <><p>{summary.extract}</p><a className="chip" href={summary.url} target="_blank" rel="noreferrer">Wikipedia ↗</a></>}
              {!loading && !summary && <p className="note">No matching Wikipedia article — see the links below.</p>}
            </div>
          </section>
        )}

        <FramingPreview o={o} wish={wish} scope={scope} onSave={(data, thumb) => {
          store.addWish(o.id, { status: 'wishlist', custom: isCustom(o.id) ? { name: o.names[0], ra: o.ra, dec: o.dec, con: o.con } : undefined })
          store.addFraming(o.id, { ...data, id: crypto.randomUUID(), name: `Framing ${(wish?.framings?.length ?? 0) + 1}`, created: new Date().toISOString().slice(0, 10), thumb })
        }} />

        <div className="two">
          <section className="card">
            <h3>Filter recommendations <small>(general guidance)</small></h3>
            <dl className="adv">
              <dt>Color</dt><dd><span className="pill r">{advice.color}</span></dd>
              <dt>Mono</dt><dd><span className="pill p">{advice.mono}</span></dd>
              <dt>Seestar</dt><dd><span className="pill b">{advice.seestar}</span></dd>
            </dl>
          </section>
          <section className="card">
            <div className="now"><b>{Math.round(now.alt)}°</b><span>Current altitude · {loc.name}</span><em>{compass(now.az)}</em></div>
            <AltitudeChart samples={samples} loc={loc} minAlt={minAlt} marker={night.tmin} compact />
          </section>
        </div>

        <section className="card">
          <div className="ch"><h3>Max altitude during darkness — next 12 months</h3><span className="sp" /><b className="best">Best: {best}</b></div>
          <div className="plot">
            {peaks.map((p, i) => <span key={i} className={p.alt >= minAlt ? 'ok' : ''} style={{ height: `${Math.max(1.5, (p.alt / top) * 100)}%` }} title={`${monthName(p.month)} ${p.year}: ${Math.round(p.alt)}°`} />)}
            <i className="min" style={{ bottom: `${(minAlt / top) * 100}%` }}><small>{minAlt}°</small></i>
          </div>
          <div className="lab">{peaks.map((p, i) => <small key={i}>{monthName(p.month)}</small>)}</div>
        </section>

        <p className={`peak ${peak && peak.alt >= minAlt ? 'ok' : ''}`}>
          {peak ? `Tonight peaks ${Math.round(peak.alt)}° around ${clockIn(tz, peak.t.getTime())}${peak.alt < minAlt ? ` — below your ${minAlt}° minimum` : ''}` : 'No astronomical darkness tonight at this location'}
        </p>

        <TargetInfo o={o} compact />

        {wish && <textarea className="notes" rows={2} placeholder="Notes" value={wish.notes} onChange={(e) => store.patchWish(o.id, { notes: e.target.value })} />}

        <footer className="df">
          {wish ? <button className="pri" onClick={onPlanner}>📅 Open in Planner</button> : <button className="pri" onClick={() => store.addWish(o.id, { status: 'progress' })}>＋ Add to planner</button>}
          {!wish && <button onClick={() => store.addWish(o.id)}>☆ Add to wishlist</button>}
          <button onClick={() => onShow(wish?.framings?.[0]?.id)}>▭ Framing &amp; Mosaic</button>
          <button onClick={onLog}>＋ Log observation</button>
          <span className="sp" />
          {wish && <button onClick={() => confirm(`Remove ${title} from your wishlist?`) && (store.removeWish(o.id), onClose())}>🗑 Remove from wishlist</button>}
        </footer>
      </div>
    </div>
  )
}
