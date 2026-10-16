import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, navigate } from '../lib/router'
import type { useStore } from '../lib/store'

type Store = ReturnType<typeof useStore>

/** A button that opens a small menu below it; closes on outside click, Escape or choosing an item. */
function Popover({ label, className, children }: { label: ReactNode; className?: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', off); window.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', off); window.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <span className={`pop ${className ?? ''}`} ref={ref}>
      <button className={open ? 'on' : ''} aria-expanded={open} onClick={() => setOpen(!open)}>{label}</button>
      {open && <div className="popmenu">{children(() => setOpen(false))}</div>}
    </span>
  )
}

/** The active site, switchable from any page; the home site is starred. */
export function SiteSwitcher({ store }: { store: Store }) {
  const loc = store.active
  return (
    <Popover className="sitesw" label={<><span className="pin">◉</span><span className="sname">{loc.name}</span>{loc.bortle ? <small>B{loc.bortle}</small> : null}<span className="car">▾</span></>}>
      {(close) => (
        <>
          <small className="poph">Site</small>
          {store.locations.map((l) => (
            <button key={l.id} className={l.id === loc.id ? 'sel' : ''} onClick={() => { store.setActive(l.id); close() }}>
              <span className="star">{l.id === store.homeId ? '★' : ''}</span>{l.name}{l.bortle ? <small>Bortle {l.bortle}</small> : null}
            </button>
          ))}
          <hr />
          <button onClick={() => { navigate('/account/sites'); close() }}>Manage and add sites…</button>
        </>
      )}
    </Popover>
  )
}

/** The account's own pages, and the tools that are not about one account's data. */
export const ACCOUNT: [string, string, string][] = [['/account', 'My account', 'Sign-in, sync, planning limits'], ['/account/gear', 'My gear', 'Your telescopes and cameras'], ['/account/sites', 'My sites', 'Light pollution, horizons, home']]
export const TOOLS: [string, string, string][] = [['/tools/gear', 'Gear planner', 'Compare scopes and cameras'], ['/tools/inspector', 'Image inspector', 'Check stars and noise'], ['/tools/review', 'Image review', 'Feedback on a finished image'], ['/tools/iso', 'Best ISO', 'Where a camera stops gaining'], ['/tools/gain', 'Best gain', 'For astro cameras, under your sky']]

export function ToolsMenu({ active }: { active: boolean }) {
  return (
    <Popover className={`setupm ${active ? 'cur' : ''}`} label={<>Tools <span className="car">▾</span></>}>
      {(close) => TOOLS.map(([to, name, sub]) => <Link key={to} to={to} onClick={close}><b>{name}</b><small>{sub}</small></Link>)}
    </Popover>
  )
}

/** Phones: the main sections as a tab bar at the bottom of the screen, everything else under More. */
export function TabBar({ items, current, more }: { items: [string, string, string, string][]; current: string; more: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {open && <div className="mback" onClick={() => setOpen(false)} />}
      {open && <nav className="msheet" onClick={() => setOpen(false)}>{more}</nav>}
      <nav className="tabbar">
        {items.map(([id, to, name, icon]) => <Link key={id} to={to} className={current === id ? 'on' : ''} onClick={() => setOpen(false)}><i>{icon}</i>{name}</Link>)}
        <button className={open || current === 'more' ? 'on' : ''} onClick={() => setOpen(!open)}><i>⋯</i>More</button>
      </nav>
    </>
  )
}
