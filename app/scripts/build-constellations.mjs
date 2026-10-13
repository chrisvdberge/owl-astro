// Fetches the d3-celestial constellation stick figures and label positions (BSD-3, Olaf Frohn)
// into public/constellations.json: [{ id, name, label: [ra, dec], lines: [[[ra, dec], …], …] }], degrees J2000.
import { writeFileSync } from 'node:fs'

const src = 'https://cdn.jsdelivr.net/gh/ofrohn/d3-celestial@master/data/'
const get = async (f) => (await fetch(src + f)).json()
const [lines, names] = await Promise.all([get('constellations.lines.json'), get('constellations.json')])
const ra = (lon) => +((lon + 360) % 360).toFixed(3)
const pt = ([lon, lat]) => [ra(lon), +lat.toFixed(3)]
const label = new Map(names.features.map((f) => [f.id, { name: f.properties.name, at: pt(f.geometry.coordinates) }]))
const out = lines.features.map((f) => ({ id: f.id, name: label.get(f.id)?.name ?? f.id, label: label.get(f.id)?.at ?? pt(f.geometry.coordinates[0][0]), lines: f.geometry.coordinates.map((l) => l.map(pt)) }))
writeFileSync(new URL('../public/constellations.json', import.meta.url), JSON.stringify(out))
console.log(`${out.length} constellations`)
