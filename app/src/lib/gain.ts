/**
 * Gain curves of dedicated astro cameras, approximated from the makers' published charts: read noise at a few gain settings
 * (linear in between; two points one apart mark the jump where the sensor switches to high conversion gain, HCG) and the full
 * well at gain 0. ZWO gain is in 0.1 dB, so electrons per ADU, and with them the usable full well, fall 10× per 200 gain.
 * `id` matches the gear planner's camera catalogue.
 */
export interface GainCamera { id: string; label: string; bits: number; fullWell0: number; maxGain: number; hcg?: number; rn: [number, number][] }

export const GAIN_CAMERAS: GainCamera[] = [
  { id: 'zwo-asi2600', label: 'ZWO ASI2600MC/MM Pro', bits: 16, fullWell0: 50000, maxGain: 300, hcg: 100, rn: [[0, 3.3], [99, 3.0], [100, 1.5], [200, 1.3], [300, 1.0]] },
  { id: 'zwo-asi6200', label: 'ZWO ASI6200MC/MM Pro', bits: 16, fullWell0: 51000, maxGain: 300, hcg: 100, rn: [[0, 3.5], [99, 3.2], [100, 1.6], [200, 1.4], [300, 1.2]] },
  { id: 'zwo-asi533mc', label: 'ZWO ASI533MC Pro', bits: 14, fullWell0: 50000, maxGain: 300, hcg: 100, rn: [[0, 3.8], [99, 3.4], [100, 1.6], [200, 1.2], [300, 1.0]] },
  { id: 'zwo-asi294mc', label: 'ZWO ASI294MC Pro', bits: 14, fullWell0: 63700, maxGain: 390, hcg: 120, rn: [[0, 7.3], [119, 6.0], [120, 2.0], [200, 1.6], [390, 1.2]] },
  { id: 'zwo-asi183', label: 'ZWO ASI183MC/MM Pro', bits: 12, fullWell0: 15000, maxGain: 300, rn: [[0, 3.0], [111, 2.0], [200, 1.7], [300, 1.6]] },
  { id: 'zwo-asi071mc', label: 'ZWO ASI071MC Pro', bits: 14, fullWell0: 46000, maxGain: 250, rn: [[0, 3.3], [90, 2.6], [250, 2.3]] },
]

export function readNoiseAt(c: GainCamera, g: number) {
  const i = c.rn.findIndex(([x]) => x >= g)
  if (i < 0) return c.rn[c.rn.length - 1][1]
  if (i === 0) return c.rn[0][1]
  const [x0, y0] = c.rn[i - 1], [x1, y1] = c.rn[i]
  return y0 + ((g - x0) / (x1 - x0)) * (y1 - y0)
}
export const fullWellAt = (c: GainCamera, g: number) => c.fullWell0 * 10 ** (-g / 200)

/** Read noise adds at most ~5% to the noise of a sub once the sky background reaches SWAMP × read noise². */
export const SWAMP = 10
const PENALTY = Math.sqrt(1 + 1 / SWAMP) - 1

export interface GainOption { gain: number; rn: number; fullWell: number; dr: number; minSub: number; fits: boolean; penalty: number }
export interface GainAdvice { options: GainOption[]; best: GainOption; key: GainOption[]; swamped: boolean; lower?: GainOption }

/**
 * The gain to use under a given sky: each gain needs subs long enough for the sky's noise to bury the read noise (sky electrons
 * ≥ SWAMP × RN²). Of the gains whose subs fit within `maxSub`, the one with the most dynamic range wins: under a bright sky that is
 * often gain 0, which keeps the most headroom for stars. When none fits (dark sky, narrowband) the HCG switch wins, where read
 * noise drops most for the range given up; `lower` is the gain past which read noise hardly falls further, for the faintest
 * work. `penalty` is how much read noise still adds to a sub of `minSub`, or `maxSub` when that is shorter.
 */
export function gainAdvice(c: GainCamera, skyPerSec: number, maxSub: number): GainAdvice {
  const steps = Array.from({ length: Math.floor(c.maxGain / 10) + 1 }, (_, i) => i * 10)
  const gains = [...new Set([...steps, ...c.rn.map(([g]) => g)])].filter((g) => g <= c.maxGain).sort((a, b) => a - b)
  const options = gains.map((gain): GainOption => {
    const rn = readNoiseAt(c, gain), fullWell = fullWellAt(c, gain)
    const minSub = (SWAMP * rn * rn) / skyPerSec
    const sub = Math.min(minSub, maxSub)
    return { gain, rn, fullWell, dr: Math.log2(fullWell / rn), minSub, fits: minSub <= maxSub, penalty: Math.sqrt(1 + (rn * rn) / (skyPerSec * sub)) - 1 }
  })
  const fits = options.filter((o) => o.fits)
  const floor = Math.min(...options.map((o) => o.rn))
  const quiet = options.find((o) => o.rn <= floor + 0.1)!
  const best = fits.length ? fits.reduce((a, b) => (b.dr > a.dr + 0.05 ? b : a)) : options.find((o) => o.gain === c.hcg) ?? quiet
  // the settings worth comparing: gain 0, the HCG switch (or where read noise levels off), and the advice
  const key = options.filter((o) => o.gain === 0 || o.gain === (c.hcg ?? c.rn[1][0]) || o === best)
  return { options, best, key, swamped: best.penalty <= PENALTY + 1e-9, lower: !best.fits && quiet.gain > best.gain ? quiet : undefined }
}
