import { useEffect, useMemo, useState } from 'react'
import { cometId, cometObject, cometPos, constellationOf, loadComets, loadSightings, remember, type CometSighting, type CometTarget } from '../lib/comets'
import type { CatObject } from '../lib/catalog'
import { clockIn, nightNow, tzOf } from '../lib/tz'
import { COMET_LIMIT, ephemeris, scoreNights } from '../lib/suitability'
import type { useStore } from '../lib/store'

type Store = ReturnType<typeof useStore>

const LIMITS = [8, 10, 12, 14]
const TREND_DAYS = 14
const fmtDate = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/** Comets bright enough to image now: observed brightness (COBS) where there is one, else the MPC prediction. */
export default function Comets({ store, onDetails, onShow }: { store: Store; onDetails: (o: CatObject) => void; onShow: (o: CatObject) => void }) {
  const { active: loc, settings, wishlist } = store
  const tz = tzOf(loc)
  const [comets, setComets] = useState<CometTarget[] | null>(null)
  const [seen, setSeen] = useState<Map<string, CometSighting>>(new Map())
  const [error, setError] = useState('')
  const [limit, setLimit] = useState(12)
  const [onlyUp, setOnlyUp] = useState(false)
  useEffect(() => {
    loadComets().then(setComets).catch(() => setError('The Minor Planet Center could not be reached, and there is no saved copy yet.'))
    loadSightings().then(setSeen)
  }, [])

  const nights = useMemo(() => {
    const [y, m, d] = nightNow(tz).night.split('-').map(Number)
    return ephemeris(loc, new Date(y, m - 1, d), 1)
  }, [loc, tz])

  const rows = useMemo(() => {
    if (!comets) return []
    const now = Date.now()
    return comets.flatMap((c) => {
      const id = cometId(c.desig)
      const p = cometPos(c.el, now)
      const obs = seen.get(id)
      if ((obs?.mag ?? p.mag) > limit) return []
      const dm = obs ? obs.mag - p.mag : 0
      const c2: CometTarget = { ...c, dm: obs ? +dm.toFixed(2) : undefined }
      const later = cometPos(c.el, now + TREND_DAYS * 86400000)
      const o = cometObject(c2)
      const tonight = scoreNights(loc, o, nights, settings)[0]
      return [{ c: c2, id, o, p, obs, mag: obs?.mag ?? p.mag, trend: later.mag - p.mag, tonight }]
    }).filter((r) => !onlyUp || r.tonight.suitable).sort((a, b) => a.mag - b.mag)
  }, [comets, seen, limit, onlyUp, loc, nights, settings])

  const wished = useMemo(() => new Set(wishlist.map((w) => w.id)), [wishlist])
  const open = (r: (typeof rows)[number], f: (o: CatObject) => void) => { remember(r.c); f(r.o) }

  return (
    <div className="comets">
      <div className="catbar">
        <select value={limit} onChange={(e) => setLimit(+e.target.value)}>{LIMITS.map((l) => <option key={l} value={l}>Brighter than mag {l}</option>)}</select>
        <label className="note"><input type="checkbox" checked={onlyUp} onChange={(e) => setOnlyUp(e.target.checked)} /> Up tonight from {loc.name}</label>
        <span className="sp" />
        <small className="note">{comets ? `${rows.length} comets` : error ? '' : 'Loading comets…'}</small>
      </div>
      {error && <p className="empty">{error}</p>}
      {comets && rows.length === 0 && <p className="empty">No comets brighter than mag {limit}{onlyUp ? ' are up tonight' : ' right now'}.</p>}
      {rows.length > 0 && (
        <div className="ctab"><table>
          <thead><tr><th>Comet</th><th>Mag</th><th>Trend ({TREND_DAYS} d)</th><th>Perihelion</th><th>Earth</th><th>Where</th><th>Tonight</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td><button className="title" onClick={() => open(r, onDetails)}><b>{r.c.desig}</b></button>{r.c.name !== r.c.desig && <small>{r.c.name.replace(/^.*\(|\)$/g, '').replace(/^\d+[PDI]\//, '')}</small>}</td>
              <td title={r.obs ? `Observed (COBS); MPC predicts ${r.p.mag.toFixed(1)}` : 'Predicted from MPC elements, not recently observed'}><b>{r.mag.toFixed(1)}</b> <small>{r.obs ? 'obs.' : 'pred.'}</small></td>
              <td className={r.trend < -0.2 ? 'up' : r.trend > 0.2 ? 'down' : ''}>{r.trend < -0.2 ? '↑ brightening' : r.trend > 0.2 ? '↓ fading' : '→ steady'}</td>
              <td>{fmtDate(r.c.el.tp)}<small>q {r.c.el.q.toFixed(2)} AU</small></td>
              <td>{r.p.delta.toFixed(2)} AU</td>
              <td>{constellationOf(r.p.ra, r.p.dec)}<small>{Math.round(r.p.elong)}° from the sun</small></td>
              <td>{r.tonight.suitable ? <em className="badge2 ok">↑ {Math.round(r.tonight.peakAlt)}° · {clockIn(tz, r.tonight.peakAt)}</em> : <em className="badge2 mute">{r.p.elong < 35 ? 'too near the sun' : r.mag > COMET_LIMIT ? `fainter than ${COMET_LIMIT}` : 'not up tonight'}</em>}</td>
              <td className="acts">
                <button className={`star ${wished.has(r.id) ? 'on' : ''}`} title={wished.has(r.id) ? 'One of your targets' : 'Add to your targets'}
                  onClick={() => (wished.has(r.id) ? confirm(`Remove ${r.c.desig} from your targets?`) && store.removeWish(r.id) : store.addWish(r.id, { comet: r.c }))}>{wished.has(r.id) ? '★' : '☆'}</button>
                <button title="Details and finder chart" onClick={() => open(r, onDetails)}>ⓘ</button>
                <button onClick={() => open(r, onShow)}>Show on sky</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="note">Orbits from the <a href="https://www.minorplanetcenter.net/iau/MPCORB/CometEls.txt" target="_blank" rel="noreferrer">Minor Planet Center</a>; observed brightness from <a href="https://cobs.si" target="_blank" rel="noreferrer">COBS</a>. Comets are unpredictable: predictions can be off by several magnitudes.</p>
    </div>
  )
}
