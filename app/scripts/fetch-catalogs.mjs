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
  ['abell', SIMBAD, "SELECT main_id, ra, dec, galdim_majaxis FROM basic JOIN ident ON oidref = oid WHERE id LIKE 'PN A66 %'"],
]

for (const [name, url, query] of jobs) {
  const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', QUERY: query }) })
  const text = await res.text()
  if (!res.ok || text.includes('QUERY_STATUS')) throw new Error(`${name}: ${text.slice(0, 300)}`)
  writeFileSync(new URL(`../../data/raw/${name}.csv`, import.meta.url), text)
  console.log(name, text.trim().split('\n').length - 1, 'rows')
}
