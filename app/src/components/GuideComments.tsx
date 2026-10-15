import { useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/sync'

const SITE = 'https://owlastro.com'
const COLS = 'id, page_id, parent_id, name, body, is_author, approved, created_at'

interface Comment { id: string; page_id: string; parent_id: string | null; name: string; body: string; is_author: boolean; approved: boolean; created_at: string }

/** Whether the signed-in user moderates the comments on the guides (decided in the database, not here). */
export function useCommentAdmin(user: User | null) {
  const [admin, setAdmin] = useState(false)
  useEffect(() => {
    if (!supabase || !user) { setAdmin(false); return }
    supabase.rpc('is_comment_admin').then(({ data }) => setAdmin(data === true))
  }, [user])
  return admin
}

/** How many comments wait for approval; for the card on the account page. */
export function usePendingComments(admin: boolean) {
  const [n, setN] = useState<number | null>(null)
  useEffect(() => {
    if (!supabase || !admin) return
    supabase.from('guide_comments').select('id', { count: 'exact', head: true }).eq('approved', false).then(({ count }) => setN(count ?? 0))
  }, [admin])
  return n
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** Moderating the comments on the guides: approve or delete what's waiting, reply as the author, remove published ones. */
export default function GuideComments({ user }: { user: User | null }) {
  const admin = useCommentAdmin(user)
  const [rows, setRows] = useState<Comment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reply, setReply] = useState<{ to: Comment; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase.from('guide_comments').select(COLS).order('created_at', { ascending: false }).limit(300)
    setError(error?.message ?? null)
    setRows(data ?? [])
  }, [])
  useEffect(() => { if (admin) load() }, [admin, load])

  const act = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p
    setError(error?.message ?? null)
    load()
  }
  const approve = (c: Comment) => act(supabase!.from('guide_comments').update({ approved: true }).eq('id', c.id))
  const remove = (c: Comment) => { if (confirm(`Delete the comment by ${c.name}${c.parent_id ? '' : ' and any replies to it'}?`)) act(supabase!.from('guide_comments').delete().eq('id', c.id)) }
  const sendReply = async () => {
    if (!reply || !reply.text.trim()) return
    const to = reply.to
    // replying approves the comment too: you wouldn't answer one you don't want published
    if (!to.approved) await supabase!.from('guide_comments').update({ approved: true }).eq('id', to.id)
    await act(supabase!.from('guide_comments').insert({ page_id: to.page_id, parent_id: to.parent_id ?? to.id, name: 'Christian van den Berge', body: reply.text.trim(), is_author: true, approved: true }))
    setReply(null)
  }

  if (!user) return <div className="settings"><p className="note">Sign in to moderate comments.</p></div>
  if (!admin) return <div className="settings"><p className="note">Comments on the guides are moderated by the site owner.</p></div>
  if (!rows) return <div className="settings"><p className="note">Loading comments…</p></div>

  const pending = rows.filter((c) => !c.approved).reverse()
  const published = rows.filter((c) => c.approved)
  const item = (c: Comment) => (
    <li key={c.id} className="gcm">
      <div className="ch wrap">
        <b>{c.name}</b>{c.is_author && <small className="note"> · you</small>}
        <small className="note">on <a href={`${SITE}/guides/${c.page_id}#comments-h`} target="_blank" rel="noreferrer">{c.page_id}</a> · {when(c.created_at)}{c.parent_id ? ' · reply' : ''}</small>
      </div>
      <p className="gcb">{c.body}</p>
      <div className="row wrap">
        {!c.approved && <button onClick={() => approve(c)}>✓ Approve</button>}
        {!c.is_author && <button onClick={() => setReply({ to: c, text: '' })}>↩ Reply</button>}
        <button onClick={() => remove(c)}>✕ Delete</button>
      </div>
      {reply?.to.id === c.id && (
        <div className="gcr">
          <textarea rows={4} value={reply.text} autoFocus onChange={(e) => setReply({ ...reply, text: e.target.value })} placeholder={`Reply to ${c.name}…`} />
          <div className="row wrap"><button onClick={sendReply} disabled={!reply.text.trim()}>Publish reply</button><button onClick={() => setReply(null)}>Cancel</button></div>
        </div>
      )}
    </li>
  )

  return (
    <div className="settings">
      {error && <p className="note gwarn">{error}</p>}
      <section className="card">
        <div className="ch"><h3>Waiting for approval</h3><span className="sp" /><button className="linkish" onClick={load}>Refresh</button></div>
        {pending.length ? <ul className="plain gcl">{pending.map(item)}</ul> : <p className="note">Nothing waiting.</p>}
        <p className="note fine">Visitors post with just a name. Only approved comments appear on the guides. Replying approves the comment you reply to.</p>
      </section>
      <section className="card">
        <h3>Published</h3>
        {published.length ? <ul className="plain gcl">{published.map(item)}</ul> : <p className="note">No comments yet.</p>}
      </section>
    </div>
  )
}
