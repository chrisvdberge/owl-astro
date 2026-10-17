import { useEffect, useState } from 'react'
import type { CatObject } from '../lib/catalog'
import { notes } from '../lib/review'
import { loadShared, printReview } from '../lib/reviews'
import { setupNotes } from '../lib/reviewSetup'
import { Link } from '../lib/router'
import { supabase } from '../lib/sync'
import { ReviewGrids, ReviewMarks, ReviewNotes, ReviewStats } from './ReviewParts'

type Shared = NonNullable<Awaited<ReturnType<typeof loadShared>>>

/** A review someone shared: read-only, for anyone with the link, signed in or not. */
export default function SharedReview({ token, catalog }: { token: string; catalog: CatObject[] }) {
  const [state, setState] = useState<{ token: string; rev: Shared | null; err?: string } | null>(null)
  useEffect(() => {
    if (!supabase) return
    let live = true
    loadShared(supabase, token)
      .then((rev) => { if (live) setState({ token, rev }) })
      .catch((e) => { if (live) setState({ token, rev: null, err: e.message ?? String(e) }) })
    return () => { live = false }
  }, [token])

  if (!supabase) return <div className="insp"><p className="nmsg">Shared reviews need the online version of the app.</p></div>
  if (!state || state.token !== token) return <div className="insp"><p className="note">Loading the review…</p></div>
  const rev = state.rev
  if (!rev) return (
    <div className="insp">
      <h2 className="th">Review not found</h2>
      <p className="note">{state.err ? `Couldn't load it: ${state.err}` : 'This link isn\'t shared any more, or it was mistyped.'} <Link to="/tools/review">Review your own image</Link>.</p>
    </div>
  )
  const r = rev.result, ctx = rev.share?.ctx
  const target = rev.targetId ? catalog.find((o) => o.id === rev.targetId) : undefined
  const list = [...notes(r, { arcsecKnown: !!ctx?.arcsec }), ...(ctx ? setupNotes(r, ctx) : [])]
  const issues = list.filter((n) => n.tone === 'warn' || n.tone === 'bad').length
  const made = [rev.share?.setup, ctx?.hours && `${ctx.hours} h`, ctx?.subSec && `${ctx.subSec} s subs`, ctx?.filter === 'dual' && 'dual-band filter', ctx?.bortle && `Bortle ${ctx.bortle}`].filter(Boolean).join(' · ')
  return (
    <div className="insp rvshared">
      <div className="ch wrap"><h2 className="th">Image review <small>{target ? target.m ?? target.names[0] ?? target.id : rev.name}</small></h2><span className="sp" />
        <button className="noprint" onClick={() => printReview(rev.name)}>Export PDF</button></div>
      <h3>{rev.name} <small>{new Date(rev.at).toLocaleDateString()} · {issues ? `${issues} thing${issues > 1 ? 's' : ''} to look at` : 'nothing obvious to fix'}</small></h3>
      {made && <p className="note">{made}</p>}
      <div className="rvtop">
        {rev.src ? <figure className="rvimg"><img src={rev.src} alt={rev.name} /><ReviewMarks r={r} /></figure> : <p className="note">The image couldn't be loaded.</p>}
        <ReviewStats r={r} />
      </div>
      <ReviewNotes list={list} />
      <ReviewGrids r={r} />
      <p className="note noprint">Made with Owl Astro's <Link to="/tools/review">Image review</Link>: drop in your own finished image for the same check.</p>
    </div>
  )
}
