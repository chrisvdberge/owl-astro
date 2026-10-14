import { useMemo, useState, type ReactNode } from 'react'
import { customObject, searchCatalog, type CatObject } from '../lib/catalog'
import { DEFAULT_BORTLE, SKY_MAG, type Filter } from '../lib/exposure'
import { MOUNTS, REFS, analyse, defaultMount, fmtS, pct, type Analysis, type Conditions, type Tone } from '../lib/gearplan'
import { setupLabel } from '../lib/gear'
import { CAMERAS, PRESETS, findCamera, SCOPES, SEEING, framingFit, type Optics } from '../lib/optics'
import { cutoutUrl } from '../lib/hips2fits'
import { defaultSurvey } from '../lib/surveys'
import type { useStore } from '../lib/store'
import { panelPolygons, type Scope } from './FramingPreview'

type Store = ReturnType<typeof useStore>
type Setup = Scope & { key: string; mount?: string; guided?: boolean }

const SETUPS_KEY = 'astroplanner.gear.setups'
const COND_KEY = 'astroplanner.gear.conditions'
const COLORS = ['#38bdf8', '#fbbf24', '#f472b6', '#4ade80']
const MAX = 4
const AIO = PRESETS.filter((p) => p.id !== 'custom')
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6
const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d } catch { return d } }
const loadList = <T,>(k: string): T[] | null => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null } catch { return null } }
const put = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage unavailable */ } }
const hrs = (h?: number) => (h == null ? '–' : h >= 200 ? '> 200 h' : h < 1 ? `${Math.max(5, Math.round((h * 60) / 5) * 5)} min` : `${h >= 20 ? Math.round(h) : h.toFixed(1)} h`)
const costTone = (x: number): Tone => (x <= 0.12 ? 'ok' : x <= 0.3 ? 'warn' : 'bad')
const fov = (deg: number) => (deg >= 1 ? `${deg.toFixed(2)}°` : `${(deg * 60).toFixed(1)}′`)

/** A second setup to compare against when the page is first opened: APM 107/700 with a Nikon D7000. */
function starter(): Setup {
  const s = SCOPES.find((x) => x.id === 'apm-107-700')!, c = CAMERAS.find((x) => x.id === 'nikon-d7000')!
  return { key: crypto.randomUUID(), presetId: 'custom', mount: 'eq-mid', guided: false, optics: { apertureMm: s.apertureMm, focalLengthMm: s.focalLengthMm, sensorWmm: c.sensorWmm, sensorHmm: c.sensorHmm, pixelUm: c.pixelUm, binning: 1, drizzle: 1, reducer: 1, qe: c.qe, readNoise: c.readNoise, fullWell: c.fullWell, bits: c.bits } }
}

function SetupEditor({ s, color, onChange, onRemove, onDefault, isDefault }: { s: Setup; color: string; onChange: (s: Setup) => void; onRemove?: () => void; onDefault: () => void; isDefault: boolean }) {
  const o = s.optics
  const aio = AIO.find((p) => p.id === s.presetId)
  const scopeSel = aio?.id ?? SCOPES.find((t) => near(t.apertureMm, o.apertureMm) && near(t.focalLengthMm, o.focalLengthMm))?.id ?? ''
  const camSel = aio?.id ?? findCamera(o)?.id ?? ''
  // leaving an all-in-one also takes it off its built-in alt-az mount
  const set = (patch: Partial<Optics>) => onChange({ ...s, presetId: 'custom', mount: aio && s.mount?.startsWith('smart') ? 'eq-mid' : s.mount, optics: { ...o, ...patch } })
  const mountId = s.mount ?? defaultMount(s.presetId)
  const mount = MOUNTS.find((m) => m.id === mountId) ?? MOUNTS[0]
  function pick(side: 'scope' | 'camera', id: string) {
    const unit = AIO.find((p) => p.id === id)
    if (unit) return onChange({ ...s, presetId: unit.id, mount: aio ? s.mount : 'smart-altaz', optics: { ...unit.optics, binning: o.binning, drizzle: o.drizzle } })
    if (side === 'scope') { const t = SCOPES.find((x) => x.id === id); if (t) set({ apertureMm: t.apertureMm, focalLengthMm: t.focalLengthMm, reducer: 1 }) }
    else { const c = CAMERAS.find((x) => x.id === id); if (c) set({ sensorWmm: c.sensorWmm, sensorHmm: c.sensorHmm, pixelUm: c.pixelUm, qe: c.qe, readNoise: c.readNoise, fullWell: c.fullWell, bits: c.bits }) }
  }
  const num = (k: keyof Optics, label: string, step = 'any') => (
    <label className="f"><span>{label}</span><input type="number" step={step} min={0} value={o[k] ?? ''} onChange={(e) => e.target.value && +e.target.value > 0 && set({ [k]: +e.target.value })} /></label>
  )
  return (
    <div className="card gset" style={{ borderTopColor: color }}>
      <div className="ch"><i className="gdot" style={{ background: color }} /><b className="gname">{setupLabel(o, s.presetId)}</b><span className="sp" />
        {onRemove && <button className="gx" title="Remove this setup" onClick={onRemove}>✕</button>}</div>
      <label className="f"><span>Telescope / lens</span>
        <select value={scopeSel} onChange={(e) => pick('scope', e.target.value)}>
          {!scopeSel && <option value="">Custom</option>}
          <optgroup label="All-in-one smart telescopes">{AIO.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
          <optgroup label="Telescopes & lenses">{SCOPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</optgroup>
        </select></label>
      <label className="f"><span>Camera</span>
        <select value={camSel} disabled={!!aio} onChange={(e) => pick('camera', e.target.value)}>
          {!camSel && <option value="">Custom</option>}
          {aio && <option value={aio.id}>{aio.label} (built in)</option>}
          <optgroup label="Cameras">{CAMERAS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</optgroup>
        </select></label>
      {!aio && <>{num('reducer', 'Reducer / barlow ×')}</>}
      <label className="f"><span>Binning · drizzle</span>
        <span className="row gbd">
          <select value={o.binning} onChange={(e) => onChange({ ...s, optics: { ...o, binning: +e.target.value } })}>{[1, 2, 3, 4].map((b) => <option key={b} value={b}>bin {b}×</option>)}</select>
          <select value={o.drizzle} onChange={(e) => onChange({ ...s, optics: { ...o, drizzle: +e.target.value } })}>{[1, 2, 3].map((b) => <option key={b} value={b}>drizzle {b}×</option>)}</select>
        </span></label>
      <label className="f"><span>Mount</span>
        <select value={mountId} onChange={(e) => onChange({ ...s, mount: e.target.value })}>{MOUNTS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
      {mount.guidedRms != null && <label className="note gguide"><input type="checkbox" checked={!!s.guided} onChange={(e) => onChange({ ...s, guided: e.target.checked })} /> Guided (guide scope / OAG)</label>}
      <details className="gmore"><summary className="note">Optics and sensor details</summary>
        {num('apertureMm', 'Aperture mm')}{num('focalLengthMm', 'Focal length mm')}
        {num('sensorWmm', 'Sensor width mm')}{num('sensorHmm', 'Sensor height mm')}{num('pixelUm', 'Pixel µm')}
        {num('qe', 'Quantum efficiency 0–1', '0.05')}{num('readNoise', 'Read noise e⁻', '0.1')}{num('fullWell', 'Full well e⁻', '1000')}{num('bits', 'ADC bits', '1')}
      </details>
      <div className="row wrap"><button disabled={isDefault} onClick={onDefault} title="Used for framing previews, exposure estimates and as the starting setup on the sky view">{isDefault ? '★ Your default' : '☆ Make default'}</button></div>
    </div>
  )
}

/** One row of the comparison table; `best` marks the column(s) with the most favourable value. */
function Row({ label, hint, cells, best }: { label: ReactNode; hint?: string; cells: ReactNode[]; best?: number[] }) {
  return (
    <tr>
      <th title={hint}>{label}{hint && <small>{hint}</small>}</th>
      {cells.map((c, i) => <td key={i} className={best?.includes(i) && cells.length > 1 ? 'best' : ''}>{c}</td>)}
    </tr>
  )
}
const Group = ({ title, n }: { title: string; n: number }) => <tr className="ggroup"><th colSpan={n + 1}>{title}</th></tr>
const argBest = (vals: (number | undefined)[], dir: 'max' | 'min') => {
  const ok = vals.filter((v): v is number => v != null && isFinite(v))
  if (!ok.length) return []
  const b = dir === 'max' ? Math.max(...ok) : Math.min(...ok)
  return vals.flatMap((v, i) => (v != null && Math.abs(v - b) <= Math.abs(b) * 0.02 ? [i] : []))
}
const Bar = ({ v, max, color }: { v: number; max: number; color: string }) => <i className="gbar"><em style={{ width: `${Math.max(2, (v / max) * 100)}%`, background: color }} /></i>
const SAMPLE = { under: 'Under', ok: 'Good', over: 'Over' } as const

/** Compare telescopes and cameras: field, resolution against the site's seeing, light grasp, sensor and sub-exposure behaviour. */
export default function GearPlanner({ store, catalog, scope }: { store: Store; catalog: CatObject[]; scope: Scope }) {
  const loc = store.active
  const [setups, setSetups] = useState<Setup[]>(() => loadList<Setup>(SETUPS_KEY) ?? [{ ...scope, key: crypto.randomUUID() }, starter()])
  const save = (next: Setup[]) => { setSetups(next); put(SETUPS_KEY, next) }
  const [cond, setCond] = useState(() => load(COND_KEY, { subSec: 60, filter: 'none' as Filter, moon: 0, seeing: 0 }))
  const patchCond = (p: Partial<typeof cond>) => { const next = { ...cond, ...p }; setCond(next); put(COND_KEY, next) }
  // seeing follows the site's typical value unless picked here (0 = follow the site)
  const seeing = cond.seeing || (loc.seeing ?? 3)
  const bortle = loc.bortle ?? DEFAULT_BORTLE

  // target for the field comparison
  const byId = useMemo(() => new Map(catalog.map((o) => [o.id, o])), [catalog])
  const wishTargets = useMemo(() => store.wishlist.flatMap((w) => { const o = byId.get(w.id) ?? (w.custom ? customObject(w.id, w.custom) : undefined); return o ? [o] : [] }), [store.wishlist, byId])
  const [targetId, setTargetId] = useState(() => { try { return localStorage.getItem('astroplanner.gear.target') ?? 'NGC 224' } catch { return 'NGC 224' } })
  const [q, setQ] = useState('')
  const hits = useMemo(() => (q.length > 1 ? searchCatalog(catalog, q, 8) : []), [catalog, q])
  const target = byId.get(targetId) ?? wishTargets.find((o) => o.id === targetId) ?? byId.get('NGC 224')
  const c: Conditions = useMemo(() => ({ seeing, bortle, moon: cond.moon, lat: loc.lat, dec: target?.dec ?? 30, subSec: cond.subSec, filter: cond.filter }), [seeing, bortle, cond, loc.lat, target?.dec])
  const res: Analysis[] = useMemo(() => setups.map((s) => analyse(s.optics, s.presetId, c, s.mount ?? defaultMount(s.presetId), !!s.guided)), [setups, c])
  const pickTarget = (o: CatObject) => { setTargetId(o.id); setQ(''); try { localStorage.setItem('astroplanner.gear.target', o.id) } catch { /* ignore */ } }

  const isDefault = (s: Setup) => s.presetId === scope.presetId && JSON.stringify(s.optics) === JSON.stringify(scope.optics)
  const n = setups.length
  const name = (o: CatObject) => (o.m ? `${o.m} (${o.names[0] ?? o.id})` : o.names[0] ? `${o.id} · ${o.names[0]}` : o.id)

  return (
    <div className="gear">
      <div className="ch wrap"><h2 className="th">Gear planner <small>field · resolution · light · sensor</small></h2></div>

      <section className="card gcond">
        <h3>Your sky</h3>
        <div className="gcgrid">
          <label className="f"><span>Site</span>
            <select value={loc.id} onChange={(e) => store.setActive(e.target.value)}>{store.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <label className="f"><span>Seeing</span>
            <select value={cond.seeing} onChange={(e) => patchCond({ seeing: +e.target.value })}>
              <option value={0}>Site’s typical ({loc.seeing ?? 3}″)</option>
              {SEEING.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</select></label>
          <label className="f"><span>Sky darkness</span>
            <select value={loc.bortle ?? ''} onChange={(e) => store.saveLocation({ ...loc, bortle: e.target.value ? +e.target.value : undefined })}>
              <option value="">Bortle {DEFAULT_BORTLE} (assumed)</option>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((b) => <option key={b} value={b}>Bortle {b} · {SKY_MAG[b]} mag/″²</option>)}</select></label>
          <label className="f"><span>Moon</span>
            <select value={cond.moon} onChange={(e) => patchCond({ moon: +e.target.value })}>
              <option value={0}>Down / new</option><option value={0.3}>Crescent up</option><option value={0.6}>Half up</option><option value={1}>Full up</option></select></label>
          <label className="f"><span>Sub length · filter</span>
            <span className="row gbd">
              <select value={cond.subSec} onChange={(e) => patchCond({ subSec: +e.target.value })}>{[10, 20, 30, 60, 120, 180, 300, 600].map((t) => <option key={t} value={t}>{t < 60 ? `${t} s` : `${t / 60} min`}</option>)}</select>
              <select value={cond.filter} onChange={(e) => patchCond({ filter: e.target.value as Filter })}><option value="none">No filter</option><option value="dual">Dual-band</option></select>
            </span></label>
        </div>
        {cond.seeing > 0 && cond.seeing !== (loc.seeing ?? 3) && (
          <div className="row wrap"><small className="note">Planning for {seeing}″ while {loc.name} is set to {loc.seeing ?? 3}″.</small>
            <button onClick={() => { store.saveLocation({ ...loc, seeing: cond.seeing }); patchCond({ seeing: 0 }) }}>Make {seeing}″ this site’s typical seeing</button></div>
        )}
      </section>

      <div className="gsets">
        {setups.map((s, i) => (
          <SetupEditor key={s.key} s={s} color={COLORS[i]} isDefault={isDefault(s)}
            onChange={(x) => save(setups.map((y) => (y.key === s.key ? x : y)))}
            onRemove={n > 1 ? () => save(setups.filter((y) => y.key !== s.key)) : undefined}
            onDefault={() => store.setSettings({ scope: { presetId: s.presetId, optics: s.optics } })} />
        ))}
        {n < MAX && <button className="gadd" onClick={() => save([...setups, { ...setups[n - 1], key: crypto.randomUUID() }])}>+ Add a setup to compare</button>}
      </div>

      {target && <FieldCompare target={target} res={res} label={name(target)}>
        <div className="search gtsearch">
          <input placeholder="Compare on another target…" value={q} onChange={(e) => setQ(e.target.value)} />
          {hits.length > 0 && <ul>{hits.map((o) => <li key={o.id} onClick={() => pickTarget(o)}>{name(o)} <small>{o.typeName}</small></li>)}</ul>}
        </div>
        {wishTargets.length > 0 && <div className="chips">{wishTargets.slice(0, 12).map((o) => <button key={o.id} className={o.id === target.id ? 'on' : ''} onClick={() => pickTarget(o)}>{o.m ?? o.names[0] ?? o.id}</button>)}</div>}
      </FieldCompare>}

      <div className="gtable">
        <table>
          <thead><tr><th />{setups.map((s, i) => <th key={s.key}><i className="gdot" style={{ background: COLORS[i] }} />{setupLabel(s.optics, s.presetId)}</th>)}</tr></thead>
          <tbody>
            <Group title="Field" n={n} />
            <Row label="Field of view" cells={res.map((a) => `${fov(a.r.fovW)} × ${fov(a.r.fovH)}`)} />
            <Row label="Focal length · f-ratio" cells={res.map((a) => `${Math.round(a.r.effectiveFl)} mm · f/${a.r.fNumber.toFixed(1)}`)} />
            <Row label="Image size" cells={res.map((a) => `${a.pxW} × ${a.pxH} px · ${a.mp.toFixed(1)} MP`)} />
            <Row label="Sensor coverage" hint="corrected image circle vs sensor diagonal" cells={res.map((a, k) => <span key={k} className={a.coverage.tone ? `gt ${a.coverage.tone}` : 'note'}>{a.coverage.text}</span>)} />
            {target && <Row label={`Fits ${target.m ?? target.id}?`} cells={res.map((a) => { const f = framingFit(target.maj, target.min, a.r.fovW, a.r.fovH); return !f ? '–' : f.kind === 'mosaic' ? `Mosaic ${f.cols}×${f.rows}` : f.kind === 'small' ? `Small (${Math.round(f.ratio * 100)}% of frame)` : `Fits (${Math.round(f.ratio * 100)}%)` })} />}

            <Group title={`Resolution · ${seeing}″ seeing`} n={n} />
            <Row label="Image scale" cells={res.map((a, k) => <span key={k}>{a.r.scale.toFixed(2)} ″/px{a.optics.drizzle > 1 && <small> → {a.r.drizzledScale.toFixed(2)} drizzled</small>}</span>)} best={argBest(res.map((a) => a.r.scale), 'min')} />
            <Row label="Star size (FWHM)" hint="seeing + optics + tracking" cells={res.map((a, k) => <span key={k}>{a.fwhm.toFixed(1)}″ <small>· {a.fwhmPx.toFixed(1)} px · {a.trackingRms.toFixed(1)}″ RMS tracking</small></span>)} best={argBest(res.map((a) => a.fwhm), 'min')} />
            <Row label="Sampling" hint="2–3.5 px per FWHM is the sweet spot" cells={res.map((a, k) => <span key={k} className={`gs ${a.sampling}`}>{SAMPLE[a.sampling]}</span>)} />
            <Row label="Through the year" hint="sampling on each kind of night" cells={res.map((a, k) => <span key={k} className="gtiers">{a.tiers.map((t) => <span key={t.v} className={`gs ${t.sampling} ${t.v === seeing ? 'cur' : ''}`} title={`${t.l}: ${SAMPLE[t.sampling].toLowerCase()}sampled`}>{t.short}</span>)}</span>)} />
            <Row label="Advice" cells={res.map((a, k) => <small key={k}>{a.advice}</small>)} />

            <Group title="Light gathering" n={n} />
            <Row label="Aperture" cells={res.map((a) => `${a.optics.apertureMm} mm · ${a.areaCm2.toFixed(0)} cm²`)} best={argBest(res.map((a) => a.areaCm2), 'max')} />
            <Row label="Light per pixel" hint="how fast each pixel fills: f-ratio, pixel size, QE" cells={res.map((a, i) => { const m = Math.max(...res.map((x) => x.perPixel)); return <><Bar v={a.perPixel} max={m} color={COLORS[i]} />{(a.perPixel / m).toFixed(2)}×</> })} best={argBest(res.map((a) => a.perPixel), 'max')} />
            <Row label="Light per arcsec²" hint="detail-for-detail, at the same final scale: aperture × QE" cells={res.map((a, i) => { const m = Math.max(...res.map((x) => x.perArcsec)); return <><Bar v={a.perArcsec} max={m} color={COLORS[i]} />{(a.perArcsec / m).toFixed(2)}×</> })} best={argBest(res.map((a) => a.perArcsec), 'max')} />
            <Row label="Faint galaxy, “good”" hint={REFS.galaxy} cells={res.map((a) => hrs(a.galaxyHours))} best={argBest(res.map((a) => a.galaxyHours), 'min')} />
            <Row label="Emission nebula, “good”" hint={REFS.nebula} cells={res.map((a) => hrs(a.nebulaHours))} best={argBest(res.map((a) => a.nebulaHours), 'min')} />

            <Group title="Sensor" n={n} />
            <Row label="QE · read noise" cells={res.map((a) => `${Math.round(a.qe * 100)}% · ${a.rn} e⁻`)} />
            <Row label="Full well" hint={n > 0 && res.some((a) => a.optics.binning > 1) ? 'binned pixels add their wells' : undefined} cells={res.map((a) => (a.fullWell ? `${(a.fullWell / 1000).toFixed(a.fullWell < 20000 ? 1 : 0)}k e⁻` : '–'))} best={argBest(res.map((a) => a.fullWell), 'max')} />
            <Row label="Dynamic range" hint="full well ÷ read noise" cells={res.map((a) => (a.dynamicRange ? `${a.dynamicRange.toFixed(1)} stops` : '–') + (a.bits ? ` · ${a.bits}-bit ADC` : ''))} best={argBest(res.map((a) => a.dynamicRange), 'max')} />

            <Group title={`Read noise vs light pollution · ${fmtS(cond.subSec)} ${cond.filter === 'dual' ? 'dual-band' : 'unfiltered'} subs, ${res[0]?.skyMag} mag/″² sky`} n={n} />
            <Row label="Sky background" cells={res.map((a) => `${a.sky < 1 ? a.sky.toFixed(2) : a.sky.toFixed(1)} e⁻/s/px`)} />
            <Row label="Read noise costs" hint="extra integration time at your sub length" cells={res.map((a, k) => <span key={k} className={`gt ${costTone(a.rnCostNow)}`}>+{pct(a.rnCostNow)} time{a.rnCostNow <= 0.12 ? ' — doesn’t matter' : a.rnCostNow <= 0.3 ? ' — noticeable' : ' — matters: longer subs'}</span>)} best={argBest(res.map((a) => a.rnCostNow), 'min')} />
            <Row label="Shortest useful sub" hint="sky noise buries read noise (sky ≥ 10 × RN²)" cells={res.map((a, k) => <span key={k} className={a.minSub > cond.subSec ? 'gwarn' : ''}>{fmtS(a.minSub)}{a.minSub > cond.subSec ? ' ⚠ longer than yours' : ''}</span>)} best={argBest(res.map((a) => a.minSub), 'min')} />
            <Row label="…under other skies" hint={`shortest useful sub by Bortle class; colour: read-noise cost of ${fmtS(cond.subSec)} subs`} cells={res.map((a, k) => <span key={k} className="gtiers">{a.byBortle.map((x) => <span key={x.b} className={`gs ${costTone(x.cost) === 'ok' ? 'ok' : costTone(x.cost) === 'warn' ? 'under' : 'over'} ${Math.round(bortle) === x.b ? 'cur' : ''}`} title={`Bortle ${x.b}: ${fmtS(x.minSub)} subs bury read noise; ${fmtS(cond.subSec)} subs cost +${pct(x.cost)} time`}>B{x.b} {fmtS(x.minSub)}</span>)}</span>)} />

            <Group title="Mount, guiding and sub length" n={n} />
            <Row label="Mount" cells={res.map((a) => `${a.mount.label}${a.isGuided ? ' · guided' : ''}`)} />
            <Row label="Unguided limit" hint="before stars stretch past ~1.15:1" cells={res.map((a, k) => <span key={k} className={a.trails ? 'gwarn' : ''}>{a.isGuided ? <small>({fmtS(a.unguidedMax)} unguided)</small> : fmtS(a.unguidedMax)}{a.trails ? ` ⚠ your ${fmtS(cond.subSec)} subs trail` : ''}</span>)} best={argBest(res.map((a) => (a.isGuided ? undefined : a.unguidedMax)), 'max')} />
            <Row label="Guiding" cells={res.map((a, k) => <span key={k} className={`gt ${a.guiding.tone}`}>{a.guiding.text}</span>)} />
            <Row label="Recommended sub" hint="from burying read noise to what the mount allows" cells={res.map((a, k) => <b key={k} className={a.subRange.ok ? '' : 'gwarn'}>{a.subRange.ok ? (a.subRange.hi / a.subRange.lo < 1.3 ? `~${fmtS(a.subRange.hi)}` : `${fmtS(a.subRange.lo)} – ${fmtS(a.subRange.hi)}`) : `~${fmtS(a.subRange.hi)} (mount-limited)`}</b>)} />
            <Row label="Stars that clip" hint="brighter than this saturate in one sub" cells={res.map((a, k) => (a.skyFill != null && a.skyFill >= 1 ? <span key={k} className="gwarn">Sky alone fills the wells</span> : a.satMag != null ? `mag ${a.satMag.toFixed(1)} and brighter` : '–'))} best={argBest(res.map((a) => a.satMag), 'min')} />
            <Row label="Sky fills the well" cells={res.map((a) => (a.skyFill != null ? `${(a.skyFill * 100).toFixed(a.skyFill < 0.01 ? 2 : 1)}%` : '–'))} />

            <Group title="Practical" n={n} />
            <Row label="Critical focus zone" hint="how far focus can drift" cells={res.map((a) => `±${(a.cfz / 2).toFixed(0)} µm`)} best={argBest(res.map((a) => a.cfz), 'max')} />
            <Row label="Data per hour" hint="16-bit FITS at this sub length" cells={res.map((a) => `${a.gbPerHour < 1 ? `${Math.round(a.gbPerHour * 1000)} MB` : `${a.gbPerHour.toFixed(1)} GB`}`)} />
          </tbody>
        </table>
      </div>

      <details className="card gnotes"><summary><b>How this is worked out</b></summary>
        <p className="note"><b>Star size</b> combines the seeing, the telescope’s diffraction blur (1.03 λ/D) and the mount’s tracking error (RMS × 2.355) in quadrature. A star wants about 2–3.5 pixels across its FWHM: fewer and stars turn square; more and the light is spread thinner for no extra detail. One-shot-colour cameras resolve a little less than their pixel count suggests (the Bayer matrix), so lean towards the finer end with them.</p>
        <p className="note"><b>Seeing steps</b>: most sites have a typical value (set it per location), with better and worse nights around it. The “through the year” row shows how a setup copes on each kind of night: a setup that is well sampled on average nights and slightly undersampled on the rare excellent ones is a sound choice.</p>
        <p className="note"><b>Light per pixel</b> follows the f-ratio and pixel size: it is why a fast scope “feels” quicker. <b>Light per arcsec²</b> follows aperture (× QE): when two setups are resampled to the same final scale, the bigger aperture wins. The galaxy and nebula times use the same model as the exposure estimate on the target cards, at the native scale.</p>
        <p className="note"><b>Read noise vs light pollution</b>: every sub adds read noise once; the sky adds shot noise that grows with the sub. Under a bright sky the sky noise swamps read noise within seconds, so read noise hardly matters and short subs lose almost nothing. Under a dark sky (or through a narrowband filter) the sky is faint and read noise dominates short subs: that is where low-read-noise cameras and longer subs pay off. “Read noise costs” is the extra integration time compared with a camera without read noise (RN² ÷ sky electrons per sub); a sub is long enough once the sky gives 10 × RN² electrons (~10% extra time).</p>
        <p className="note"><b>Mount and guiding</b>: unguided, a mount drifts with its periodic error (on average 2 × peak-to-peak ÷ worm period; the steep part of the curve is ~1.5× worse, so expect some rejects) plus polar-alignment drift. Stars stay acceptably round (under ~1.15:1) while the drift in one sub stays under 0.8 × the star’s width, or one pixel when undersampled. Star size above is judged at the sub length the mount allows, so longer focal lengths and finer pixels need guiding sooner. Alt-az mounts also rotate the field: the corners trail first, at a rate set by latitude and altitude. Guiding is worth it when the unguided limit is shorter than the sub that buries the read noise. Mount figures are typical for the class, not for your unit.</p>
        <p className="note"><b>Sensor coverage</b>: a telescope only gives sharp, evenly lit stars within its corrected image circle (with the right flattener or coma corrector at the right back focus). A full-frame sensor (43 mm diagonal) needs a scope designed for it; smaller scopes leave dark, elongated corners that you crop away. A reducer shrinks the circle with the focal length. Image circles are approximate manufacturer figures.</p>
        <p className="note">Full well and dynamic range are approximate manufacturer / measured figures at low gain; check your camera’s gain curves.</p>
      </details>
    </div>
  )
}

/** All setups' frames on one survey cutout of the target, mosaics drawn dashed. */
function FieldCompare({ target, res, label, children }: { target: CatObject; res: Analysis[]; label: string; children: ReactNode }) {
  const W = 720, H = 405
  const fits = res.map((a) => framingFit(target.maj, target.min, a.r.fovW, a.r.fovH))
  const extent = Math.max(...res.map((a, i) => { const f = fits[i]; return Math.hypot(a.r.fovW * (1 + ((f?.cols ?? 1) - 1) * 0.8), a.r.fovH * (1 + ((f?.rows ?? 1) - 1) * 0.8)) }))
  const width = Math.min(60, Math.max(extent * 1.1, ((target.maj ?? 0) / 60) * 1.4, 0.3))
  const survey = width > 8 ? 'mellinger' : defaultSurvey(target)
  const url = cutoutUrl(survey, target.ra, target.dec, width, W, H)
  const [state, setState] = useState<{ url: string; ok: boolean } | null>(null)
  const ok = state?.url === url ? state.ok : null
  return (
    <section className="card gfield">
      <div className="ch wrap"><h3>Field compared on {label}</h3><span className="sp" /><small className="note">{width.toFixed(1)}° wide · north up</small></div>
      {children}
      <div className="fpimg">
        <img src={url} crossOrigin="anonymous" alt={`${target.id} survey view`} onLoad={() => setState({ url, ok: true })} onError={() => setState({ url, ok: false })} style={ok === false ? { display: 'none' } : undefined} />
        <svg viewBox={`0 0 ${W} ${H}`}>
          {res.map((a, i) => {
            const f = fits[i], cols = f?.cols ?? 1, rows = f?.rows ?? 1
            const panels = cols * rows > 1 ? panelPolygons(width, a.r.fovW, a.r.fovH, 0, cols, rows, W, H) : []
            const frame = panelPolygons(width, a.r.fovW, a.r.fovH, 0, 1, 1, W, H)[0]
            const pts = (p: [number, number][]) => p.map((x) => x.join(',')).join(' ')
            return (
              <g key={i} style={{ stroke: COLORS[i] }}>
                {panels.map((p, j) => <polygon key={j} className="gmos" points={pts(p)} />)}
                <polygon className="gframe" points={pts(frame)} />
                {a.coverage.fieldDeg != null && a.coverage.tone !== 'ok' && <circle className="gcircle" cx={W / 2} cy={H / 2} r={(a.coverage.fieldDeg / 2) * (W / width)} />}
              </g>
            )
          })}
        </svg>
        {ok === null && <p className="note fpmsg">Rendering the field…</p>}
        {ok === false && <p className="note fpmsg">Couldn’t fetch the survey image.</p>}
      </div>
      <small className="note">Solid: one frame. Dashed: the mosaic it takes to cover the target (20% overlap). Dotted circle: the scope’s corrected field, where the sensor overshoots it.</small>
    </section>
  )
}
