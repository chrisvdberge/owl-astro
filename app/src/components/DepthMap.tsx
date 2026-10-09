import { useEffect, useMemo, useRef } from 'react'
import { areaAtDepth, depthGrid } from '../lib/depth'

const W = 300

/** Colour of a depth share (0..1): dark violet (little) → violet → green (every frame). */
const ramp = (d: number): [number, number, number] => {
  if (d <= 0) return [11, 15, 23]
  const t = Math.max(0, Math.min(1, (d - 0.3) / 0.7))
  const a = [49, 27, 110], b = [192, 132, 252], c = [74, 222, 128]
  const [p, q, u] = t < 0.6 ? [a, b, t / 0.6] : [b, c, (t - 0.6) / 0.4]
  return [Math.round(p[0] + (q[0] - p[0]) * u), Math.round(p[1] + (q[1] - p[1]) * u), Math.round(p[2] + (q[2] - p[2]) * u)]
}

/** How much of the session's integration each part of the frame receives, with the chosen crop on top. North is up, east to the left. */
export default function DepthMap({ fovW, fovH, angles, crop }: {
  fovW: number; fovH: number; angles: number[]; crop: { w: number; h: number; ref: number } | null
}) {
  const g = useMemo(() => depthGrid(fovW, fovH, angles), [fovW, fovH, angles])
  const ref = useRef<HTMLCanvasElement>(null)
  const H = Math.round((W * g.hh) / g.hw)
  const flat = Math.max(...angles) - Math.min(...angles) < 1

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    const img = ctx.createImageData(g.nx, g.ny)
    for (let i = 0; i < g.grid.length; i++) {
      const [r, gg, b] = ramp(g.grid[i])
      img.data.set([r, gg, b, 255], i * 4)
    }
    const off = document.createElement('canvas')
    off.width = g.nx; off.height = g.ny
    off.getContext('2d')!.putImageData(img, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, W, H)
    ctx.drawImage(off, 0, 0, W, H)
    if (crop) {
      // the crop rectangle, drawn in the same plane (sky offsets: east left, north up)
      const px = (xi: number, eta: number): [number, number] => [W / 2 - (xi / g.hw) * (W / 2), H / 2 - (eta / g.hh) * (H / 2)]
      const th = (crop.ref * Math.PI) / 180, c = Math.cos(th), sn = Math.sin(th)
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.setLineDash([5, 3]); ctx.beginPath()
      ;([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).forEach(([sx, sy], k) => {
        const u = (sx * crop.w) / 2, v = (sy * crop.h) / 2
        const [x, y] = px(u * c + v * sn, -u * sn + v * c)
        k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
      })
      ctx.closePath(); ctx.stroke()
    }
  }, [g, crop, H])

  const levels = [1, 0.9, 0.75, 0.5]
  return (
    <div className="depth">
      <canvas ref={ref} width={W} height={H} />
      {flat ? <p className="note">The field barely turns in this window, so every part of the frame gets the full depth.</p> : (
        <table className="dtab"><tbody>
          {levels.map((d) => (
            <tr key={d}><td><i style={{ background: `rgb(${ramp(d).join(',')})` }} /></td><td>≥ {Math.round(d * 100)}% of the frames</td><td>{Math.round(areaAtDepth(g, fovW, fovH, d) * 100)}% of the frame</td></tr>
          ))}
        </tbody></table>
      )}
    </div>
  )
}
