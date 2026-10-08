/** Rough, general guidance by object type (not specific to a filter wheel). */
export function filterAdvice(type: string) {
  if (['HII', 'EmN', 'SNR', 'Neb', 'Cl+N'].includes(type)) return { color: 'Ha or dual narrowband', mono: 'Ha + OIII (+ SII)', seestar: 'Dual-band (LP) filter on' }
  if (type === 'PN') return { color: 'OIII / dual narrowband', mono: 'OIII + Ha', seestar: 'Dual-band (LP) filter on' }
  if (type === 'RfN') return { color: 'Broadband, UV/IR cut', mono: 'L + RGB', seestar: 'No filter' }
  if (type === 'DrkN') return { color: 'Broadband, long integration', mono: 'L + RGB', seestar: 'No filter' }
  if (['OCl', 'GCl', '*Ass', '*', '**'].includes(type)) return { color: 'Broadband, UV/IR cut', mono: 'RGB', seestar: 'No filter' }
  if (type.startsWith('G')) return { color: 'Broadband, UV/IR cut', mono: 'L + RGB (+ Ha for star-forming regions)', seestar: 'No filter' }
  return { color: 'Broadband, UV/IR cut', mono: 'L + RGB', seestar: 'No filter' }
}

/** One-word filter hint for list rows. */
export const filterShort = (type: string) => (['HII', 'EmN', 'SNR', 'Neb', 'Cl+N', 'PN'].includes(type) ? 'Dual-NB' : type === 'DrkN' ? 'Broadband' : 'No filter')
