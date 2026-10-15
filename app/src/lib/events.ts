import * as Astronomy from 'astronomy-engine'
import type { Location } from './astro'
import type { CatObject } from './catalog'
import { cometPos, type CometTarget } from './comets'

/**
 * Sky events worth imaging from a site, computed with astronomy-engine: lunar occultations (bright stars, planets,
 * clusters), close passes of planets by stars, deep-sky objects and each other, comets passing deep-sky objects, and
 * eclipses. Moon positions are topocentric (its parallax decides who sees an occultation); the rest geocentric J2000.
 */
export type EventKind = 'occultation' | 'pass' | 'comet' | 'eclipse'
export interface SkyEvent {
  id: string
  kind: EventKind
  t: number            // the moment to look: occultation disappearance, closest approach (or its best moment that night), eclipse peak
  end?: number         // occultation reappearance, eclipse end
  title: string
  detail: string
  sep: number          // separation at `t` (deg); 0 for eclipses
  span: number         // what has to fit in the frame: from the far edge of one to the far edge of the other (deg)
  ra: number; dec: number // centre of the pair at `t` (deg)
  alt: number; az: number // of that centre from the site
  sun: number          // sun altitude at `t`
  visible: boolean     // above 5° (10° for slow events) with the sun below −6°
  bodies: string[]     // names, for the sky view label
}

export type Star = [name: string, ra: number, dec: number, v: number]
let starsP: Promise<Star[]> | null = null
export const loadStars = () => (starsP ??= fetch('/stars.json').then((r) => r.json()).catch(() => { starsP = null; return [] }))

const D = Math.PI / 180, HOUR = 3600000, DAY = 86400000
const EPS = 23.4392911 * D
const PLANETS = [Astronomy.Body.Mercury, Astronomy.Body.Venus, Astronomy.Body.Mars, Astronomy.Body.Jupiter, Astronomy.Body.Saturn, Astronomy.Body.Uranus, Astronomy.Body.Neptune]
const BRIGHT_PLANETS = new Set<string>([Astronomy.Body.Mercury, Astronomy.Body.Venus, Astronomy.Body.Mars, Astronomy.Body.Jupiter, Astronomy.Body.Saturn])
const MOON_KM = 1737.4, AU_KM = 149597870.7

export function sep(ra1: number, dec1: number, ra2: number, dec2: number) {
  const c = Math.sin(dec1 * D) * Math.sin(dec2 * D) + Math.cos(dec1 * D) * Math.cos(dec2 * D) * Math.cos((ra1 - ra2) * D)
  return Math.acos(Math.min(1, Math.max(-1, c))) / D
}
const eclLat = (ra: number, dec: number) => Math.asin(Math.sin(dec * D) * Math.cos(EPS) - Math.cos(dec * D) * Math.sin(EPS) * Math.sin(ra * D)) / D
const mid = (a: P, b: P): [number, number] => {
  const x = Math.cos(a.dec * D) * Math.cos(a.ra * D) + Math.cos(b.dec * D) * Math.cos(b.ra * D)
  const y = Math.cos(a.dec * D) * Math.sin(a.ra * D) + Math.cos(b.dec * D) * Math.sin(b.ra * D)
  const z = Math.sin(a.dec * D) + Math.sin(b.dec * D)
  return [((Math.atan2(y, x) / D) + 360) % 360, Math.atan2(z, Math.hypot(x, y)) / D]
}

interface P { ra: number; dec: number }
/** Something that can be near something else: a fixed point, or a body that moves (position per moment). */
interface Thing { name: string; at: (t: number) => P; r: number; fixed: boolean; kind: 'star' | 'dso' | 'planet' | 'moon' | 'comet'; mag?: number }

export interface EventOptions { stars: Star[]; catalog: CatObject[]; comets: CometTarget[] }

/** All events from `from` (epoch ms) for `days` days, earliest first. */
export function findEvents(loc: Location, from: number, days: number, o: EventOptions): SkyEvent[] {
  const obs = new Astronomy.Observer(loc.lat, loc.lon, loc.elevation)
  const to = from + days * DAY
  const eq = (body: Astronomy.Body, t: number) => { const e = Astronomy.Equator(body, new Date(t), obs, false, true); return { ra: e.ra * 15, dec: e.dec, dist: e.dist } }
  const altAz = (ra: number, dec: number, t: number) => { const h = Astronomy.Horizon(new Date(t), obs, ra / 15, dec, 'normal'); return { alt: h.altitude, az: h.azimuth } }
  const sunCache = new Map<number, number>()
  const sunAlt = (t: number) => {
    let a = sunCache.get(t)
    if (a === undefined) { const s = eq(Astronomy.Body.Sun, t); a = altAz(s.ra, s.dec, t).alt; if (t % 60000 === 0) sunCache.set(t, a) }
    return a
  }
  const moonP = (t: number) => { const m = eq(Astronomy.Body.Moon, t); return { ra: m.ra, dec: m.dec, sd: Math.asin(MOON_KM / (m.dist * AU_KM)) / D } }
  const out: SkyEvent[] = []

  const planets: Thing[] = PLANETS.map((b) => ({ name: b, at: (t) => eq(b, t), r: 0, fixed: false, kind: 'planet' as const }))
  /** A planet's position from its daily positions (linear), for coarse scans; refinement uses `at`. */
  const dailyOf = new Map<Thing, Map<number, P>>()
  const roughAt = (x: Thing, t: number): P => {
    let m = dailyOf.get(x)
    if (!m) { m = new Map(); dailyOf.set(x, m) }
    const d0 = Math.floor(t / DAY) * DAY, f = (t - d0) / DAY
    const get = (d: number) => { let p = m!.get(d); if (!p) { p = x.at(d); m!.set(d, p) } return p }
    const a = get(d0), b = get(d0 + DAY)
    const dra = ((b.ra - a.ra + 540) % 360) - 180
    return { ra: (a.ra + dra * f + 360) % 360, dec: a.dec + (b.dec - a.dec) * f }
  }
  const fixedPt = (ra: number, dec: number) => () => ({ ra, dec })
  const stars: Thing[] = o.stars.map(([name, ra, dec, v]) => ({ name, at: fixedPt(ra, dec), r: 0, fixed: true, kind: 'star' as const, mag: v }))
  const label = (c: CatObject) => (c.m ? `${c.m.replace(' ', '')}${c.names[0] ? ` (${c.names[0]})` : ''}` : `${c.id}${c.names[0] ? ` (${c.names[0]})` : ''}`)
  const dso = (c: CatObject): Thing => ({ name: label(c), at: fixedPt(c.ra, c.dec), r: (c.maj ?? 0) / 120, fixed: true, kind: 'dso', mag: c.mag ?? undefined })
  const deep = o.catalog.filter((c) => c.type !== '*' && c.type !== '**' && !c.track)
  // showpieces the moon or a planet can cross: Messier objects and bright NGC/IC/cluster entries
  const showpieces = deep.filter((c) => c.m || ((c.mag ?? 99) <= 8 && (c.maj ?? 0) >= 3)).map(dso)
  const moonClusters = deep.filter((c) => (c.m || c.id === 'Melotte 25') && ['OCl', 'GCl', 'Cl+N', 'HII', 'EmN', '*Ass'].includes(c.type) && (c.maj ?? 0) >= 5).map(dso)
  const nearEcliptic = (things: Thing[], lim: number) => things.filter((x) => { const p = x.at(from); return Math.abs(eclLat(p.ra, p.dec)) < lim + x.r })

  /** Local minima of separation between a and b over [t0, t1] sampled every `step`, refined to ~1 minute. */
  function minima(sepAt: (t: number) => number, t0: number, t1: number, step: number, near: number): { t: number; s: number }[] {
    const res: { t: number; s: number }[] = []
    let p2 = sepAt(t0), p1 = sepAt(t0 + step)
    for (let t = t0 + 2 * step; t <= t1; t += step) {
      const s = sepAt(t)
      if (p1 <= p2 && p1 <= s && p1 < near) {
        // golden-section search between the neighbouring samples
        let a = t - 2 * step, b = t, g = 0.381966
        let c = a + g * (b - a), d = b - g * (b - a), fc = sepAt(c), fd = sepAt(d)
        while (b - a > 60000) {
          if (fc < fd) { b = d; d = c; fd = fc; c = a + g * (b - a); fc = sepAt(c) }
          else { a = c; c = d; fc = fd; d = b - g * (b - a); fd = sepAt(d) }
        }
        const tm = (a + b) / 2
        res.push({ t: tm, s: sepAt(tm) })
      }
      p2 = p1; p1 = s
    }
    return res
  }
  /** First moment in [a, b] where `f` changes from false to true (or true to false), to a minute. */
  function edge(f: (t: number) => boolean, a: number, b: number) {
    const fa = f(a)
    while (b - a > 30000) { const m = (a + b) / 2; if (f(m) === fa) a = m; else b = m }
    return (a + b) / 2
  }
  const dark = (t: number) => sunAlt(t) < -6
  const visibleAt = (p: P, t: number, minAlt: number) => altAz(p.ra, p.dec, t).alt >= minAlt && dark(t)
  const push = (e: Omit<SkyEvent, 'alt' | 'az' | 'sun' | 'visible'>, minAlt: number) => {
    const h = altAz(e.ra, e.dec, e.t), sun = sunAlt(e.t)
    out.push({ ...e, alt: h.alt, az: h.az, sun, visible: h.alt >= minAlt && sun < -6 })
  }

  // ---- the Moon: occultations of stars, planets and clusters; close passes of bright stars and planets ----
  {
    const cache = new Map<number, ReturnType<typeof moonP>>()
    const moonAt = (t: number) => { let m = cache.get(t); if (!m) { m = moonP(t); cache.set(t, m) } return m }
    const targets = [...nearEcliptic(stars, 7), ...nearEcliptic(moonClusters, 7), ...planets]
    for (const x of targets) {
      const isPlanet = x.kind === 'planet'
      // the moon moves ~0.55°/h: hourly samples find every minimum; refinement uses exact positions
      const sepAt = (t: number) => {
        const grid = t % HOUR === 0 // the hourly scan: shared moon positions, interpolated planets
        const m = grid ? moonAt(t) : moonP(t), p = grid && isPlanet ? roughAt(x, t) : x.at(t)
        return sep(m.ra, m.dec, p.ra, p.dec)
      }
      const reach = isPlanet ? 2 : x.kind === 'dso' ? 0.6 + x.r : (x.mag ?? 9) <= 1.5 ? 1 : 0.6
      for (const { t, s } of minima(sepAt, Math.ceil(from / HOUR) * HOUR, to, HOUR, reach + 0.6)) {
        const m = moonP(t), p = x.at(t)
        const covers = s < m.sd + x.r * 0.7
        if (!covers && (x.kind === 'dso' || (x.kind === 'star' && ((x.mag ?? 9) > 1.5 || s > 1)) || s > reach)) continue
        if (isPlanet) { const sun = eq(Astronomy.Body.Sun, t); if (sep(p.ra, p.dec, sun.ra, sun.dec) < 15) continue }
        const [ra, dec] = mid(m, p)
        const who = x.name
        if (covers && x.r === 0) {
          // disappearance and reappearance behind the limb
          const inside = (u: number) => { const mm = moonP(u), pp = x.at(u); return sep(mm.ra, mm.dec, pp.ra, pp.dec) < mm.sd }
          const t1 = edge(inside, t - 3 * HOUR, t), t2 = edge(inside, t, t + 3 * HOUR)
          const v1 = visibleAt(m, t1, 5), v2 = visibleAt(m, t2, 5)
          const tt = v1 || !v2 ? t1 : t2
          push({ id: `occ:${who}:${Math.round(t / 60000)}`, kind: 'occultation', t: tt, end: t2, title: `Moon occults ${who}`,
            detail: `${who}${x.mag != null ? ` (mag ${x.mag.toFixed(1)})` : ''} disappears behind the Moon and reappears after ${Math.round((t2 - t1) / 60000)} min`,
            sep: 0, span: 2 * m.sd, ra: m.ra, dec: m.dec, bodies: ['Moon', who] }, 5)
          if (!v1 && v2) out[out.length - 1].detail += ' — only the reappearance is visible from here'
        } else if (covers) {
          push({ id: `occ:${who}:${Math.round(t / 60000)}`, kind: 'occultation', t, title: `Moon crosses ${who}`,
            detail: `The Moon passes over ${who}`, sep: s, span: Math.max(2 * m.sd, 2 * x.r) + s, ra: m.ra, dec: m.dec, bodies: ['Moon', who] }, 5)
        } else {
          push({ id: `pass:Moon:${who}:${Math.round(t / 60000)}`, kind: 'pass', t, title: `Moon ${s.toFixed(1)}° from ${who}`,
            detail: `Closest at ${s.toFixed(2)}° (centre to centre)`, sep: s, span: s + m.sd + x.r, ra, dec, bodies: ['Moon', who] }, 5)
        }
      }
    }
  }

  // stars of a cluster the Moon crosses (the Pleiades) belong to that crossing, not separate events
  {
    const starAt = new Map(o.stars.map(([n, ra, dec]) => [n, { ra, dec }]))
    const cluster = new Map(moonClusters.map((c) => [c.name, { ...c.at(0), r: c.r }]))
    const crossings = out.filter((e) => e.title.startsWith('Moon crosses ') && cluster.has(e.bodies[1]))
    for (const e of [...out]) {
      const s = e.title.startsWith('Moon occults ') ? starAt.get(e.bodies[1]) : undefined
      const host = s && crossings.find((c) => { const k = cluster.get(c.bodies[1])!; return Math.abs(c.t - e.t) < 6 * HOUR && sep(s.ra, s.dec, k.ra, k.dec) < k.r + 0.1 })
      if (!host) continue
      out.splice(out.indexOf(e), 1)
      const list = host.detail.match(/, covering (.*)$/)?.[1]
      host.detail = `${host.detail.replace(/, covering .*$/, '')}, covering ${list ? `${list}, ` : ''}${e.bodies[1]}`
      if (e.t < host.t) {
        // the crossing starts with the first star it covers
        const m = moonP(e.t), h = altAz(m.ra, m.dec, e.t), sun = sunAlt(e.t)
        Object.assign(host, { t: e.t, ra: m.ra, dec: m.dec, alt: h.alt, az: h.az, sun, visible: h.alt >= 5 && sun < -6 })
      }
    }
  }

  // ---- slow pairs: planets with stars, deep-sky objects and each other; comets with deep-sky objects ----
  /** Best moment to see a slow pair near its closest approach: the highest dark moment within a night either side. */
  function bestMoment(a: Thing, b: Thing, t: number) {
    let best: { t: number; alt: number } | null = null
    const STEP = 15 * 60000
    for (let u = Math.round((t - 18 * HOUR) / STEP) * STEP; u <= t + 18 * HOUR; u += STEP) {
      if (u < from || u > to || !dark(u)) continue
      const pa = a.at(u), pb = b.fixed ? b.at(0) : b.at(u), [ra, dec] = mid(pa, pb)
      const alt = altAz(ra, dec, u).alt
      if (alt > 10 && (!best || alt - Math.abs(u - t) / HOUR * 0.5 > best.alt - Math.abs(best.t - t) / HOUR * 0.5)) best = { t: u, alt }
    }
    return best?.t ?? t
  }
  function slowPairs(movers: Thing[], fixed: Thing[], reachOf: (a: Thing, b: Thing) => number, kind: EventKind, keep?: (a: Thing, t: number) => string | null) {
    for (const a of movers) {
      // positions once a day, shared by every partner
      const daily = new Map<number, P>()
      const at = (t: number) => { if (t % DAY === 0) { let p = daily.get(t); if (!p) { p = a.at(t); daily.set(t, p) } return p } return a.at(t) }
      const t0 = Math.floor(from / DAY) * DAY
      for (const b of fixed) {
        if (b === a) continue
        const reach = reachOf(a, b)
        const sepAt = (t: number) => { const p = at(t), q = b.fixed ? b.at(0) : b.at(t); return sep(p.ra, p.dec, q.ra, q.dec) }
        for (const { t, s } of minima(sepAt, t0, to + DAY, DAY, reach + 2.5)) {
          if (s > reach || t < from - DAY || t > to) continue
          const sun = eq(Astronomy.Body.Sun, t), pa = a.at(t)
          if (sep(pa.ra, pa.dec, sun.ra, sun.dec) < 15) continue // lost in the sun's glare
          const extra = keep ? keep(a, t) : ''
          if (extra === null) continue
          const tb = bestMoment(a, b, t), pb = a.at(tb), qb = b.at(tb), sb = sep(pb.ra, pb.dec, qb.ra, qb.dec)
          const [ra, dec] = mid(pb, qb)
          const d = new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
          push({ id: `${kind}:${a.name}:${b.name}:${Math.round(t / DAY)}`, kind, t: tb, title: `${a.name} ${sb < 0.1 ? `${(sb * 60).toFixed(0)}′` : `${sb.toFixed(1)}°`} from ${b.name}`,
            detail: `Closest ${s < 0.1 ? `${(s * 60).toFixed(1)}′` : `${s.toFixed(2)}°`} on ${d}${extra ? ` · ${extra}` : ''}`, sep: sb, span: sb + a.r + b.r, ra, dec, bodies: [a.name, b.name] }, 10)
        }
      }
    }
  }
  const brightStars = nearEcliptic(stars, 10).filter((s) => (s.mag ?? 9) <= 3)
  const planetDso = nearEcliptic(showpieces, 10)
  slowPairs(planets.filter((p) => BRIGHT_PLANETS.has(p.name)), [...brightStars, ...planetDso], (_, b) => (b.kind === 'dso' ? Math.max(1, b.r + 0.3) : 1), 'pass')
  slowPairs(planets.filter((p) => !BRIGHT_PLANETS.has(p.name)), [...planetDso.filter((x) => x.r > 0)], (_, b) => b.r + 0.3, 'pass')
  // planet pairs: each pair once
  planets.forEach((p, i) => slowPairs([p], planets.slice(i + 1), () => 1.5, 'pass'))
  // comets: brighter than 12.5 at the time, past any deep-sky showpiece or a catalogued object it nearly covers
  const cometThings: Thing[] = o.comets.map((c) => ({ name: c.desig, at: (t) => cometPos(c.el, t), r: 0, fixed: false, kind: 'comet' as const }))
  const cometMag = new Map(o.comets.map((c) => [c.desig, c]))
  const cometDso = [...showpieces, ...deep.filter((c) => !c.m && (c.mag ?? 99) <= 11 && (c.maj ?? 0) >= 2).map(dso)]
  slowPairs(cometThings, cometDso, (_, b) => Math.max(0.5, b.r + 0.2), 'comet', (a, t) => {
    const c = cometMag.get(a.name)!, m = cometPos(c.el, t).mag + (c.dm ?? 0)
    return m > 12.5 ? null : `comet about mag ${m.toFixed(1)}`
  })

  // ---- eclipses ----
  for (let e = Astronomy.SearchLunarEclipse(new Date(from)); e.peak.date.getTime() < to; e = Astronomy.NextLunarEclipse(e.peak)) {
    const t = e.peak.date.getTime(), m = moonP(t), h = altAz(m.ra, m.dec, t)
    push({ id: `lunar:${Math.round(t / HOUR)}`, kind: 'eclipse', t, end: t + (e.sd_penum * 60000), title: `${e.kind[0].toUpperCase()}${e.kind.slice(1)} lunar eclipse`,
      detail: `${e.sd_total ? `Totality ${Math.round(e.sd_total * 2)} min` : e.sd_partial ? `Partial phase ${Math.round(e.sd_partial * 2)} min` : `Penumbral ${Math.round(e.sd_penum * 2)} min`}${h.alt < 0 ? ' — Moon below the horizon at maximum' : ''}`,
      sep: 0, span: 0, ra: m.ra, dec: m.dec, bodies: ['Moon'] }, 0)
  }
  for (let e = Astronomy.SearchLocalSolarEclipse(new Date(from), obs); e.peak.time.date.getTime() < to; e = Astronomy.NextLocalSolarEclipse(e.peak.time, obs)) {
    if (e.peak.altitude <= 0) continue
    const t = e.peak.time.date.getTime(), s = eq(Astronomy.Body.Sun, t), h = altAz(s.ra, s.dec, t)
    out.push({ id: `solar:${Math.round(t / HOUR)}`, kind: 'eclipse', t, end: e.partial_end.time.date.getTime(), title: `${e.kind[0].toUpperCase()}${e.kind.slice(1)} solar eclipse`,
      detail: `${Math.round(e.obscuration * 100)}% of the Sun covered at maximum, ${Math.round(e.peak.altitude)}° up — solar filter required`,
      sep: 0, span: 0, ra: s.ra, dec: s.dec, alt: h.alt, az: h.az, sun: h.alt, visible: true, bodies: ['Sun'] })
  }

  return out.filter((e) => e.t >= from && e.t <= to).sort((a, b) => a.t - b.t)
}
