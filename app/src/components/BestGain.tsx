import { useMemo, useState } from 'react'
import { DEFAULT_BORTLE, SKY_PASS, skyRate, withSensor } from '../lib/exposure'
import { gearDefaultFirst, gearName } from '../lib/gear'
import { GAIN_CAMERAS, SWAMP, gainAdvice, type GainAdvice } from '../lib/gain'
import { CAMERAS, PRESETS, findCamera, type Optics } from '../lib/optics'
import { navigate } from '../lib/router'
import type { useStore } from '../lib/store'

type Store = ReturnType<typeof useStore>
type Pass = keyof typeof SKY_PASS
const SUB_KEY = 'astroplanner.gain.maxsub'
const SUBS = [60, 120, 180, 300, 600, 900]
const get = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const secs = (s: number) => (s >= 3600 ? '> 1 h' : s >= 90 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`)
const pct = (x: number) => `${Math.round(x * 100)}%`
/** Behind a Bayer matrix each pixel sees about a third of a broadband sky, and one of a dual-band filter's two lines. */
const BAYER: Record<Pass, number> = { none: 1 / 3, dual: 1 / 2, narrow: 1 }

const W = 560, H = 230, PAD = { l: 34, r: 14, t: 10, b: 28 }

/** Dynamic range per gain setting; filled where the sky buries the read noise within the longest sub you take. */
function GainChart({ a, maxGain }: { a: GainAdvice; maxGain: number }) {
  const pts = a.options
  const top = Math.ceil(Math.max(...pts.map((p) => p.dr)) + 0.3), bot = Math.floor(Math.min(...pts.map((p) => p.dr)) - 0.3)
  const x = (g: number) => PAD.l + (g / maxGain) * (W - PAD.l - PAD.r)
  const y = (dr: number) => PAD.t + ((top - dr) / (top - bot)) * (H - PAD.t - PAD.b)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="alt isoc" role="img" aria-label="Dynamic range per gain">
      {Array.from({ length: top - bot + 1 }, (_, i) => bot + i).map((d) => (
        <g key={d}><line x1={PAD.l} x2={W - PAD.r} y1={y(d)} y2={y(d)} className="grid" /><text x={PAD.l - 5} y={y(d) + 3} textAnchor="end">{d}</text></g>
      ))}
      {Array.from({ length: Math.floor(maxGain / 50) + 1 }, (_, i) => i * 50).map((g) => <text key={g} x={x(g)} y={H - 10} textAnchor="middle">{g}</text>)}
      <line x1={x(a.best.gain)} x2={x(a.best.gain)} y1={PAD.t} y2={H - PAD.b} className="now" />
      <polyline points={pts.map((p) => `${x(p.gain)},${y(p.dr)}`).join(' ')} className="isocurve" />
      {pts.map((p) => (
        <circle key={p.gain} cx={x(p.gain)} cy={y(p.dr)} r={p === a.best ? 4.5 : 3} className={p.fits ? 'on' : 'nr'}>
          <title>{`Gain ${p.gain}: ${p.rn.toFixed(1)} e⁻ read noise, ${Math.round(p.fullWell / 100) / 10}k e⁻ full well, ${p.dr.toFixed(1)} stops; subs of ${secs(p.minSub)} bury the read noise`}</title>
        </circle>
      ))}
    </svg>
  )
}

/** The gain to use with a cooled astro camera under your sky: enough to hide read noise in the subs you take, no more. */
export default function BestGain({ store, cameraId }: { store: Store; cameraId?: string }) {
  const def = store.settings.scope ?? { presetId: PRESETS[0].id, optics: PRESETS[0].optics }
  // my gear with a camera the gain data knows, the default first
  const mine = useMemo(() => gearDefaultFirst(store.settings).flatMap((g) => {
    const id = findCamera(g.optics)?.id
    return id && GAIN_CAMERAS.some((c) => c.id === id) ? [{ id, name: gearName(g), optics: g.optics }] : []
  }).filter((g, i, all) => all.findIndex((h) => h.id === g.id) === i), [store.settings])
  const cam = GAIN_CAMERAS.find((c) => c.id === cameraId) ?? GAIN_CAMERAS.find((c) => c.id === mine[0]?.id) ?? GAIN_CAMERAS[0]
  const [passPick, setPass] = useState<Pass>('none')
  const pass: Pass = passPick === 'narrow' && !cam.label.includes('MM') ? 'none' : passPick
  // the camera on the scope it is used with: the gear it is part of, else the default scope with this sensor
  const optics: Optics = useMemo(() => {
    const own = mine.find((g) => g.id === cam.id)
    if (own) return withSensor(own.optics)
    const c = CAMERAS.find((x) => x.id === cam.id)!
    return { ...def.optics, sensorWmm: c.sensorWmm, sensorHmm: c.sensorHmm, pixelUm: c.pixelUm, qe: c.qe, readNoise: c.readNoise, fullWell: c.fullWell, bits: c.bits }
  }, [mine, cam, def.optics])
  const scopeName = mine.find((g) => g.id === cam.id)?.name

  const [bortle, setBortle] = useState(store.active.bortle ?? DEFAULT_BORTLE)
  const [monoPick, setMono] = useState(false)
  const mono = cam.label.includes('MM') && (monoPick || pass === 'narrow')
  const [maxSub, setMaxSub] = useState(() => Number(get(SUB_KEY)) || 300)
  const sky = useMemo(() => skyRate(optics, bortle, SKY_PASS[pass]) * (mono ? 1 : BAYER[pass]), [optics, bortle, pass, mono])
  const a = useMemo(() => gainAdvice(cam, sky, maxSub), [cam, sky, maxSub])
  const fNumber = (optics.focalLengthMm * optics.reducer) / optics.apertureMm
  const b = a.best

  return (
    <div className="insp iso">
      <div className="ch wrap"><h2 className="th">Best gain <small>for a cooled astro camera under your sky</small></h2></div>
      <div className="row wrap">
        <select value={cam.id} onChange={(e) => navigate(`/tools/gain/${e.target.value}`, { replace: !!cameraId })} aria-label="Camera">
          {GAIN_CAMERAS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select value={bortle} onChange={(e) => setBortle(+e.target.value)} aria-label="Sky">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>Bortle {n}{n === store.active.bortle ? ` (${store.active.name})` : ''}</option>)}
        </select>
        <select value={pass} onChange={(e) => setPass(e.target.value as Pass)} aria-label="Filter">
          <option value="none">No filter / broadband</option><option value="dual">Dual-band filter</option>{cam.label.includes('MM') && <option value="narrow">Narrowband 3–7 nm (mono)</option>}
        </select>
        {cam.label.includes('MC/MM') && <span className="pills">{(['colour', 'mono'] as const).map((k) => (
          <button key={k} className={(k === 'mono') === mono ? 'on' : ''} disabled={pass === 'narrow'} onClick={() => setMono(k === 'mono')}>{k === 'mono' ? 'Mono' : 'Colour'}</button>))}</span>}
        <label className="f inl"><span>Longest sub</span>
          <select value={maxSub} onChange={(e) => { setMaxSub(+e.target.value); try { localStorage.setItem(SUB_KEY, e.target.value) } catch { /* storage unavailable */ } }}>
            {SUBS.map((s) => <option key={s} value={s}>{secs(s)}</option>)}
          </select></label>
      </div>
      <p className="note">{scopeName ? `On ${scopeName}` : 'On your default scope'}: f/{fNumber.toFixed(1)}, {(206.265 * optics.pixelUm * optics.binning / (optics.focalLengthMm * optics.reducer)).toFixed(2)}″/px,{' '}
        {mono ? 'mono' : 'colour'} sensor, sky {sky >= 1 ? sky.toFixed(1) : sky.toPrecision(2)} e⁻/s per pixel.</p>

      <div className="istats">
        <div className="istat"><small>Best gain</small><b>{b.gain}</b><small>{b.gain === cam.hcg ? 'the high conversion gain switch' : b.gain === 0 ? 'the most room for bright stars' : 'read noise has levelled off'}</small></div>
        <div className="istat"><small>Sub length</small><b>{b.fits ? `${secs(b.minSub)} – ${secs(maxSub)}` : secs(maxSub)}</b><small>{b.fits ? 'long enough to bury the read noise' : `read noise still adds ${pct(b.penalty)} to the noise`}</small></div>
        <div className="istat"><small>At this gain</small><b>{b.rn.toFixed(1)} e⁻</b><small>{Math.round(b.fullWell / 100) / 10}k e⁻ full well · {b.dr.toFixed(1)} stops</small></div>
      </div>

      <section className="card">
        <GainChart a={a} maxGain={cam.maxGain} />
        <p className="legend"><i className="k isod" />Dynamic range (stops) per gain, the sky buries the read noise within {secs(maxSub)} <i className="k nrd" />it does not <i className="k nowd" />Best gain</p>
        <table className="gtab">
          <thead><tr><th>Gain</th><th>Read noise</th><th>Full well</th><th>Range</th><th>Shortest sub</th></tr></thead>
          <tbody>{a.key.map((o) => (
            <tr key={o.gain} className={o === b ? 'sel' : ''}><td>{o.gain}{o.gain === cam.hcg ? ' (HCG)' : ''}</td><td>{o.rn.toFixed(1)} e⁻</td><td>{Math.round(o.fullWell / 100) / 10}k e⁻</td><td>{o.dr.toFixed(1)} stops</td>
              <td className={o.fits ? '' : 'bad'}>{secs(o.minSub)}</td></tr>
          ))}</tbody>
        </table>
      </section>

      <section className="card note">
        <p>A sub is good enough once the sky background in it is {SWAMP}× the read noise squared: read noise then adds only 5% to the noise. Higher gain lowers the read noise,
          so that point comes sooner, but it also shrinks the full well and with it the room before stars clip. So the best gain is the lowest one that still buries
          the read noise within the longest sub you can take.</p>
        {b.fits && b.gain === 0 && <p>Your sky is bright enough to drown the read noise even at gain 0. Use the extra headroom: stars keep their colour, and a dual-band filter or a darker site would move the advice to gain {cam.hcg ?? cam.rn[1][0]}.</p>}
        {!b.fits && <p>No gain buries the read noise within {secs(maxSub)}: take the longest subs your mount and guiding allow.{a.lower && <> For the faintest work, gain {a.lower.gain} cuts read noise to {a.lower.rn.toFixed(1)} e⁻ (adds {pct(a.lower.penalty)}) at the cost of {(b.dr - a.lower.dr).toFixed(1)} stops of range.</>}</p>}
        <p><small>Read noise and full well approximated from the maker's gain charts; set the offset as the maker recommends. The moon brightens the sky, so on moonlit nights a lower gain often fits.</small></p>
      </section>
    </div>
  )
}
