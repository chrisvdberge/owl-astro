import { useMemo, useRef, useState } from 'react'
import { customObject, isCustom, type CatObject } from '../lib/catalog'
import { setupLabel } from '../lib/gear'
import { findings, runInspection, type Inspection, type Saved } from '../lib/inspector'
import { withSensor } from '../lib/exposure'
import type { useStore } from '../lib/store'
import type { Scope } from './FramingPreview'

type Store = ReturnType<typeof useStore>
const URL_KEY = 'astroplanner.inspector.url'
const KEY_KEY = 'astroplanner.inspector.key'
const HIST_KEY = 'astroplanner.inspector.history'
const get = (k: string, d = '') => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const put = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* storage unavailable */ } }
const loadHist = (): Saved[] => { try { return JSON.parse(get(HIST_KEY, '[]')) } catch { return [] } }

/** Colour a grid cell by its value relative to the median: blue below, amber above. */
const shade = (v: number | null, med: number, span: number) => {
  if (v == null) return 'transparent'
  const t = Math.max(-1, Math.min(1, (v - med) / span))
  return t >= 0 ? `rgba(251,191,36,${0.12 + 0.55 * t})` : `rgba(56,189,248,${0.12 + 0.55 * -t})`
}

function Grid({ title, rows, fmt, med, span, note }: { title: string; rows: (number | null)[][]; fmt: (v: number) => string; med: number; span: number; note?: string }) {
  return (
    <div className="igrid">
      <h4>{title}</h4>
      <div style={{ gridTemplateColumns: `repeat(${rows[0]?.length ?? 1}, 1fr)` }}>
        {rows.flat().map((v, i) => <span key={i} style={{ background: shade(v, med, span) }}>{v == null ? '–' : fmt(v)}</span>)}
      </div>
      {note && <small className="note">{note}</small>}
    </div>
  )
}

const Stat = ({ k, v, s }: { k: string; v: string; s?: string }) => <div className="istat"><small>{k}</small><b>{v}</b>{s && <small>{s}</small>}</div>

/** Inspect a standalone image (stack or single frame) with the local `astroinspect` service. */
export default function Inspector({ store, catalog, scope }: { store: Store; catalog: CatObject[]; scope: Scope }) {
  const [url, setUrl] = useState(() => get(URL_KEY, 'http://localhost:8000'))
  const [key, setKey] = useState(() => get(KEY_KEY))
  const [showCfg, setShowCfg] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState<Inspection | null>(null)
  const [targetId, setTargetId] = useState('')
  const [hist, setHist] = useState<Saved[]>(loadHist)
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const optics = useMemo(() => withSensor(scope.optics, scope.presetId), [scope])
  const setup = setupLabel(scope.optics, scope.presetId)
  const byId = useMemo(() => new Map(catalog.map((o) => [o.id, o])), [catalog])
  const targets = useMemo(() => store.wishlist.flatMap((w) => {
    const o = byId.get(w.id) ?? (w.custom ? customObject(w.id, w.custom) : undefined)
    return o ? [{ id: w.id, label: isCustom(w.id) ? o.names[0] : o.m ?? o.id }] : []
  }), [store.wishlist, byId])
  const nameOf = (id?: string) => targets.find((t) => t.id === id)?.label

  const saveCfg = (u: string, k: string) => { put(URL_KEY, u); put(KEY_KEY, k) }
  const run = async (file: File) => {
    setBusy(true); setErr(''); setResult(null)
    try {
      const r = await runInspection(url, key, file, optics)
      setResult(r)
      const next = [{ id: crypto.randomUUID(), at: new Date().toISOString(), targetId: targetId || undefined, setup, result: r }, ...hist].slice(0, 20)
      setHist(next); put(HIST_KEY, JSON.stringify(next))
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const remove = (id: string) => { const next = hist.filter((h) => h.id !== id); setHist(next); put(HIST_KEY, JSON.stringify(next)) }

  const r = result
  const s = r?.stars
  const arc = s?.fwhm_arcsec
  const tone = r ? findings(r) : []
  const f = r?.background.flatness
  return (
    <div className="insp">
      <div className="ch wrap"><h2 className="th">Image inspector <small>FWHM · eccentricity · SNR · flatness</small></h2><span className="sp" />
        <small className="note">{setup} · {(optics.pixelUm * optics.binning / optics.drizzle / (optics.focalLengthMm * optics.reducer) * 206.265).toFixed(2)}″/px</small>
        <button onClick={() => setShowCfg(!showCfg)}>Inspector service</button></div>
      {showCfg && (
        <div className="icfg">
          <label className="f"><span>URL</span><input value={url} onChange={(e) => { setUrl(e.target.value); saveCfg(e.target.value, key) }} placeholder="http://localhost:8000" /></label>
          <label className="f"><span>Key</span><input type="password" value={key} onChange={(e) => { setKey(e.target.value); saveCfg(url, e.target.value) }} placeholder="INSPECTOR_KEY, if set" /></label>
          <p className="note">Runs on your own machine: <code>cd inspector &amp;&amp; .venv/bin/uvicorn astroinspect.server:app --port 8000</code>. Use a Cloudflare Tunnel URL to reach it from your phone. Uploads over the tunnel are limited to 100 MB.</p>
        </div>
      )}

      <div className={`idrop ${drag ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f0 = e.dataTransfer.files[0]; if (f0) run(f0) }}
        onClick={() => input.current?.click()}>
        <input ref={input} type="file" accept=".fit,.fits,.fts,.tif,.tiff" hidden onChange={(e) => { const f0 = e.target.files?.[0]; if (f0) run(f0); e.target.value = '' }} />
        {busy ? 'Measuring… large stacks take a few seconds.' : 'Drop a FITS or TIFF here, or click to choose'}
      </div>
      <label className="f inl"><span>Target</span>
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          <option value="">— none —</option>{targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select></label>
      {err && <p className="nmsg">{err}</p>}

      {r && s && f && (
        <>
          <h3>{r.filename}{r.image.object ? ` · ${r.image.object}` : ''} <small>{r.image.width}×{r.image.height}, {r.image.channels === 1 ? 'mono' : `${r.image.channels} channels`}{r.image.plate_scale_arcsec_px ? ` · ${r.image.plate_scale_arcsec_px.toFixed(2)}″/px (${r.image.plate_scale_source})` : ''}</small></h3>
          <div className="istats">
            <Stat k="FWHM" v={arc ? `${arc.median.toFixed(2)}″` : s.fwhm_px ? `${s.fwhm_px.median.toFixed(2)} px` : '–'} s={s.fwhm_px ? `${s.fwhm_px.median.toFixed(2)} px · ${s.fwhm_px.p10.toFixed(1)}–${s.fwhm_px.p90.toFixed(1)}` : undefined} />
            <Stat k="Eccentricity" v={s.eccentricity ? s.eccentricity.median.toFixed(2) : '–'} s="0 round · 1 line" />
            <Stat k="Stars" v={s.measured.toLocaleString()} s={`${s.detected.toLocaleString()} detected · ${s.saturated} saturated`} />
            <Stat k="Star SNR" v={s.snr ? s.snr.median.toFixed(0) : '–'} s="median over measured stars" />
            <Stat k="Noise σ" v={r.noise.sigma.toFixed(5)} s={r.noise.sky_to_noise ? `sky/noise ${r.noise.sky_to_noise.toFixed(0)}` : undefined} />
            <Stat k="Flatness" v={`${f.peak_to_peak_pct.toFixed(1)}%`} s={`corners ${f.corner_vs_centre_pct > 0 ? '+' : ''}${f.corner_vs_centre_pct.toFixed(1)}% · rms ${f.rms_pct.toFixed(1)}%`} />
          </div>
          <ul className="ifind">{tone.map((t, i) => <li key={i} className={t.tone}>{t.text}</li>)}</ul>
          <div className="igrids">
            {s.fwhm_px && <Grid title="FWHM across the field" rows={s.grid.fwhm_px} fmt={(v) => v.toFixed(1)} med={s.fwhm_px.median} span={s.fwhm_px.median * 0.25} note={`px, ${s.grid.size}×${s.grid.size} cells (top-left of the image = top-left here)`} />}
            {s.eccentricity && <Grid title="Eccentricity across the field" rows={s.grid.eccentricity} fmt={(v) => v.toFixed(2)} med={s.eccentricity.median} span={0.25} />}
            <Grid title="Background deviation" rows={f.grid} fmt={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`} med={0} span={Math.max(2, f.peak_to_peak_pct / 2)} note="% from the median background" />
          </div>
        </>
      )}

      {hist.length > 0 && (
        <>
          <h3>Recent inspections</h3>
          <div className="ihist">
            {hist.map((h) => (
              <div key={h.id} className="ihrow">
                <button onClick={() => setResult(h.result)}><b>{h.result.filename}</b>
                  <small>{new Date(h.at).toLocaleDateString()} · {nameOf(h.targetId) ?? 'no target'} · {h.setup}</small></button>
                <span>{h.result.stars.fwhm_arcsec ? `${h.result.stars.fwhm_arcsec.median.toFixed(1)}″` : `${h.result.stars.fwhm_px?.median.toFixed(1)} px`} · e {h.result.stars.eccentricity?.median.toFixed(2)}</span>
                <button onClick={() => remove(h.id)} aria-label="Remove">✕</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
