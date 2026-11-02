/**
 * Survey cutout (JPEG): a flat TAN view, north up, `fov` degrees wide, square pixels. Served by our worker (worker/cutout.ts):
 * CDS hips2fits in colour, or a single band from NASA SkyView while CDS is down.
 */
export function cutoutUrl(survey: string, ra: number, dec: number, fov: number, width: number, height: number): string {
  const q = new URLSearchParams({ survey, ra: ra.toFixed(5), dec: dec.toFixed(5), fov: fov.toFixed(4), w: String(width), h: String(height) })
  return `/api/cutout?${q}`
}
