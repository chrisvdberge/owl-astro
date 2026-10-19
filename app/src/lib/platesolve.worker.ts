import { detectStars, solve, type Hint } from './platesolve'

/**
 * Plate solves off the main thread: receives RGBA pixels, a scale guess and hints, answers with the solution (or null).
 * One worker serves the whole page, so Gaia tiles fetched for one image are reused for the next.
 */
self.onmessage = async (e: MessageEvent<{ id: string; width: number; height: number; data: ArrayBuffer; scale: number; scaleTol: number; hints: Hint[] }>) => {
  const { id, width, height, data, scale, scaleTol, hints } = e.data
  try {
    const stars = detectStars({ width, height, data: new Uint8ClampedArray(data) })
    const solution = await solve({ width, height, stars, scale, scaleTol }, hints, undefined, (text) => self.postMessage({ id, progress: text }))
    self.postMessage({ id, done: true, solution, stars: stars.length })
  } catch (err) {
    self.postMessage({ id, done: true, error: err instanceof Error ? err.message : String(err) })
  }
}
