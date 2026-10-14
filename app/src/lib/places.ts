/** Place search and terrain height for new sites: OpenStreetMap Nominatim (search on request only, as its policy asks) and Open-Meteo. */
export interface Place { name: string; detail: string; lat: number; lon: number }

export async function searchPlaces(q: string): Promise<Place[]> {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`)
  if (!r.ok) throw new Error(`Search failed (${r.status})`)
  const j: { name?: string; display_name: string; lat: string; lon: string }[] = await r.json()
  return j.map((p) => ({ name: p.name || p.display_name.split(',')[0], detail: p.display_name, lat: +p.lat, lon: +p.lon }))
}

/** Ground height (m) at a point from Open-Meteo's elevation model; undefined when offline. */
export async function elevationAt(lat: number, lon: number): Promise<number | undefined> {
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`)
    const j = await r.json()
    const e = j.elevation?.[0]
    return typeof e === 'number' ? Math.round(e) : undefined
  } catch { return undefined }
}
