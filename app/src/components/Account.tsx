import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { useAuth } from '../lib/auth'
import type { SyncStatus } from '../lib/store'

const LABEL: Record<SyncStatus, string> = { local: 'Local only', syncing: 'Saving…', synced: 'Synced', error: 'Sync error' }

export default function Account({ auth, status }: { auth: ReturnType<typeof useAuth>; status: SyncStatus }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  if (!auth.enabled) return null

  return (
    <>
      <button className={`acct ${auth.user ? status : ''}`} onClick={() => setOpen(true)}>
        {auth.user ? `● ${LABEL[status]}` : 'Sign in'}
      </button>
      {/* rendered at the top of the page, so no header or map layer can cover it */}
      {open && createPortal(
        <div className="modal" onClick={() => setOpen(false)}>
          <div style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2>Account<button onClick={() => setOpen(false)}>Close</button></h2>
            {auth.user ? (
              <>
                <p>Signed in as <b>{auth.user.email}</b></p>
                <p className="note">Targets, sites, framings, plans and observations sync to your account. Status: {LABEL[status]}.</p>
                <p className="note">Signing out removes your data from this device; it stays in your account.</p>
                <button onClick={() => { auth.signOut(); setOpen(false); setSent(false); setCode('') }}>Sign out</button>
              </>
            ) : sent ? (
              <>
                <p>We sent an email to <b>{email}</b>. Click the link in it, or type the code from the email here:</p>
                <div className="row">
                  <input inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
                  <button disabled={code.length !== 6 || busy} onClick={async () => { setBusy(true); const err = await auth.verifyCode(email, code); setBusy(false); if (err) setMsg(err); else { setOpen(false); setSent(false); setCode(''); setMsg(null) } }}>Sign in</button>
                </div>
                {msg && <p className="note" style={{ color: 'var(--bad)' }}>{msg}</p>}
                <p className="note">No email? Check your spam folder, or <button className="linkish" onClick={() => { setSent(false); setMsg(null) }}>use another address</button>.</p>
              </>
            ) : (
              <>
                <p className="note">Sign in, or create an account by entering your email: we send you a one-time link and code, no password. Your data then syncs across your devices.</p>
                <div className="row">
                  <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                  <button disabled={!email.includes('@') || busy} onClick={async () => { setBusy(true); const err = await auth.sendLink(email.trim()); setBusy(false); if (err) setMsg(err); else { setSent(true); setMsg(null) } }}>Send link</button>
                </div>
                {msg && <p className="note" style={{ color: 'var(--bad)' }}>{msg}</p>}
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
