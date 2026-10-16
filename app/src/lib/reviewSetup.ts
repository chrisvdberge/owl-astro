import type { Location } from './astro'
import type { CatObject } from './catalog'
import { DEFAULT_BORTLE, SKY_PASS, TIERS, defaultFilter, estimateExposure, skyRate, withSensor, type Filter } from './exposure'
import type { GearItem } from './gear'
import { MOUNTS, defaultMount } from './gearplan'
import { compute } from './optics'
import type { Note, Review } from './review'

/** What the user said about how the image was made; every field optional. Saved with the review. */
export interface ReviewInputs {
  gearId?: string; siteId?: string
  hours?: number; subSec?: number; filter?: Filter
  size?: 'captured' | 'resized' | 'custom'; arcsec?: number
}

/** The inputs resolved into numbers the advice needs. */
export interface ReviewContext {
  arcsec?: number                    // image scale, ″ per pixel of the image as shared
  captureArcsec?: number             // the scale it was captured (and drizzled) at
  apertureMm?: number
  mount?: { label: string; altaz?: boolean; fixed?: boolean }; guided?: boolean
  bortle?: number; seeing: number; siteKnown: boolean
  target?: string; emission?: boolean
  hours?: number; subSec?: number; filter?: Filter
  needSub?: number                   // sub length where the sky buries read noise (10 × RN²)
  model?: { snr: number; tier: string; good: number; great: number }
}

/** Does the image keep the sensor's shape? Then a smaller one was most likely resized rather than cropped. */
export const looksResized = (g: GearItem | undefined, w: number, h: number) => {
  if (!g) return false
  const o = g.optics, nativeW = ((o.sensorWmm * 1000) / (o.pixelUm * o.binning)) * o.drizzle
  const ar = Math.max(w, h) / Math.min(w, h), sar = Math.max(o.sensorWmm, o.sensorHmm) / Math.min(o.sensorWmm, o.sensorHmm)
  return Math.abs(ar / sar - 1) < 0.03 && Math.max(w, h) < 0.9 * nativeW
}

export function buildContext(inp: ReviewInputs, gear: GearItem | undefined, site: Location | undefined, target: CatObject | undefined, image: { width: number; height: number }): ReviewContext {
  const ctx: ReviewContext = { seeing: site?.seeing ?? 3, siteKnown: !!site, bortle: site?.bortle, target: target ? target.m ?? target.names[0] ?? target.id : undefined, emission: target ? defaultFilter(target.type) === 'dual' : undefined, hours: inp.hours, subSec: inp.subSec, filter: inp.filter }
  if (gear) {
    const o = withSensor(gear.optics, gear.presetId)
    const capture = compute(o, ctx.seeing).scale / o.drizzle
    const nativeLong = ((Math.max(o.sensorWmm, o.sensorHmm) * 1000) / (o.pixelUm * o.binning)) * o.drizzle
    const imgLong = Math.max(image.width, image.height)
    ctx.captureArcsec = capture
    ctx.arcsec = inp.size === 'custom' && inp.arcsec ? inp.arcsec : inp.size === 'resized' || imgLong > 1.05 * nativeLong ? (capture * nativeLong) / imgLong : capture
    ctx.apertureMm = o.apertureMm
    const m = MOUNTS.find((x) => x.id === (gear.mount ?? defaultMount(gear.presetId)))
    if (m) ctx.mount = { label: m.label, altaz: m.altaz, fixed: m.fixed }
    ctx.guided = gear.guided
    const filter = inp.filter ?? 'none'
    const sky = skyRate(o, ctx.bortle ?? DEFAULT_BORTLE, SKY_PASS[filter])
    if (o.readNoise && sky > 0) ctx.needSub = (10 * o.readNoise ** 2) / sky
    if (target && inp.hours && inp.subSec) {
      const est = estimateExposure(target, o, ctx.bortle ?? DEFAULT_BORTLE, inp.subSec, filter)
      if (est && est.kind !== 'cluster' && est.perSub > 0) {
        // the model's own frame-loss allowance (90%), so its hours and this SNR agree
        const snr = est.perSub * Math.sqrt((inp.hours * 3600 * 0.9) / inp.subSec)
        const tier = [...TIERS].reverse().find((t) => snr >= t.snr)?.label ?? 'below decent'
        ctx.model = { snr, tier, good: est.hours.good, great: est.hours.great }
      }
    }
  } else if (inp.size === 'custom' && inp.arcsec) ctx.arcsec = inp.arcsec
  return ctx
}

const hrs = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${h < 10 ? h.toFixed(1).replace(/\.0$/, '') : Math.round(h)} h`)
const secs = (s: number) => (s >= 90 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`)

/** Advice that needs to know how the image was made: star size against seeing, the mount, integration and sub length, filter and sky. */
export function setupNotes(r: Review, ctx: ReviewContext): Note[] {
  const out: Note[] = []
  const add = (tone: Note['tone'], text: string) => out.push({ area: 'Setup', tone, text })
  const s = r.stars, n = r.noise, bg = r.background

  // star size in arcseconds: seeing, diffraction and pixel size add up; a stretch widens stars a little more
  if (ctx.arcsec && s.fwhm) {
    const f = (s.fwhm.median / r.image.scale) * ctx.arcsec
    const diff = ctx.apertureMm ? 116 / ctx.apertureMm : 0
    const expected = Math.hypot(ctx.seeing, diff, ctx.captureArcsec ?? ctx.arcsec)
    const ratio = f / expected
    const why = `${ctx.siteKnown ? `${ctx.seeing}″ seeing at this site` : `typical ${ctx.seeing}″ seeing`}${ctx.apertureMm ? `, a ${ctx.apertureMm} mm aperture` : ''} and ${(ctx.captureArcsec ?? ctx.arcsec).toFixed(2)}″ pixels`
    if (ratio <= 1.7) add('ok', `Stars are ${f.toFixed(1)}″ across at half maximum, about what ${why} allow.`)
    else add(ratio > 2.4 ? 'bad' : 'warn', `Stars are ${f.toFixed(1)}″ across at half maximum, ${ratio.toFixed(1)}× what ${why} explain. Check focus (a Bahtinov mask or autofocus between targets), tracking, and how hard the stars were stretched.`)
  }
  if (ctx.captureArcsec) {
    const c = ctx.captureArcsec, S = ctx.seeing
    if (c > S / 1.5) add('info', `Captured at ${c.toFixed(2)}″/px, the image is undersampled for ${S}″ seeing, so stars can look blocky. Drizzle 2× (it needs dithered subs) recovers some resolution.`)
    else if (c < S / 3.5) add('info', `Captured at ${c.toFixed(2)}″/px, the image oversamples ${S}″ seeing. Binning 2×2, or halving the size, loses no detail and lowers the noise.`)
  }

  // elongated stars, explained by the mount
  const e = s.eccentricity?.median
  if (e != null && e > 0.55 && ctx.mount) {
    const ge = s.grid.eccentricity, corners = [ge[0][0], ge[0][2], ge[2][0], ge[2][2]].filter((v): v is number => v != null)
    const cornerWorse = ge[1][1] != null && corners.length >= 3 && corners.reduce((a, b) => a + b, 0) / corners.length - ge[1][1] > 0.1
    if (ctx.mount.fixed) add('warn', `On a fixed tripod stars trail within seconds. Keep subs under the "500 rule" (or NPF) limit, or use a tracker.`)
    else if (ctx.mount.altaz) add('warn', `Elongated stars${cornerWorse ? ', worst in the corners,' : ''} on an alt-az mount: field rotation. Shorter subs help, as does avoiding targets near the zenith; an EQ wedge removes it.`)
    else if (!ctx.guided && ctx.subSec && ctx.subSec > 60) add('warn', `Elongated stars with unguided ${secs(ctx.subSec)} subs on ${ctx.mount.label.replace(/ \(.*\)$/, '')}: periodic error shows at this length. Shorter subs, better polar alignment, or guiding.`)
    else if (ctx.guided) add('warn', 'Elongated stars despite guiding: check balance (slightly east-heavy), backlash, cable drag, wind, and the guiding graph (RMS should be under half the image scale).')
  }

  // noise against integration
  const noisy = (n.fine ?? 0) > 1.5 || ((n.coarse ?? 0) > 2 && (n.coarse ?? 0) > 0.7 * (n.fine ?? 0))
  if (ctx.model && ctx.hours) {
    const m = ctx.model
    add('info', `For ${ctx.target} after ${hrs(ctx.hours)}${ctx.bortle ? ` under Bortle ${ctx.bortle}` : ''}${ctx.filter === 'dual' ? ' with a dual-band filter' : ''}, the exposure model expects a signal-to-noise of about ${m.snr.toFixed(1)} per pixel (${m.tier.toLowerCase()}). A good result takes about ${hrs(m.good)}, a great one about ${hrs(m.great)}.`)
    if (noisy && ctx.hours < m.good) add('warn', `The noise is what ${hrs(ctx.hours)} gives on this target: more integration helps most, about ${hrs(m.good)} for a good result. Noise reduction can only hide so much.`)
    else if (noisy && ctx.hours >= m.great) add('warn', `${hrs(ctx.hours)} is plenty for this target, so the noise is more than it should be. Check that darks and flats match the lights, that bad subs were rejected, and ease the stretch or noise reduction.`)
    else if (!noisy && m.snr < TIERS[0].snr) add('info', `The background is smooth although the model expects little signal after ${hrs(ctx.hours)}: probably strong noise reduction. Check that faint detail survived it.`)
    else if (!noisy && ctx.hours < m.good) add('ok', `Clean for ${hrs(ctx.hours)} of integration: the processing kept the noise down well.`)
  } else if (ctx.hours && noisy) add('info', `With ${hrs(ctx.hours)} of integration some noise is expected; more time helps more than more noise reduction. Pick a target and setup for an estimate of how much.`)

  // sub length against the sky
  if (ctx.subSec && ctx.needSub) {
    const need = ctx.needSub
    if (ctx.subSec < need * 0.8 && ctx.subSec >= need / 2) add('info', `${secs(ctx.subSec)} subs are a little short for this sky: about ${secs(need)} buries read noise fully. The difference is small.`)
    else if (ctx.subSec < need / 2) add('warn', `${secs(ctx.subSec)} subs are short for this sky${ctx.filter === 'dual' ? ' through a dual-band filter' : ''}: read noise adds noticeably. Around ${secs(need)} buries it (or a higher gain, which lowers read noise).`)
    else if (ctx.subSec > need * 6 && s.measured > 20 && s.saturated > 0.3 * s.measured) add('info', `About ${secs(need)} subs already bury read noise here; your ${secs(ctx.subSec)} subs clip more star cores than needed. Shorter subs keep star colour.`)
    else add('ok', `${secs(ctx.subSec)} subs bury read noise under this sky (about ${secs(need)} is enough).`)
  }

  // filter and sky
  if (ctx.filter === 'dual' && ctx.emission === false) add('warn', `A dual-band filter passes only the Hα and OIII lines, and ${ctx.target} shines mostly in broadband light. Without the filter (or with a light-pollution filter) it collects far more signal.`)
  if (ctx.filter === 'dual') {
    if (bg.cast && ['magenta', 'purple', 'red', 'cyan', 'blue'].includes(bg.cast)) add('info', `A ${bg.cast} background is common with dual-band filters: colour calibration assumes broadband light. Neutralise the background by hand, or balance on a background sample.`)
    if (s.colour && (s.colour.chroma < 0.08 || s.colour.whitePct > 70)) add('info', 'Dual-band filters flatten star colour. Many imagers replace the stars with a short unfiltered (RGB) set, or boost star saturation separately.')
  }
  if (ctx.bortle && bg.reliable && bg.gradient.peakToPeak > 3) {
    if (ctx.bortle >= 6) add('info', `Under Bortle ${ctx.bortle} skies gradients are expected. Remove them early, before colour calibration and stretching.`)
    else if (ctx.bortle <= 3 && bg.gradient.linear > 8) add('info', `A strong gradient is unusual at a Bortle ${ctx.bortle} site: the moon, a nearby light, or dew on the optics.`)
  }
  if (r.artefacts.streaks && r.artefacts.streaks.strength > 0.2 && ctx.guided === false) add('info', 'Dithering (the fix for walking noise) needs guiding or a mount that can dither between subs.')
  return out
}
