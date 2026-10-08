import { useMemo } from 'react'
import { customObject, type CatObject } from '../lib/catalog'
import { lstHours, parallacticFromLst } from '../lib/astro'
import { compute, sessionCrop } from '../lib/optics'
import { clockIn, nightNow, tzOf } from '../lib/tz'
import { cloudAt, meanCloud, useCloud } from '../lib/weather'
import { ephemeris, rankBonus, scoreNights, type NightResult } from '../lib/suitability'
import type { useStore } from '../lib/store'
import type { Scope } from './FramingPreview'

type Store = ReturnType<typeof useStore>

const STEP = 20 // minutes between ephemeris samples
const COLORS = ['#38bdf8', '#fbbf24', '#4ade80', '#c084fc', '#f87171']
const label = (o: CatObject) => (o.id.startsWith('custom:') ? o.names[0] : o.m ? `${o.m} · ${o.id}` : o.id)

interface Row { id: string; w: Store['wishlist'][number]; o: CatObject; r: NightResult; cloud?: number; eff: number }

/** Tonight at a glance: darkness, moon, cloud, and the best wishlist targets with a suggested order for the night. */
export default function Tonight({ store, catalog, scope, onShow, onDetails, onSky }: {
  store: Store; catalog: CatObject[]; scope: Scope
  onShow: (o: CatObject, fid?: string) => void; onDetails: (o: CatObject) => void; onSky: () => void
}) {
  const { active: loc, settings, wishlist } = store
  const tz = tzOf(loc)
  const { cloud, error: wxError } = useCloud(loc)
  const night = useMemo(() => nightNow(tz).night, [tz])
  const nights = useMemo(() => {
    const [y, m, d] = night.split('-').map(Number)
    return ephemeris(loc, new Date(y, m - 1, d), 1)
  }, [loc, night])
  const samples = nights[0].samples
  const byId = useMemo(() => new Map(catalog.map((o) => [o.id, o])), [catalog])
  const now = Date.now()

  // darkness (sun below −12°, the same rule the planner uses) and moon
  const dark = samples.map((s) => s.sun < -12)
  const darkIdx = dark.flatMap((d, i) => (d ? [i] : []))
  const darkStart = darkIdx.length ? samples[darkIdx[0]].t : null
  const darkEnd = darkIdx.length ? samples[darkIdx[darkIdx.length - 1]].t + STEP * 60000 : null
  const darkHours = (darkIdx.length * STEP) / 60
  const moonUp = samples.filter((s, i) => dark[i] && s.moonAlt > 0).length
  const illum = Math.round(nights[0].illum * 100)
  const darkTimes = darkIdx.map((i) => samples[i].t)
  const darkCloud = cloud ? meanCloud(cloud, darkTimes) : undefined
  const clearHours = cloud ? (darkTimes.filter((t) => (cloudAt(cloud, t) ?? 100) < 30).length * STEP) / 60 : undefined
  const verdict = darkCloud === undefined ? null : darkCloud < 30 ? 'go' : darkCloud < 60 ? 'maybe' : 'no'

  const rows: Row[] = useMemo(() => {
    const out: Row[] = []
    for (const w of wishlist) {
      if (w.status === 'done') continue
      const o = byId.get(w.id) ?? (w.custom ? customObject(w.id, w.custom) : undefined)
      if (!o) continue
      const r = scoreNights(loc, o, nights, settings, w.moon)[0]
      const c = cloud ? meanCloud(cloud, samples.filter((_, i) => r.usable[i]).map((s) => s.t)) : undefined
      out.push({ id: w.id, w, o, r, cloud: c, eff: (c === undefined ? r.score : r.score * (1 - c / 100)) + rankBonus(w) })
    }
    return out.filter((x) => x.r.suitable).sort((a, b) => b.eff - a.eff).slice(0, 5)
  }, [wishlist, byId, loc, nights, settings, cloud, samples])

  // suggested order: stay on a target while it is usable; when it is lost, move to the best-ranked one that stays usable longest
  const plan = useMemo(() => {
    const blocks: { row: Row; from: number; to: number }[] = []
    const run = (row: Row, i: number) => { let n = 0; while (i + n < samples.length && row.r.usable[i + n]) n++; return n }
    let cur: Row | null = null
    for (let i = 0; i < samples.length; i++) {
      if (cur && cur.r.usable[i]) { blocks[blocks.length - 1].to = i; continue }
      const avail = rows.filter((r) => r.r.usable[i])
      cur = avail.find((r) => run(r, i) >= 3) ?? avail.sort((a, b) => run(b, i) - run(a, i))[0] ?? null
      if (cur) blocks.push({ row: cur, from: i, to: i })
    }
    return blocks.filter((b) => b.to - b.from + 1 >= 2) // drop slivers under 40 minutes
  }, [rows, samples])

  const fov = useMemo(() => compute(scope.optics, 3), [scope])
  const altaz = (() => { try { return localStorage.getItem('astroplanner.mount') !== 'eq' } catch { return true } })()
  const crop = (row: Row) => {
    if (!altaz) return null
    const angles = samples.flatMap((s, i) => (row.r.usable[i] ? [parallacticFromLst(loc.lat, lstHours(loc, new Date(s.t)), row.o.ra, row.o.dec)] : []))
    return sessionCrop(fov.fovW, fov.fovH, angles)
  }
  const pct = (i: number) => `${(i / samples.length) * 100}%`
  const nowPct = now >= samples[0].t && now <= samples[samples.length - 1].t + STEP * 60000 ? `${((now - samples[0].t) / (samples.length * STEP * 60000)) * 100}%` : null
  const fmtDay = new Date(samples[0].t).toLocaleDateString('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' })
  const t = (ms: number) => clockIn(tz, ms)
  const range = (row: Row) => {
    const idx = row.r.usable.flatMap((u, i) => (u ? [i] : []))
    return idx.length ? `${t(samples[idx[0]].t)} – ${t(samples[idx[idx.length - 1]].t + STEP * 60000)}` : ''
  }

  return (
    <div className="tonight">
      <h2 className="th">Tonight <small>{fmtDay} · {loc.name}</small></h2>

      <section className="tsum">
        <div><span className="k">Darkness</span><b>{darkStart ? `${t(darkStart)} – ${t(darkEnd!)}` : 'No astronomical darkness'}</b><small>{darkStart ? `${darkHours.toFixed(1)} h with the sun below −12°` : 'sun stays too high tonight at this latitude'}</small></div>
        <div><span className="k">Moon</span><b>{illum}% lit</b><small>{moonUp === 0 ? 'down for the whole dark time' : `up for ${((moonUp * STEP) / 60).toFixed(1)} h of the dark time`}</small></div>
        <div><span className="k">Clouds</span>
          <b>{darkCloud === undefined ? (wxError ? 'Forecast unavailable' : 'Loading…') : `${Math.round(darkCloud)}% average`}</b>
          <small>{clearHours === undefined ? ' ' : `${clearHours.toFixed(1)} h under 30% cloud`}</small></div>
        {verdict && <div className={`verdict ${verdict}`}>{verdict === 'go' ? 'Go' : verdict === 'maybe' ? 'Maybe' : 'Unlikely'}</div>}
      </section>

      {wishlist.filter((w) => w.status !== 'done').length === 0 && (
        <p className="empty">Nothing on your wishlist yet. <button className="lnk" onClick={onSky}>Pick a target on the sky view</button> and add it with its framing.</p>
      )}
      {wishlist.some((w) => w.status !== 'done') && rows.length === 0 && (
        <p className="empty">None of your targets reach {settings.minAlt}° for {settings.minHours} h in the dark tonight.</p>
      )}

      {plan.length > 0 && (
        <section className="tplan">
          <h3>Suggested order</h3>
          <div className="pbar">
            {plan.map((b, i) => (
              <span key={i} style={{ left: pct(b.from), width: `calc(${pct(b.to - b.from + 1)} - 2px)`, background: COLORS[rows.indexOf(b.row) % COLORS.length] }} title={`${label(b.row.o)} ${t(samples[b.from].t)}–${t(samples[b.to].t + STEP * 60000)}`}>{label(b.row.o).split(' · ')[0]}</span>
            ))}
            {nowPct && <i className="nowline" style={{ left: nowPct }} />}
          </div>
          <div className="tlx"><span>17h</span><span>20h</span><span>23h</span><span>02h</span><span>05h</span><span>08h</span></div>
          <ol className="plist">{plan.map((b, i) => (
            <li key={i}><i style={{ background: COLORS[rows.indexOf(b.row) % COLORS.length] }} />{t(samples[b.from].t)} – {t(samples[b.to].t + STEP * 60000)} · <button className="title" onClick={() => onDetails(b.row.o)}><b>{label(b.row.o)}</b></button> <small>{(((b.to - b.from + 1) * STEP) / 60).toFixed(1)} h</small></li>
          ))}</ol>
        </section>
      )}

      {rows.map((row, k) => {
        const c = crop(row)
        const thumb = row.w.framings?.[0]?.thumb
        return (
          <article key={row.id} className="tcard">
            {thumb && <img className="thumb sm" src={thumb} alt="" onClick={() => onShow(row.o, row.w.framings?.[0]?.id)} title="Open the saved framing" />}
            <div className="tbody">
              <div className="ch"><i className="dotc" style={{ background: COLORS[k % COLORS.length] }} />
                <button className="title" onClick={() => onDetails(row.o)}><b>{label(row.o)}</b></button> <small>{row.o.id.startsWith('custom:') ? '' : row.o.names[0] ?? row.o.typeName}</small>
                {row.w.status === 'progress' && <span className="tag">in progress</span>}
                {row.w.priority === 'high' && <span className="dot high" title="high priority" />}
                <span className="sp" /><b className="sc" style={{ color: `hsl(${Math.round(Math.min(1, Math.max(0, (row.r.score - 25) / 70)) * 135)} 65% 50%)` }}>{row.r.score}</b></div>
              <div className="tl">{row.r.usable.map((u, i) => <span key={i} className={u ? 'u' : ''} />)}</div>
              {cloud && (
                <div className="tl cl" title="Cloud cover forecast">{samples.map((s, i) => {
                  const cc = cloudAt(cloud, s.t)
                  return <span key={i} style={{ background: cc === undefined ? 'transparent' : `rgba(148,163,184,${0.12 + (cc / 100) * 0.85})` }} />
                })}</div>
              )}
              <p className="note">
                {range(row)} · {row.r.rawHours.toFixed(1)} h usable · peak {row.r.peakAlt.toFixed(0)}°
                {row.r.moonPenalty > 0.3 ? ' · ⚠ moon' : ''}{row.cloud !== undefined ? ` · cloud ${Math.round(row.cloud)}%` : ''}
                {c && <> · crop <b>{(c.w * 60).toFixed(0)}′×{(c.h * 60).toFixed(0)}′</b> ({Math.round(c.scale * 100)}% per side, field turns {c.spread.toFixed(0)}°)</>}
                <button className="lnk" onClick={() => onShow(row.o, row.w.framings?.[0]?.id)}>Show on sky</button>
              </p>
            </div>
          </article>
        )
      })}
    </div>
  )
}
