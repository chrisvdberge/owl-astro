export interface CatObject {
  id: string; m: string | null; type: string; typeName: string
  ra: number; dec: number; con: string
  maj: number | null; min: number | null; pa: number | null
  mag: number | null; sb: number | null
  names: string[]; alt: string[]
}

export async function loadCatalog(): Promise<CatObject[]> {
  const res = await fetch('/catalog.json')
  return res.json()
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '')

export const CATALOGS: { id: string; label: string; test: (o: CatObject) => boolean }[] = [
  { id: 'all', label: 'All catalogs', test: () => true },
  { id: 'messier', label: 'Messier', test: (o) => !!o.m },
  { id: 'caldwell', label: 'Caldwell', test: (o) => o.alt.some((a) => /^C \d+$/.test(a)) },
  { id: 'h400', label: 'Herschel 400', test: (o) => o.alt.includes('H400') },
  { id: 'ngc', label: 'NGC', test: (o) => o.id.startsWith('NGC ') },
  { id: 'ic', label: 'IC', test: (o) => o.id.startsWith('IC ') },
  { id: 'sh2', label: 'Sharpless (Sh2)', test: (o) => o.id.startsWith('Sh2-') },
  { id: 'vdb', label: 'van den Bergh (vdB)', test: (o) => o.id.startsWith('vdB ') },
  { id: 'ldn', label: 'Lynds dark (LDN)', test: (o) => o.id.startsWith('LDN ') },
  { id: 'barnard', label: 'Barnard (B)', test: (o) => /^B \d/.test(o.id) },
  { id: 'rcw', label: 'RCW', test: (o) => o.id.startsWith('RCW ') },
  { id: 'arp', label: 'Arp', test: (o) => o.id.startsWith('Arp ') },
  { id: 'hcg', label: 'Hickson (HCG)', test: (o) => o.id.startsWith('HCG ') },
  { id: 'abell', label: 'Abell PN', test: (o) => o.id.startsWith('Abell ') },
  { id: 'clusters', label: 'Collinder / Melotte', test: (o) => /^(Collinder|Melotte) /.test(o.id) },
]

/** Short catalog tag for a result row. */
export function catalogTag(o: CatObject): string {
  if (o.m) return 'Messier'
  return CATALOGS.find((c) => !['all', 'messier', 'caldwell', 'h400'].includes(c.id) && c.test(o))?.label.replace(/ \(.*\)/, '') ?? 'Other'
}

export function searchCatalog(cat: CatObject[], q: string, limit = 12, filter = 'all'): CatObject[] {
  const test = CATALOGS.find((c) => c.id === filter)?.test ?? (() => true)
  const n = norm(q)
  if (n.length < 2) {
    // browsing a single catalog: brightest / largest first
    if (filter === 'all') return []
    return cat.filter(test).sort((a, b) => (a.mag ?? 30) - (b.mag ?? 30) || (b.maj ?? 0) - (a.maj ?? 0)).slice(0, limit)
  }
  const scored: [number, CatObject][] = []
  for (const o of cat) {
    if (!test(o)) continue
    const keys = [o.id, o.m ?? '', ...o.names, ...o.alt].map(norm)
    let best = 0
    for (const k of keys) {
      if (k === n) { best = 3; break }
      if (k.startsWith(n)) best = Math.max(best, 2)
      else if (n.length > 2 && k.includes(n)) best = Math.max(best, 1)
    }
    if (best) scored.push([best * 100 + (o.m ? 50 : 0) + Math.min(o.maj ?? 0, 60) / 6 - (o.mag ?? 20), o])
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map((s) => s[1])
}

export function sexa(ra: number, dec: number): string {
  const h = ra / 15
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = Math.round(((h - hh) * 60 - mm) * 60)
  const ad = Math.abs(dec)
  const dd = Math.floor(ad), dm = Math.floor((ad - dd) * 60), ds = Math.round(((ad - dd) * 60 - dm) * 60)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(hh)}h${p(mm)}m${p(ss)}s ${dec < 0 ? '−' : '+'}${p(dd)}°${p(dm)}′${p(ds)}″`
}
