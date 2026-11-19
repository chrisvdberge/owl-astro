/** Drawing the Moon on the sky view: its disc at true size (never smaller than a glyph), lit as it is at the moment, with a glow. */

export type MoonAt = {
  ra: number; dec: number // degrees
  sd: number // apparent radius, degrees
  phaseAngle: number // Sun–Moon–Earth angle, degrees: 0 full, 180 new
  limbPA: number // position angle of the bright limb's midpoint (towards the Sun), degrees east of north
  label: string
}

const RAD = Math.PI / 180

/** Position angle (from north through east) of the great circle from (ra1, dec1) towards (ra2, dec2), in degrees. */
export function positionAngle(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const da = (ra2 - ra1) * RAD, d1 = dec1 * RAD, d2 = dec2 * RAD
  return Math.atan2(Math.cos(d2) * Math.sin(da), Math.sin(d2) * Math.cos(d1) - Math.cos(d2) * Math.sin(d1) * Math.cos(da)) / RAD
}

/** The point `dist` degrees from (ra, dec) along position angle `pa`. */
function offset(ra: number, dec: number, pa: number, dist: number): [number, number] {
  const d = dist * RAD, p = pa * RAD, d1 = dec * RAD
  const d2 = Math.asin(Math.sin(d1) * Math.cos(d) + Math.cos(d1) * Math.sin(d) * Math.cos(p))
  const da = Math.atan2(Math.sin(p) * Math.sin(d) * Math.cos(d1), Math.cos(d) - Math.sin(d1) * Math.sin(d2))
  return [(((ra + da / RAD) % 360) + 360) % 360, d2 / RAD]
}

type Pix = (ra: number, dec: number) => number[] | null | undefined

/**
 * Draws the Moon centred on (x, y). `pix` projects sky to screen, so the disc's size and which side is lit follow the
 * view's zoom, projection and any mirroring. MIN_R keeps it a readable glyph when zoomed out.
 */
export function drawMoon(ctx: CanvasRenderingContext2D, x: number, y: number, m: MoonAt, pix: Pix) {
  const MIN_R = 8
  // true radius in pixels, and the screen direction towards the Sun, from points projected just off the centre
  const STEP = Math.max(m.sd, 0.2)
  let r = MIN_R, ang = 0
  try {
    const n = pix(...offset(m.ra, m.dec, 0, m.sd)), s = pix(...offset(m.ra, m.dec, m.limbPA, STEP))
    if (n) r = Math.max(MIN_R, Math.hypot(n[0] - x, n[1] - y))
    if (s) ang = Math.atan2(s[1] - y, s[0] - x)
  } catch { /* off the projection: keep the defaults */ }
  const lit = (1 + Math.cos(m.phaseAngle * RAD)) / 2 // fraction of the disc lit

  ctx.save()
  // glow, brighter the fuller the Moon
  const g = Math.max(r * 5, 90)
  const grad = ctx.createRadialGradient(x, y, r * 0.8, x, y, g)
  grad.addColorStop(0, `rgba(226,232,240,${(0.08 + 0.22 * lit).toFixed(3)})`)
  grad.addColorStop(0.35, `rgba(203,213,225,${(0.03 + 0.08 * lit).toFixed(3)})`)
  grad.addColorStop(1, 'rgba(203,213,225,0)')
  ctx.fillStyle = grad
  ctx.beginPath(); ctx.arc(x, y, g, 0, 2 * Math.PI); ctx.fill()

  // the unlit disc (faint earthshine)
  ctx.fillStyle = 'rgba(30,35,48,0.92)'
  ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill()

  // the lit part: the bright limb's half circle, closed by the terminator (a half ellipse)
  if (lit > 0.005) {
    ctx.translate(x, y); ctx.rotate(ang)
    const c = Math.cos(m.phaseAngle * RAD)
    ctx.fillStyle = '#f1ead2'
    ctx.beginPath()
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false)
    ctx.ellipse(0, 0, Math.abs(c) * r, r, 0, Math.PI / 2, (3 * Math.PI) / 2, c < 0)
    ctx.closePath(); ctx.fill()
  }
  ctx.restore()

  // the label, under the disc
  ctx.save()
  ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  ctx.fillStyle = '#e5e7eb'
  ctx.fillText(m.label, x, y + r + 4)
  ctx.restore()
}
