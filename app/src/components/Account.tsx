import { useState } from 'react'
import type { useAuth } from '../lib/auth'
import type { SyncStatus } from '../lib/store'

const LABEL: Record<SyncStatus, string> = { local: 'Local only', syncing: 'Saving…', synced: 'Synced', error: 'Sync error' }

export default function Account({ auth, status }: { auth: ReturnType<typeof useAuth>; status: SyncStatus }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  if (!auth.enabled) return null

  return (
    <>
      <button className={`acct ${auth.user ? status : ''}`} onClick={() => setOpen(true)}>
        {auth.user ? `● ${LABEL[status]}` : 'Sign in'}
      </button>
      {open && (
        <div className="modal" onClick={() => setOpen(false)}>
          <div style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2>Account<button onClick={() => setOpen(false)}>Close</button></h2>
            {auth.user ? (
              <>
                <p>Signed in as <b>{auth.user.email}</b></p>
                <p className="note">Wishlist, locations, horizons and sessions sync to your account. Status: {LABEL[status]}.</p>
                <button onClick={() => { auth.signOut(); setOpen(false) }}>Sign out</button>
              </>
            ) : sent ? (
              <p>Check <b>{email}</b> for a sign-in link, then come back to this tab. Your local data is uploaded the first time you sign in.</p>
            ) : (
              <>
                <p className="note">Sign in to keep your data across devices. We email you a one-time link, no password.</p>
                <div className="row">
                  <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                  <button disabled={!email.includes('@')} onClick={async () => { const err = await auth.sendLink(email); if (err) setMsg(err); else setSent(true) }}>Send link</button>
                </div>
                {msg && <p className="note" style={{ color: 'var(--bad)' }}>{msg}</p>}
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
