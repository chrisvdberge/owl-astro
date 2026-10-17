import { useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { extraObject, guessTarget, isCustom, type CatObject } from '../lib/catalog'
import { analyze, notes, type Rect, type Review } from '../lib/review'
import { defaultFilter, type Filter } from '../lib/exposure'
import { gearDefaultFirst, gearName, setupLabel, type GearItem } from '../lib/gear'
import { defaultMount } from '../lib/gearplan'
import { PRESETS } from '../lib/optics'
import { NotSetUp, deleteReview, imageUrl, listReviews, loadLocal, printReview, saveLocal, saveReview, setSharing, shareUrl, updateReview, uploadBlob, type SavedReview } from '../lib/reviews'
import { buildContext, looksResized, setupNotes, type ReviewInputs } from '../lib/reviewSetup'
import { Link } from '../lib/router'
import type { useStore } from '../lib/store'
import { supabase } from '../lib/sync'
import { ReviewGrids, ReviewNotes, ReviewStats } from './ReviewParts'
import ReviewCompare from './ReviewCompare'
import TargetPicker from './TargetPicker'

type Store = ReturnType<typeof useStore>
/** Larger images are scaled down to this many pixels before review: plenty for every check, and phones keep up. */
const MAX_PIXELS = 12e6

/** Decode in the browser and hand the pixels to the worker (or review here when workers are unavailable). */
async function review(file: File, exclude: Rect[] = []): Promise<{ result: Review; thumb: string; scaled: () => Promise<Blob> }> {
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
    return { result: analyze(px, scale, exclude), thumb, scaled }
  }
  const result = await new Promise<Review>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<{ ok: boolean; review?: Review; error?: string }>) => (e.data.ok ? resolve(e.data.review!) : reject(new Error(e.data.error)))
    worker.onerror = (e) => reject(new Error(e.message || 'The review failed.'))
    worker.postMessage({ width: w, height: h, data: px.data.buffer, scale, exclude }, [px.data.buffer])
  }).finally(() => worker.terminate())
  return { result, thumb, scaled }
}

/** Script review of a finished image: background, noise, clipping, stars, colour and calibration leftovers, from the pixels alone. */
export default function ImageReview({ user, store, catalog }: { user: User | null; store: Store; catalog: CatObject[] }) {
  const db = user ? supabase : null
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState<'' | 'saving' | 'saved'>('')
  const [err, setErr] = useState('')
  const [setUp, setSetUp] = useState(true)
  const [cur, setCur] = useState<{ id: string; name: string; src: string; result: Review; targetId?: string; file?: File } | null>(null)
  const [local, setLocal] = useState<SavedReview[]>(loadLocal)
  const [remote, setRemote] = useState<{ uid: string; list: SavedReview[] } | null>(null)
  const [targetId, setTargetId] = useState('')
  const gears = useMemo(() => gearDefaultFirst(store.settings), [store.settings])
  /** All-in-one units anyone can pick, for when My gear is empty or the image came from a friend's scope. */
  const units = useMemo((): GearItem[] => PRESETS.filter((p) => p.id !== 'custom').map((p) => ({ id: `unit:${p.id}`, presetId: p.id, optics: p.optics, mount: defaultMount(p.id) })), [])
  const [inp, setInp] = useState<ReviewInputs>(() => ({ gearId: gearDefaultFirst(store.settings)[0]?.id, siteId: store.active?.id, filter: 'none', size: 'captured' }))
  const setI = (patch: Partial<ReviewInputs>) => setInp((i) => ({ ...i, ...patch }))
  const stored = useRef('')
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
  const mine = useMemo(() => store.wishlist.flatMap((w) => { const o = byId.get(w.id) ?? extraObject(w); return o ? [o] : [] }), [store.wishlist, byId])
  /** Any catalogue object, or one of the wishlist's own (custom fields, comets). */
  const objectOf = (id?: string) => (id ? byId.get(id) ?? mine.find((o) => o.id === id) : undefined)
  const nameOf = (id?: string) => { const o = objectOf(id); return o ? (isCustom(o.id) ? o.names[0] : o.m ?? o.id) : undefined }
  const gearOf = (id?: string) => gears.find((g) => g.id === id) ?? units.find((g) => g.id === id)
  const gear = gearOf(inp.gearId)
  const site = store.locations.find((l) => l.id === inp.siteId)
  const targetObj = objectOf(targetId)
  const ctx = cur ? buildContext(inp, gear, site, targetObj, { width: cur.result.image.width / cur.result.image.scale, height: cur.result.image.height / cur.result.image.scale }) : null
  const [cmpId, setCmpId] = useState('')
  const [cmpSrc, setCmpSrc] = useState<Record<string, string>>({})
  /** Picking a target fills in what the observation log knows: total hours, the latest sub length, the filter its type suggests. */
  const pickTarget = (id: string) => {
    setTargetId(id)
    const w = store.wishlist.find((x) => x.id === id), o = objectOf(id)
    const ses = w?.sessions ?? []
    const hours = ses.reduce((a, x) => a + (x.hours || 0), 0)
    const sub = [...ses].sort((a, b) => b.date.localeCompare(a.date)).find((x) => x.exposure)?.exposure
    const patch: Partial<ReviewInputs> = { hours: hours || undefined, subSec: sub, filter: o ? defaultFilter(o.type) : 'none' }
    setI(patch)
    return patch
  }
  // edits to the setup after a review are kept with it
  useEffect(() => {
    if (!cur) return
    const key = JSON.stringify([targetId, inp])
    if (stored.current === key) return
    const t = setTimeout(() => {
      stored.current = key
      const patch = (h: SavedReview) => (h.id === cur.id ? { ...h, targetId: targetId || undefined, inputs: inp, ...(h.shareId && ctx ? { share: { ctx, setup: gear ? gearName(gear) : undefined } } : {}) } : h)
      setLocal((l) => { if (!l.some((x) => x.id === cur.id)) return l; const next = l.map(patch); saveLocal(next); return next })
      const rem = remote?.list.find((x) => x.id === cur.id)
      if (rem && db) { setRemote((r) => r && { ...r, list: r.list.map(patch) }); updateReview(db, patch(rem)).catch((e) => setErr(`Couldn't save the setup details: ${e.message ?? e}`)) }
    }, 800)
    return () => clearTimeout(t)
  }, [cur?.id, targetId, inp]) // eslint-disable-line react-hooks/exhaustive-deps

  const [marking, setMarking] = useState(false)
  const [drawRect, setDrawRect] = useState<Rect | null>(null)
  const drawStart = useRef<{ x: number; y: number } | null>(null)
  /** Review the open file again with these areas left out, and keep the new result with the saved review. */
  const rerun = async (manual: Rect[]) => {
    // the file behind the current review, while it is open: needed to review it again without the marked areas
    const file = cur?.file
    if (!file || !cur) return
    setBusy(true); setErr('')
    try {
      const { result } = await review(file, manual)
      setCur((c) => (c && c.id === cur.id ? { ...c, result } : c))
      const patch = (h: SavedReview) => (h.id === cur.id ? { ...h, result } : h)
      setLocal((l) => { if (!l.some((x) => x.id === cur.id)) return l; const next = l.map(patch); saveLocal(next); return next })
      const rem = remote?.list.find((x) => x.id === cur.id)
      if (rem && db) { setRemote((rr) => rr && { ...rr, list: rr.list.map(patch) }); await updateReview(db, patch(rem)) }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const manualRects = cur?.result.excluded?.manual ?? []
  const pos = (e: React.PointerEvent<HTMLElement>) => { const b = e.currentTarget.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) } }
  const box = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) })

  const run = async (file: File) => {
    setBusy(true); setErr(''); setSaving(''); setMarking(false)
    try {
      const { result, thumb, scaled } = await review(file)
      if (objUrl.current) URL.revokeObjectURL(objUrl.current)
      objUrl.current = URL.createObjectURL(file)
      const W = Math.round(result.image.width / result.image.scale), H = Math.round(result.image.height / result.image.scale)
      // no target yet: try the file name ("M42_final.jpg", "pacman.png")
      const guess = targetId ? undefined : guessTarget(catalog, file.name)
      const tid = guess?.id ?? targetId
      const fromLog = guess ? pickTarget(guess.id) : {}
      const inputs: ReviewInputs = { ...inp, ...fromLog, size: inp.size === 'custom' ? 'custom' : looksResized(gear, W, H) ? 'resized' : 'captured' }
      setInp(inputs); stored.current = JSON.stringify([tid, inputs]); setCmpId('')
      const rec = { id: crypto.randomUUID(), at: new Date().toISOString(), name: file.name, targetId: tid || undefined, thumb, result, inputs }
      setCur({ id: rec.id, name: file.name, src: objUrl.current, result, targetId: rec.targetId, file })
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
    setCur({ id: h.id, name: h.name, src: h.thumb, result: h.result, targetId: h.targetId }); setSaving(''); setMarking(false)
    const inputs = h.inputs ?? inp
    setTargetId(h.targetId ?? ''); setInp(inputs); stored.current = JSON.stringify([h.targetId ?? '', inputs]); setCmpId('')
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
  const list = r && ctx ? [...notes(r, { arcsecKnown: !!ctx.arcsec }), ...setupNotes(r, ctx)] : []
  const b = r?.background, s = r?.stars
  const issues = list.filter((n) => n.tone === 'warn' || n.tone === 'bad').length
  // other reviews of the same target (any review when no target is set)
  const others = cur ? hist.filter((h) => h.id !== cur.id && (!targetId || h.targetId === targetId)) : []
  const other = others.find((h) => h.id === cmpId)
  const ctxOf = (res: Review, i: ReviewInputs | undefined, tid?: string) => buildContext(i ?? {}, gearOf(i?.gearId), store.locations.find((l) => l.id === i?.siteId), objectOf(tid), { width: res.image.width / res.image.scale, height: res.image.height / res.image.scale })
  const curSaved = cur ? remote?.list.find((x) => x.id === cur.id) : undefined
  const [copied, setCopied] = useState(false)
  const toggleShare = async () => {
    if (!db || !curSaved || !ctx) return
    if (curSaved.shareId && !window.confirm('Stop sharing? The link will stop working for everyone who has it.')) return
    try {
      const rec = { ...curSaved, share: curSaved.shareId ? undefined : { ctx, setup: gear ? gearName(gear) : undefined } }
      const shareId = await setSharing(db, rec, !curSaved.shareId)
      setRemote((rr) => rr && { ...rr, list: rr.list.map((x) => (x.id === rec.id ? { ...rec, shareId } : x)) })
      setCopied(false)
    } catch (e) { setErr(e instanceof NotSetUp ? 'Sharing isn\'t set up on this server yet (the database update hasn\'t been applied).' : `Couldn't change sharing: ${e instanceof Error ? e.message : String(e)}`) }
  }
  const copyLink = async (url: string) => { try { await navigator.clipboard.writeText(url); setCopied(true) } catch { window.prompt('Copy this link:', url) } }
  const compareWith = async (id: string) => {
    setCmpId(id)
    const h = hist.find((x) => x.id === id)
    if (h && db && h.path && !cmpSrc[h.id]) { try { const url = await imageUrl(db, h.path); setCmpSrc((m) => ({ ...m, [h.id]: url })) } catch { /* the thumbnail stays */ } }
  }
  return (
    <div className="insp">
      <div className="ch wrap"><h2 className="th">Image review <small>background · noise · stars · colour · calibration</small></h2></div>
      <p className="note noprint">Checks a finished (stretched) image: use a JPEG, PNG or WebP at full size. {inAccount ? 'The image and its review are saved to your account.' : user && !setUp ? 'Saving to your account isn\'t set up on this server yet, so reviews are kept on this device.' : <><Link to="/account">Sign in</Link> to save images and reviews to your account; until then they're kept on this device.</>} To measure a linear stack, use the <Link to="/tools/inspector">Image inspector</Link>.</p>

      <div className={`idrop ${drag ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f0 = e.dataTransfer.files[0]; if (f0) run(f0) }}
        onClick={() => input.current?.click()}>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/tiff,.jpg,.jpeg,.png,.webp,.tif,.tiff" hidden onChange={(e) => { const f0 = e.target.files?.[0]; if (f0) run(f0); e.target.value = '' }} />
        {busy ? 'Reviewing… a large image takes a few seconds.' : 'Drop a processed image here, or click to choose'}
      </div>
      <details className="rvform" open>
        <summary>How it was made <small>optional: adds advice on star size, tracking, integration and sub length</small></summary>
        <div>
          <label><small>Setup</small><select value={inp.gearId ?? ''} onChange={(e) => setI({ gearId: e.target.value || undefined })}>
            <option value="">Not specified</option>
            {gears.length > 0 && <optgroup label="My gear">{gears.map((g) => <option key={g.id} value={g.id}>{gearName(g)}</option>)}</optgroup>}
            <optgroup label="Smart telescopes">{units.map((g) => <option key={g.id} value={g.id}>{setupLabel(g.optics, g.presetId)}</option>)}</optgroup>
          </select></label>
          <label><small>Site</small><select value={inp.siteId ?? ''} onChange={(e) => setI({ siteId: e.target.value || undefined })}>
            <option value="">Not specified</option>{store.locations.map((l) => <option key={l.id} value={l.id}>{l.name}{l.bortle ? ` (Bortle ${l.bortle})` : ''}</option>)}
          </select></label>
          <label><small>Target</small><TargetPicker catalog={catalog} mine={mine} value={targetId} objectOf={(id) => objectOf(id)} onChange={(id) => { pickTarget(id); setCmpId('') }} /></label>
          <label><small>Integration (h)</small><input type="number" min={0} step={0.1} value={inp.hours ?? ''} onChange={(e) => setI({ hours: e.target.value ? +e.target.value : undefined })} placeholder="total" /></label>
          <label><small>Sub length (s)</small><input type="number" min={0} step={1} value={inp.subSec ?? ''} onChange={(e) => setI({ subSec: e.target.value ? +e.target.value : undefined })} placeholder="per frame" /></label>
          <label><small>Filter</small><select value={inp.filter ?? 'none'} onChange={(e) => setI({ filter: e.target.value as Filter })}>
            <option value="none">None / broadband</option><option value="dual">Dual-band (Hα + OIII)</option>
          </select></label>
          <label><small>Image size</small><select value={inp.size ?? 'captured'} onChange={(e) => setI({ size: e.target.value as ReviewInputs['size'] })}>
            <option value="captured">As captured (maybe cropped)</option><option value="resized">Resized (whole frame)</option><option value="custom">Known scale (″/px)</option>
          </select></label>
          {inp.size === 'custom'
            ? <label><small>Scale (″/px)</small><input type="number" min={0} step={0.01} value={inp.arcsec ?? ''} onChange={(e) => setI({ arcsec: e.target.value ? +e.target.value : undefined })} placeholder="from a plate solve" /></label>
            : ctx?.arcsec ? <p className="note">{ctx.arcsec.toFixed(2)}″/px in this image{ctx.captureArcsec && Math.abs(ctx.captureArcsec / ctx.arcsec - 1) > 0.03 ? ` (${ctx.captureArcsec.toFixed(2)}″/px as captured)` : ''}</p> : null}
        </div>
        <p className="note">{gears.length ? '' : <>Add your telescope and camera in <Link to="/account/gear">My gear</Link> to pick them here. </>}Picking a target from your wishlist fills in integration and sub length from your observation log.</p>
      </details>
      {err && <p className="nmsg">{err}</p>}

      {cur && r && b && s && (
        <>
          <h3>{cur.name}{nameOf(targetId) ? ` · ${nameOf(targetId)}` : ''} <small>{saving === 'saving' ? 'saving… · ' : saving === 'saved' ? 'saved to your account · ' : ''}{Math.round(r.image.width / r.image.scale)}×{Math.round(r.image.height / r.image.scale)}{r.image.mono ? ', mono' : ''} · {issues ? `${issues} thing${issues > 1 ? 's' : ''} to look at` : 'nothing obvious to fix'}</small></h3>
          <label className="f inl rvcmpsel"><span>Compare</span>
            <select value={cmpId} onChange={(e) => compareWith(e.target.value)} disabled={!others.length}>
              <option value="">{others.length ? `with another review${targetId ? ` of ${nameOf(targetId)}` : ''}…` : targetId ? `no other reviews of ${nameOf(targetId)} yet` : 'no other reviews yet'}</option>
              {others.map((h) => <option key={h.id} value={h.id}>{h.name} · {new Date(h.at).toLocaleDateString()}{!targetId && nameOf(h.targetId) ? ` · ${nameOf(h.targetId)}` : ''}</option>)}
            </select></label>
          <div className="rvshare noprint">
            <button onClick={() => printReview(cur.name)}>Export PDF</button>
            {curSaved
              ? <button onClick={toggleShare} className={curSaved.shareId ? 'on' : ''}>{curSaved.shareId ? 'Stop sharing' : 'Share…'}</button>
              : <button disabled title={user ? 'Saving to your account comes first' : 'Sign in to save and share reviews'}>Share…</button>}
            {curSaved?.shareId && <span className="rvlink"><input readOnly value={shareUrl(curSaved.shareId)} onFocus={(e) => e.target.select()} /><button onClick={() => copyLink(shareUrl(curSaved.shareId!))}>{copied ? 'Copied' : 'Copy link'}</button></span>}
            {!user && <small className="note">Sign in to share a review with a link.</small>}
          </div>
          {other && ctx && <ReviewCompare a={{ name: cur.name, src: cur.src, result: r, ctx }} b={{ name: other.name, at: other.at, src: cmpSrc[other.id] ?? other.thumb, result: other.result, ctx: ctxOf(other.result, other.inputs, other.targetId) }} onClose={() => setCmpId('')} />}
          <div className="rvtop">
            <div>
            <figure className={`rvimg ${marking ? 'marking' : ''}`}
              onPointerDown={(e) => { if (!marking || busy || (e.target as Element).classList.contains('exman')) return; e.currentTarget.setPointerCapture(e.pointerId); drawStart.current = pos(e); setDrawRect(box(drawStart.current, drawStart.current)) }}
              onPointerMove={(e) => { if (drawStart.current) setDrawRect(box(drawStart.current, pos(e))) }}
              onPointerUp={(e) => {
                const st = drawStart.current
                drawStart.current = null; setDrawRect(null)
                if (!st) return
                const rc = box(st, pos(e))
                if (rc.w > 0.01 && rc.h > 0.01) rerun([...manualRects, rc])
              }}>
              <img src={cur.src} alt="" draggable={false} />
              <svg viewBox={`0 0 ${r.image.width} ${r.image.height}`} preserveAspectRatio="none" aria-label="Marked areas">
                {r.artefacts.dust.map((d, i) => <ellipse key={i} cx={d.x * r.image.width} cy={d.y * r.image.height} rx={(d.d * r.image.width) / 2 + 6} ry={(d.d * r.image.width) / 2 + 6}><title>{`Dark spot, ${d.depth.toFixed(1)} levels deep`}</title></ellipse>)}
                {r.excluded?.auto.map((x, i) => <rect key={`a${i}`} className="exauto" x={x.x * r.image.width} y={x.y * r.image.height} width={x.w * r.image.width} height={x.h * r.image.height}><title>Overlay text, left out of the review</title></rect>)}
                {manualRects.map((x, i) => <rect key={`m${i}`} className="exman" x={x.x * r.image.width} y={x.y * r.image.height} width={x.w * r.image.width} height={x.h * r.image.height}
                  onClick={() => { if (marking && !busy) rerun(manualRects.filter((_, k) => k !== i)) }}><title>{marking ? 'Click to review this area again' : 'Left out of the review'}</title></rect>)}
                {drawRect && <rect className="exman" x={drawRect.x * r.image.width} y={drawRect.y * r.image.height} width={drawRect.w * r.image.width} height={drawRect.h * r.image.height} />}
              </svg>
            </figure>
            <div className="rvexcl">
              <small>{r.excluded?.auto.length ? `Overlay text found and left out (${r.excluded.auto.length} line${r.excluded.auto.length > 1 ? 's' : ''}, dashed). ` : ''}{manualRects.length ? `${manualRects.length} area${manualRects.length > 1 ? 's' : ''} you marked ${manualRects.length > 1 ? 'are' : 'is'} left out. ` : ''}{marking ? 'Drag a box over anything to leave out; click a box to bring it back.' : ''}</small>
              <button onClick={() => setMarking(!marking)} disabled={!cur.file || busy} title={cur.file ? undefined : 'Drop the image again to change what is left out'}>{marking ? 'Done' : 'Ignore an area…'}</button>
            </div>
            </div>
            <ReviewStats r={r} />
          </div>
          <ReviewNotes list={list} />
          <ReviewGrids r={r} />
        </>
      )}

      {hist.length > 0 && (
        <>
          <h3 className="noprint">{inAccount ? 'Saved reviews' : 'Recent reviews on this device'}</h3>
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
