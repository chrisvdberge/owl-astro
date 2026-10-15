// Photographic dynamic range per ISO for the cameras astrophotographers commonly use, from Bill Claff's PhotonsToPhotos
// (https://www.photonstophotos.net/Charts/PDR.htm) into src/lib/isodr.json for the Best ISO tool.
// Only a curated list is kept, credited and linked in the tool. Run: node scripts/build-iso.mjs [saved PDR.htm]
import { readFileSync, writeFileSync } from 'node:fs'

// PhotonsToPhotos name → name shown in the app
const CAMERAS = {
  'Canon EOS 1100D': 'Canon EOS 1100D', 'Canon EOS 600D': 'Canon EOS 600D', 'Canon EOS 700D': 'Canon EOS 700D', 'Canon EOS 2000D': 'Canon EOS 2000D',
  'Canon EOS 250D': 'Canon EOS 250D', 'Canon EOS 60Da': 'Canon EOS 60Da', 'Canon EOS 80D': 'Canon EOS 80D', 'Canon EOS 90D': 'Canon EOS 90D',
  'Canon EOS 6D': 'Canon EOS 6D', 'Canon EOS 6D Mark II': 'Canon EOS 6D Mark II', 'Canon EOS 5D Mark III': 'Canon EOS 5D Mark III',
  'Canon EOS 5D Mark IV': 'Canon EOS 5D Mark IV', 'Canon EOS M50': 'Canon EOS M50', 'Canon EOS Ra': 'Canon EOS Ra', 'Canon EOS R': 'Canon EOS R',
  'Canon EOS RP': 'Canon EOS RP', 'Canon EOS R5': 'Canon EOS R5', 'Canon EOS R6': 'Canon EOS R6', 'Canon EOS R6 Mark II': 'Canon EOS R6 Mark II',
  'Canon EOS R7': 'Canon EOS R7', 'Canon EOS R8': 'Canon EOS R8', 'Canon EOS R10': 'Canon EOS R10',
  'Nikon D5300': 'Nikon D5300', 'Nikon D5600': 'Nikon D5600', 'Nikon D7000': 'Nikon D7000', 'Nikon D7100': 'Nikon D7100', 'Nikon D7200': 'Nikon D7200',
  'Nikon D7500': 'Nikon D7500', 'Nikon D600': 'Nikon D600', 'Nikon D610': 'Nikon D610', 'Nikon D750': 'Nikon D750', 'Nikon D810': 'Nikon D810',
  'Nikon D810A': 'Nikon D810A', 'Nikon D850': 'Nikon D850', 'Nikon Z 5': 'Nikon Z5', 'Nikon Z 6': 'Nikon Z6', 'Nikon Z 6II': 'Nikon Z6 II',
  'Nikon Z 7': 'Nikon Z7', 'Nikon Z 8': 'Nikon Z8', 'Nikon Z 50': 'Nikon Z50', 'Nikon Z f': 'Nikon Zf',
  'Sony ILCE-6000': 'Sony A6000', 'Sony ILCE-6400': 'Sony A6400', 'Sony ILCE-6700': 'Sony A6700', 'Sony ILCE-7M2': 'Sony A7 II',
  'Sony ILCE-7M3': 'Sony A7 III', 'Sony ILCE-7M4': 'Sony A7 IV', 'Sony ILCE-7RM3': 'Sony A7R III', 'Sony ILCE-7RM4': 'Sony A7R IV',
  'Sony ILCE-7RM5': 'Sony A7R V', 'Sony ILCE-7SM2': 'Sony A7S II', 'Sony ILCE-7SM3': 'Sony A7S III',
  'FujiFilm X-T3': 'Fujifilm X-T3', 'FujiFilm X-T4': 'Fujifilm X-T4', 'FujiFilm X-T5': 'Fujifilm X-T5', 'FujiFilm X-S10': 'Fujifilm X-S10',
  'Olympus System OM-1': 'OM System OM-1', 'Olympus System OM-3 Astro': 'OM System OM-3 Astro', 'Panasonic Lumix DC-S5': 'Panasonic Lumix S5',
  'Panasonic Lumix DC-S5M2': 'Panasonic Lumix S5 II', 'Panasonic Lumix DC-GH5S': 'Panasonic Lumix GH5S', 'Pentax K-1': 'Pentax K-1',
}

// the nominal third-stop ISO series the measured values are snapped to (3.125 · 2^x gives 126, 159, …)
const NOMINAL = [50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000,
  12800, 16000, 20000, 25600, 32000, 40000, 51200, 64000, 80000, 102400, 128000, 160000, 204800, 256000, 320000, 409600, 512000, 640000, 819200]
const nominal = (iso) => NOMINAL.reduce((a, b) => (Math.abs(Math.log2(b / iso)) < Math.abs(Math.log2(a / iso)) ? b : a))

const src = process.argv[2]
const html = src ? readFileSync(src, 'latin1') : await (await fetch('https://www.photonstophotos.net/Charts/PDR.htm', { headers: { 'User-Agent': 'Mozilla/5.0' } })).text()

const out = []
for (const [ptp, label] of Object.entries(CAMERAS)) {
  const at = html.indexOf(`name: '${ptp}', lowLightEv`)
  if (at < 0) { console.warn('missing', ptp); continue }
  const data = html.slice(html.indexOf('data: [', at) + 7, html.indexOf(']}', at))
  // plain [x, y] points are measured ISOs; {x, y, marker} ones are extended ISOs (white, left out) or raw files with noise
  // reduction applied (triangles, kept with a third element 1: they overstate the range). ISO = 3.125 · 2^x.
  const pts = [...data.matchAll(/\[([\d.]+),([\d.]+)\]|\{x:([\d.]+),y:([\d.]+),marker:\{(symbol:'triangle-down')?[^}]*\}\}/g)]
    .filter((m) => m[1] || (m[5] && !m[0].includes('white')))
    .map((m) => (m[1] ? [nominal(3.125 * 2 ** +m[1]), +m[2]] : [nominal(3.125 * 2 ** +m[3]), +m[4], 1]))
  out.push({ id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label, ptp, pts })
}
out.sort((a, b) => a.label.localeCompare(b.label))
writeFileSync(new URL('../src/lib/isodr.json', import.meta.url), JSON.stringify(out) + '\n')
console.log(`${out.length} cameras`)
