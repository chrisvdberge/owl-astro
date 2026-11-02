/**
 * `hips` is the CDS id. While CDS is unreachable the sky view loads `mirror` (an ESASky copy of the same HiPS) when there is one,
 * and cutouts come from NASA SkyView in the single `skyview` band (SkyView has no colour composites).
 */
export interface Survey { id: string; label: string; hips: string; note: string; mirror?: string; skyview: string }

const ESASKY = 'https://skies.esac.esa.int'

export const SURVEYS: Survey[] = [
  { id: 'dss2', label: 'DSS2 colour', hips: 'P/DSS2/color', note: 'Full sky, classic default', mirror: `${ESASKY}/DSSColor/`, skyview: 'DSS2 Red' },
  { id: 'panstarrs', label: 'PanSTARRS DR1', hips: 'CDS/P/PanSTARRS/DR1/color-z-zg-g', note: 'Sharp, Dec > −30°', skyview: 'DSS2 Red' },
  { id: 'halpha', label: 'H-alpha (Finkbeiner)', hips: 'CDS/P/Finkbeiner', note: 'Faint emission nebulosity', skyview: 'H-Alpha Comp' },
  { id: 'mellinger', label: 'Mellinger', hips: 'CDS/P/Mellinger/color', note: 'Wide-field Milky Way', skyview: 'DSS2 Red' }, // SkyView's Mellinger carries a burnt-in credit line
  { id: 'desi', label: 'DESI Legacy DR10', hips: 'CDS/P/DESI-Legacy-Surveys/DR10/color', note: 'Very deep, partial sky', skyview: 'DSS2 Red' },
  { id: '2mass', label: '2MASS colour', hips: 'CDS/P/2MASS/color', note: 'Near-infrared', mirror: `${ESASKY}/2MASSColor/`, skyview: '2MASS-K' },
  { id: 'wise', label: 'allWISE colour', hips: 'CDS/P/allWISE/color', note: 'Mid-infrared dust', mirror: `${ESASKY}/AllWISEColor/`, skyview: 'WISE 3.4' },
]

/** Smart default: Mellinger for huge objects, PanSTARRS for small galaxies in its sky, DSS2 otherwise. */
export function defaultSurvey(o: { type: string; maj: number | null; dec: number }): string {
  if (o.maj && o.maj > 120) return 'mellinger'
  if ((o.type === 'G' || o.type === 'GPair' || o.type === 'GGroup') && (o.maj ?? 0) < 20 && o.dec > -28) return 'panstarrs'
  return 'dss2'
}
