// Downloads the extra catalogs (VizieR / SIMBAD TAP) into ../data/raw as CSV. Re-run to refresh.
import { writeFileSync } from 'node:fs'

const VIZIER = 'https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync'
const SIMBAD = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync'

const jobs = [
  ['vdb', VIZIER, 'SELECT VdB, _RA, _DE, BRadMax, RRadMax, DM, HD FROM "VII/21/catalog"'],
  ['barnard', VIZIER, 'SELECT * FROM "VII/220A/barnard"'],
  ['ldn', VIZIER, 'SELECT * FROM "VII/7A/ldn"'],
  ['sh2', VIZIER, 'SELECT Sh2, RA1900, DE1900, Diam FROM "VII/20/catalog"'],
  ['hickson', VIZIER, 'SELECT * FROM "VII/213/groups"'],
  ['rcw', VIZIER, 'SELECT * FROM "VII/216/rcw"'],
  ['arp', VIZIER, 'SELECT Arp, Name, VT, dim1, dim2, MType, RAJ2000, DEJ2000 FROM "VII/192/arplist"'],
  ['clusters', VIZIER, "SELECT Cluster, RAJ2000, DEJ2000, Diam FROM \"B/ocl/clusters\" WHERE Cluster LIKE 'Collinder%' OR Cluster LIKE 'Melotte%'"],
  ['collinder', SIMBAD, "SELECT id, main_id, ra, dec, galdim_majaxis, otype FROM basic JOIN ident ON oidref = oid WHERE id LIKE 'Cl Collinder %' AND otype IN ('OpC','Cl*','As*','*iC','Cl*..')"],
  ['melotte', SIMBAD, "SELECT id, main_id, ra, dec, galdim_majaxis, otype FROM basic JOIN ident ON oidref = oid WHERE id LIKE 'Cl Melotte %' AND otype IN ('OpC','Cl*','As*','*iC','Cl*..')"],
  ['abell', SIMBAD, "SELECT id, main_id, ra, dec, galdim_majaxis FROM basic JOIN ident ON oidref = oid WHERE id LIKE 'PN A66 %'"],
]

for (const [name, url, query] of jobs) {
  const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', QUERY: query }) })
  const text = await res.text()
  if (!res.ok || text.includes('QUERY_STATUS')) throw new Error(`${name}: ${text.slice(0, 300)}`)
  writeFileSync(new URL(`../../data/raw/${name}.csv`, import.meta.url), text)
  console.log(name, text.trim().split('\n').length - 1, 'rows')
}

// Herschel 400: NGC numbers from the four list tables of the Wikipedia article (Wikipedia text is CC-BY-SA)
{
  const res = await fetch('https://en.wikipedia.org/w/api.php?action=parse&page=Herschel_400_Catalogue&prop=wikitext&format=json&formatversion=2', { headers: { 'User-Agent': 'astroplanner-catalog-build' } })
  const wikitext = (await res.json()).parse.wikitext
  const tables = wikitext.match(/\{\|[\s\S]*?\n\|\}/g).filter((t) => /Messier or <br ?\/?>Caldwell ID/.test(t))
  const nums = new Set()
  for (const t of tables) for (const row of t.split('\n|-').slice(2)) {
    const m = row.split('\n').slice(1).join(' ').match(/NGC\s*(\d+)/)
    if (m) nums.add(+m[1])
  }
  writeFileSync(new URL('../../data/raw/herschel400.csv', import.meta.url), 'ngc\n' + [...nums].sort((a, b) => a - b).join('\n') + '\n')
  console.log('herschel400', nums.size, 'objects')
}
