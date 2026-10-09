import { useMemo, useState } from 'react'
import { customObject, isCustom, searchCatalog, type CatObject } from '../lib/catalog'
import { unitLabels } from '../lib/gear'
import { nightNow, tzOf } from '../lib/tz'
import type { useStore } from '../lib/store'

type Store = ReturnType<typeof useStore>

export interface ObsPrefill { targetId?: string; date?: string; hours?: number; sessionId?: string }

/** Log an observation (or edit one when `prefill.sessionId` is set): what was imaged, when, with which setup, and how much integration time. */
export default function ObservationForm({ store, catalog, setup: defaultSetup, prefill, onClose }: {
  store: Store; catalog: CatObject[]; setup: string; prefill: ObsPrefill; onClose: () => void
}) {
  const { wishlist, active: loc } = store
  const byId = useMemo(() => new Map(catalog.map((o) => [o.id, o])), [catalog])
  const find = (id?: string): CatObject | undefined => {
    if (!id) return undefined
    const w = wishlist.find((x) => x.id === id)
    return byId.get(id) ?? (w?.custom ? customObject(w.id, w.custom) : undefined)
  }
  const editing = prefill.sessionId ? wishlist.find((w) => w.id === prefill.targetId)?.sessions?.find((x) => x.id === prefill.sessionId) : undefined
  const [target, setTarget] = useState<CatObject | undefined>(() => find(prefill.targetId))
  const [query, setQuery] = useState('')
  const [date, setDate] = useState(editing?.date ?? prefill.date ?? nightNow(tzOf(loc)).night)
  const [setup, setSetup] = useState(editing ? editing.setup ?? '' : defaultSetup)
  const [frames, setFrames] = useState(editing?.frames ? String(editing.frames) : '')
  const [exposure, setExposure] = useState(editing?.exposure ? String(editing.exposure) : '')
  const [hours, setHours] = useState(editing ? String(editing.hours) : prefill.hours ? String(Math.round(prefill.hours * 100) / 100) : '')
  const [note, setNote] = useState(editing?.note ?? '')

  const known = useMemo(() => [...new Set([defaultSetup, ...unitLabels(), ...wishlist.flatMap((w) => (w.sessions ?? []).flatMap((s) => (s.setup ? [s.setup] : [])))])], [defaultSetup, wishlist])
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return wishlist.filter((w) => w.status !== 'done').flatMap((w) => { const o = find(w.id); return o ? [o] : [] }).slice(0, 8)
    const mine = wishlist.flatMap((w) => { const o = find(w.id); return o && (o.id + ' ' + o.names.join(' ') + ' ' + (o.m ?? '')).toLowerCase().includes(q) ? [o] : [] })
    return [...new Map([...mine, ...searchCatalog(catalog, query, 8)].map((o) => [o.id, o])).values()].slice(0, 8)
  }, [query, wishlist, catalog]) // eslint-disable-line react-hooks/exhaustive-deps

  const f = +frames, e = +exposure
  const fromFrames = f > 0 && e > 0
  const total = fromFrames ? (f * e) / 3600 : +hours
  const ok = !!target && total > 0 && !!date

  function save() {
    if (!target || !ok) return
    const data = {
      date, hours: Math.round(total * 1000) / 1000, note,
      setup: setup.trim() || undefined, frames: fromFrames ? f : undefined, exposure: fromFrames ? e : undefined,
    }
    if (!wishlist.some((w) => w.id === target.id)) store.addWish(target.id, { status: 'progress' })
    if (editing && prefill.targetId === target.id) store.patchSession(target.id, editing.id, data)
    else {
      // a different target: the observation moves over, keeping its id
      if (editing && prefill.targetId) store.removeSession(prefill.targetId, editing.id)
      store.addSession(target.id, { ...data, ...(editing ? { id: editing.id } : {}) })
    }
    onClose()
  }

  const name = (o: CatObject) => (isCustom(o.id) ? o.names[0] : `${o.m ? `${o.m} · ` : ''}${o.id}${o.names[0] ? ` — ${o.names[0]}` : ''}`)
  return (
    <div className="modal" onClick={onClose}>
      <div className="pick obs" onClick={(e) => e.stopPropagation()}>
        <h2>{editing ? 'Edit observation' : 'Add observation'}<button onClick={onClose}>Close</button></h2>

        <label className="f"><span>Target</span>
          {target ? (
            <span className="tsel"><b>{name(target)}</b> <button className="lnk" onClick={() => setTarget(undefined)}>change</button></span>
          ) : <input autoFocus placeholder="Search your wishlist or the catalogue…" value={query} onChange={(e) => setQuery(e.target.value)} />}
        </label>
        {!target && (
          <ul className="osug">{hits.map((o) => <li key={o.id} onClick={() => { setTarget(o); setQuery('') }}>{name(o)}</li>)}
            {hits.length === 0 && <li className="note">No match</li>}</ul>
        )}
        <label className="f"><span>Night</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="f"><span>Setup</span><input list="setups" value={setup} onChange={(e) => setSetup(e.target.value)} placeholder="Telescope + camera" />
          <datalist id="setups">{known.map((s) => <option key={s} value={s} />)}</datalist></label>
        <div className="f2">
          <label className="f"><span>Frames</span><input type="number" min={0} value={frames} onChange={(e) => setFrames(e.target.value)} /></label>
          <label className="f"><span>Exposure (s)</span><input type="number" min={0} step="0.5" value={exposure} onChange={(e) => setExposure(e.target.value)} /></label>
        </div>
        <label className="f"><span>Integration (h)</span>
          <input type="number" min={0} step="0.25" value={fromFrames ? (total).toFixed(2) : hours} readOnly={fromFrames} onChange={(e) => setHours(e.target.value)} placeholder="or enter hours" /></label>
        {fromFrames && <p className="note">{f} × {e}s = {total.toFixed(2)} h ({Math.round(total * 60)} min)</p>}
        <label className="f"><span>Note</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Seeing, filter, issues… (optional)" /></label>
        <div className="row"><span className="sp" /><button onClick={onClose}>Cancel</button><button className="pri" disabled={!ok} onClick={save}>{editing ? 'Save changes' : 'Save observation'}</button></div>
      </div>
    </div>
  )
}
