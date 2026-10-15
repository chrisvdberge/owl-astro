// Fetches the stars brighter than V 4.5 from SIMBAD (TAP) into public/stars.json, for occultation and close-pass events:
// [[name, ra, dec, V], …], degrees J2000; name is the proper name when SIMBAD has one, else the Bayer/Flamsteed designation.
import { writeFileSync } from 'node:fs'

const SIMBAD = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync'
const LIMIT = 4.5
async function tap(query) {
  const res = await fetch(SIMBAD, { method: 'POST', body: new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', QUERY: query }) })
  const text = await res.text()
  if (!res.ok || text.includes('QUERY_STATUS')) throw new Error(text.slice(0, 300))
  return text.trim().split('\n').slice(1).map((l) => l.match(/("[^"]*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '')))
}
const stars = await tap(`SELECT b.oid, b.main_id, b.ra, b.dec, f.V FROM basic b JOIN allfluxes f ON f.oidref = b.oid WHERE f.V < ${LIMIT} AND b.ra IS NOT NULL AND b.main_id LIKE '* %'`)
const names = await tap(`SELECT i.oidref, i.id FROM ident i JOIN allfluxes f ON f.oidref = i.oidref WHERE f.V < ${LIMIT} AND i.id LIKE 'NAME %'`)

// a star's everyday name: no component letter ("Sirius A"), single words first, then the shortest
const named = new Map()
for (const [oid, id] of names) {
  const n = id.replace(/^NAME /, '')
  const score = (/ [A-C]$/.test(n) ? 100 : 0) + n.split(' ').length * 10 + n.length / 100
  const prev = named.get(oid)
  if (!prev || score < prev.score) named.set(oid, { n, score })
}
const GREEK = { alf: 'α', bet: 'β', gam: 'γ', del: 'δ', eps: 'ε', zet: 'ζ', eta: 'η', tet: 'θ', iot: 'ι', kap: 'κ', lam: 'λ', mu: 'μ', nu: 'ν', ksi: 'ξ', omi: 'ο', pi: 'π', rho: 'ρ', sig: 'σ', tau: 'τ', ups: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', ome: 'ω' }
const bayer = (id) => id.replace(/^\*+\s*/, '').replace(/^([a-z]{2,3})\.?(\d*)\s/, (_, g, k) => `${GREEK[g] ?? g}${k ? `${k}` : ''} `).replace(/\s+/g, ' ')
const all = stars
  .map(([oid, id, ra, dec, v]) => ({ name: named.get(oid)?.n, id: bayer(id), ra: +ra, dec: +dec, v: +v }))
  .sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1) || a.v - b.v)
// components of one system (α Cen A / AB, γ Lup B …) appear separately: keep one entry per arcminute, named first
const out = []
for (const s of all) {
  if (out.some((o) => Math.abs(o.dec - s.dec) < 1 / 60 && Math.abs(o.ra - s.ra) * Math.cos((s.dec * Math.PI) / 180) < 1 / 60)) continue
  out.push(s)
}
out.sort((a, b) => a.v - b.v)
writeFileSync(new URL('../public/stars.json', import.meta.url), JSON.stringify(out.map((s) => [s.name ?? s.id, +s.ra.toFixed(4), +s.dec.toFixed(4), +s.v.toFixed(2)])))
console.log(`${out.length} stars, ${out.filter((s) => s.name).length} with a proper name`)
