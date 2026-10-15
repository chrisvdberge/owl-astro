import { useEffect, useMemo, useState } from 'react'
import * as Astronomy from 'astronomy-engine'
import { findEvents, loadStars, type EventKind, type SkyEvent, type Star } from '../lib/events'
import { cometId, cometPos, loadComets, loadSightings, type CometTarget } from '../lib/comets'
import type { CatObject } from '../lib/catalog'
import { compute } from '../lib/optics'
import { compass } from '../lib/monthly'
import { clockIn, tzOf } from '../lib/tz'
import type { useStore } from '../lib/store'
import type { Scope } from './FramingPreview'

type Store = ReturnType<typeof useStore>

const KINDS: { id: EventKind | 'all'; label: string }[] = [
  { id: 'all', label: 'All events' }, { id: 'occultation', label: 'Occultations' }, { id: 'pass', label: 'Close passes' },
  { id: 'comet', label: 'Comets' }, { id: 'eclipse', label: 'Eclipses' },
]
const TAG: Record<EventKind, string> = { occultation: 'Occultation', pass: 'Close pass', comet: 'Comet', eclipse: 'Eclipse' }
const SPANS = [30, 90, 180]
const COMET_MAG = 11 // comets from the MPC list taken into account (your comet targets always are)

/** Occultations, close passes, comets meeting deep-sky objects and eclipses, from the active site. */
export default function Events({ store, catalog, scope, onShow }: { store: Store; catalog: CatObject[]; scope: Scope; onShow: (e: SkyEvent) => void }) {
  const { active: loc, wishlist } = store
  const tz = tzOf(loc)
  const [kind, setKind] = useState<EventKind | 'all'>('all')
  const [days, setDays] = useState(90)
  const [onlyVisible, setOnlyVisible] = useState(true)
  const [stars, setStars] = useState<Star[] | null>(null)
  const [comets, setComets] = useState<CometTarget[]>([])
  const [events, setEvents] = useState<SkyEvent[] | null>(null)
  const fov = useMemo(() => compute(scope.optics, 3), [scope])

  useEffect(() => { loadStars().then(setStars) }, [])
  // comets: your comet targets plus the ones bright enough right now
  const own = useMemo(() => wishlist.flatMap((w) => (w.comet ? [w.comet] : [])), [wishlist])
  useEffect(() => {
    Promise.all([loadComets(), loadSightings()]).then(([all, seen]) => {
      const now = Date.now()
      setComets(all.flatMap((c) => {
        const pred = cometPos(c.el, now).mag, obs = seen.get(cometId(c.desig))?.mag
        return (obs ?? pred) <= COMET_MAG ? [{ ...c, dm: obs != null ? obs - pred : undefined }] : []
      }))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!stars || !catalog.length) return
    setEvents(null)
    // a few hundred ms of work: let the page paint first
    const id = setTimeout(() => {
      const all = [...own, ...comets.filter((c) => !own.some((o) => o.desig === c.desig))]
      setEvents(findEvents(loc, Date.now(), days, { stars, catalog, comets: all }))
    }, 30)
    return () => clearTimeout(id)
  }, [stars, catalog, comets, own, loc, days])

  const rows = (events ?? []).filter((e) => (kind === 'all' || e.kind === kind) && (!onlyVisible || e.visible))
  const months = new Map<string, SkyEvent[]>()
  for (const e of rows) {
    const k = new Date(e.t).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: tz })
    months.set(k, [...(months.get(k) ?? []), e])
  }
  const frame = Math.min(fov.fovW, fov.fovH)

  return (
    <div className="events">
      <div className="catbar">
        <div className="chips">{KINDS.map((k) => <button key={k.id} className={kind === k.id ? 'on' : ''} onClick={() => setKind(k.id)}>{k.label}</button>)}</div>
        <span className="sp" />
        <label className="note"><input type="checkbox" checked={onlyVisible} onChange={(e) => setOnlyVisible(e.target.checked)} /> Visible from {loc.name}</label>
        <select value={days} onChange={(e) => setDays(+e.target.value)}>{SPANS.map((d) => <option key={d} value={d}>Next {d} days</option>)}</select>
      </div>
      {!events && <p className="empty">Working out the sky for the next {days} days…</p>}
      {events && rows.length === 0 && <p className="empty">No {kind === 'all' ? '' : `${KINDS.find((k) => k.id === kind)!.label.toLowerCase()} `}events{onlyVisible ? ` visible from ${loc.name}` : ''} in the next {days} days.</p>}
      {[...months].map(([m, list]) => (
        <section key={m} className="evmonth">
          <h3>{m}</h3>
          {list.map((e) => {
            const moon = Astronomy.Illumination(Astronomy.Body.Moon, new Date(e.t)).phase_fraction
            const fits = e.span > 0 && e.span * 1.15 < frame
            return (
              <article key={e.id} className={`evrow ${e.visible ? '' : 'off'}`}>
                <div className="evwhen">
                  <b>{new Date(e.t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz })}</b>
                  <span>{clockIn(tz, e.t)}{e.end && e.kind !== 'eclipse' ? `–${clockIn(tz, e.end)}` : ''}</span>
                </div>
                <div className="evbody">
                  <p><em className={`badge2 ${e.kind === 'occultation' || e.kind === 'eclipse' ? 'warn' : 'mute'}`}>{TAG[e.kind]}</em> <b>{e.title}</b></p>
                  <p className="note">{e.detail}</p>
                  <p className="note">
                    {e.alt > 0 ? `${Math.round(e.alt)}° up in the ${compass(e.az)}` : 'below the horizon'}
                    {e.kind !== 'eclipse' || e.bodies[0] !== 'Sun' ? ` · ${e.sun < -18 ? 'dark sky' : e.sun < -6 ? 'twilight' : 'daylight'}` : ''}
                    {e.bodies[0] !== 'Moon' && e.bodies[0] !== 'Sun' ? ` · Moon ${Math.round(moon * 100)}%` : ''}
                    {fits && <> <em className="badge2 ok">Fits your frame</em></>}
                  </p>
                </div>
                <div className="evact"><button onClick={() => onShow(e)} disabled={e.bodies[0] === 'Sun'} title={e.bodies[0] === 'Sun' ? 'The sky view does not show daytime' : 'Open the sky at this moment'}>Show on sky</button></div>
              </article>
            )
          })}
        </section>
      ))}
      <p className="note">Computed for {loc.name} with astronomy-engine. Bright stars from SIMBAD; comets from the Minor Planet Center (brighter than mag {COMET_MAG}, plus your comet targets). Times are local to the site.</p>
    </div>
  )
}
