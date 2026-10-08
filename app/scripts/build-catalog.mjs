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
const dups = []   // [duplicate id, primary id] from OpenNGC 'Dup' rows
for (const f of ['NGC.csv', 'addendum.csv']) {
  const [head, ...rows] = readFileSync(new URL(f, dir), 'utf8').trim().split('\n')
  const cols = head.split(';')
  for (const line of rows) {
    const c = Object.fromEntries(line.split(';').map((v, i) => [cols[i], v]))
    if (c.Type === 'Dup') {
      const primary = c.NGC ? `NGC ${+c.NGC}` : c.IC ? `IC ${+c.IC}` : null
      if (primary) dups.push([pretty(c.Name), primary])
      continue
    }
    if (!c.RA || !c.Dec || c.Type === 'NonEx') continue
    const m = c.M ? `M ${Number(c.M)}` : null
    out.push({
      id: pretty(c.Name),
      add: f === 'addendum.csv',
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

// ---- Caldwell aliases (OpenNGC lists them as "C 020") ----
for (const o of out) {
  for (const a of [...o.alt]) {
    const m = a.match(/^C (\d+)$/)
    if (m) o.alt.push(`C ${+m[1]}`, `Caldwell ${+m[1]}`)
  }
}

// ---- extra catalogs (data/raw, fetched by scripts/fetch-catalogs.mjs) ----
function csv(name) {
  const lines = readFileSync(new URL(`raw/${name}.csv`, dir), 'utf8').trim().split('\n')
  const split = (l) => { const r = []; let cur = '', q = false
    for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { r.push(cur); cur = '' } else cur += ch }
    r.push(cur); return r }
  const head = split(lines[0])
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v.trim()])))
}
const n = (v) => (v === '' || v === undefined || Number.isNaN(+v) ? null : +v)
const r5 = (x) => +x.toFixed(5)

// B1900 -> J2000 precession (Meeus 21.2) for the Sharpless catalog
function b1900ToJ2000(raDeg, decDeg) {
  const d2r = Math.PI / 180, as = d2r / 3600
  const T = -1, t = 1
  const zeta = ((2306.2181 + 1.39656 * T - 0.000139 * T * T) * t + (0.30188 - 0.000344 * T) * t * t + 0.017998 * t ** 3) * as
  const z = ((2306.2181 + 1.39656 * T - 0.000139 * T * T) * t + (1.09468 + 0.000066 * T) * t * t + 0.018203 * t ** 3) * as
  const th = ((2004.3109 - 0.8533 * T - 0.000217 * T * T) * t - (0.42665 + 0.000217 * T) * t * t - 0.041833 * t ** 3) * as
  const a = raDeg * d2r, d = decDeg * d2r
  const A = Math.cos(d) * Math.sin(a + zeta)
  const B = Math.cos(th) * Math.cos(d) * Math.cos(a + zeta) - Math.sin(th) * Math.sin(d)
  const C = Math.sin(th) * Math.cos(d) * Math.cos(a + zeta) + Math.cos(th) * Math.sin(d)
  return [(((Math.atan2(A, B) + z) / d2r) % 360 + 360) % 360, Math.asin(C) / d2r]
}

const mk = (id, type, ra, dec, maj, min = maj, extra = {}) => ({
  id, m: null, type, typeName: TYPES[type] ?? type, ra: r5(ra), dec: r5(dec), con: '',
  maj: maj ? +maj.toFixed(1) : null, min: min ? +min.toFixed(1) : null, pa: null, mag: null, sb: null, names: [], alt: [], ...extra,
})

const extra = []
for (const r of csv('vdb')) {
  const rad = Math.max(n(r.BRadMax) ?? 0, n(r.RRadMax) ?? 0)
  extra.push(mk(`vdB ${+r.VdB}`, 'RfN', +r._RA, +r._DE, rad * 2, undefined, { alt: [r.DM, +r.HD ? `HD ${+r.HD}` : ''].filter(Boolean) }))
}
for (const r of csv('barnard')) extra.push(mk(`B ${r.Barn.trim()}`, 'DrkN', +r._RA_icrs, +r._DE_icrs, n(r.Diam)))
for (const r of csv('ldn')) {
  if (!r.LDN) continue
  const d = n(r.Area) ? 2 * Math.sqrt(+r.Area / Math.PI) * 60 : null
  extra.push(mk(`LDN ${+r.LDN}`, 'DrkN', +r._RA_icrs, +r._DE_icrs, d, undefined, { alt: r.Barn ? [`B ${+r.Barn}`] : [] }))
}
for (const r of csv('sh2')) {
  const [ra, dec] = b1900ToJ2000(+r.RA1900, +r.DE1900)
  extra.push(mk(`Sh2-${+r.Sh2}`, 'HII', ra, dec, n(r.Diam)))
}
for (const r of csv('rcw')) {
  const ids = (r.IDs.match(/\b(NGC|IC)\s?\d+/g) ?? []).map((x) => x.replace(/(NGC|IC)\s?/, '$1 '))
  extra.push(mk(`RCW ${+r.RCW}`, 'HII', +r._RA_icrs, +r._DE_icrs, n(r.MajAxis), n(r.MinAxis), { alt: ids }))
}
for (const r of csv('hickson')) extra.push(mk(`HCG ${+r.HCG}`, 'GGroup', +r._RA_icrs, +r._DE_icrs, n(r.AngSize), undefined, { mag: n(r.Totmag), alt: [`Hickson ${+r.HCG}`] }))
{
  const arp = new Map()
  for (const r of csv('arp')) {
    const k = +r.Arp
    const e = arp.get(k) ?? { ra: +r.RAJ2000, dec: +r.DEJ2000, maj: 0, min: 0, mag: null, names: [] }
    e.maj = Math.max(e.maj, n(r.dim1) ?? 0); e.min = Math.max(e.min, n(r.dim2) ?? 0)
    e.mag = e.mag === null ? n(r.VT) : Math.min(e.mag, n(r.VT) ?? 99)
    if (r.Name) e.names.push(r.Name.replace(/\s+/g, ' '))
    arp.set(k, e)
  }
  for (const [k, e] of arp) extra.push(mk(`Arp ${k}`, e.names.length > 1 ? 'GPair' : 'G', e.ra, e.dec, e.maj, e.min, { mag: e.mag, alt: e.names }))
}
const clusterSeen = new Map()
const addCluster = (id, ra, dec, maj) => {
  const prev = clusterSeen.get(id)
  if (prev) { prev.maj = Math.max(prev.maj ?? 0, maj ?? 0) || null; return }
  const e = mk(id, 'OCl', ra, dec, maj)
  clusterSeen.set(id, e); extra.push(e)
}
for (const r of csv('clusters')) addCluster(r.Cluster.replace(/\s+/g, ' '), +r.RAJ2000, +r.DEJ2000, n(r.Diam))
const clusterAliases = []   // [catalog object id, alias]
for (const [file, label] of [['collinder', 'Collinder'], ['melotte', 'Melotte']]) {
  for (const r of csv(file)) {
    const m = r.id.match(/^Cl (Collinder|Melotte)\s+(\d+)$/)
    if (!m) continue
    const id = `${label} ${+m[2]}`
    const main = r.main_id.replace(/\s+/g, ' ')
    if (/^(NGC|IC) \d+$/.test(main)) clusterAliases.push([main, id, `${label === 'Collinder' ? 'Cr' : 'Mel'} ${+m[2]}`])
    else addCluster(id, +r.ra, +r.dec, n(r.galdim_majaxis))
  }
}
for (const r of csv('abell')) {
  const m = r.id.match(/^PN A66\s+(\d+)$/)
  if (!m) continue
  const num = +m[1]
  extra.push(mk(`Abell ${num}`, 'PN', +r.ra, +r.dec, n(r.galdim_majaxis), undefined, { alt: [`PN A66 ${num}`] }))
}

// hand-picked popular names for objects that have none in OpenNGC
const NAMES = {
  'B 33': 'Horsehead Nebula (dark)', 'B 72': 'Snake Nebula', 'B 142': "Barnard's E (north)", 'B 143': "Barnard's E (south)",
  'LDN 1622': 'Boogeyman Nebula', 'LDN 1235': 'Shark Nebula', 'vdB 141': 'Ghost Nebula', 'vdB 142': "Elephant's Trunk Nebula",
  'Sh2-101': 'Tulip Nebula', 'Sh2-155': 'Cave Nebula', 'Sh2-132': 'Lion Nebula', 'Sh2-261': "Lower's Nebula",
  'Sh2-240': 'Spaghetti Nebula', 'Sh2-129': 'Flying Bat Nebula', 'Sh2-308': 'Dolphin Head Nebula', 'Sh2-190': 'Heart Nebula',
  'Sh2-199': 'Soul Nebula', 'Sh2-275': 'Rosette Nebula',
}

// cross-identify with OpenNGC objects at (almost) the same position, so searching "IC 1805" also finds Sh2-190
const OLD_NEB = new Set(['HII', 'EmN', 'Neb', 'RfN', 'DrkN', 'PN', 'SNR', 'Cl+N'])
const dist = (a, b) => {
  const d = Math.PI / 180
  const c = Math.sin(a.dec * d) * Math.sin(b.dec * d) + Math.cos(a.dec * d) * Math.cos(b.dec * d) * Math.cos((a.ra - b.ra) * d)
  return (Math.acos(Math.min(1, Math.max(-1, c))) / d) * 60
}
let matched = 0
for (const e of extra) {
  if (NAMES[e.id]) e.names.push(NAMES[e.id])
  if (/^(Arp|HCG)/.test(e.id)) continue
  const tol = Math.max(3, 0.4 * (e.maj ?? 0))
  let best = null
  for (const o of out) {
    if (o.add) continue
    if (!(e.type === 'OCl' ? o.type === 'OCl' || o.type === 'Cl+N' : e.type === 'PN' ? o.type === 'PN' : OLD_NEB.has(o.type))) continue
    if (Math.abs(o.dec - e.dec) * 60 > tol) continue
    const d = dist(e, o)
    if (d <= tol && (!best || d < best.d)) best = { o, d }
  }
  if (best) { e.alt.push(best.o.id, ...(best.o.m ? [best.o.m] : [])); e.names.push(...best.o.names); matched++ }
}
out.push(...extra)

// ---- clean-up ----
const byId = new Map(out.map((o) => [o.id, o]))
for (const [ngc, ...aliases] of clusterAliases) byId.get(ngc)?.alt.push(...aliases)

// OpenNGC duplicates (e.g. NGC 2244 = NGC 2239) become searchable aliases of their primary object
const primaryOf = new Map(dups)
for (const [dup, primary] of dups) byId.get(primary)?.alt.push(dup)

// Herschel 400 flag
let h400 = 0
for (const r of csv('herschel400')) {
  const o = byId.get(`NGC ${+r.ngc}`) ?? byId.get(primaryOf.get(`NGC ${+r.ngc}`) ?? '')
  if (o) { o.alt.push('H400', 'Herschel 400'); h400++ }
}

// addendum entries: merge into an existing canonical entry, or rename to a readable id
const canon = (id) => {
  let m
  if ((m = id.match(/^B(\d+)$/))) return `B ${+m[1]}`
  if ((m = id.match(/^C(\d+)$/))) return `Caldwell ${+m[1]}`
  if ((m = id.match(/^Cl(\d+)$/))) return `Collinder ${+m[1]}`
  if ((m = id.match(/^Mel(\d+)$/))) return `Melotte ${+m[1]}`
  if ((m = id.match(/^HCG(\d+)$/))) return `HCG ${+m[1]}`
  if ((m = id.match(/^(PGC|UGC|MWSC)0*(\d+)$/))) return `${m[1]} ${+m[2]}`
  if ((m = id.match(/^H0*(\d+)$/))) return `Harvard ${+m[1]}`
  if ((m = id.match(/^M0*(\d+)$/))) return `M ${+m[1]}`
  return id
}
const drop = new Set()
for (const o of out) {
  if (!o.add) continue
  const raw = o.id, id = canon(raw)
  const tol = Math.max(5, 0.5 * (o.maj ?? 0))
  const twin = out.find((x) => x !== o && !x.add && x.id === id) ??
    (o.maj ? out.filter((x) => !x.add && x.type === o.type && (x.maj ?? 0) >= 0.3 * o.maj && dist(x, o) <= tol).sort((a, b) => dist(a, o) - dist(b, o))[0] : undefined)
  if (twin) {
    twin.names.push(...o.names); twin.alt.push(...o.alt)
    if (o.m && !twin.m) twin.m = o.m
    if (/^Caldwell /.test(id)) twin.alt.push(`C ${+id.split(' ')[1]}`, id)
    twin.maj = Math.max(twin.maj ?? 0, o.maj ?? 0) || null
    drop.add(o)
  } else {
    o.id = id
    if (/^Caldwell /.test(id)) o.alt.push(`C ${+id.split(' ')[1]}`)
  }
}
out.splice(0, out.length, ...out.filter((o) => !drop.has(o)))
for (const o of out) delete o.add

// verified sizes (arcmin) where the catalogs are badly off: the whole nebula, not just its cluster / brightest knot
const SIZES = { 'NGC 7000': [120, 100], 'IC 1396': [170, 140], 'IC 1848': [150, 75], 'NGC 1909': [180, 60] }
for (const o of out) if (SIZES[o.id]) [o.maj, o.min] = SIZES[o.id]
for (const o of out) { o.names = [...new Set(o.names)]; o.alt = [...new Set(o.alt)].filter((a) => a !== o.id) }

writeFileSync(new URL('../public/catalog.json', import.meta.url), JSON.stringify(out))
const by = {}
for (const o of out) { const k = o.m ? 'Messier' : o.id.match(/^[A-Za-z]+/)?.[0] ?? '?'; by[k] = (by[k] ?? 0) + 1 }
for (const k of Object.keys(by)) if (by[k] < 20) delete by[k]
console.log(`${out.length} objects (${matched} cross-identified, ${h400} Herschel 400)`, by)
