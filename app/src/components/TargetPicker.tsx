import { useMemo, useState } from 'react'
import { searchCatalog, targetLabel, type CatObject } from '../lib/catalog'

/** Find an object by typing (any catalogue object, your wishlist first); `value` is its id, '' for none. */
export default function TargetPicker({ catalog, mine, value, objectOf, onChange }: {
  catalog: CatObject[]; mine: CatObject[]; value: string; objectOf: (id: string) => CatObject | undefined; onChange: (id: string) => void
}) {
  const [q, setQ] = useState<string | null>(null)
  const sel = value ? objectOf(value) : undefined
  const results = useMemo(() => {
    if (q == null) return []
    if (q.trim().length < 2) return mine.slice(0, 12)
    const own = searchCatalog(mine, q, 6)
    return [...own, ...searchCatalog(catalog, q, 12).filter((o) => !own.some((x) => x.id === o.id))].slice(0, 12)
  }, [q, mine, catalog])
  const pick = (id: string) => { onChange(id); setQ(null) }
  return (
    <span className="tpick">
      <input value={q ?? (sel ? targetLabel(sel) : '')} placeholder="Search: M42, NGC 281, Pacman…"
        onFocus={() => setQ('')} onChange={(e) => setQ(e.target.value)}
        onBlur={() => setTimeout(() => setQ(null), 150)}
        onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); pick(results[0].id) } if (e.key === 'Escape') setQ(null) }} />
      {sel && q == null && <button type="button" className="tclear" onClick={() => onChange('')} aria-label="Clear target">✕</button>}
      {q != null && results.length > 0 && (
        <span className="tlist" role="listbox">
          {results.map((o) => <button type="button" key={o.id} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o.id)}>{targetLabel(o)}<small>{mine.some((m) => m.id === o.id) ? 'wishlist' : o.typeName}</small></button>)}
        </span>
      )}
    </span>
  )
}
