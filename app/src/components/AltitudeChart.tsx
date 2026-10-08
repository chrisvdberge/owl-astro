import { useMemo } from 'react'
import { horizonAlt, moonIllum, type Location, type NightSample } from '../lib/astro'

const W = 320, H = 190, PAD = { l: 26, r: 6, t: 8, b: 22 }

export default function AltitudeChart({ samples, loc, minAlt, stepMin = 10 }: { samples: NightSample[]; loc: Location; minAlt: number; stepMin?: number }) {
  const n = samples.length - 1
  const x = (i: number) => PAD.l + (i / n) * (W - PAD.l - PAD.r)
  const y = (alt: number) => PAD.t + (1 - Math.max(0, alt) / 90) * (H - PAD.t - PAD.b)
  const line = (f: (s: NightSample) => number) => samples.map((s, i) => `${x(i)},${y(f(s))}`).join(' ')

  const info = useMemo(() => {
    const usable = samples.filter((s) => s.usable)
    const peak = samples.reduce((m, s) => Math.max(m, s.alt), -90)
    return { hours: (usable.length * stepMin) / 60, peak, moon: moonIllum(samples[Math.floor(n / 2)].t) }
  }, [samples, n, stepMin])

  const cw = (W - PAD.l - PAD.r) / n + 0.5
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="alt">
        {samples.map((s, i) => (
          <rect key={i} x={x(i)} y={PAD.t} width={cw} height={H - PAD.t - PAD.b}
            className={s.sun < -18 ? 'night' : s.sun < -12 ? 'naut' : s.sun < -6 ? 'civ' : 'day'} />
        ))}
        {[0, 30, 60, 90].map((a) => (<g key={a}><line x1={PAD.l} x2={W - PAD.r} y1={y(a)} y2={y(a)} className="grid" /><text x={PAD.l - 4} y={y(a) + 3} textAnchor="end">{a}°</text></g>))}
        {samples.map((s, i) => (i % 12 === 0 ? <text key={i} x={x(i)} y={H - 7} textAnchor="middle">{String(s.t.getHours()).padStart(2, '0')}h</text> : null))}
        <polyline points={samples.map((s, i) => `${x(i)},${y(Math.max(minAlt, horizonAlt(loc.horizon, s.az)))}`).join(' ')} className="limit" />
        <polyline points={line((s) => s.moon)} className="moonl" />
        <polyline points={line((s) => s.alt)} className="tgtl" />
        {samples.map((s, i) => (s.usable ? <circle key={i} cx={x(i)} cy={y(s.alt)} r={1.8} className="ok" /> : null))}
      </svg>
      <p className="legend"><i className="k tgt" />Target <i className="k moon" />Moon <i className="k lim" />Min altitude / horizon <i className="k okd" />Usable</p>
      <dl>
        <dt>Usable time (sun &lt; −12°)</dt><dd>{info.hours.toFixed(1)} h</dd>
        <dt>Peak altitude</dt><dd>{info.peak.toFixed(0)}°</dd>
        <dt>Moon illuminated</dt><dd>{Math.round(info.moon * 100)}%</dd>
      </dl>
    </div>
  )
}
