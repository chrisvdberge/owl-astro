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

export function searchCatalog(cat: CatObject[], q: string, limit = 12): CatObject[] {
  const n = norm(q)
  if (n.length < 2) return []
  const scored: [number, CatObject][] = []
  for (const o of cat) {
    const keys = [o.id, o.m ?? '', ...o.names, ...o.alt].map(norm)
    let best = 0
    for (const k of keys) {
      if (k === n) { best = 3; break }
      if (k.startsWith(n)) best = Math.max(best, 2)
      else if (n.length > 2 && k.includes(n)) best = Math.max(best, 1)
    }
    if (best) scored.push([best * 100 + (o.m ? 50 : 0) - (o.mag ?? 20), o])
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
