import { useMemo } from 'react'
import { gearDefaultFirst, gearName } from '../lib/gear'
import { ISO_CAMERAS, ISO_FOR_GEAR, TOLERANCE, isoAdvice, type IsoAdvice } from '../lib/iso'
import { findCamera } from '../lib/optics'
import { navigate } from '../lib/router'
import type { useStore } from '../lib/store'

type Store = ReturnType<typeof useStore>
const LAST_KEY = 'astroplanner.iso.camera'
const BRANDS = [...new Set(ISO_CAMERAS.map((c) => c.label.split(' ')[0]))]
const isoText = (iso: number) => iso.toLocaleString('en-US')

const W = 560, H = 260, PAD = { l: 34, r: 22, t: 10, b: 28 }

/** Dynamic range against ISO on a log axis, with the read-noise-free line the curve joins at the best ISO. */
function IsoChart({ a }: { a: IsoAdvice }) {
  const shown = a.pts.filter((p) => p.iso <= 51200)
  const lo = Math.log2(shown[0].iso), hi = Math.log2(shown[shown.length - 1].iso)
  const top = Math.ceil(Math.max(...shown.map((p) => p.dr)) + 0.5), bot = Math.max(0, Math.floor(Math.min(...shown.map((p) => p.dr)) - 0.5))
  const x = (iso: number) => PAD.l + ((Math.log2(iso) - lo) / (hi - lo || 1)) * (W - PAD.l - PAD.r)
  const y = (dr: number) => PAD.t + ((top - dr) / (top - bot)) * (H - PAD.t - PAD.b)
  const line = (iso: number) => a.plateau - Math.log2(iso / 100)
  const ticks = [50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600, 51200].filter((t) => t >= shown[0].iso && t <= shown[shown.length - 1].iso)
  const from = shown[0].iso, to = shown[shown.length - 1].iso
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="alt isoc" role="img" aria-label="Dynamic range against ISO">
      {Array.from({ length: top - bot + 1 }, (_, i) => bot + i).map((d) => (
        <g key={d}><line x1={PAD.l} x2={W - PAD.r} y1={y(d)} y2={y(d)} className="grid" /><text x={PAD.l - 5} y={y(d) + 3} textAnchor="end">{d}</text></g>
      ))}
      {ticks.map((t) => <text key={t} x={x(t)} y={H - 10} textAnchor="middle">{t >= 1000 ? `${t / 1000}k` : t}</text>)}
      <line x1={x(from)} y1={y(line(from))} x2={x(to)} y2={y(line(to))} className="isol" />
      <line x1={x(a.best.iso)} x2={x(a.best.iso)} y1={PAD.t} y2={H - PAD.b} className="now" />
      <polyline points={shown.filter((p) => !p.nr).map((p) => `${x(p.iso)},${y(p.dr)}`).join(' ')} className="isocurve" />
      {shown.map((p) => (
        <circle key={p.iso} cx={x(p.iso)} cy={y(p.dr)} r={p.iso === a.best.iso ? 4.5 : 3}
          className={p.nr ? 'nr' : p.penalty <= TOLERANCE ? 'on' : 'off'}>
          <title>{`ISO ${isoText(p.iso)}: ${p.dr.toFixed(2)} stops${p.nr ? ' (noise reduction in raw)' : p.penalty > TOLERANCE ? `, ${p.penalty.toFixed(1)} stops below the line` : ''}`}</title>
        </circle>
      ))}
    </svg>
  )
}

/** The lowest ISO worth using for a camera: where its dynamic range starts to fall a full stop per stop of ISO. */
export default function BestIso({ store, cameraId }: { store: Store; cameraId?: string }) {
  // cameras in my gear the ISO data knows (the gear planner's sensor catalogue names a few)
  const mine = useMemo(() => gearDefaultFirst(store.settings).flatMap((g) => {
    const id = ISO_FOR_GEAR[findCamera(g.optics)?.id ?? '']
    return id ? [{ id, name: gearName(g) }] : []
  }).filter((g, i, all) => all.findIndex((h) => h.id === g.id) === i), [store.settings])
  const last = (() => { try { return localStorage.getItem(LAST_KEY) } catch { return null } })()
  const cam = ISO_CAMERAS.find((c) => c.id === cameraId) ?? ISO_CAMERAS.find((c) => c.id === (mine[0]?.id ?? last)) ?? ISO_CAMERAS.find((c) => c.id === 'sony-a7-iii')!
  const a = useMemo(() => isoAdvice(cam), [cam])
  const pick = (id: string) => { try { localStorage.setItem(LAST_KEY, id) } catch { /* storage unavailable */ } navigate(`/tools/iso/${id}`, { replace: !!cameraId }) }
  const lost = a.base.dr - a.best.dr

  return (
    <div className="insp iso">
      <div className="ch wrap"><h2 className="th">Best ISO <small>for long exposures with a photo camera</small></h2></div>
      <div className="row wrap">
        <select value={cam.id} onChange={(e) => pick(e.target.value)} aria-label="Camera">
          {BRANDS.map((b) => <optgroup key={b} label={b}>{ISO_CAMERAS.filter((c) => c.label.startsWith(b + ' ')).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</optgroup>)}
        </select>
        {mine.map((g) => <button key={g.id} className={`chip ${g.id === cam.id ? 'on' : ''}`} onClick={() => pick(g.id)}>{g.name}</button>)}
      </div>

      <div className="istats">
        <div className="istat"><small>Best ISO</small><b>{a.capped ? '≤ ' : ''}{isoText(a.best.iso)}</b><small>{a.capped ? 'the lowest ISO without noise reduction in raw' : a.best === a.base ? 'base ISO: the sensor is ISO-invariant' : 'the lowest ISO on the line'}</small></div>
        <div className="istat"><small>Dynamic range there</small><b>{a.best.dr.toFixed(1)} stops</b><small>{lost > 0.05 ? `${lost.toFixed(1)} less than at ISO ${isoText(a.base.iso)}` : a.capped ? 'below it raw noise reduction blurs the comparison' : 'as much as at base ISO'}</small></div>
        {a.base.penalty > TOLERANCE && <div className="istat"><small>At ISO {isoText(a.base.iso)}</small><b>+{a.base.penalty.toFixed(1)} stops</b><small>more read noise in the shadows</small></div>}
      </div>

      <section className="card">
        <IsoChart a={a} />
        <p className="legend"><i className="k isod" />Dynamic range (stops) <i className="k offd" />Read noise still matters <i className="k lined" />Read-noise-free line (−1 stop per stop) <i className="k nowd" />Best ISO{a.pts.some((p) => p.nr) && <><i className="k nrd" />Noise reduction in raw</>}</p>
      </section>

      <section className="card note">
        <p>{a.best === a.base
          ? <>Read noise is low enough that even at ISO {isoText(a.base.iso)} it barely shows: the curve follows a straight line from the start.</>
          : <>Up to ISO {isoText(a.best.iso)} the higher gain still hides the camera's read noise, so the faint signal in the shadows gets cleaner. From there on the curve follows a straight line.</>}
          {' '}Along that line each stop of ISO costs a full stop of dynamic range and buys nothing: it only clips bright stars sooner.
          {a.best !== a.base && <> Below ISO {isoText(a.best.iso)}, use longer subs instead: the sky background then buries the extra read noise.</>}</p>
        {a.capped && <p>This camera applies noise reduction to its raw files below ISO {isoText(a.best.iso)}, which flatters those measurements, so the real best ISO may be lower.</p>}
        {a.best.iso <= 200 && a.best === a.base && <p>An ISO-invariant sensor: raising ISO only brightens the preview. Pick ISO 400–800 if you want to judge focus and framing on the screen, the data barely changes.</p>}
        <p><small>Data: photographic dynamic range by <a href={`https://www.photonstophotos.net/Charts/PDR.htm#${encodeURIComponent(cam.ptp)}`} target="_blank" rel="noreferrer">Bill Claff, PhotonsToPhotos</a>.
          The best ISO is the lowest one within {TOLERANCE} stops of the line.</small></p>
      </section>
    </div>
  )
}
