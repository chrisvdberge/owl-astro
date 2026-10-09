import type { Optics } from './optics'

/** Mirrors the JSON from inspector/ (astroinspect, schema_version 1). */
export interface Stat { median: number; mean: number; std: number; p10: number; p90: number }
export interface Inspection {
  schema_version: number
  filename: string | null
  image: { width: number; height: number; channels: number; linear: boolean; plate_scale_arcsec_px: number | null; plate_scale_source: string | null; object: string | null; exposure_s: number | null }
  stars: {
    detected: number; measured: number; saturated: number
    fwhm_px: Stat | null; fwhm_arcsec: Stat | null; eccentricity: Stat | null; snr: Stat | null
    grid: { size: number; fwhm_px: (number | null)[][]; eccentricity: (number | null)[][]; count: number[][] }
    tilt: { slope_pct: number; direction_deg: number; centre_vs_edge_pct: number | null } | null
  }
  background: {
    median: number
    flatness: { peak_to_peak_pct: number; rms_pct: number; corner_vs_centre_pct: number; linear_gradient_pct: number; gradient_direction_deg: number; grid: number[][] }
    colour: { channel_background: number[]; neutrality_spread_pct: number } | null
  }
  noise: { sigma: number; sky_to_noise: number | null }
  clipping: { black_pct: number; white_pct: number }
  warnings: string[]
}

export interface Finding { tone: 'ok' | 'warn' | 'bad'; text: string }

/** Plain-language reading of an inspection; thresholds are rules of thumb for small refractors. */
export function findings(r: Inspection): Finding[] {
  const out: Finding[] = []
  const { stars: s, background: b } = r
  const ecc = s.eccentricity?.median
  if (ecc != null) {
    if (ecc > 0.5) out.push({ tone: 'bad', text: `Stars are clearly elongated (eccentricity ${ecc.toFixed(2)}): check tracking, wind, balance or tilt.` })
    else if (ecc > 0.35) out.push({ tone: 'warn', text: `Slightly elongated stars (eccentricity ${ecc.toFixed(2)}).` })
    else out.push({ tone: 'ok', text: `Round stars (eccentricity ${ecc.toFixed(2)}).` })
  }
  if (s.tilt && s.tilt.slope_pct > 10) out.push({ tone: 'warn', text: `Star size changes ${s.tilt.slope_pct.toFixed(0)}% across the field: sensor tilt, spacing or field curvature.` })
  if (s.tilt?.centre_vs_edge_pct != null && Math.abs(s.tilt.centre_vs_edge_pct) > 12)
    out.push({ tone: 'warn', text: `Stars at the edge are ${s.tilt.centre_vs_edge_pct > 0 ? 'larger' : 'smaller'} than in the centre by ${Math.abs(s.tilt.centre_vs_edge_pct).toFixed(0)}%.` })
  const f = b.flatness
  if (f.corner_vs_centre_pct < -10) out.push({ tone: 'warn', text: `Corners are ${Math.abs(f.corner_vs_centre_pct).toFixed(0)}% darker than the centre: vignetting or an under-corrected flat.` })
  else if (f.corner_vs_centre_pct > 10) out.push({ tone: 'warn', text: `Corners are ${f.corner_vs_centre_pct.toFixed(0)}% brighter than the centre: over-corrected flat or a gradient.` })
  if (f.linear_gradient_pct > 5) out.push({ tone: 'warn', text: `A ${f.linear_gradient_pct.toFixed(0)}% linear gradient crosses the background: light pollution or moon. Gradient removal will help.` })
  if (Math.abs(f.corner_vs_centre_pct) <= 10 && f.linear_gradient_pct <= 5) out.push({ tone: 'ok', text: `Flat background (peak-to-peak ${f.peak_to_peak_pct.toFixed(1)}%).` })
  if (b.colour && b.colour.neutrality_spread_pct > 3) out.push({ tone: 'warn', text: `Background colour is off by ${b.colour.neutrality_spread_pct.toFixed(1)}% between channels.` })
  if (s.saturated > 0.01 * s.detected && s.saturated > 5) out.push({ tone: 'warn', text: `${s.saturated} saturated stars.` })
  if (r.clipping.black_pct > 1) out.push({ tone: 'warn', text: `${r.clipping.black_pct.toFixed(1)}% of pixels are clipped to black.` })
  for (const w of r.warnings) out.push({ tone: 'warn', text: w })
  return out
}

/** Pixel size and focal length to send, so the inspector can convert FWHM to arcseconds. */
export function scaleArgs(o: Optics) {
  return { pixelSizeUm: (o.pixelUm * o.binning) / o.drizzle, focalLengthMm: o.focalLengthMm * o.reducer }
}

export async function runInspection(base: string, key: string, file: File, o: Optics): Promise<Inspection> {
  const { pixelSizeUm, focalLengthMm } = scaleArgs(o)
  const body = new FormData()
  body.append('file', file)
  body.append('pixel_size_um', String(pixelSizeUm))
  body.append('focal_length_mm', String(focalLengthMm))
  let res: Response
  try {
    res = await fetch(`${base.replace(/\/$/, '')}/inspect`, { method: 'POST', body, headers: key ? { 'X-Inspector-Key': key } : {} })
  } catch {
    throw new Error(`Cannot reach the inspector at ${base}. Is it running?`)
  }
  if (res.status === 401) throw new Error('The inspector rejected the key.')
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? `Inspector error ${res.status}`)
  return res.json()
}

export interface Saved { id: string; at: string; targetId?: string; setup: string; result: Inspection }
