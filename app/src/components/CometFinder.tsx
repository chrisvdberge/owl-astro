import { useEffect, useMemo, useState } from 'react'
import * as Astronomy from 'astronomy-engine'
import { horizonAlt, limitAlt, lstHours, moonAltAz, sunAlt, sunAltAz, targetAltAz, type Location } from '../lib/astro'
import { ephemeris, scoreNights, type Settings } from '../lib/suitability'
import { clockIn, tzOf, zonedEpoch } from '../lib/tz'
import type { CatObject } from '../lib/catalog'

type Con = { id: string; name: string; label: [number, number]; lines: [number, number][][] }
let conCache: Promise<Con[]> | null = null
const loadCons = () => (conCache ??= fetch('/constellations.json').then((r) => r.json()).catch(() => { conCache = null; return [] }))

const W = 640, STEP = 10, D = Math.PI / 180
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const wrap = (a: number) => ((a % 360) + 540) % 360 - 180 // to −180…180

/** Alt/az (deg) of an RA/Dec (deg) for a local sidereal time (hours): fast, no refraction; for drawing star figures. */
function altAz(lat: number, lst: number, ra: number, dec: number): [number, number] {
  const H = (lst * 15 - ra) * D, d = dec * D, p = lat * D
  const alt = Math.asin(Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(H))
  const az = Math.atan2(-Math.cos(d) * Math.sin(H), Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.cos(H) * Math.sin(p))
  return [alt / D, ((az / D) + 360) % 360]
}

interface Sample { t: number; sun: number; alt: number; az: number; ra: number; dec: number }

/**
 * Where to look for a moving target from the site on a night: a horizon panorama with the object's path through the night
 * (hour marks), the constellation figures, the local horizon and the moon at the chosen moment.
 */
export default function CometFinder({ o, loc, settings, night }: { o: CatObject; loc: Location; settings: Settings; night: string }) {
  const tz = tzOf(loc)
  const [cons, setCons] = useState<Con[]>([])
  useEffect(() => { loadCons().then(setCons) }, [])

  const samples = useMemo(() => {
    const [y, m, d] = night.split('-').map(Number)
    const t0 = zonedEpoch(tz, y, m, d, 17)
    const out: Sample[] = []
    for (let k = 0; k <= (15 * 60) / STEP; k++) {
      const t = new Date(t0 + k * STEP * 60000)
      const [ra, dec] = o.track ? o.track(t) : [o.ra, o.dec]
      const h = targetAltAz(loc, ra, dec, t)
      out.push({ t: t.getTime(), sun: sunAlt(loc, t), alt: h.alt, az: h.az, ra, dec })
    }
    return out
  }, [o, loc, tz, night])

  // the part of the night worth looking in: sun below −6° (comets are often caught in twilight)
  const dusk = samples.findIndex((s) => s.sun < -6)
  const dawn = samples.length - 1 - [...samples].reverse().findIndex((s) => s.sun < -6)
  const visible = samples.filter((s, i) => i >= dusk && i <= dawn && s.alt > horizonAlt(loc.horizon, s.az) + 2)
  const best = useMemo(() => {
    const dark = visible.filter((s) => s.sun < -12 && s.alt >= limitAlt(loc, s.az, settings.minAlt))
    const pool = dark.length ? dark : visible
    return pool.length ? samples.indexOf(pool.reduce((a, b) => (b.alt > a.alt ? b : a))) : -1
  }, [visible, samples, loc, settings.minAlt])
  const [chosen, setIdx] = useState<number | null>(null) // the slider's sample; the best moment until moved
  const idx = chosen ?? best

  // the next night it is up, when it is not tonight
  const next = useMemo(() => {
    if (best >= 0) return null
    const [y, m, d] = night.split('-').map(Number)
    const r = scoreNights(loc, o, ephemeris(loc, new Date(y, m - 1, d + 1), 120), settings).find((n) => n.suitable)
    return r ? r.date : undefined
  }, [best, night, loc, o, settings])

  if (dusk < 0) return <p className="note">No dark sky tonight at {loc.name}.</p>
  if (best < 0) {
    const s = samples[Math.round((dusk + dawn) / 2)]
    return (
      <p className="note">Not above the horizon at {loc.name} tonight while the sky is dark{s ? ` (it is in ${Astronomy.Constellation(s.ra / 15, s.dec).name})` : ''}.
        {next ? ` First good night from here: ${next.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}.` : ' No good night from here in the next four months (too low, too near the sun or too faint).'}</p>
    )
  }

  const cur = samples[Math.min(Math.max(idx, dusk), dawn)] ?? samples[best]
  // window: centred on the path while it is up, at least 120° wide; same scale both ways, from the horizon to above its highest point
  const azs = visible.map((s) => s.az)
  const mean = Math.atan2(azs.reduce((a, z) => a + Math.sin(z * D), 0), azs.reduce((a, z) => a + Math.cos(z * D), 0)) / D
  const spread = Math.max(...azs.map((z) => Math.abs(wrap(z - mean))))
  const span = Math.min(360, Math.max(120, 2 * spread + 40))
  const top = Math.min(90, Math.max(40, Math.max(...visible.map((s) => s.alt)) + 15))
  const k = W / span, base = top * k + 6, H = base + 26
  const X = (az: number) => W / 2 + wrap(az - mean) * k
  const Y = (alt: number) => base - alt * k
  const inView = (az: number, alt: number) => Math.abs(wrap(az - mean)) <= span / 2 && alt > -3 && alt < top + 3

  const t = new Date(cur.t)
  const lst = lstHours(loc, t)
  const figures = cons.flatMap((c, ci) => c.lines.flatMap((l, li) => {
    const pts = l.map(([ra, dec]) => altAz(loc.lat, lst, ra, dec))
    const segs: string[] = []
    for (let i = 1; i < pts.length; i++) {
      const [a0, z0] = pts[i - 1], [a1, z1] = pts[i]
      if ((inView(z0, a0) || inView(z1, a1)) && Math.abs(wrap(z1 - z0)) < 60 && a0 > -10 && a1 > -10) segs.push(`M${X(z0)},${Y(a0)}L${X(z1)},${Y(a1)}`)
    }
    return segs.length ? [<path key={`${ci}-${li}`} d={segs.join('')} />] : []
  }))
  const labels = cons.flatMap((c, ci) => {
    const [alt, az] = altAz(loc.lat, lst, c.label[0], c.label[1])
    return inView(az, alt) && alt > 2 ? [<text key={ci} x={X(az)} y={Y(alt)}>{c.name}</text>] : []
  })

  const ground: string[] = [], limit: string[] = []
  for (let x = 0; x <= W; x += 4) {
    const az = mean + (x - W / 2) / k
    ground.push(`${x},${Y(horizonAlt(loc.horizon, az))}`)
    limit.push(`${x},${Y(Math.min(top, limitAlt(loc, az, settings.minAlt)))}`)
  }
  const path = samples.slice(dusk, dawn + 1).filter((s) => s.alt > -3 && inView(s.az, s.alt))
  const runs: Sample[][] = []
  for (const s of path) { const r = runs[runs.length - 1]; if (r && s.t - r[r.length - 1].t <= STEP * 60000 && Math.abs(wrap(s.az - r[r.length - 1].az)) < 30) r.push(s); else runs.push([s]) }
  const hours = path.filter((s) => Math.abs(((s.t / 60000) % 60)) < 0.5 && s.alt > 0)

  const moon = moonAltAz(loc, t)
  const sun = sunAltAz(loc, t)
  // the tail points away from the sun
  const cx = X(cur.az), cy = Y(cur.alt)
  const sx = W / 2 + wrap(sun.az - mean) * k, sy = Y(sun.alt)
  const len = Math.hypot(cx - sx, cy - sy) || 1
  const tail = o.type === 'Comet' ? [cx + ((cx - sx) / len) * 22, cy + ((cy - sy) / len) * 22] : null
  const ticks = Array.from({ length: 24 }, (_, i) => i * 15).filter((az) => Math.abs(wrap(az - mean)) <= span / 2)
  const con = Astronomy.Constellation(cur.ra / 15, cur.dec).name
  const lo = cur.alt < limitAlt(loc, cur.az, settings.minAlt)

  return (
    <div className="cfind">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${o.names[0] ?? o.id} from ${loc.name}`}>
        <rect className="sky" x="0" y="0" width={W} height={base} style={{ opacity: cur.sun > -12 ? 0.8 : 0.35 }} />
        <g className="figs">{figures}</g>
        <g className="clab">{labels}</g>
        <polyline className="lim" points={limit.join(' ')} />
        <polygon className="ground" points={`0,${H} ${ground.join(' ')} ${W},${H}`} />
        <polyline className="hz" points={ground.join(' ')} />
        {runs.map((r, i) => <polyline key={i} className="path" points={r.map((s) => `${X(s.az)},${Y(s.alt)}`).join(' ')} />)}
        {hours.map((s) => <g key={s.t} className="hr"><circle cx={X(s.az)} cy={Y(s.alt)} r="2.5" /><text x={X(s.az) + 5} y={Y(s.alt) - 5}>{clockIn(tz, s.t)}</text></g>)}
        {moon.alt > 0 && inView(moon.az, moon.alt) && <g className="moon"><circle cx={X(moon.az)} cy={Y(moon.alt)} r="7" /><text x={X(moon.az) + 10} y={Y(moon.alt) + 4}>Moon</text></g>}
        {tail && <line className="tail" x1={cx} y1={cy} x2={tail[0]} y2={tail[1]} />}
        <circle className="obj" cx={cx} cy={cy} r="5" />
        {ticks.map((az) => <g key={az} className="tick"><line x1={X(az)} x2={X(az)} y1={base} y2={base + 5} /><text x={X(az)} y={base + 18}>{az % 45 === 0 ? DIRS[az / 45 % 8] : `${az}°`}</text></g>)}
      </svg>
      <input type="range" min={dusk} max={dawn} value={Math.min(Math.max(idx, dusk), dawn)} onChange={(e) => setIdx(+e.target.value)} aria-label="Time" />
      <p className="note">
        At <b>{clockIn(tz, cur.t)}</b> look <b>{DIRS[Math.round(cur.az / 45) % 8]}</b> ({Math.round(cur.az)}°), <b>{Math.round(cur.alt)}°</b> above the horizon, in {con}
        {cur.sun > -12 ? ' — still twilight' : ''}{cur.alt <= horizonAlt(loc.horizon, cur.az) ? ' — behind your horizon' : lo ? ` — below your ${settings.minAlt}° limit` : ''}.
      </p>
    </div>
  )
}
