import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/** Tells the user when a new version is ready (and applies it on request) and when the app can work offline. */
export default function PwaStatus() {
  const [ready, setReady] = useState(false)
  const { needRefresh: [needRefresh, setNeedRefresh], offlineReady: [offlineReady, setOfflineReady], updateServiceWorker } = useRegisterSW({
    // check for a new deploy now and then while the app stays open (a night in the field can be long)
    onRegisteredSW: (_url, reg) => { if (reg) setInterval(() => reg.update().catch(() => undefined), 60 * 60 * 1000) },
  })
  useEffect(() => { if (offlineReady) { setReady(true); const t = setTimeout(() => { setReady(false); setOfflineReady(false) }, 5000); return () => clearTimeout(t) } }, [offlineReady, setOfflineReady])

  if (needRefresh) return (
    <div className="pwa" role="status">
      A new version of Owl Astro is ready.
      <button className="pri" onClick={() => updateServiceWorker(true)}>Reload</button>
      <button onClick={() => setNeedRefresh(false)}>Later</button>
    </div>
  )
  if (ready) return <div className="pwa" role="status">Ready to work offline ✓</div>
  return null
}
