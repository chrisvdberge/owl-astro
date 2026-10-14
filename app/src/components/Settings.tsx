import type { useAuth } from '../lib/auth'
import { Link } from '../lib/router'
import type { useStore } from '../lib/store'
import Account from './Account'
import { scopeName, type Scope } from './FramingPreview'

type Store = ReturnType<typeof useStore>

/** Settings that apply across the app, gathered in one place. */
export default function Settings({ store, scope, auth }: { store: Store; scope: Scope; auth: ReturnType<typeof useAuth> }) {
  const { settings } = store
  return (
    <div className="settings">
      <h2 className="th">Settings</h2>
      <section className="card">
        <h3>Planning</h3>
        <label className="f"><span>Minimum altitude °</span><input type="number" min={0} max={80} value={settings.minAlt} onChange={(e) => store.setSettings({ minAlt: +e.target.value })} /></label>
        <label className="f"><span>Minimum usable hours</span><input type="number" min={0} step={0.5} value={settings.minHours} onChange={(e) => store.setSettings({ minHours: +e.target.value })} /></label>
        <p className="note">A target counts as usable above this altitude, your horizon and any light domes you use as limits, for at least this long in a night.</p>
      </section>
      <section className="card">
        <h3>Home site</h3>
        <label className="f"><span>Open the app at</span>
          <select value={store.homeId ?? ''} onChange={(e) => store.setHome(e.target.value || undefined)}>
            <option value="">The site I used last</option>
            {store.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select></label>
        <p className="note"><Link to="/setup/sites">Manage sites</Link>: add sites, horizon profiles, light pollution.</p>
      </section>
      <section className="card">
        <h3>Default scope</h3>
        <p>{scopeName(scope)}</p>
        <p className="note">Used for framing previews, exposure estimates and the image inspector. Change it with “Make default” in the <Link to="/setup/gear">gear planner</Link> or on the sky view.</p>
      </section>
      {auth.enabled && (
        <section className="card">
          <h3>Account</h3>
          <p className="note">Sign in to keep your targets, sites and logs in sync across devices.</p>
          <Account auth={auth} status={store.syncStatus} />
        </section>
      )}
    </div>
  )
}
