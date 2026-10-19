import { useEffect, useMemo, useRef, useState } from 'react'
import { extraObject, guessTarget, isCustom, type CatObject } from '../lib/catalog'
import { gearDefaultFirst, gearName, setupLabel, type GearItem } from '../lib/gear'
import { cutoutUrl } from '../lib/hips2fits'
import { groups, layout, overlaps, paDiff, unionArea, area, type Layout, type Overlap, type P } from '../lib/mosaic'
import { CAMERAS, PRESETS, compute } from '../lib/optics'
import { project, separation, type Hint, type Solution } from '../lib/platesolve'
import { otherGear } from '../lib/reviewSetup'
import { Link } from '../lib/router'
import type { useStore } from '../lib/store'
import { SURVEYS } from '../lib/surveys'
import TargetPicker from './TargetPicker'

type Store = ReturnType<typeof useStore>
const MAX_IMAGES = 8
/** Images are solved at this size (longest side): plenty of stars, and quick. */
const SOLVE_SIDE = 2000
const THUMB_SIDE = 900
/** One colour per panel, in a fixed order (validated categorical steps for a dark surface). */
const COLOURS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#2fa52f', '#9085e9', '#e66767']

interface Img {
  id: string; file: File; label: string; colour: string
  thumb: string; tw: number; th: number
  /** pixels as decoded, and as solved (scaled down) */
  origW: number; origH: number; w: number; h: number
  status: 'waiting' | 'solving' | 'solved' | 'failed'
  progress?: string; err?: string; sol?: Solution
  /** the target guessed from the file name, and one picked to solve near */
  guessId?: string; nearId?: string
  /** how many images were solved when this one failed: it is tried again once more are */
  failedAt?: number
}

async function decode(file: File, side: number) {
  let bmp: ImageBitmap
  try { bmp = await createImageBitmap(file) } catch {
    throw new Error('This browser can\'t open that file. Export a JPEG or PNG.')
  }
  const k = Math.min(1, side / Math.max(bmp.width, bmp.height))
  const cv = document.createElement('canvas')
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k)
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height)
  const out = { bmp, cv, ctx, origW: bmp.width, origH: bmp.height }
  return out
}

const fmtArea = (deg2: number) => (deg2 >= 1 ? `${deg2.toFixed(deg2 >= 10 ? 0 : 1)} deg²` : `${Math.round(deg2 * 3600)} arcmin²`)
const pct = (f: number) => (f > 0 && f < 0.005 ? '<1%' : `${Math.round(f * 100)}%`)
/** Image scale in arcseconds per pixel of the file as it was dropped. */
const arcsec = (m: Img) => (m.sol ? m.sol.scale * 3600 * (m.w / m.origW) : 0)

/**
 * Mosaic check: plate solve up to 8 panels in the browser and show where they landed on the sky, with their overlaps.
 * Needs a rough position (the target, or a file name that names it) and a rough scale (the setup).
 */
export default function MosaicCheck({ store, catalog }: { store: Store; catalog: CatObject[] }) {
  const gears = useMemo(() => gearDefaultFirst(store.settings), [store.settings])
  const units = useMemo((): GearItem[] => PRESETS.filter((p) => p.id !== 'custom').map((p) => ({ id: `unit:${p.id}`, presetId: p.id, optics: p.optics })), [])
  const [setupId, setSetupId] = useState(() => gears[0]?.id ?? 'lens')
  const [lens, setLens] = useState<{ fl?: number; cameraId?: string }>({})
  const gear = setupId === 'lens' ? otherGear({ apertureMm: (lens.fl ?? 0) / 4, focalLengthMm: lens.fl, cameraId: lens.cameraId }) ?? undefined
    : gears.find((g) => g.id === setupId) ?? units.find((g) => g.id === setupId)
  /** the long side of the sensor on the sky (deg) */
  const fieldLong = useMemo(() => { if (!gear) return 0; const r = compute(gear.optics, 3); return Math.max(r.fovW, r.fovH) }, [gear])
  const [targetId, setTargetId] = useState('')
  const [imgs, setImgs] = useState<Img[]>([])
  const [err, setErr] = useState('')
  const [drag, setDrag] = useState(false)
  const [bg, setBg] = useState('')
  const [showImgs, setShowImgs] = useState(false)
  const [hi, setHi] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const byId = useMemo(() => new Map(catalog.map((o) => [o.id, o])), [catalog])
  const mine = useMemo(() => store.wishlist.flatMap((w) => { const o = byId.get(w.id) ?? extraObject(w); return o ? [o] : [] }), [store.wishlist, byId])
  const objectOf = (id?: string) => (id ? byId.get(id) ?? mine.find((o) => o.id === id) : undefined)
  const nameOf = (o?: CatObject) => (o ? (isCustom(o.id) ? o.names[0] : o.m ?? o.id) : '')
  const target = objectOf(targetId)
  const patch = (id: string, p: Partial<Img>) => setImgs((l) => l.map((m) => (m.id === id ? { ...m, ...p } : m)))

  // one worker for the page: the Gaia tiles it fetched stay with it
  const worker = useRef<Worker | null>(null)
  const pending = useRef(new Map<string, { resolve: (v: { solution: Solution | null; stars?: number }) => void; reject: (e: Error) => void }>())
  useEffect(() => () => worker.current?.terminate(), [])
  const getWorker = () => {
    if (worker.current) return worker.current
    const w = new Worker(new URL('../lib/platesolve.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<{ id: string; progress?: string; done?: boolean; solution?: Solution | null; stars?: number; error?: string }>) => {
      const d = e.data
      if (d.progress) { patch(d.id, { progress: d.progress }); return }
      const p = pending.current.get(d.id)
      if (!p) return
      pending.current.delete(d.id)
      if (d.error) p.reject(new Error(d.error)); else p.resolve({ solution: d.solution ?? null, stars: d.stars })
    }
    w.onerror = (e) => { for (const p of pending.current.values()) p.reject(new Error(e.message || 'The solver stopped.')); pending.current.clear(); worker.current = null }
    return (worker.current = w)
  }

  const add = async (files: File[]) => {
    setErr('')
    const pics = files.filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name))
    const room = MAX_IMAGES - imgs.length
    if (pics.length > room) setErr(`Up to ${MAX_IMAGES} images: ${room ? `the first ${room} were added` : 'remove one to add another'}.`)
    const added: Img[] = []
    for (const file of pics.slice(0, Math.max(0, room))) {
      try {
        const { bmp, cv, origW, origH } = await decode(file, SOLVE_SIDE)
        const t = document.createElement('canvas'), k = Math.min(1, THUMB_SIDE / Math.max(origW, origH))
        t.width = Math.round(origW * k); t.height = Math.round(origH * k)
        t.getContext('2d')!.drawImage(bmp, 0, 0, t.width, t.height)
        bmp.close()
        const used = new Set([...imgs, ...added].map((m) => m.colour))
        added.push({
          id: crypto.randomUUID(), file, label: file.name.replace(/\.[a-z0-9]+$/i, ''), colour: COLOURS.find((c) => !used.has(c)) ?? COLOURS[0],
          thumb: t.toDataURL('image/jpeg', 0.8), tw: t.width, th: t.height, origW, origH, w: cv.width, h: cv.height,
          status: 'waiting', guessId: guessTarget(catalog, file.name)?.id,
        })
      } catch (e) { setErr(`${file.name}: ${e instanceof Error ? e.message : String(e)}`) }
    }
    if (!targetId) { const g = added.find((m) => m.guessId)?.guessId; if (g) setTargetId(g) }
    setImgs((l) => [...l, ...added])
  }

  /** A new setup or target: try the images that failed again. */
  const retry = () => setImgs((l) => l.map((m) => (m.status === 'failed' ? { ...m, status: 'waiting', err: undefined } : m)))

  /** Where to look for an image: a target picked for it, its file name, the panels already solved, the mosaic's target. */
  const hintsFor = (m: Img, solved: Img[], diag: number): Hint[] => {
    const out: Hint[] = []
    const push = (ra: number, dec: number, radius: number) => { if (!out.some((h) => separation(h.ra, h.dec, ra, dec) < diag * 0.3 && h.radius >= radius * 0.8)) out.push({ ra, dec, radius }) }
    for (const o of [objectOf(m.nearId), objectOf(m.guessId)]) if (o) push(o.ra, o.dec, 1.5 * diag + 0.5)
    for (const s of solved) push(s.sol!.ra, s.sol!.dec, 1.3 * diag)
    if (target) push(target.ra, target.dec, 2 * diag + 0.5)
    return out
  }

  const running = useRef(false)
  useEffect(() => {
    if (running.current) return
    const solved = imgs.filter((m) => m.sol)
    const next = imgs.find((m) => m.status === 'waiting') ?? imgs.find((m) => m.status === 'failed' && (m.failedAt ?? 0) < solved.length && !m.err?.startsWith('Pick'))
    if (!next) return
    // the scale: from a solved panel of the same shape (same camera), else from the setup
    const twin = solved.find((s) => Math.abs(s.w / s.h - next.w / next.h) < 0.03)
    const long = twin ? twin.sol!.scale * Math.max(twin.w, twin.h) : fieldLong
    if (!long) { if (next.status === 'waiting') patch(next.id, { status: 'failed', err: 'Choose the setup (or type the focal length and camera) so the solver knows how wide the images are.', failedAt: solved.length }); return }
    const scale = long / Math.max(next.w, next.h), tol = twin ? 0.06 : 0.2
    const hints = hintsFor(next, solved, Math.hypot(next.w, next.h) * scale)
    if (!hints.length) { patch(next.id, { status: 'failed', err: 'Pick the target (or name the file after it) so the solver knows where to look.', failedAt: solved.length }); return }
    running.current = true
    patch(next.id, { status: 'solving', progress: 'Finding stars…', err: undefined })
    ;(async () => {
      try {
        const { cv, ctx, bmp } = await decode(next.file, SOLVE_SIDE)
        bmp.close()
        const px = ctx.getImageData(0, 0, cv.width, cv.height)
        const res = await new Promise<{ solution: Solution | null; stars?: number }>((resolve, reject) => {
          pending.current.set(next.id, { resolve, reject })
          getWorker().postMessage({ id: next.id, width: cv.width, height: cv.height, data: px.data.buffer, scale, scaleTol: tol, hints }, [px.data.buffer])
        })
        if (res.solution) patch(next.id, { status: 'solved', sol: res.solution, progress: undefined })
        else patch(next.id, {
          status: 'failed', progress: undefined, failedAt: solved.length,
          err: (res.stars ?? 0) < 12 ? `Only ${res.stars ?? 0} stars found: the solver needs a stretched image with stars in it.` : 'No match near the target or the other panels. Check the setup, or pick what this panel shows below.',
        })
      } catch (e) {
        patch(next.id, { status: 'failed', progress: undefined, failedAt: solved.length, err: e instanceof Error ? e.message : String(e) })
      } finally { running.current = false; setImgs((l) => [...l]) }
    })()
  }, [imgs, fieldLong]) // eslint-disable-line react-hooks/exhaustive-deps

  const remove = (id: string) => { setImgs((l) => l.filter((m) => m.id !== id)); setHi(null) }
  const solved = imgs.filter((m) => m.sol)
  const solvedKey = solved.map((m) => m.id).join()
  const lay = useMemo(() => (solved.length ? layout(solved.map((m) => m.sol!.outline)) : null), [solvedKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const ov = useMemo(() => (lay ? overlaps(lay.polys) : []), [lay])
  const weak = weakLinks(solved.length, ov)
  const notes = lay ? mosaicNotes(solved, ov, weak) : []
  const covered = useMemo(() => (lay ? unionArea(lay.polys) : 0), [lay])
  const total = lay ? lay.polys.reduce((a, p) => a + area(p), 0) : 0

  return (
    <div className="insp mos">
      <div className="ch wrap"><h2 className="th">Mosaic check <small>plate solve · framing · overlap</small></h2></div>
      <p className="note">Drop the panels of a mosaic (up to {MAX_IMAGES} JPEG or PNG images, stretched). Each is plate-solved in your browser against Gaia stars, nothing is uploaded, and drawn where it landed on the sky with its overlaps. The solver needs to know roughly where (the target, or a file name like <code>NGC7000_panel2.jpg</code>) and how wide (the setup).</p>

      <div className="rvform"><div>
        <label><small>Setup</small><select value={setupId} onChange={(e) => { setSetupId(e.target.value); retry() }}>
          <option value="lens">Lens or scope: type the focal length…</option>
          {gears.length > 0 && <optgroup label="My gear">{gears.map((g) => <option key={g.id} value={g.id}>{gearName(g)}</option>)}</optgroup>}
          <optgroup label="Smart telescopes">{units.map((g) => <option key={g.id} value={g.id}>{setupLabel(g.optics, g.presetId)}</option>)}</optgroup>
        </select></label>
        {setupId === 'lens' && <>
          <label><small>Focal length (mm)</small><input type="number" min={1} value={lens.fl ?? ''} onChange={(e) => { setLens((l) => ({ ...l, fl: e.target.value ? +e.target.value : undefined })); retry() }} placeholder="e.g. 135" /></label>
          <label><small>Camera</small><select value={lens.cameraId ?? ''} onChange={(e) => { setLens((l) => ({ ...l, cameraId: e.target.value || undefined })); retry() }}>
            <option value="">Choose…</option>{CAMERAS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select></label>
        </>}
        <label><small>Target</small><TargetPicker catalog={catalog} mine={mine} value={targetId} objectOf={(id) => objectOf(id)} onChange={(id) => { setTargetId(id); retry() }} /></label>
        {gear && <p className="note">{fieldLong.toFixed(2)}° on the long side{gears.length ? '' : <> · add your gear in <Link to="/account/gear">My gear</Link></>}</p>}
      </div></div>

      <div className={`idrop ${drag ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add([...e.dataTransfer.files]) }}
        onClick={() => input.current?.click()}>
        <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" hidden onChange={(e) => { add([...(e.target.files ?? [])]); e.target.value = '' }} />
        {imgs.length >= MAX_IMAGES ? `${MAX_IMAGES} images: remove one to add another` : `Drop panel images here, or click to choose (${MAX_IMAGES - imgs.length} more)`}
      </div>
      {err && <p className="nmsg">{err}</p>}

      {imgs.length > 0 && (
        <div className="ihist mosl">
          {imgs.map((m) => (
            <div key={m.id} className={`ihrow ${m.status}`}>
              <i className="mosw" style={{ background: m.colour }} />
              <img src={m.thumb} alt="" className="rvthumb" />
              <span className="mosn">
                <input value={m.label} onChange={(e) => patch(m.id, { label: e.target.value })} aria-label="Panel name" />
                <small>{m.status === 'solved' && m.sol
                  ? `${m.sol.fieldW.toFixed(2)}° × ${m.sol.fieldH.toFixed(2)}° · ${arcsec(m).toFixed(2)}″/px · up ${Math.round(m.sol.pa) % 360}° E of N${m.sol.mirrored ? ' · mirrored' : ''} · ${m.sol.matched} stars`
                  : m.status === 'solving' ? m.progress ?? 'Solving…' : m.status === 'waiting' ? 'Waiting…' : m.err}</small>
                {m.status === 'failed' && <span className="mosnear"><small>Shows</small><TargetPicker catalog={catalog} mine={mine} value={m.nearId ?? ''} objectOf={(id) => objectOf(id)} onChange={(id) => patch(m.id, { nearId: id || undefined, status: 'waiting', err: undefined })} /></span>}
              </span>
              <span className={`mosst ${m.status}`}>{m.status === 'solved' ? 'solved' : m.status === 'solving' ? 'solving' : m.status === 'waiting' ? 'queued' : 'not solved'}</span>
              <button onClick={() => remove(m.id)} aria-label={`Remove ${m.label}`}>✕</button>
            </div>
          ))}
        </div>
      )}

      {lay && (
        <>
          <div className="mosctl">
            <label className="f inl"><span>Background</span><select value={bg} onChange={(e) => setBg(e.target.value)}>
              <option value="">Clean</option>{SURVEYS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select></label>
            <label className="moschk"><input type="checkbox" checked={showImgs} onChange={(e) => setShowImgs(e.target.checked)} /> Show my images</label>
          </div>
          <MosaicPlot frames={solved} lay={lay} ov={ov} hi={hi} bg={bg} showImgs={showImgs} target={target ? { ...project(lay.ra0, lay.dec0, target.ra, target.dec), name: nameOf(target) } : undefined} />
          <p className="note">{solved.length} panel{solved.length > 1 ? 's' : ''} · together {fmtArea(covered)} of sky{solved.length > 1 ? ` · ${pct(Math.max(0, 1 - covered / total))} of the imaged area is overlap` : ''} · centre {fmtRa(lay.ra0)} {fmtDec(lay.dec0)}</p>
          {notes.length > 0 && <ul className="ifind">{notes.map((n, i) => <li key={i} className={n.tone}><i>{{ ok: '✓', info: 'i', warn: '!', bad: '!!' }[n.tone]}</i>{n.text}</li>)}</ul>}
          {ov.length > 0 && (
            <table className="mostab">
              <thead><tr><th>Panels</th><th>Overlap</th><th>Shared sky</th><th /></tr></thead>
              <tbody>
                {ov.map((o, i) => {
                  const a = solved[o.a], b = solved[o.b], v = verdict(o, weak.has(o))
                  return (
                    <tr key={`${a.id}-${b.id}`} className={hi === i ? 'on' : ''} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} onClick={() => setHi(hi === i ? null : i)}>
                      <td><i className="mosw" style={{ background: a.colour }} />{a.label} <span className="mute">↔</span> <i className="mosw" style={{ background: b.colour }} />{b.label}</td>
                      <td><b>{pct(o.ofSmaller)}</b> <small className="mute">({pct(o.ofA)} of {a.label}, {pct(o.ofB)} of {b.label})</small></td>
                      <td>{fmtArea(o.area)}</td>
                      <td className={v.tone}>{v.text}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}

const fmtRa = (ra: number) => { const h = ra / 15, m = (h % 1) * 60; return `${Math.floor(h)}h${String(Math.floor(m)).padStart(2, '0')}m` }
const fmtDec = (dec: number) => `${dec < 0 ? '−' : '+'}${Math.abs(dec).toFixed(1)}°`

/** Below this (of the smaller panel) stitching software can't match two panels on their own. */
const THIN = 0.05

/** Thin overlaps that are the only link between parts of the mosaic (the panels also join through others otherwise). */
function weakLinks(n: number, ov: Overlap[]): Set<Overlap> {
  const strong = groups(n, ov, THIN), of = (i: number) => strong.findIndex((g) => g.includes(i))
  return new Set(ov.filter((o) => o.ofSmaller < THIN && of(o.a) !== of(o.b)))
}

/** Overlap as a fraction of the smaller panel, in the terms stitching software cares about. */
function verdict(o: Overlap, weak: boolean): { tone: 'ok' | 'info' | 'warn'; text: string } {
  const f = o.ofSmaller
  if (f < THIN) return weak ? { tone: 'warn', text: 'too thin to stitch' } : { tone: 'info', text: 'corners touch' }
  if (f < 0.1) return { tone: 'info', text: 'tight' }
  if (f <= 0.35) return { tone: 'ok', text: 'good' }
  if (f <= 0.5) return { tone: 'info', text: 'generous' }
  return { tone: 'info', text: 'mostly the same sky' }
}

interface MNote { tone: 'ok' | 'info' | 'warn' | 'bad'; text: string }
function mosaicNotes(frames: Img[], ov: Overlap[], weak: Set<Overlap>): MNote[] {
  const out: MNote[] = []
  const name = (i: number) => frames[i].label
  if (frames.length < 2) return [{ tone: 'info', text: 'Solve at least two panels to check how they overlap.' }]
  const gs = groups(frames.length, ov, 0)
  if (gs.length > 1) out.push({ tone: 'bad', text: `The panels fall apart into ${gs.length} groups that don't overlap: ${gs.map((g) => g.map(name).join(' + ')).join(' | ')}. Add a panel between them, or move one so it overlaps its neighbour by 10–20%.` })
  for (const o of weak) out.push({ tone: 'warn', text: `${name(o.a)} and ${name(o.b)} overlap only ${pct(o.ofSmaller)}, and nothing else joins them: too little for the stitching software to match stars reliably. Aim for 10–20%.` })
  for (const o of ov) if (o.ofSmaller > 0.6) out.push({ tone: 'info', text: `${name(o.a)} and ${name(o.b)} cover mostly the same sky (${pct(o.ofSmaller)}): good for extra depth there, but it adds little to the mosaic's size.` })
  const links = ov.filter((o) => o.ofSmaller >= THIN)
  if (gs.length === 1 && !weak.size && links.length) {
    const lo = Math.min(...links.map((o) => o.ofSmaller)), hiF = Math.max(...links.map((o) => o.ofSmaller))
    out.push({ tone: lo >= 0.1 ? 'ok' : 'info', text: `All ${frames.length} panels connect; neighbouring panels overlap ${pct(lo)}${hiF - lo > 0.01 ? `–${pct(hiF)}` : ''}.` })
  }
  // rotation: the same angle for every panel tiles cleanly; mixed angles leave ragged edges that are cropped away
  let worst = 0, pair: [number, number] = [0, 0]
  for (let a = 0; a < frames.length; a++) for (let b = a + 1; b < frames.length; b++) { const d = paDiff(frames[a].sol!.pa, frames[b].sol!.pa); if (d > worst) { worst = d; pair = [a, b] } }
  if (worst > 3) out.push({ tone: worst > 15 ? 'warn' : 'info', text: `The camera angle differs by up to ${Math.round(worst)}° between panels (${name(pair[0])} ${Math.round(frames[pair[0]].sol!.pa) % 360}°, ${name(pair[1])} ${Math.round(frames[pair[1]].sol!.pa) % 360}°). It stitches, but the edges come out ragged and are cropped away; shoot every panel at the same angle to tile cleanly.` })
  else out.push({ tone: 'ok', text: `All panels at the same camera angle (within ${Math.max(1, Math.round(worst))}°).` })
  const mir = frames.filter((m) => m.sol!.mirrored)
  if (mir.length && mir.length < frames.length) out.push({ tone: 'warn', text: `${(mir.length * 2 > frames.length ? frames.filter((m) => !m.sol!.mirrored) : mir).map((m) => m.label).join(', ')} ${mir.length === 1 || frames.length - mir.length === 1 ? 'is' : 'are'} mirrored compared to the others: flip horizontally before stitching.` })
  const sc = frames.map(arcsec), lo = Math.min(...sc), hi = Math.max(...sc)
  if (hi / lo > 1.03) out.push({ tone: 'info', text: `The panels have different image scales (${lo.toFixed(2)}–${hi.toFixed(2)}″/px): different setups, or some were resized. Stitching software scales them to match, at some cost in sharpness.` })
  return out
}

/** The panels on a flat (TAN) view of the sky, east left and north up; optionally on a survey or with the images themselves. */
function MosaicPlot({ frames, lay, ov, hi, bg, showImgs, target }: { frames: Img[]; lay: Layout; ov: Overlap[]; hi: number | null; bg: string; showImgs: boolean; target?: { 0: number; 1: number; name: string } }) {
  const VW = 900, ML = 54, MR = 14, MT = 14, MB = 46, PW = VW - ML - MR
  const hw0 = Math.max(lay.halfW * 1.08, 0.05), hh0 = Math.max(lay.halfH * 1.08, 0.05)
  const s = Math.max((2 * hw0) / PW, (2 * hh0) / 620) // degrees per plot pixel
  const PH = Math.max(280, (2 * hh0) / s), hw = (PW * s) / 2, hh = (PH * s) / 2
  const X = (xi: number) => ML + PW / 2 - xi / s, Y = (eta: number) => MT + PH / 2 - eta / s
  const pts = (p: P[]) => p.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ')
  const step = nice((2 * hw) / 7)
  const ticks = (h: number) => { const out: number[] = []; for (let v = Math.ceil(-h / step) * step; v <= h + 1e-9; v += step) out.push(+v.toFixed(6)); return out }
  const fmt = (v: number) => (Math.abs(v) < 1e-9 ? '0' : `${v < 0 ? '−' : ''}${+Math.abs(v).toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)}`)
  const bgUrl = bg ? cutoutUrl(bg, lay.ra0, lay.dec0, PW * s, Math.round(PW * 1.5), Math.round(PH * 1.5)) : ''
  const [bgState, setBgState] = useState<{ url: string; ok: boolean } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [saving, setSaving] = useState(false)
  const on = hi != null ? ov[hi] : null
  const ink = bg ? '#fff' : 'var(--fg)'

  /** PNG of the plot: images inlined (a survey from another site would block the canvas) and colours resolved. */
  async function savePng() {
    const svg = svgRef.current
    if (!svg) return
    setSaving(true)
    try {
      const clone = svg.cloneNode(true) as SVGSVGElement
      for (const im of clone.querySelectorAll('image')) {
        const href = im.getAttribute('href')
        if (href && !href.startsWith('data:')) {
          const blob = await (await fetch(href)).blob()
          im.setAttribute('href', await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(blob) }))
        }
      }
      const cs = getComputedStyle(svg)
      clone.setAttribute('font-family', cs.fontFamily)
      // text is styled by the page's stylesheet, which the PNG doesn't see
      const texts = svg.querySelectorAll('text'), copies = clone.querySelectorAll('text')
      texts.forEach((t, i) => {
        const st = getComputedStyle(t)
        for (const k of ['fill', 'stroke', 'stroke-width', 'stroke-linejoin', 'paint-order', 'font-size', 'font-weight']) copies[i].style.setProperty(k, st.getPropertyValue(k))
      })
      const txt = new XMLSerializer().serializeToString(clone).replace(/var\((--[\w-]+)\)/g, (_, n: string) => cs.getPropertyValue(n).trim() || '#888')
      const img = new Image()
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(txt)}`
      await img.decode()
      const k = 2, c = document.createElement('canvas')
      c.width = VW * k; c.height = (PH + MT + MB) * k
      const g = c.getContext('2d')!
      g.fillStyle = cs.getPropertyValue('--bg').trim() || '#0b0f17'; g.fillRect(0, 0, c.width, c.height)
      g.drawImage(img, 0, 0, c.width, c.height)
      const a = document.createElement('a')
      a.href = c.toDataURL('image/png'); a.download = 'mosaic.png'; a.click()
    } finally { setSaving(false) }
  }

  return (
    <figure className="mosplot">
      <svg ref={svgRef} viewBox={`0 0 ${VW} ${PH + MT + MB}`} role="img" aria-label="Where the panels landed on the sky">
        <defs>
          <clipPath id="mosclip"><rect x={ML} y={MT} width={PW} height={PH} /></clipPath>
          <pattern id="moshatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" style={{ stroke: ink, strokeWidth: 2.5 }} /></pattern>
        </defs>
        <rect x={ML} y={MT} width={PW} height={PH} style={{ fill: bg ? '#05080f' : 'var(--panel)' }} />
        <g clipPath="url(#mosclip)">
          {bgUrl && <image href={bgUrl} x={ML} y={MT} width={PW} height={PH} preserveAspectRatio="none" crossOrigin="anonymous"
            onLoad={() => setBgState({ url: bgUrl, ok: true })} onError={() => setBgState({ url: bgUrl, ok: false })} />}
          {ticks(hw).map((v) => <line key={`x${v}`} x1={X(-v)} x2={X(-v)} y1={MT} y2={MT + PH} style={{ stroke: bg ? 'rgba(255,255,255,.18)' : 'var(--line)', strokeWidth: 1 }} />)}
          {ticks(hh).map((v) => <line key={`y${v}`} y1={Y(v)} y2={Y(v)} x1={ML} x2={ML + PW} style={{ stroke: bg ? 'rgba(255,255,255,.18)' : 'var(--line)', strokeWidth: 1 }} />)}
          {showImgs && frames.map((m, i) => {
            // thumbnail pixels → plot: from where its top-left, top-right and bottom-left corners landed
            const p = lay.polys[i]
            const [a, b, d] = [p[0], p[2], p[6]].map(([x, y]) => [X(x), Y(y)])
            return <image key={`i${m.id}`} href={m.thumb} width={m.tw} height={m.th} preserveAspectRatio="none" opacity={0.92}
              transform={`matrix(${(b[0] - a[0]) / m.tw} ${(b[1] - a[1]) / m.tw} ${(d[0] - a[0]) / m.th} ${(d[1] - a[1]) / m.th} ${a[0]} ${a[1]})`} />
          })}
          {frames.map((m, i) => (
            <polygon key={m.id} points={pts(lay.polys[i])} style={{ fill: m.colour, fillOpacity: showImgs ? 0 : on && on.a !== i && on.b !== i ? 0.03 : bg ? 0.06 : 0.13, stroke: m.colour, strokeWidth: on && (on.a === i || on.b === i) ? 3 : 2, strokeOpacity: on && on.a !== i && on.b !== i ? 0.35 : 1 }}>
              <title>{`${m.label}: ${m.sol!.fieldW.toFixed(2)}° × ${m.sol!.fieldH.toFixed(2)}°, up ${Math.round(m.sol!.pa) % 360}° E of N`}</title>
            </polygon>
          ))}
          {on && <polygon points={pts(on.poly)} style={{ fill: 'url(#moshatch)', fillOpacity: 0.5, stroke: ink, strokeWidth: 1.5 }} />}
          {frames.map((m, i) => {
            const c = centroid(lay.polys[i])
            return <text key={`t${m.id}`} x={X(c[0])} y={Y(c[1])} textAnchor="middle" dominantBaseline="middle" className="moslbl" style={{ fill: ink, stroke: bg || showImgs ? 'rgba(0,0,0,.75)' : 'var(--panel)' }}>{m.label}</text>
          })}
          {target && Math.abs(target[0]) < hw && Math.abs(target[1]) < hh && (
            <g transform={`translate(${X(target[0])} ${Y(target[1])})`}>
              <path d="M0,-7 L2,-2 L7,-2 L3,1.5 L4.5,7 L0,3.5 L-4.5,7 L-3,1.5 L-7,-2 L-2,-2 Z" style={{ fill: ink }} />
              <text x={9} y={-6} className="moslbl sm" style={{ fill: ink, stroke: bg || showImgs ? 'rgba(0,0,0,.75)' : 'var(--panel)' }}>{target.name}</text>
            </g>
          )}
        </g>
        <rect x={ML} y={MT} width={PW} height={PH} style={{ fill: 'none', stroke: 'var(--line)' }} />
        {ticks(hw).map((v) => <text key={`xl${v}`} x={X(-v)} y={MT + PH + 16} textAnchor="middle" className="mosax">{fmt(v)}</text>)}
        {ticks(hh).map((v) => <text key={`yl${v}`} x={ML - 6} y={Y(v)} textAnchor="end" dominantBaseline="middle" className="mosax">{fmt(v)}</text>)}
        <text x={ML + PW / 2} y={MT + PH + 36} textAnchor="middle" className="mosax">← East · degrees · West →</text>
        <text transform={`translate(14 ${MT + PH / 2}) rotate(-90)`} textAnchor="middle" className="mosax">degrees (north up)</text>
      </svg>
      <figcaption>
        {bg && bgState?.url === bgUrl && !bgState.ok ? <small className="note">The survey image didn't load (offline, or the survey doesn't cover this part of the sky).</small> : <small className="note">{bg ? `${SURVEYS.find((x) => x.id === bg)?.label} from CDS hips2fits` : 'Offsets from the mosaic centre'}{on ? ` · hatched: ${frames[on.a].label} ∩ ${frames[on.b].label}` : ' · hover an overlap below to see it'}</small>}
        <button onClick={savePng} disabled={saving}>{saving ? 'Saving…' : 'Save PNG'}</button>
      </figcaption>
    </figure>
  )
}

const centroid = (p: P[]): P => [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length]
function nice(x: number) { const e = 10 ** Math.floor(Math.log10(x)), f = x / e; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e }
