import { useMemo, useState } from 'react'
import { catalogTag, isCustom, type CatObject } from '../lib/catalog'
import { PRESETS, compute, framingFit, type Optics } from '../lib/optics'
import { SURVEYS, defaultSurvey } from '../lib/surveys'
import { cutoutUrl } from '../lib/hips2fits'
import type { FrameData, WishItem } from '../lib/store'

const W = 720, H = 405
const OVERLAP = 0.2

export interface Scope { presetId: string; optics: Optics }
export const scopeName = (s: Scope) => PRESETS.find((p) => p.id === s.presetId)?.label ?? 'Custom scope'

/** Rectangles (as pixel polygons) of a cols × rows mosaic centred in a W × H cutout `fov` degrees wide, rotated by pa. */
export function panelPolygons(fov: number, fovW: number, fovH: number, pa: number, cols: number, rows: number, w = W, h = H): [number, number][][] {
  const s = fov / w // degrees per pixel
  const th = (pa * Math.PI) / 180
  const out: [number, number][][] = []
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const cx = (i - (cols - 1) / 2) * fovW * (1 - OVERLAP), cy = (j - (rows - 1) / 2) * fovH * (1 - OVERLAP)
      out.push(([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]) => {
        const x = cx + (sx * fovW) / 2, y = cy + (sy * fovH) / 2
        const xi = x * Math.cos(th) + y * Math.sin(th), eta = -x * Math.sin(th) + y * Math.cos(th) // east, north (deg)
        return [w / 2 - xi / s, h / 2 - eta / s] as [number, number]
      }))
    }
  return out
}

/**
 * What the default scope sees of a target: a survey cutout with the frame (or mosaic grid) drawn on it. Uses the target's
 * saved framing when it has one, otherwise frames it automatically (centred, mosaic sized by the object).
 */
export default function FramingPreview({ o, wish, scope, onSave }: { o: CatObject; wish?: WishItem; scope: Scope; onSave: (f: FrameData, thumb?: string) => void }) {
  const saved = wish?.framings?.[0]
  const optics = saved?.optics ?? scope.optics
  const res = useMemo(() => compute(optics, 3), [optics])
  const fit = useMemo(() => framingFit(o.maj, o.min, res.fovW, res.fovH), [o, res.fovW, res.fovH])
  const cols = saved?.cols ?? fit?.cols ?? 1, rows = saved?.rows ?? fit?.rows ?? 1
  const pa = saved?.rotation ?? 0
  const ra = saved?.ra ?? o.ra, dec = saved?.dec ?? o.dec
  const survey = saved?.survey ?? defaultSurvey(o)
  // wide enough for the whole grid (turned by pa) and the whole object, with a margin
  const extW = res.fovW * (1 + (cols - 1) * (1 - OVERLAP)), extH = res.fovH * (1 + (rows - 1) * (1 - OVERLAP))
  const fov = Math.min(20, Math.max(Math.hypot(extW, extH) * 1.15, (extH * 1.15 * W) / H, ((o.maj ?? 0) / 60) * 1.3, 0.5))
  const url = cutoutUrl(survey, ra, dec, fov, W, H)
  const polys = panelPolygons(fov, res.fovW, res.fovH, pa, cols, rows)
  const [state, setState] = useState<{ url: string; ok: boolean } | null>(null)
  const ok = state?.url === url ? state.ok : null
  const [busy, setBusy] = useState(false)

  /** The saved thumbnail: a smaller cutout of the same view with the frame drawn on it. */
  async function save() {
    setBusy(true)
    let thumb: string | undefined
    try {
      const tw = 480, th = 270
      const blob = await (await fetch(cutoutUrl(survey, ra, dec, fov, tw, th))).blob()
      const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode()
      const c = document.createElement('canvas'); c.width = tw; c.height = th
      const g = c.getContext('2d')!
      g.drawImage(img, 0, 0, tw, th)
      g.strokeStyle = '#38bdf8'; g.lineWidth = 2
      for (const poly of panelPolygons(fov, res.fovW, res.fovH, pa, cols, rows, tw, th)) { g.beginPath(); poly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke() }
      thumb = c.toDataURL('image/jpeg', 0.75)
    } catch { /* save without a snapshot */ }
    onSave({
      rotation: pa, cols, rows, survey, ra, dec, optics, presetId: scope.presetId, mount: 'eq',
      viewFov: Math.min(Math.max(res.fovW * 1.4, o.maj ? (o.maj / 60) * 1.6 : 0), 60),
    }, thumb)
    setBusy(false)
  }

  return (
    <section className="fp">
      <div className="ch"><h3>{saved ? `Your framing — ${saved.name}` : 'Through your scope'}</h3><span className="sp" />
        <small className="note">{scopeName(saved?.optics ? { presetId: saved.presetId ?? 'custom', optics } : scope)} · {res.fovW.toFixed(2)}° × {res.fovH.toFixed(2)}° · {res.scale.toFixed(2)}″/px</small></div>
      <div className="fpimg">
        <img src={url} crossOrigin="anonymous" alt={`${o.id} survey view`} onLoad={() => setState({ url, ok: true })} onError={() => setState({ url, ok: false })} style={ok === false ? { display: 'none' } : undefined} />
        {ok !== false && (
          <svg viewBox={`0 0 ${W} ${H}`}>{polys.map((p, i) => <polygon key={i} points={p.map((q) => q.join(',')).join(' ')} />)}</svg>
        )}
        {ok === null && <p className="note fpmsg">Rendering the field…</p>}
        {ok === false && <p className="note fpmsg">Couldn’t fetch the survey image (it may not cover this part of the sky).</p>}
      </div>
      <div className="row wrap">
        <span className="note">
          {cols * rows > 1 ? `Mosaic ${cols}×${rows} (20% overlap) · ` : fit?.kind === 'small' ? `Fills only ${Math.round(fit.ratio * 100)}% of the frame · ` : ''}
          {SURVEYS.find((s) => s.id === survey)?.label} · north up{!isCustom(o.id) && ` · ${catalogTag(o)}`}
        </span>
        <span className="sp" />
        {!saved && <button disabled={busy || ok === false} onClick={save}>{wish ? '💾 Save this framing' : '☆ Add with this framing'}</button>}
      </div>
    </section>
  )
}
