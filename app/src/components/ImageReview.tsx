import { useEffect, useRef, useState } from 'react'
import { AREAS, analyze, notes, type Review } from '../lib/review'
import { Link } from '../lib/router'
import { Grid, Stat } from './Inspector'

const HIST_KEY = 'astroplanner.review.history'
/** Larger images are scaled down to this many pixels before review: plenty for every check, and phones keep up. */
const MAX_PIXELS = 12e6
interface Saved { id: string; at: string; name: string; thumb: string; result: Review }
const loadHist = (): Saved[] => { try { return JSON.parse(localStorage.getItem(HIST_KEY) ?? '[]') } catch { return [] } }
const saveHist = (h: Saved[]) => { try { localStorage.setItem(HIST_KEY, JSON.stringify(h)) } catch { /* storage full or unavailable */ } }

/** Decode in the browser and hand the pixels to the worker (or review here when workers are unavailable). */
async function review(file: File): Promise<{ result: Review; thumb: string }> {
  let bmp: ImageBitmap
  try { bmp = await createImageBitmap(file) } catch {
    throw new Error('This browser can\'t open that file. Export a JPEG or PNG (browsers don\'t read FITS, and most not 16-bit TIFF).')
  }
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (bmp.width * bmp.height)))
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale)
  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0, w, h)
  const px = ctx.getImageData(0, 0, w, h)
  const th = document.createElement('canvas'), tw = Math.min(360, w)
  th.width = tw; th.height = Math.round((h * tw) / w)
  th.getContext('2d')!.drawImage(bmp, 0, 0, th.width, th.height)
  const thumb = th.toDataURL('image/jpeg', 0.75)
  bmp.close()
  let worker: Worker
  try { worker = new Worker(new URL('../lib/review.worker.ts', import.meta.url), { type: 'module' }) } catch {
    return { result: analyze(px, scale), thumb }
  }
  const result = await new Promise<Review>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<{ ok: boolean; review?: Review; error?: string }>) => (e.data.ok ? resolve(e.data.review!) : reject(new Error(e.data.error)))
    worker.onerror = (e) => reject(new Error(e.message || 'The review failed.'))
    worker.postMessage({ width: w, height: h, data: px.data.buffer, scale }, [px.data.buffer])
  }).finally(() => worker.terminate())
  return { result, thumb }
}

const TONE_MARK = { ok: '✓', info: 'i', warn: '!', bad: '!!' } as const

/** Script review of a finished image: background, noise, clipping, stars, colour and calibration leftovers, from the pixels alone. */
export default function ImageReview() {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [cur, setCur] = useState<{ name: string; src: string; result: Review } | null>(null)
  const [hist, setHist] = useState<Saved[]>(loadHist)
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const objUrl = useRef('')
  useEffect(() => () => { if (objUrl.current) URL.revokeObjectURL(objUrl.current) }, [])

  const run = async (file: File) => {
    setBusy(true); setErr('')
    try {
      const { result, thumb } = await review(file)
      if (objUrl.current) URL.revokeObjectURL(objUrl.current)
      objUrl.current = URL.createObjectURL(file)
      setCur({ name: file.name, src: objUrl.current, result })
      const next = [{ id: crypto.randomUUID(), at: new Date().toISOString(), name: file.name, thumb, result }, ...hist].slice(0, 12)
      setHist(next); saveHist(next)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const remove = (id: string) => { const next = hist.filter((h) => h.id !== id); setHist(next); saveHist(next) }

  const r = cur?.result
  const list = r ? notes(r) : []
  const b = r?.background, s = r?.stars
  const issues = list.filter((n) => n.tone === 'warn' || n.tone === 'bad').length
  return (
    <div className="insp">
      <div className="ch wrap"><h2 className="th">Image review <small>background · noise · stars · colour · calibration</small></h2></div>
      <p className="note">Checks a finished (stretched) image in your browser; nothing is uploaded. Use a JPEG, PNG or WebP at full size. To measure a linear stack, use the <Link to="/tools/inspector">Image inspector</Link>.</p>

      <div className={`idrop ${drag ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f0 = e.dataTransfer.files[0]; if (f0) run(f0) }}
        onClick={() => input.current?.click()}>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/tiff,.jpg,.jpeg,.png,.webp,.tif,.tiff" hidden onChange={(e) => { const f0 = e.target.files?.[0]; if (f0) run(f0); e.target.value = '' }} />
        {busy ? 'Reviewing… a large image takes a few seconds.' : 'Drop a processed image here, or click to choose'}
      </div>
      {err && <p className="nmsg">{err}</p>}

      {cur && r && b && s && (
        <>
          <h3>{cur.name} <small>{Math.round(r.image.width / r.image.scale)}×{Math.round(r.image.height / r.image.scale)}{r.image.mono ? ', mono' : ''} · {issues ? `${issues} thing${issues > 1 ? 's' : ''} to look at` : 'nothing obvious to fix'}</small></h3>
          <div className="rvtop">
            <figure className="rvimg">
              <img src={cur.src} alt="" />
              {r.artefacts.dust.length > 0 && (
                <svg viewBox={`0 0 ${r.image.width} ${r.image.height}`} preserveAspectRatio="none" aria-label="Dust motes">
                  {r.artefacts.dust.map((d, i) => <ellipse key={i} cx={d.x * r.image.width} cy={d.y * r.image.height} rx={(d.d * r.image.width) / 2 + 6} ry={(d.d * r.image.width) / 2 + 6}><title>{`Dark spot, ${d.depth.toFixed(1)} levels deep`}</title></ellipse>)}
                </svg>
              )}
            </figure>
            <div className="istats">
              <Stat k="Background" v={b.reliable ? `${b.level.toFixed(0)}/255` : '–'} s={b.reliable ? (b.colour ? (b.cast ? `leans ${b.cast}` : 'neutral') : undefined) : 'object fills the frame'} />
              <Stat k="Gradient" v={b.reliable ? `${b.gradient.peakToPeak.toFixed(1)}` : '–'} s="levels across the frame" />
              <Stat k="Noise σ" v={r.noise.fine != null ? r.noise.fine.toFixed(1) : '–'} s={r.noise.coarse != null ? `${r.noise.coarse.toFixed(1)} at 4 px${r.noise.chroma != null ? ` · colour ${r.noise.chroma.toFixed(1)}` : ''}` : undefined} />
              <Stat k="Stars" v={s.measured.toLocaleString()} s={s.fwhm ? `${(s.fwhm.median / r.image.scale).toFixed(1)} px wide · e ${s.eccentricity?.median.toFixed(2) ?? '–'}` : undefined} />
              <Stat k="Star cover" v={`${s.coveragePct.toFixed(1)}%`} s={s.colour ? `${(100 - s.colour.whitePct).toFixed(0)}% show colour` : undefined} />
              <Stat k="Clipped" v={`${r.clipping.blackPct.toFixed(1)}% · ${r.clipping.whitePct.toFixed(1)}%`} s="black · white" />
            </div>
          </div>
          {AREAS.map((area) => {
            const ns = list.filter((n) => n.area === area)
            return ns.length ? (
              <section key={area} className="rvarea">
                <h4>{area}</h4>
                <ul className="ifind">{ns.map((n, i) => <li key={i} className={n.tone}><i>{TONE_MARK[n.tone]}</i>{n.text}</li>)}</ul>
              </section>
            ) : null
          })}
          <div className="igrids rvgrids">
            {b.reliable && <Grid title="Background across the frame" rows={b.grid} fmt={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`} med={0} span={Math.max(2, b.gradient.peakToPeak / 2)} note="levels from the median background; – where the object is" />}
            {s.fwhm && <Grid title="Star size across the field" rows={s.grid.fwhm.map((row) => row.map((v) => (v == null ? null : v / r.image.scale)))} fmt={(v) => v.toFixed(1)} med={s.fwhm.median / r.image.scale} span={(s.fwhm.median / r.image.scale) * 0.25} note="px at half maximum, 3×3 cells" />}
            {s.eccentricity && <Grid title="Star roundness across the field" rows={s.grid.eccentricity} fmt={(v) => v.toFixed(2)} med={s.eccentricity.median} span={0.2} note="eccentricity: 0 round, 1 a line" />}
          </div>
          <p className="note">Thresholds are rules of thumb for images viewed on screen. Background level and saturation are a matter of taste, so treat those as suggestions.</p>
        </>
      )}

      {hist.length > 0 && (
        <>
          <h3>Recent reviews</h3>
          <div className="ihist">
            {hist.map((h) => {
              const n = notes(h.result).filter((x) => x.tone === 'warn' || x.tone === 'bad').length
              return (
                <div key={h.id} className="ihrow">
                  <img src={h.thumb} alt="" className="rvthumb" />
                  <button onClick={() => setCur({ name: h.name, src: h.thumb, result: h.result })}><b>{h.name}</b>
                    <small>{new Date(h.at).toLocaleDateString()}</small></button>
                  <span>{n ? `${n} to look at` : 'all clear'}</span>
                  <button onClick={() => remove(h.id)} aria-label="Remove">✕</button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
