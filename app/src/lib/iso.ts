import DATA from './isodr.json'

/**
 * Photographic dynamic range per ISO setting (Bill Claff, PhotonsToPhotos). A point is [iso, dr (stops)] or [iso, dr, 1] when
 * the camera applies noise reduction to its raw files at that ISO, which flatters the range.
 */
export interface IsoCamera { id: string; label: string; ptp: string; pts: ([number, number] | [number, number, number])[] }
export const ISO_CAMERAS = DATA as IsoCamera[]

/** The camera in the ISO data for a catalogue camera of the gear planner (sensor figures only name a few). */
export const ISO_FOR_GEAR: Record<string, string> = { 'canon-6d': 'canon-eos-6d', 'canon-aps-c': 'canon-eos-600d', 'sony-a7iii': 'sony-a7-iii', 'nikon-d7000': 'nikon-d7000', 'nikon-d600': 'nikon-d600' }

/** How close (stops) to read-noise-free a setting must be to count as on the line. */
export const TOLERANCE = 0.2

export interface IsoPoint { iso: number; dr: number; nr: boolean; penalty: number }
export interface IsoAdvice {
  pts: IsoPoint[]
  /** dr + log2(iso / 100) once read noise no longer matters: the line is dr = plateau − log2(iso / 100) */
  plateau: number
  best: IsoPoint
  base: IsoPoint
  /** the best ISO is the lowest one measured without noise reduction, so the true knee may be lower */
  capped: boolean
}

/**
 * The lowest ISO above which raising the ISO only costs dynamic range. Once the read noise behind the amplifier stops mattering,
 * each doubling of ISO halves the headroom and the range drops a full stop, a straight line against log ISO; below that the
 * range drops more slowly because higher gain is still hiding read noise. `penalty` is how far a setting sits below that line
 * (stops of extra shadow noise from read noise); the advice is the lowest ISO within TOLERANCE of it.
 */
export function isoAdvice(cam: IsoCamera): IsoAdvice {
  const pts = cam.pts.map(([iso, dr, nr]) => ({ iso, dr, nr: !!nr, penalty: 0 }))
  const clean = pts.filter((p) => !p.nr)
  const off = (p: IsoPoint) => p.dr + Math.log2(p.iso / 100)
  // the line's level, from the settings well past any knee; sensors with noise reduction at high ISO fall back to their highest clean ones
  const high = clean.filter((p) => p.iso >= 1600 && p.iso <= 12800)
  const plateau = median((high.length >= 3 ? high : clean.slice(-4)).map(off))
  for (const p of pts) p.penalty = Math.max(0, plateau - off(p))
  const best = clean.find((p) => p.penalty <= TOLERANCE) ?? clean[clean.length - 1]
  return { pts, plateau, best, base: pts.find((p) => !p.nr) ?? pts[0], capped: best === clean[0] && pts[0].nr }
}

function median(a: number[]) {
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
