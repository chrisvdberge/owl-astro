import { SETUPS_KEY, gearName, myGear, sameGear, setupLabel, type GearItem } from '../lib/gear'
import { PRESETS } from '../lib/optics'
import { navigate } from '../lib/router'
import type { useStore } from '../lib/store'
import { SetupEditor } from './GearPlanner'

type Store = ReturnType<typeof useStore>

/** The telescopes and cameras you own, kept with your account; one is the default used across the app. */
export default function MyGear({ store }: { store: Store }) {
  const { settings } = store
  const gear = myGear(settings)
  // the app's default: the chosen one, else the Seestar S50 Pro; the first matching setup carries the star
  const def = settings.scope ?? { presetId: PRESETS[0].id, optics: PRESETS[0].optics }
  const defId = gear.find((g) => sameGear(g, def))?.id
  const isDefault = (g: GearItem) => g.id === defId
  const save = (next: GearItem[], scope = settings.scope) => store.setSettings({ gear: next, scope })
  const change = (g: GearItem, x: GearItem) => save(gear.map((y) => (y.id === g.id ? x : y)), isDefault(g) ? { presetId: x.presetId, optics: x.optics } : def) // the default follows its edits
  const add = () => {
    const base = gear[gear.length - 1] ?? { presetId: PRESETS[0].id, optics: PRESETS[0].optics }
    save([...gear, { id: crypto.randomUUID(), presetId: base.presetId, optics: base.optics }])
  }
  const compare = () => {
    try { localStorage.setItem(SETUPS_KEY, JSON.stringify(gear.slice(0, 4).map((g) => ({ key: g.id, presetId: g.presetId, optics: g.optics, mount: g.mount, guided: g.guided })))) } catch { /* storage unavailable */ }
    navigate('/tools/gear')
  }

  return (
    <div className="mygear">
      <p className="note">The telescopes and cameras you own. The default is used for framing previews, exposure estimates, the catalogue’s fit badges and as the starting setup on the sky view; all of them are offered when you log an observation.</p>
      {gear.length === 0 && <p className="empty">No gear yet. Add your first setup below.</p>}
      <div className="gsets">
        {gear.map((g) => (
          <SetupEditor key={g.id} s={{ ...g, key: g.id }} color={isDefault(g) ? 'var(--warn)' : 'var(--line)'}
            title={<input className="gtitle" value={g.name ?? ''} placeholder={setupLabel(g.optics, g.presetId)} aria-label="Name" onChange={(e) => change(g, { ...g, name: e.target.value || undefined })} />}
            onChange={(x) => change(g, { id: g.id, name: g.name, presetId: x.presetId, optics: x.optics, mount: x.mount, guided: x.guided })}
            onRemove={gear.length > 1 && !isDefault(g) ? () => confirm(`Remove ${gearName(g)} from your gear?`) && save(gear.filter((y) => y.id !== g.id)) : undefined}
            actions={isDefault(g) ? <b className="note gdef">★ Default</b> : <button onClick={() => save(gear, { presetId: g.presetId, optics: g.optics })}>☆ Make default</button>} />
        ))}
        <button className="gadd" onClick={add}>+ Add a setup</button>
      </div>
      {gear.length > 1 && <p className="note"><button className="linkish" onClick={compare}>Compare {gear.length > 4 ? 'the first four' : 'them'} in the gear planner</button> — field of view, resolution, sampling and exposure side by side.</p>}
    </div>
  )
}
