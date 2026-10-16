import { useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { extraObject, isCustom, type CatObject } from '../lib/catalog'
import { AREAS, analyze, notes, type Review } from '../lib/review'
import { NotSetUp, deleteReview, imageUrl, listReviews, loadLocal, saveLocal, saveReview, uploadBlob, type SavedReview } from '../lib/reviews'
import { Link } from '../lib/router'
import type { useStore } from '../lib/store'
import { supabase } from '../lib/sync'
import { Grid, Stat } from './Inspector'

type Store = ReturnType<typeof useStore>
/** Larger images are scaled down to this many pixels before review: plenty for every check, and phones keep up. */
const MAX_PIXELS = 12e6

/** Decode in the browser and hand the pixels to the worker (or review here when workers are unavailable). */
async function review(file: File): Promise<{ result: Review; thumb: string; scaled: () => Promise<Blob> }> {
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
  // the reviewed copy, for files too large to store as they are
  const scaled = () => new Promise<Blob>((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image.'))), 'image/jpeg', 0.92))
  let worker: Worker
  try { worker = new Worker(new URL('../lib/review.worker.ts', import.meta.url), { type: 'module' }) } catch {
    return { result: analyze(px, scale), thumb, scaled }
  }
  const result = await new Promise<Review>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<{ ok: boolean; review?: Review; error?: string }>) => (e.data.ok ? resolve(e.data.review!) : reject(new Error(e.data.error)))
    worker.onerror = (e) => reject(new Error(e.message || 'The review failed.'))
    worker.postMessage({ width: w, height: h, data: px.data.buffer, scale }, [px.data.buffer])
  }).finally(() => worker.terminate())
  return { result, thumb, scaled }
}

const TONE_MARK = { ok: '✓', info: 'i', warn: '!', bad: '!!' } as const

/** Script review of a finished image: background, noise, clipping, stars, colour and calibration leftovers, from the pixels alone. */
export default function ImageReview({ user, store, catalog }: { user: User | null; store: Store; catalog: CatObject[] }) {
  const db = user ? supabase : null
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState<'' | 'saving' | 'saved'>('')
  const [err, setErr] = useState('')
  const [setUp, setSetUp] = useState(true)
  const [cur, setCur] = useState<{ id: string; name: string; src: string; result: Review; targetId?: string } | null>(null)
  const [local, setLocal] = useState<SavedReview[]>(loadLocal)
  const [remote, setRemote] = useState<{ uid: string; list: SavedReview[] } | null>(null)
  const [targetId, setTargetId] = useState('')
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const objUrl = useRef('')
  useEffect(() => () => { if (objUrl.current) URL.revokeObjectURL(objUrl.current) }, [])
  // signed in: the account's reviews; signed out (or before the migration is applied): the ones on this device
  useEffect(() => {
    if (!db || !user) return
    let live = true
    listReviews(db).then((list) => { if (live) setRemote({ uid: user.id, list }) }).catch((e) => { if (!live) return; if (e instanceof NotSetUp) setSetUp(false); else setErr(`Couldn't load your saved reviews: ${e.message ?? e}`) })
    return () => { live = false }
  }, [db, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const inAccount = !!db && setUp
  const hist = inAccount ? (remote?.uid === user?.id ? remote?.list ?? [] : []) : local

  const byId = useMemo(() => new Map(catalog.map((o) => [o.id, o])), [catalog])
  const targets = useMemo(() => store.wishlist.flatMap((w) => {
    const o = byId.get(w.id) ?? extraObject(w)
    return o ? [{ id: w.id, label: isCustom(w.id) ? o.names[0] : o.m ?? o.id }] : []
  }), [store.wishlist, byId])
  const nameOf = (id?: string) => targets.find((t) => t.id === id)?.label

  const run = async (file: File) => {
    setBusy(true); setErr(''); setSaving('')
    try {
      const { result, thumb, scaled } = await review(file)
      if (objUrl.current) URL.revokeObjectURL(objUrl.current)
      objUrl.current = URL.createObjectURL(file)
      const rec = { id: crypto.randomUUID(), at: new Date().toISOString(), name: file.name, targetId: targetId || undefined, thumb, result }
      setCur({ id: rec.id, name: file.name, src: objUrl.current, result, targetId: rec.targetId })
      setBusy(false)
      if (db && user && setUp) {
        setSaving('saving')
        try {
          const { blob, ext } = await uploadBlob(file, scaled)
          const saved = await saveReview(db, user.id, rec, blob, ext)
          setRemote((r) => ({ uid: user.id, list: [saved, ...(r?.uid === user.id ? r.list : [])] })); setSaving('saved')
          return
        } catch (e) {
          setSaving('')
          if (e instanceof NotSetUp) setSetUp(false)
          else { setErr(`The review couldn't be saved to your account (${e instanceof Error ? e.message : String(e)}); it is kept on this device.`) }
        }
      }
      setLocal((h) => { const next = [rec, ...h].slice(0, 12); saveLocal(next); return next })
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const open = async (h: SavedReview) => {
    setCur({ id: h.id, name: h.name, src: h.thumb, result: h.result, targetId: h.targetId }); setSaving('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
    if (db && h.path) {
      try { const url = await imageUrl(db, h.path); setCur((c) => (c?.id === h.id ? { ...c, src: url } : c)) } catch { /* the thumbnail stays */ }
    }
  }
  const remove = async (h: SavedReview) => {
    if (h.path) {
      if (!db || !window.confirm(`Delete the review of ${h.name} and its image from your account?`)) return
      try { await deleteReview(db, h); setRemote((r) => r && { ...r, list: r.list.filter((x) => x.id !== h.id) }) } catch (e) { setErr(`Couldn't delete: ${e instanceof Error ? e.message : String(e)}`) }
    } else setLocal((l) => { const next = l.filter((x) => x.id !== h.id); saveLocal(next); return next })
    if (cur?.id === h.id) setCur(null)
  }

  const r = cur?.result
  const list = r ? notes(r) : []
  const b = r?.background, s = r?.stars
  const issues = list.filter((n) => n.tone === 'warn' || n.tone === 'bad').length
  return (
    <div className="insp">
      <div className="ch wrap"><h2 className="th">Image review <small>background · noise · stars · colour · calibration</small></h2></div>
      <p className="note">Checks a finished (stretched) image: use a JPEG, PNG or WebP at full size. {inAccount ? 'The image and its review are saved to your account.' : user && !setUp ? 'Saving to your account isn\'t set up on this server yet, so reviews are kept on this device.' : <><Link to="/account">Sign in</Link> to save images and reviews to your account; until then they're kept on this device.</>} To measure a linear stack, use the <Link to="/tools/inspector">Image inspector</Link>.</p>

      <div className={`idrop ${drag ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f0 = e.dataTransfer.files[0]; if (f0) run(f0) }}
        onClick={() => input.current?.click()}>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/tiff,.jpg,.jpeg,.png,.webp,.tif,.tiff" hidden onChange={(e) => { const f0 = e.target.files?.[0]; if (f0) run(f0); e.target.value = '' }} />
        {busy ? 'Reviewing… a large image takes a few seconds.' : 'Drop a processed image here, or click to choose'}
      </div>
      <label className="f inl"><span>Target</span>
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          <option value="">— none —</option>{targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select></label>
      {err && <p className="nmsg">{err}</p>}

      {cur && r && b && s && (
        <>
          <h3>{cur.name}{nameOf(cur.targetId) ? ` · ${nameOf(cur.targetId)}` : ''} <small>{saving === 'saving' ? 'saving… · ' : saving === 'saved' ? 'saved to your account · ' : ''}{Math.round(r.image.width / r.image.scale)}×{Math.round(r.image.height / r.image.scale)}{r.image.mono ? ', mono' : ''} · {issues ? `${issues} thing${issues > 1 ? 's' : ''} to look at` : 'nothing obvious to fix'}</small></h3>
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
          <h3>{inAccount ? 'Saved reviews' : 'Recent reviews on this device'}</h3>
          <div className="ihist">
            {hist.map((h) => {
              const n = notes(h.result).filter((x) => x.tone === 'warn' || x.tone === 'bad').length
              return (
                <div key={h.id} className="ihrow">
                  <img src={h.thumb} alt="" className="rvthumb" />
                  <button onClick={() => open(h)}><b>{h.name}</b>
                    <small>{new Date(h.at).toLocaleDateString()}{nameOf(h.targetId) ? ` · ${nameOf(h.targetId)}` : ''}</small></button>
                  <span>{n ? `${n} to look at` : 'all clear'}</span>
                  <button onClick={() => remove(h)} aria-label="Delete">✕</button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
