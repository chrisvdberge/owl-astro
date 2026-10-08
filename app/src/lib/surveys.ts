export interface Survey { id: string; label: string; hips: string; note: string }

export const SURVEYS: Survey[] = [
  { id: 'dss2', label: 'DSS2 colour', hips: 'P/DSS2/color', note: 'Full sky, classic default' },
  { id: 'panstarrs', label: 'PanSTARRS DR1', hips: 'CDS/P/PanSTARRS/DR1/color-z-zg-g', note: 'Sharp, Dec > −30°' },
  { id: 'halpha', label: 'H-alpha (Finkbeiner)', hips: 'CDS/P/Finkbeiner', note: 'Faint emission nebulosity' },
  { id: 'mellinger', label: 'Mellinger', hips: 'CDS/P/Mellinger/color', note: 'Wide-field Milky Way' },
  { id: 'desi', label: 'DESI Legacy DR10', hips: 'CDS/P/DESI-Legacy-Surveys/DR10/color', note: 'Very deep, partial sky' },
  { id: '2mass', label: '2MASS colour', hips: 'CDS/P/2MASS/color', note: 'Near-infrared' },
  { id: 'wise', label: 'allWISE colour', hips: 'CDS/P/allWISE/color', note: 'Mid-infrared dust' },
]

/** Smart default: Mellinger for huge objects, PanSTARRS for small galaxies in its sky, DSS2 otherwise. */
export function defaultSurvey(o: { type: string; maj: number | null; dec: number }): string {
  if (o.maj && o.maj > 120) return 'mellinger'
  if ((o.type === 'G' || o.type === 'GPair' || o.type === 'GGroup') && (o.maj ?? 0) < 20 && o.dec > -28) return 'panstarrs'
  return 'dss2'
}
