// Converts OpenNGC CSVs (../data) into public/catalog.json (Messier + NGC/IC).
import { readFileSync, writeFileSync } from 'node:fs'

const dir = new URL('../../data/', import.meta.url)
const TYPES = {
  '*': 'Star', '**': 'Double star', '*Ass': 'Association', 'OCl': 'Open cluster', 'GCl': 'Globular cluster',
  'Cl+N': 'Cluster + nebula', 'G': 'Galaxy', 'GPair': 'Galaxy pair', 'GTrpl': 'Galaxy triplet', 'GGroup': 'Galaxy group',
  'PN': 'Planetary nebula', 'HII': 'HII region', 'DrkN': 'Dark nebula', 'EmN': 'Emission nebula', 'Neb': 'Nebula',
  'RfN': 'Reflection nebula', 'SNR': 'Supernova remnant', 'Nova': 'Nova star', 'NonEx': 'Nonexistent', 'Dup': 'Duplicate', 'Other': 'Other',
}

const hms = (s) => { const [h, m, x] = s.split(':').map(Number); return (h + m / 60 + x / 3600) * 15 }
const dms = (s) => { const sign = s.startsWith('-') ? -1 : 1; const [d, m, x] = s.replace(/^[+-]/, '').split(':').map(Number); return sign * (d + m / 60 + x / 3600) }
const num = (v) => (v === '' || v === undefined ? null : Number(v))
const pretty = (n) => n.replace(/^(NGC|IC)0*(\d+)(.*)$/, '$1 $2$3')

const out = []
for (const f of ['NGC.csv', 'addendum.csv']) {
  const [head, ...rows] = readFileSync(new URL(f, dir), 'utf8').trim().split('\n')
  const cols = head.split(';')
  for (const line of rows) {
    const c = Object.fromEntries(line.split(';').map((v, i) => [cols[i], v]))
    if (!c.RA || !c.Dec || c.Type === 'NonEx' || c.Type === 'Dup') continue
    const m = c.M ? `M ${Number(c.M)}` : null
    out.push({
      id: pretty(c.Name),
      m,
      type: c.Type,
      typeName: TYPES[c.Type] ?? c.Type,
      ra: +hms(c.RA).toFixed(5),
      dec: +dms(c.Dec).toFixed(5),
      con: c.Const,
      maj: num(c.MajAx), min: num(c.MinAx), pa: num(c.PosAng),
      mag: num(c['V-Mag']) ?? num(c['B-Mag']),
      sb: num(c.SurfBr),
      names: c['Common names'] ? c['Common names'].split(',').map((s) => s.trim()) : [],
      alt: c.Identifiers ? c.Identifiers.split(',').map((s) => s.trim()) : [],
    })
  }
}
writeFileSync(new URL('../public/catalog.json', import.meta.url), JSON.stringify(out))
console.log(`${out.length} objects, ${out.filter((o) => o.m).length} Messier`)
