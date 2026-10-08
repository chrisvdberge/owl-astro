import { useEffect, useState } from 'react'
import { isCustom, type CatObject } from './catalog'

export interface Img { id: string; title: string; thumb: string; full: string; page: string; artist: string; license: string }

const cache = new Map<string, Promise<Img[]>>()

const strip = (html: string) => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()

/** Search terms for an object: most specific first (id + common name), then looser fallbacks. */
export function searchTerms(o: CatObject): string[] {
  const ident = o.m ? `Messier ${o.m.replace(/\D/g, '')}` : o.id
  const name = o.names[0]
  return [...new Set([name ? `${ident} ${name}` : ident, name ?? '', ident].filter(Boolean))]
}

async function commons(q: string): Promise<Img[]> {
  const u = 'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=14&gsrsearch=' + encodeURIComponent(q) +
    '&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=480&format=json&origin=*'
  const res = await fetch(u)
  if (!res.ok) throw new Error(`Wikimedia ${res.status}`)
  const j = await res.json()
  type Page = { pageid: number; title: string; index: number; imageinfo?: { thumburl?: string; url: string; descriptionurl: string; mime: string; extmetadata?: Record<string, { value: string }> }[] }
  return (Object.values(j.query?.pages ?? {}) as Page[])
    .sort((a, b) => a.index - b.index)
    .flatMap((p) => {
      const i = p.imageinfo?.[0]
      if (!i || !/^image\/(jpeg|png)$/.test(i.mime) || !i.thumburl) return []
      const m = i.extmetadata ?? {}
      return [{
        id: String(p.pageid), title: p.title.replace(/^File:/, '').replace(/\.\w+$/, ''), thumb: i.thumburl,
        full: i.thumburl.replace(/\/\d+px-/, '/1280px-'), page: i.descriptionurl,
        artist: strip(m.Artist?.value ?? ''), license: m.LicenseShortName?.value ?? '',
      }]
    })
}

/** Example images from Wikimedia Commons; tries tighter queries first and widens until there are a few results. */
export function findImages(o: CatObject): Promise<Img[]> {
  let p = cache.get(o.id)
  if (!p) {
    p = (async () => {
      const seen = new Map<string, Img>()
      for (const q of searchTerms(o)) {
        for (const img of await commons(q)) seen.set(img.id, img)
        if (seen.size >= 6) break
      }
      return [...seen.values()].slice(0, 12)
    })()
    p.catch(() => cache.delete(o.id)) // let a failed lookup be retried
    cache.set(o.id, p)
  }
  return p
}

export function useImages(o: CatObject, enabled = true) {
  const [state, setState] = useState<{ id: string; images: Img[] | null; error: boolean }>({ id: '', images: null, error: false })
  useEffect(() => {
    if (!enabled || isCustom(o.id)) return
    let dead = false
    findImages(o).then((images) => !dead && setState({ id: o.id, images, error: false })).catch(() => !dead && setState({ id: o.id, images: null, error: true }))
    return () => { dead = true }
  }, [o, enabled])
  const mine = state.id === o.id
  return { images: mine ? state.images : null, error: mine ? state.error : false, loading: enabled && !isCustom(o.id) && !(mine && (state.images || state.error)) }
}
