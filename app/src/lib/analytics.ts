/**
 * Analytics for owlastro.com and app.owlastro.com (this file is kept identical in both repos).
 *
 * - Cloudflare Web Analytics: cookieless page views for every visitor, no consent needed.
 * - Google Analytics 4: only after the visitor clicks "Allow" (GDPR). Until then Google's script isn't loaded at all.
 *
 * The choice is kept in a first-party cookie on .owlastro.com, so answering on the site also answers for the app.
 * Leave an ID empty to switch that service off; nothing loads on localhost.
 */

/** GA4 measurement ID (Admin → Data streams), the same one on the site and the app so a visit can be followed across both. */
const GA_ID = ''
/** Cloudflare Web Analytics site token (Cloudflare → Analytics & Logs → Web Analytics → the site → Manage site → JS snippet). */
const CF_TOKEN = ''
const PRIVACY_URL = 'https://owlastro.com/privacy'

type Choice = 'granted' | 'denied'
const COOKIE = 'owl_consent'
const MAX_AGE = 180 * 24 * 3600 // ask again after six months

type Gtag = (...args: unknown[]) => void
declare global { interface Window { dataLayer?: unknown[]; gtag?: Gtag } }

const isLocal = () => /^(localhost|127\.0\.0\.1|\[::1\])$|\.(localhost|test)$/.test(location.hostname)
const cookieDomain = () => (location.hostname.endsWith('owlastro.com') ? '; domain=.owlastro.com' : '')

function readChoice(): Choice | null {
  const m = document.cookie.match(/(?:^|;\s*)owl_consent=(granted|denied)/)
  return m ? (m[1] as Choice) : null
}
function writeChoice(c: Choice) {
  document.cookie = `${COOKIE}=${c}; max-age=${MAX_AGE}; path=/${cookieDomain()}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`
}

function addScript(src: string, attrs: Record<string, string> = {}) {
  const s = document.createElement('script')
  s.src = src; s.async = true
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v)
  document.head.appendChild(s)
}

let gaLoaded = false
function loadGA() {
  if (!GA_ID || gaLoaded) return
  gaLoaded = true
  ;(window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`] = false
  window.dataLayer = window.dataLayer ?? []
  // gtag must push the arguments object itself, not an array
  // eslint-disable-next-line prefer-rest-params
  window.gtag = function () { window.dataLayer!.push(arguments) }
  window.gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' })
  window.gtag('js', new Date())
  // page changes in the app are picked up by GA4's enhanced measurement (browser history events)
  window.gtag('config', GA_ID)
  addScript(`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`)
}

/** Stops GA4 for the rest of this page and removes its cookies. */
function stopGA() {
  if (!GA_ID) return
  ;(window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`] = true
  window.gtag?.('consent', 'update', { analytics_storage: 'denied' })
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0].trim()
    if (name === '_ga' || name.startsWith('_ga_')) {
      for (const d of ['', cookieDomain()]) document.cookie = `${name}=; max-age=0; path=/${d}`
    }
  }
}

export function setConsent(c: Choice) {
  writeChoice(c)
  if (c === 'granted') loadGA(); else stopGA()
  document.getElementById('owl-consent')?.remove()
}

/** Sends a GA4 event; does nothing without consent (Cloudflare only counts page views). */
export function track(name: string, params?: Record<string, string | number | boolean | undefined>) {
  if (gaLoaded) window.gtag?.('event', name, params)
}

const CSS = `
#owl-consent{position:fixed;z-index:10000;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));max-width:440px;margin-inline:auto;
  background:#111827;color:#e5e7eb;border:1px solid #243044;border-radius:10px;padding:14px 16px;box-shadow:0 8px 30px rgba(0,0,0,.5);
  font:14px/1.45 system-ui,sans-serif}
#owl-consent p{margin:0 0 12px}
#owl-consent a{color:#38bdf8}
#owl-consent div{display:flex;gap:8px;justify-content:flex-end}
#owl-consent button{font:inherit;cursor:pointer;border-radius:6px;padding:7px 14px;border:1px solid #38bdf8;background:transparent;color:#38bdf8}
#owl-consent button:hover{background:#38bdf81a}`

/** Shows the consent question (on a first visit, or from a "Cookie settings" link). */
export function openConsent() {
  if (!GA_ID || document.getElementById('owl-consent')) return
  if (!document.getElementById('owl-consent-css')) {
    const st = document.createElement('style'); st.id = 'owl-consent-css'; st.textContent = CSS
    document.head.appendChild(st)
  }
  const el = document.createElement('div')
  el.id = 'owl-consent'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Analytics cookies')
  el.innerHTML = `<p>May we count your visit with Google Analytics? It sets cookies so we can see which pages and features get used. Nothing is used for ads. <a href="${PRIVACY_URL}">Privacy</a></p>
    <div><button type="button" data-c="denied">No thanks</button><button type="button" data-c="granted">Allow</button></div>`
  el.addEventListener('click', (e) => {
    const c = (e.target as HTMLElement).closest('button')?.dataset.c as Choice | undefined
    if (c) setConsent(c)
  })
  document.body.appendChild(el)
}

let started = false
/** Call once on page load. */
export function initAnalytics() {
  if (started || isLocal()) return
  started = true
  // Cloudflare's beacon follows pushState navigation by itself
  if (CF_TOKEN) addScript('https://static.cloudflareinsights.com/beacon.min.js', { defer: '', 'data-cf-beacon': JSON.stringify({ token: CF_TOKEN }) })
  const c = readChoice()
  if (c === 'granted') loadGA()
  else if (!c) openConsent()
}
