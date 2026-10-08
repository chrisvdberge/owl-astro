import { SURVEYS } from './surveys'

/** Survey cutout (JPEG) from the CDS hips2fits service: a flat TAN view, north up, `fov` degrees wide, square pixels. */
export function cutoutUrl(survey: string, ra: number, dec: number, fov: number, width: number, height: number): string {
  const hips = SURVEYS.find((s) => s.id === survey)?.hips ?? SURVEYS[0].hips
  const q = new URLSearchParams({
    hips: hips.startsWith('P/') ? `CDS/${hips}` : hips, width: String(width), height: String(height), fov: fov.toFixed(4),
    projection: 'TAN', coordsys: 'icrs', ra: ra.toFixed(5), dec: dec.toFixed(5), format: 'jpg',
  })
  return `https://alasky.cds.unistra.fr/hips-image-services/hips2fits?${q}`
}
