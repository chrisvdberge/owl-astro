import { useMemo, useState } from 'react'
import { customObject, isCustom, type CatObject } from '../lib/catalog'
import type { useStore } from '../lib/store'
import type { ObsPrefill } from './ObservationForm'

type Store = ReturnType<typeof useStore>
const NONE = 'Unspecified setup'
const h = (n: number) => (n < 1 ? `${Math.round(n * 60)} min` : `${n.toFixed(n >= 10 ? 0 : 1)} h`)

/** Everything imaged so far: integration time per setup, per target, and the log itself. */
export default function Observations({ store, catalog, onDetails, onAdd, onEdit }: {
  store: Store; catalog: CatObject[]; onDetails: (o: CatObject) => void; onAdd: () => void; onEdit: (p: ObsPrefill) => void
}) {
  const { wishlist } = store
  const [setup, setSetup] = useState<string>('')
  const byId = useMemo(() => new Map(catalog.map((o) => [o.id, o])), [catalog])
  const objOf = (id: string, w?: (typeof wishlist)[number]): CatObject | undefined => byId.get(id) ?? (w?.custom ? customObject(id, w.custom) : undefined)

  const all = useMemo(() => wishlist.flatMap((w) => (w.sessions ?? []).map((s) => ({ w, s, setup: s.setup || NONE }))), [wishlist])
  const setups = useMemo(() => {
    const m = new Map<string, { hours: number; sessions: number; targets: Set<string>; last: string; frames: number }>()
    for (const { w, s, setup: k } of all) {
      const e = m.get(k) ?? { hours: 0, sessions: 0, targets: new Set<string>(), last: '', frames: 0 }
      e.hours += s.hours; e.sessions++; e.targets.add(w.id); e.frames += s.frames ?? 0
      if (s.date > e.last) e.last = s.date
      m.set(k, e)
    }
    return [...m.entries()].sort((a, b) => b[1].hours - a[1].hours)
  }, [all])
  const total = all.reduce((a, x) => a + x.s.hours, 0)
  const maxH = Math.max(1, ...setups.map(([, e]) => e.hours))

  const rows = useMemo(() => wishlist.flatMap((w) => {
    const ss = (w.sessions ?? []).filter((s) => !setup || (s.setup || NONE) === setup)
    if (!ss.length) return []
    const per = new Map<string, number>()
    for (const s of ss) per.set(s.setup || NONE, (per.get(s.setup || NONE) ?? 0) + s.hours)
    const o = objOf(w.id, w)
    return o ? [{ w, o, hours: ss.reduce((a, s) => a + s.hours, 0), per: [...per.entries()].sort((a, b) => b[1] - a[1]), n: ss.length }] : []
  }).sort((a, b) => b.hours - a.hours), [wishlist, setup, byId]) // eslint-disable-line react-hooks/exhaustive-deps
  const log = [...all].filter((x) => !setup || x.setup === setup).sort((a, b) => b.s.date.localeCompare(a.s.date)).slice(0, 40)
  const title = (o: CatObject) => (isCustom(o.id) ? o.names[0] : o.m ? `${o.m.replace(' ', '')} · ${o.id}` : o.id)

  return (
    <div className="obsv">
      <div className="ch wrap"><h2 className="th">Observations <small>{h(total)} total · {wishlist.filter((w) => w.sessions?.length).length} targets · {all.length} sessions</small></h2><span className="sp" />
        <button className="pri" onClick={onAdd}>＋ Add observation</button></div>

      {all.length === 0 ? (
        <p className="empty">Nothing logged yet. Add an observation after a night out, or log a block straight from the night schedule.</p>
      ) : (
        <>
          <div className="scards">
            {setups.map(([k, e]) => (
              <button key={k} className={`scard ${setup === k ? 'sel' : ''}`} onClick={() => setSetup(setup === k ? '' : k)} title="Filter by this setup">
                <small>{k}</small>
                <b>{h(e.hours)}</b>
                <i><span style={{ width: `${(e.hours / maxH) * 100}%` }} /></i>
                <small>{e.targets.size} target{e.targets.size === 1 ? '' : 's'} · {e.sessions} session{e.sessions === 1 ? '' : 's'}{e.frames ? ` · ${e.frames.toLocaleString()} frames` : ''} · last {e.last}</small>
              </button>
            ))}
          </div>

          <h3>Integration per target{setup ? ` — ${setup}` : ''}</h3>
          <div className="otable">
            {rows.map(({ w, o, hours, per, n }) => {
              const pct = w.goalHours ? Math.min(100, (hours / w.goalHours) * 100) : 0
              return (
                <div key={w.id} className="orow">
                  <button className="title" onClick={() => onDetails(o)}><b>{title(o)}</b></button>
                  <small>{o.names[0] ?? o.typeName}</small>
                  <span className="otot"><b>{h(hours)}</b>{w.goalHours ? ` / ${w.goalHours} h` : ''}<small> · {n}×</small></span>
                  {w.goalHours ? <div className="bar"><span style={{ width: `${pct}%` }} /></div> : <span />}
                  <span className="nchips">{per.map(([k, v]) => <em key={k} className="badge2 mute" title={k}>{k.length > 26 ? `${k.slice(0, 25)}…` : k} · {h(v)}</em>)}</span>
                </div>
              )
            })}
          </div>

          <h3>Log</h3>
          <div className="olog">
            {log.map(({ w, s, setup: k }) => {
              const o = objOf(w.id, w)
              return (
                <p key={s.id} className="note srow">
                  <span>{s.date} · <button className="title" onClick={() => o && onDetails(o)}><b>{o ? title(o) : w.id}</b></button> · {h(s.hours)}
                    {s.frames && s.exposure ? ` (${s.frames}×${s.exposure}s)` : ''} · {k}{s.note ? ` · ${s.note}` : ''}</span>
                  <span><button className="lnk" onClick={() => onEdit({ targetId: w.id, sessionId: s.id })}>edit</button>
                  <button className="lnk" onClick={() => confirm('Delete this observation?') && store.removeSession(w.id, s.id)}>delete</button></span>
                </p>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
