import { useMemo, useState } from 'react'
import type { CatObject } from '../lib/catalog'
import { DEFAULT_BORTLE, SKY_MAG, TIERS, defaultFilter, estimateExposure, withSensor, type Filter } from '../lib/exposure'
import { setupLabel } from '../lib/gear'
import { PRESETS } from '../lib/optics'
import type { useStore } from '../lib/store'
import type { Scope } from './FramingPreview'

type Store = ReturnType<typeof useStore>
const hrs = (h: number) => (h >= 200 ? '> 200 h' : h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${h >= 20 ? Math.round(h) : h.toFixed(1)} h`)

/** Rough integration-time guide for a target with the default scope under the active location's sky. */
export default function ExposurePlanner({ o, store, scope }: { o: CatObject; store: Store; scope: Scope }) {
  const { active: loc } = store
  const wish = store.wishlist.find((w) => w.id === o.id)
  const unit = PRESETS.some((p) => p.id === scope.presetId && p.id !== 'custom')
  const optics = useMemo(() => withSensor(scope.optics, scope.presetId), [scope])
  const [sub, setSub] = useState(unit ? 10 : 120)
  const [filter, setFilter] = useState<'auto' | Filter>('auto')
  const f: Filter = filter === 'auto' ? defaultFilter(o.type) : filter
  const bortle = loc.bortle ?? DEFAULT_BORTLE
  const est = useMemo(() => estimateExposure(o, optics, bortle, sub, f), [o, optics, bortle, sub, f])
  const withMoon = useMemo(() => estimateExposure(o, optics, bortle, sub, f, 0.6), [o, optics, bortle, sub, f])
  // progress counts only time logged with this setup: other gear collects light at a different rate
  const mine = setupLabel(scope.optics, scope.presetId)
  const have = (wish?.sessions ?? []).filter((s) => s.setup === mine).reduce((a, s) => a + s.hours, 0)
  const other = (wish?.sessions ?? []).filter((s) => s.setup !== mine).reduce((a, s) => a + s.hours, 0)

  if (!est) return (
    <section className="card"><h3>Exposure estimate</h3><p className="note">No surface brightness for this kind of object, so there is nothing to estimate from.</p></section>
  )
  const good = est.hours.good
  return (
    <section className="card exp">
      <div className="ch wrap"><h3>Exposure estimate <small>(rough guide)</small></h3><span className="sp" />
        <small className="note">{mine}</small></div>
      <div className="exrows">
        {TIERS.map((t) => {
          const h = est.hours[t.id]
          const done = have >= h
          return (
            <div key={t.id} className={`exrow ${done ? 'done' : ''}`}>
              <span>{t.label}</span><b>{hrs(h)}</b>
              <i><em style={{ width: `${Math.min(100, (have / h) * 100)}%` }} /></i>
              <small>{done ? '✓ reached' : have > 0 ? `${Math.round((have / h) * 100)}%` : ''}</small>
            </div>
          )
        })}
      </div>
      <p className="note">
        {have > 0 ? <>You have <b>{hrs(have)}</b> logged with this setup. </> : null}
        {other > 0 ? <>{hrs(other)} more with other setups (not counted). </> : null}
        With a half-lit moon up it takes about ×{(withMoon!.hours.good / good).toFixed(1)} longer.
      </p>
      <div className="row wrap exctl">
        <label className="note">Sky <select value={loc.bortle ?? ''} onChange={(e) => store.saveLocation({ ...loc, bortle: e.target.value ? +e.target.value : undefined })}>
          <option value="">Bortle {DEFAULT_BORTLE} (assumed)</option>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((b) => <option key={b} value={b}>Bortle {b} · {SKY_MAG[b]} mag</option>)}</select></label>
        <label className="note">Sub <input type="number" min={1} step={1} value={sub} onChange={(e) => setSub(Math.max(1, +e.target.value))} /> s</label>
        <label className="note">Filter <select value={filter} onChange={(e) => setFilter(e.target.value as 'auto' | Filter)}>
          <option value="auto">Auto ({defaultFilter(o.type) === 'dual' ? 'dual-band' : 'none'})</option><option value="none">None</option><option value="dual">Dual-band</option></select></label>
        <span className="sp" />
        <button disabled={!wish} title={wish ? 'Set the goal hours of this target to the “good” estimate' : 'Add the target to your wishlist first'} onClick={() => store.patchWish(o.id, { goalHours: Math.max(0.5, Math.round(good * 2) / 2) })}>
          Use “good” as goal{wish?.goalHours ? ` (now ${wish.goalHours} h)` : ''}</button>
      </div>
      <p className="note fine">
        Assumes the object at ~{est.mu.toFixed(1)} mag/arcsec² ({est.muSource}) under a {est.skyMag} mag/arcsec² sky; “decent / good / great” mean a signal-to-noise of 4 / 8 / 16 per pixel in the stack.
        A mean value understates bright cores and overstates faint outskirts, so treat the numbers as a planning range.
      </p>
    </section>
  )
}
