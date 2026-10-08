import { useEffect, useState } from 'react'
import { isCustom, type CatObject } from './catalog'

export interface Summary { title: string; extract: string; thumb?: string; url: string }

const cache = new Map<string, Promise<Summary | null>>()
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Spellings of an object's designations that an article about it would contain. */
const idents = (o: CatObject) => [o.id, o.m ?? '', o.m ? `Messier ${o.m.replace(/\D/g, '')}` : '', ...o.alt.filter((a) => /^(NGC|IC|M|Sh2|Caldwell)/.test(a))].filter(Boolean).map(squash)

/** Lead paragraph of the English Wikipedia article about an object, when one clearly mentions it. */
export function findSummary(o: CatObject): Promise<Summary | null> {
  let p = cache.get(o.id)
  if (!p) {
    p = (async () => {
      const q = [o.m ? `Messier ${o.m.replace(/\D/g, '')}` : o.id, o.names[0]].filter(Boolean).join(' ')
      const u = 'https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrlimit=5&gsrsearch=' + encodeURIComponent(q) +
        '&prop=extracts|pageimages|info&exintro=1&explaintext=1&exsentences=5&inprop=url&piprop=thumbnail&pithumbsize=440&format=json&origin=*'
      const res = await fetch(u)
      if (!res.ok) throw new Error(`Wikipedia ${res.status}`)
      const j = await res.json()
      type Page = { title: string; index: number; extract?: string; fullurl: string; thumbnail?: { source: string } }
      const pages = (Object.values(j.query?.pages ?? {}) as Page[]).sort((a, b) => a.index - b.index)
      const ids = idents(o), name = o.names[0] ? squash(o.names[0]) : ''
      const hit = pages.find((pg) => pg.extract && (ids.some((i) => squash(pg.title + ' ' + pg.extract).includes(i)) || (name && squash(pg.title).includes(name))))
      return hit ? { title: hit.title, extract: hit.extract!, thumb: hit.thumbnail?.source, url: hit.fullurl } : null
    })()
    p.catch(() => cache.delete(o.id))
    cache.set(o.id, p)
  }
  return p
}

export function useSummary(o: CatObject) {
  const [state, setState] = useState<{ id: string; data: Summary | null; done: boolean }>({ id: '', data: null, done: false })
  useEffect(() => {
    if (isCustom(o.id)) return
    let dead = false
    findSummary(o).then((data) => !dead && setState({ id: o.id, data, done: true })).catch(() => !dead && setState({ id: o.id, data: null, done: true }))
    return () => { dead = true }
  }, [o])
  const mine = state.id === o.id
  return { summary: mine ? state.data : null, loading: !isCustom(o.id) && !(mine && state.done) }
}
