import { AREAS, type Note, type Review } from '../lib/review'
import { Grid, Stat } from './Inspector'

const TONE_MARK = { ok: '✓', info: 'i', warn: '!', bad: '!!' } as const

/** The headline numbers of a review. */
export function ReviewStats({ r }: { r: Review }) {
  const b = r.background, s = r.stars
  return (
    <div className="istats">
      <Stat k="Background" v={b.reliable ? `${b.level.toFixed(0)}/255` : '–'} s={b.reliable ? `${b.colour ? (b.cast ? `leans ${b.cast}` : 'neutral') + ' · ' : ''}aim for 20–30` : 'object fills the frame'} />
      <Stat k="Gradient" v={b.reliable ? `${b.gradient.peakToPeak.toFixed(1)}` : '–'} s="levels across the frame" />
      <Stat k="Noise σ" v={r.noise.fine != null ? r.noise.fine.toFixed(1) : '–'} s={r.noise.coarse != null ? `${r.noise.coarse.toFixed(1)} at 4 px${r.noise.chroma != null ? ` · colour ${r.noise.chroma.toFixed(1)}` : ''}` : undefined} />
      <Stat k="Stars" v={s.measured.toLocaleString()} s={s.fwhm ? `${(s.fwhm.median / r.image.scale).toFixed(1)} px wide · e ${s.eccentricity?.median.toFixed(2) ?? '–'}` : undefined} />
      <Stat k="Star cover" v={`${s.coveragePct.toFixed(1)}%`} s={s.colour ? `${(100 - s.colour.whitePct).toFixed(0)}% show colour` : undefined} />
      <Stat k="Clipped" v={`${r.clipping.blackPct.toFixed(1)}% · ${r.clipping.whitePct.toFixed(1)}%`} s="black · white" />
    </div>
  )
}

/** The findings, grouped by area. */
export function ReviewNotes({ list }: { list: Note[] }) {
  return (
    <>
      {AREAS.map((area) => {
        const ns = list.filter((n) => n.area === area)
        return ns.length ? (
          <section key={area} className="rvarea">
            <h4>{area}</h4>
            <ul className="ifind">{ns.map((n, i) => <li key={i} className={n.tone}><i>{TONE_MARK[n.tone]}</i>{n.text}</li>)}</ul>
          </section>
        ) : null
      })}
    </>
  )
}

/** Background and star measurements across the frame. */
export function ReviewGrids({ r }: { r: Review }) {
  const b = r.background, s = r.stars
  return (
    <>
      <div className="igrids rvgrids">
        {b.reliable && <Grid title="Background across the frame" rows={b.grid} fmt={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`} med={0} span={Math.max(2, b.gradient.peakToPeak / 2)} note="levels from the median background; – where the object is" />}
        {s.fwhm && <Grid title="Star size across the field" rows={s.grid.fwhm.map((row) => row.map((v) => (v == null ? null : v / r.image.scale)))} fmt={(v) => v.toFixed(1)} med={s.fwhm.median / r.image.scale} span={(s.fwhm.median / r.image.scale) * 0.25} note="px at half maximum, 3×3 cells" />}
        {s.eccentricity && <Grid title="Star roundness across the field" rows={s.grid.eccentricity} fmt={(v) => v.toFixed(2)} med={s.eccentricity.median} span={0.2} note="eccentricity: 0 round, 1 a line" />}
      </div>
      <p className="note">Thresholds are rules of thumb for images viewed on screen. Background level and saturation are a matter of taste, so treat those as suggestions.</p>
    </>
  )
}

/** Dust motes and the areas left out, drawn over the image (read-only). */
export function ReviewMarks({ r }: { r: Review }) {
  const W = r.image.width, H = r.image.height
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Marked areas">
      {r.artefacts.dust.map((d, i) => <ellipse key={i} cx={d.x * W} cy={d.y * H} rx={(d.d * W) / 2 + 6} ry={(d.d * W) / 2 + 6}><title>{`Dark spot, ${d.depth.toFixed(1)} levels deep`}</title></ellipse>)}
      {[...(r.excluded?.auto ?? []), ...(r.excluded?.manual ?? [])].map((x, i) => <rect key={i} className={i < (r.excluded?.auto.length ?? 0) ? 'exauto' : 'exman'} x={x.x * W} y={x.y * H} width={x.w * W} height={x.h * H}><title>Left out of the review</title></rect>)}
    </svg>
  )
}
