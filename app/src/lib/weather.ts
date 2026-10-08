import { useEffect, useState } from 'react'
import type { Location } from './astro'

/** Hourly cloud cover (0..100) keyed by the UTC hour start in epoch ms. */
export type Cloud = Map<number, number>

const HOUR = 3600000
const TTL = 30 * 60000
const cache = new Map<string, { at: number; data: Cloud }>()

export async function fetchCloud(loc: Location): Promise<Cloud> {
  const key = `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.data
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&hourly=cloud_cover&forecast_days=8&timezone=GMT`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
  const j = (await res.json()) as { hourly: { time: string[]; cloud_cover: (number | null)[] } }
  const data: Cloud = new Map()
  j.hourly.time.forEach((t, i) => {
    const v = j.hourly.cloud_cover[i]
    if (v != null) data.set(new Date(`${t}:00Z`).getTime(), v)
  })
  cache.set(key, { at: Date.now(), data })
  return data
}

export function useCloud(loc: Location) {
  const [cloud, setCloud] = useState<Cloud | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let dead = false
    setCloud(null); setError(null)
    fetchCloud(loc).then((c) => !dead && setCloud(c)).catch((e) => !dead && setError(String(e.message ?? e)))
    return () => { dead = true }
  }, [loc.lat, loc.lon]) // eslint-disable-line react-hooks/exhaustive-deps
  return { cloud, error }
}

/** Cloud cover at an instant (the forecast hour containing it), or undefined beyond the forecast. */
export const cloudAt = (c: Cloud, t: number): number | undefined => c.get(Math.floor(t / HOUR) * HOUR)

export function meanCloud(c: Cloud, times: number[]): number | undefined {
  const v = times.map((t) => cloudAt(c, t)).filter((x): x is number => x !== undefined)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined
}
