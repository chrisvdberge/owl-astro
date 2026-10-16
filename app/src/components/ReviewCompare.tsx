import { notes, type Review } from '../lib/review'
import type { ReviewContext } from '../lib/reviewSetup'

export interface Side { name: string; at?: string; src: string; result: Review; ctx: ReviewContext }

/** How to read a metric: lower or higher is better, or closest to a range (the background level). */
type Better = 'lower' | 'higher' | [number, number]
interface Metric { label: string; get: (r: Review, c: ReviewContext) => number | null | undefined; fmt: (v: number) => string; better: Better }

const issues = (r: Review, c: ReviewContext) => notes(r, { arcsecKnown: !!c.arcsec }).filter((n) => n.tone === 'warn' || n.tone === 'bad').length
/** Star size in arcseconds when the scale is known, else as a share of the image's long side (so different sizes compare). */
const starSize = (r: Review, c: ReviewContext) => {
  if (!r.stars.fwhm) return null
  const px = r.stars.fwhm.median / r.image.scale
  return c.arcsec ? px * c.arcsec : (100 * r.stars.fwhm.median) / Math.max(r.image.width, r.image.height)
}

/** Noise as a share of how bright the object stands above the background: fair between stretches, unlike levels. */
const rel = (pick: (r: Review) => number | null) => (r: Review) => { const v = pick(r), c = r.object?.contrast; return v == null || !c ? null : (100 * v) / c }

const METRICS: Metric[] = [
  { label: 'Things to look at', get: issues, fmt: (v) => String(v), better: 'lower' },
  { label: 'Background level', get: (r) => (r.background.reliable ? r.background.level : null), fmt: (v) => `${v.toFixed(0)}/255`, better: [20, 30] },
  { label: 'Background colour cast', get: (r) => (r.background.reliable && r.background.colour ? r.background.castSpread : null), fmt: (v) => `${v.toFixed(1)} levels`, better: 'lower' },
  { label: 'Gradient', get: (r) => (r.background.reliable ? r.background.gradient.peakToPeak : null), fmt: (v) => `${v.toFixed(1)} levels`, better: 'lower' },
  { label: 'Noise vs object (pixel)', get: rel((r) => r.noise.fine), fmt: (v) => `${v.toFixed(1)}%`, better: 'lower' },
  { label: 'Noise vs object (blotches)', get: rel((r) => r.noise.coarse), fmt: (v) => `${v.toFixed(1)}%`, better: 'lower' },
  { label: 'Colour noise vs object', get: rel((r) => r.noise.chroma), fmt: (v) => `${v.toFixed(1)}%`, better: 'lower' },
  { label: 'Object brightness', get: (r) => r.object?.contrast, fmt: (v) => `+${v.toFixed(0)} levels`, better: 'higher' },
  { label: 'Background clipped to black', get: (r) => r.clipping.blackBgPct, fmt: (v) => `${v.toFixed(2)}%`, better: 'lower' },
  { label: 'Star size', get: starSize, fmt: (v) => `${v.toFixed(2)}`, better: 'lower' },
  { label: 'Star roundness (eccentricity)', get: (r) => r.stars.eccentricity?.median, fmt: (v) => v.toFixed(2), better: 'lower' },
  { label: 'Stars cover', get: (r) => r.stars.coveragePct, fmt: (v) => `${v.toFixed(1)}%`, better: 'lower' },
  { label: 'Stars showing colour', get: (r) => (r.stars.colour ? 100 - r.stars.colour.whitePct : null), fmt: (v) => `${v.toFixed(0)}%`, better: 'higher' },
  { label: 'Object saturation', get: (r) => (r.object ? r.object.saturation * 100 : null), fmt: (v) => `${v.toFixed(0)}%`, better: 'higher' },
  { label: 'Dust motes', get: (r) => (r.background.reliable ? r.artefacts.dust.length : null), fmt: (v) => String(v), better: 'lower' },
  { label: 'Hot pixels per MP', get: (r) => r.artefacts.specksPerMp, fmt: (v) => v.toFixed(0), better: 'lower' },
]

/** -1 when a is better, 1 when b is, 0 when they are about the same. */
function judge(a: number, b: number, better: Better) {
  const off = (v: number) => (Array.isArray(better) ? Math.max(better[0] - v, v - better[1], 0) : better === 'lower' ? v : -v)
  const da = off(a), db = off(b), scale = Math.max(Math.abs(a), Math.abs(b), 1e-9)
  if (Math.abs(da - db) <= 0.05 * scale) return 0
  return da < db ? -1 : 1
}

/** Two reviews side by side: the images, and each measurement with the better one marked. */
export default function ReviewCompare({ a, b, onClose }: { a: Side; b: Side; onClose: () => void }) {
  const bothArcsec = !!(a.ctx.arcsec && b.ctx.arcsec)
  const rows = METRICS.map((m) => {
    const va = m.get(a.result, a.ctx), vb = m.get(b.result, b.ctx)
    const label = m.label === 'Star size' ? `Star size (${bothArcsec ? '″' : '% of the image'})` : m.label
    return { label, fa: va == null ? '–' : m.fmt(va), fb: vb == null ? '–' : m.fmt(vb), w: va == null || vb == null ? 0 : judge(va, vb, m.better) }
  }).filter((r) => r.fa !== '–' || r.fb !== '–')
  const score = rows.reduce((s, r) => s + r.w, 0)
  const date = (s: Side) => (s.at ? new Date(s.at).toLocaleDateString() : 'now')
  return (
    <section className="rvcmp">
      <div className="ch wrap"><h3>Comparison</h3><span className="sp" /><button onClick={onClose}>Close</button></div>
      <div className="rvcmpimg">
        <figure><img src={a.src} alt="" /><figcaption><b>A</b> {a.name} <small>{date(a)}</small></figcaption></figure>
        <figure><img src={b.src} alt="" /><figcaption><b>B</b> {b.name} <small>{date(b)}</small></figcaption></figure>
      </div>
      <p className="note">{score === 0 ? 'Overall about even.' : `B ${score < 0 ? 'trails' : 'leads'} on ${Math.abs(score)} more measurement${Math.abs(score) > 1 ? 's' : ''} than it ${score < 0 ? 'leads' : 'trails'}.`} Green marks the better value; the background level counts as best between 20 and 30/255. Noise is compared as a share of the object's brightness above the background, so a darker stretch doesn't look cleaner than it is.</p>
      <table className="rvcmptab">
        <thead><tr><th /><th>A</th><th>B</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.label}><td>{r.label}</td><td className={r.w < 0 ? 'win' : r.w > 0 ? 'lose' : ''}>{r.fa}</td><td className={r.w > 0 ? 'win' : r.w < 0 ? 'lose' : ''}>{r.fb}</td></tr>)}</tbody>
      </table>
    </section>
  )
}
