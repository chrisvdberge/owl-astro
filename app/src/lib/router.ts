import { useMemo, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react'
import { createElement } from 'react'

/**
 * A minimal router on the History API: every page has a URL, back/forward work, and the app (with its sky map) stays
 * mounted while pages change. Cloudflare and the service worker serve index.html for any path, so deep links load too.
 */
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())
window.addEventListener('popstate', emit)
const href = () => location.pathname + location.search

export function navigate(to: string, opts: { replace?: boolean; state?: unknown } = {}) {
  if (to === href() && !opts.state) return
  history[opts.replace ? 'replaceState' : 'pushState'](opts.state ?? null, '', to)
  emit()
}

export function useRoute() {
  const h = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, href)
  return useMemo(() => {
    const u = new URL(h, location.origin)
    return { path: u.pathname.split('/').filter(Boolean).map(decodeURIComponent), query: u.searchParams, href: h }
  }, [h])
}

/** The current URL with some query parameters changed (null removes one). */
export function withQuery(patch: Record<string, string | null | undefined>) {
  const u = new URL(location.href)
  for (const [k, v] of Object.entries(patch)) if (v == null || v === '') u.searchParams.delete(k); else u.searchParams.set(k, v)
  return u.pathname + u.search
}

/** An ordinary link that navigates without reloading (a modified click still opens a new tab). */
export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return createElement('a', {
    ...rest, href: to,
    onClick: (e: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e)
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      e.preventDefault(); navigate(to)
    },
  })
}
