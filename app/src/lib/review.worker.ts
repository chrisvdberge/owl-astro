import { analyze } from './review'

/** Runs the image review off the main thread: receives RGBA pixels, answers with the review (or an error message). */
self.onmessage = (e: MessageEvent<{ width: number; height: number; data: ArrayBuffer; scale: number }>) => {
  const { width, height, data, scale } = e.data
  try {
    self.postMessage({ ok: true, review: analyze({ width, height, data: new Uint8ClampedArray(data) }, scale) })
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
