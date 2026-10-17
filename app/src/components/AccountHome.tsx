import { openConsent } from '../lib/analytics'
import type { useAuth } from '../lib/auth'
import { gearDefaultFirst, gearName } from '../lib/gear'
import { Link } from '../lib/router'
import type { useStore } from '../lib/store'
import AccountPanel from './Account'
import { useCommentAdmin, usePendingComments } from './GuideComments'

type Store = ReturnType<typeof useStore>

/** The account overview: sign-in and sync, your gear and sites at a glance, and the planning limits. */
export default function AccountHome({ store, auth }: { store: Store; auth: ReturnType<typeof useAuth> }) {
  const { settings } = store
  const gear = gearDefaultFirst(settings)
  const admin = useCommentAdmin(auth.user)
  const pending = usePendingComments(admin)
  return (
    <div className="settings">
      <section className="card">
        <h3>Account</h3>
        <AccountPanel auth={auth} status={store.syncStatus} />
      </section>
      {admin && (
        <section className="card">
          <div className="ch"><h3>Guide comments</h3><span className="sp" /><Link to="/account/comments">Review →</Link></div>
          <p className="note">{pending == null ? '…' : pending ? `${pending} waiting for approval` : 'Nothing waiting for approval'}</p>
        </section>
      )}
      <section className="card">
        <div className="ch"><h3>My gear</h3><span className="sp" /><Link to="/account/gear">Manage gear →</Link></div>
        {gear.length ? <ul className="plain">{gear.map((g, i) => <li key={g.id}>{i === 0 && settings.scope ? '★ ' : ''}{gearName(g)}{i === 0 && settings.scope ? <small className="note"> · default</small> : null}</li>)}</ul>
          : <p className="note">Using the Seestar S50 Pro until you add your own setup.</p>}
      </section>
      <section className="card">
        <div className="ch"><h3>My sites</h3><span className="sp" /><Link to="/account/sites">Manage sites →</Link></div>
        <label className="f"><span>Open the app at</span>
          <select value={store.homeId ?? ''} onChange={(e) => store.setHome(e.target.value || undefined)}>
            <option value="">The site I used last</option>
            {store.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select></label>
        <p className="note">{store.locations.length} site{store.locations.length === 1 ? '' : 's'}: {store.locations.map((l) => l.name).join(', ')}</p>
      </section>
      <section className="card">
        <h3>Planning limits</h3>
        <label className="f"><span>Minimum altitude °</span><input type="number" min={0} max={80} value={settings.minAlt} onChange={(e) => store.setSettings({ minAlt: +e.target.value })} /></label>
        <label className="f"><span>Minimum usable hours</span><input type="number" min={0} step={0.5} value={settings.minHours} onChange={(e) => store.setSettings({ minHours: +e.target.value })} /></label>
        <p className="note">A target counts as usable above this altitude, your horizon and any light domes you use as limits, for at least this long in a night.</p>
      </section>
      <section className="card">
        <h3>Privacy</h3>
        <p className="note">Visits are counted without cookies. Google Analytics, which sets cookies, runs only if you allowed it. <a href="https://owlastro.com/privacy">Privacy</a></p>
        <div className="row"><button onClick={openConsent}>Cookie settings</button></div>
      </section>
    </div>
  )
}
