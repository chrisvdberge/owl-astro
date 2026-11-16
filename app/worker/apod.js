// NASA APODs from the remote observatories (supabase/migrations/0020_remote_apods.sql). APOD moved to science.nasa.gov,
// where each APOD is a WordPress "image-article" whose content includes the explanation and the credit line. Once a day
// the worker reads the newest posts and stores the APODs that name one of the observatories. It looks back over the
// last 40 image articles (several days of APODs), so a missed day is picked up the next day; re-storing is harmless.

const API = 'https://science.nasa.gov/wp-json/wp/v2/image-article'

// observatory slug → how APOD names it. Kept strict: a nightscape "not far from El Sauce" or "Space Telescope Live"
// would still match, so check new rows now and then.
export const APOD_NAMES = {
  starfront: /Starfront/i,
  'deep-sky-chile': /Deep\s?Sky\s?Chile/i,
  'obstech-el-sauce': /\bObs\s?Tech\b|El Sauce/i,
  'sierra-remote-observatories': /Sierra Remote/i,
  'telescope-live': /(?<!Space )Telescope\s?Live/i,
  itelescope: /iTelescope/i,
  'e-eye': /\bE-?EyE\b|Entre Encinas/i,
  'skygems-hakos': /Hakos/i,
  'kagga-kamma': /Kagga Kamma/i,
  'deep-sky-west': /Deep\s?Sky\s?West/i,
  'dark-sky-new-mexico': /Dark\s?Sky New Mexico/i,
  // case-sensitive: "under New Mexico skies" is a common phrase
  'new-mexico-skies': /New Mexico Skies/,
  'utah-desert-remote-observatories': /Utah Desert Remote|\bUDRO\b/i,
  'trevinca-skies': /Trevinca/i,
  pixelskies: /Pixel\s?Skies/i,
}

const decode = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&(nbsp|ndash|rsquo|lsquo|ldquo|rdquo);/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * The APOD's image on NASA's image service, in the form that resizes on request (content/dam/ paths don't).
 * Asked for separately: the API only includes featured_image (with the alt text) alongside featured_media, and not with content.
 */
async function apodImage(slug) {
  const res = await fetch(`${API}?slug=${encodeURIComponent(slug)}&_fields=featured_media,featured_image,featured_image_url`, {
    headers: { accept: 'application/json', 'user-agent': 'OwlAstro remote tracker (owlastro.com/remote)' }, signal: AbortSignal.timeout(30e3),
  })
  const [post] = res.ok ? await res.json() : []
  if (!post) return { image: null, image_alt: null }
  const fi = post.featured_image && !Array.isArray(post.featured_image) ? post.featured_image : {}
  const url = fi.file || (post.featured_image_url ?? '').split('?')[0]
  return { image: url ? url.replace('assets.science.nasa.gov/content/dam/', 'assets.science.nasa.gov/dynamicimage/assets/') : null, image_alt: fi.alt ? decode(fi.alt).slice(0, 300) : null }
}

/** APOD posts among the newest image articles → rows for remote_apods */
export async function findApods() {
  const res = await fetch(`${API}?per_page=40&orderby=date&_fields=slug,date,title,link,content`, {
    headers: { accept: 'application/json', 'user-agent': 'OwlAstro remote tracker (owlastro.com/remote)' }, signal: AbortSignal.timeout(30e3),
  })
  if (!res.ok) throw new Error(`science.nasa.gov ${res.status}`)
  const rows = []
  for (const post of await res.json()) {
    if (!post.slug?.startsWith('apod-')) continue
    const text = decode(post.content?.rendered ?? '')
    const at = text.indexOf('Credit')
    const credit = at >= 0 ? text.slice(at, text.indexOf('Authors', at) >>> 0) : ''
    let img
    for (const [observatory, re] of Object.entries(APOD_NAMES)) {
      if (!re.test(text)) continue
      img ??= await apodImage(post.slug)
      rows.push({
        observatory, apod_date: post.date.slice(0, 10), link: post.link, in_credit: re.test(credit),
        title: decode(post.title?.rendered ?? '').replace(/^APOD:\s*[^–]*–\s*/, ''),
        ...img,
      })
    }
  }
  return rows
}

/** Daily cron: store any new APODs from the observatories */
export async function checkApods(env) {
  const rows = await findApods()
  if (!rows.length) return rows
  const key = env.SUPABASE_SECRET_KEY
  const headers = { apikey: key, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' }
  if (key.startsWith('ey')) headers.authorization = `Bearer ${key}`
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/remote_apods?on_conflict=observatory,apod_date`, { method: 'POST', headers, body: JSON.stringify(rows) })
  if (!res.ok) throw new Error(`remote_apods ${res.status}: ${await res.text()}`)
  return rows
}
