/** The moon as a small SVG disc; `phase` is the moon's elongation in degrees (0 new, 90 first quarter, 180 full, 270 last quarter). */
export default function MoonGlyph({ phase, size = 18 }: { phase: number; size?: number }) {
  const p = (phase * Math.PI) / 180
  const r = 9, c = 10
  const rx = r * Math.abs(Math.cos(p))
  const waxing = phase < 180
  const crescent = Math.cos(p) > 0
  // lit part = limb arc on the lit side + terminator ellipse back
  const d = `M ${c} ${c - r} A ${r} ${r} 0 0 1 ${c} ${c + r} A ${rx} ${r} 0 0 ${crescent ? 0 : 1} ${c} ${c - r} Z`
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      <circle cx={c} cy={c} r={r} fill="#1b2436" stroke="#3a4559" strokeWidth={1} />
      <path d={d} fill="#e2e8f0" transform={waxing ? undefined : `translate(${2 * c} 0) scale(-1 1)`} />
    </svg>
  )
}
