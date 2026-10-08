import { useRef, useState } from 'react'
import { horizonAlt, parseHorizonFile, type HorizonPoint } from '../lib/astro'

const W = 720, H = 240, MAXALT = 60, PAD = { l: 34, r: 10, t: 10, b: 24 }
const x = (az: number) => PAD.l + (az / 360) * (W - PAD.l - PAD.r)
const y = (alt: number) => PAD.t + (1 - alt / MAXALT) * (H - PAD.t - PAD.b)

export default function HorizonEditor({ points, onChange }: { points: HorizonPoint[]; onChange: (p: HorizonPoint[]) => void }) {
  const svg = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<number | null>(null)

  const toData = (e: React.PointerEvent): HorizonPoint => {
    const r = svg.current!.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H
    const az = Math.min(359, Math.max(0, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * 360)))
    const alt = Math.min(MAXALT, Math.max(0, Math.round((1 - (py - PAD.t) / (H - PAD.t - PAD.b)) * MAXALT)))
    return [az, alt]
  }

  const sorted = (p: HorizonPoint[]) => [...p].sort((a, b) => a[0] - b[0])

  const curve = Array.from({ length: 361 }, (_, az) => `${x(az)},${y(horizonAlt(points, az))}`).join(' ')

  return (
    <div>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="hz"
        onPointerDown={(e) => { if (drag === null) onChange(sorted([...points, toData(e)])) }}
        onPointerMove={(e) => { if (drag !== null) onChange(points.map((p, i) => (i === drag ? toData(e) : p))) }}
        onPointerUp={() => { if (drag !== null) { onChange(sorted(points)); setDrag(null) } }}
        onPointerLeave={() => { if (drag !== null) { onChange(sorted(points)); setDrag(null) } }}>
        {[0, 20, 40, 60].map((a) => (<g key={a}><line x1={PAD.l} x2={W - PAD.r} y1={y(a)} y2={y(a)} className="grid" /><text x={PAD.l - 6} y={y(a) + 4} textAnchor="end">{a}°</text></g>))}
        {[['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315], ['N', 360]].map(([l, az]) => (
          <g key={az}><line x1={x(+az)} x2={x(+az)} y1={PAD.t} y2={H - PAD.b} className="grid" /><text x={x(+az)} y={H - 8} textAnchor="middle">{l}</text></g>
        ))}
        <polygon points={`${x(0)},${y(0)} ${curve} ${x(360)},${y(0)}`} className="obst" />
        <polyline points={curve} className="hzline" />
        {points.map((p, i) => (
          <circle key={i} cx={x(p[0])} cy={y(p[1])} r={7} className="pt"
            onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(i) }}
            onDoubleClick={(e) => { e.stopPropagation(); onChange(points.filter((_, j) => j !== i)) }} />
        ))}
      </svg>
      <p className="note">Click to add a point, drag to move, double-click a point to remove. Shaded area = blocked sky.</p>
      <div className="row">
        <button onClick={() => onChange([])}>Clear (flat horizon)</button>
        <label className="filebtn">Import file<input type="file" accept=".hzn,.txt,.csv,.hor" hidden
          onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const p = parseHorizonFile(await f.text()); if (p.length) onChange(p) } e.target.value = '' }} /></label>
      </div>
    </div>
  )
}
