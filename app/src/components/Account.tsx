import { useState } from 'react'
import type { useAuth } from '../lib/auth'
import { Link } from '../lib/router'
import type { SyncStatus } from '../lib/store'

const LABEL: Record<SyncStatus, string> = { local: 'Local only', syncing: 'Saving…', synced: 'Synced', error: 'Sync error' }
type Auth = ReturnType<typeof useAuth>

/** Header link to the account page: a person icon (a dot shows the sync state when signed in), "Sign in" when not. */
export function AccountButton({ auth, status }: { auth: Auth; status: SyncStatus }) {
  const signedIn = !!auth.user
  return (
    <Link to="/account" className={`acctbtn ${signedIn ? `in ${status}` : ''}`} aria-label="My account"
      title={signedIn ? `My account · ${auth.user!.email} · ${LABEL[status]}` : auth.enabled ? 'Sign in or create an account' : 'My account'}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></svg>
      {signedIn && <i className="sdot" />}
      {!signedIn && auth.enabled && <span>Sign in</span>}
    </Link>
  )
}

/** Sign in / create an account (email link or code), or who is signed in, with sync status and sign out. */
export default function AccountPanel({ auth, status }: { auth: Auth; status: SyncStatus }) {
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  if (!auth.enabled) return <p className="note">Accounts are not set up for this copy of the app: everything is stored in this browser.</p>
  if (auth.user) return (
    <>
      <p>Signed in as <b>{auth.user.email}</b> · <span className={`acct ${status}`}>{LABEL[status]}</span></p>
      <p className="note">Targets, sites, gear, framings, plans and observations sync to your account. Signing out removes them from this device; they stay in your account.</p>
      <button onClick={() => { auth.signOut(); setSent(false); setCode('') }}>Sign out</button>
    </>
  )
  if (sent) return (
    <>
      <p>We sent an email to <b>{email}</b>. Click the link in it, or type the code from the email here:</p>
      <div className="row">
        <input inputMode="numeric" autoComplete="one-time-code" placeholder="Code from the email" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))} />
        <button disabled={code.length < 6 || busy} onClick={async () => { setBusy(true); const err = await auth.verifyCode(email, code); setBusy(false); if (err) setMsg(err); else { setSent(false); setCode(''); setMsg(null) } }}>Sign in</button>
      </div>
      {msg && <p className="note" style={{ color: 'var(--bad)' }}>{msg}</p>}
      <p className="note">No email? Check your spam folder, or <button className="linkish" onClick={() => { setSent(false); setMsg(null) }}>use another address</button>.</p>
    </>
  )
  return (
    <>
      <p className="note">Sign in, or create an account by entering your email: we send you a one-time link and code, no password. Your data then syncs across your devices.</p>
      <div className="row">
        <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && email.includes('@') && (e.currentTarget.nextSibling as HTMLButtonElement | null)?.click()} />
        <button disabled={!email.includes('@') || busy} onClick={async () => { setBusy(true); const err = await auth.sendLink(email.trim()); setBusy(false); if (err) setMsg(err); else { setSent(true); setMsg(null) } }}>Send link</button>
      </div>
      {msg && <p className="note" style={{ color: 'var(--bad)' }}>{msg}</p>}
    </>
  )
}
