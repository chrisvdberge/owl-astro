# Astroplanner — requirements (v1)

Personal astrophotography planner. Single user to start, but data model and auth are multi-user ready.
Reference: stellarnomads.com telescope FOV calculator (survey background + FOV overlay + results panel).

## Platform & stack
- Responsive web app / PWA (desk planning + phone in the field). UI in English.
- TypeScript, React + Vite, Aladin Lite v3 (HiPS surveys), astronomy-engine (ephemerides).
- Supabase (Postgres + auth) for persistence and sync; row-level security per user from day one.

## 1. Sky view
- Aladin Lite v3 with HiPS survey picker:
  - DSS2 color (full sky, default), PanSTARRS DR1 color (sharp, Dec > −30°)
  - H-alpha full-sky composite (Finkbeiner)
  - Mellinger color (wide-field Milky Way, big/dark nebulae, mosaics)
  - DESI Legacy Surveys, 2MASS, WISE (deep / infrared)
- Selection: manual dropdown + smart default per target (PanSTARRS for small galaxies, Mellinger for very large or
  dark nebulae, DSS2 otherwise); manual choice is remembered per target.
- One overlay survey with opacity slider (e.g. H-alpha at 40% over DSS2).
- Online only: survey tiles are streamed, no offline caching in v1.
- FOV rectangle overlay with rotation; mosaic grid overlay.
- Go to object by name / catalog ID / RA-Dec.

## 2. FOV calculator
- Presets: **Seestar S50 Pro** (alt-az and EQ mode) (50 mm, 260 mm f/5.2, 3840×2160 @ 2.9 µm → ~2.45°×1.38°, ~2.3″/px) first.
- Custom: aperture, focal length, sensor w/h mm, pixel µm, binning, drizzle, reducer/barlow factor.
- Results: FOV (deg/arcmin), image scale, sampling vs. site seeing.
- **Framing fit** per object: "too small" warning, "fits", or "needs mosaic" with recommended N×M grid
  (overlap %, rotation) drawn on the survey; integration estimate scales with panel count.

## 3. Locations
- Save multiple locations (name, lat/lon, elevation, timezone, optional Bortle).
- **Horizon profile**: drawn on an azimuth (0–360°) × altitude graph; import Stellarium / N.I.N.A. horizon files.

## 4. Catalog
**Included:** Messier, NGC/IC, Caldwell (aliases), vdB, Barnard, LDN, Sharpless, RCW, Hickson, Arp, Abell PN, Collinder/Melotte (partial).
**Not yet:** Herschel 400 (no clean source list), full Collinder/Melotte, UGC/PGC galaxies.
- Messier, NGC/IC (OpenNGC), Caldwell, Herschel 400.
- Dark & reflection: vdB, LDN, Barnard.
- Emission & PN: Sharpless (Sh2), Abell PN, RCW.
- Galaxies: Arp, Hickson, larger UGC/PGC.
- Clusters: Collinder, Melotte.
- Cross-identifications + common names searchable ("Pacman", "Iris").
- Per object: type, RA/Dec, size (major/minor/PA), magnitude/surface brightness where available.
- Built offline by an import script → one normalised table. Track per-catalog license (OpenNGC CC-BY-SA, VizieR sources).

## 5. Wishlist / projects
- Add objects to a wishlist; status: wishlist → in progress → done.
- Per target: framing (center, rotation, mosaic), optional integration goal (hours, no defaults), notes.
- Session log: date, location, hours captured → progress toward goal.

## 6. Suitability engine (core)
Computed **per night** for each wishlist target × location, for the coming year.
- Dark time: astronomical darkness (sun < −18°) preferred; nautical (< −12°) counts at lower quality
  (needed at ~52°N, no astro darkness ~late May–mid July).
- Usable night default: ≥ 2 h above both the horizon profile and 25° altitude during dark time.
- Moon: phase + separation. Tolerance **auto by object type** (emission/PN tolerate moon thanks to the dual-band
  filter; galaxies, reflection, dark nebulae, clusters need a dark moon); per-target override.
- Framing fit feeds in as a flag (not per-night).
- Output: per-night score (hours, peak altitude, moon penalty, darkness quality). All thresholds user-editable.

## 7. Calendar
- Target-centric: per target, a year strip of suitable weeks/months ("best: mid-Oct → Dec, avoid full moon weeks").
- Calendar-centric: month/week view; click a night → **ranked list of wishlist candidates + timeline**
  (when each target is usable that night) to chain 2–3 targets into one session.
- Unfinished projects get priority in the ranking.

## 8. Weather (short-term only)
- Open-Meteo hourly cloud cover for the next 3–7 nights, overlaid on the calendar/night view.

## Mount
- S50 Pro supports alt-az and EQ mode (wedge); mount mode is a per-session/location setting.
- Alt-az: flag field-rotation risk near the zenith (zenith gap in the night timeline). EQ: no zenith gap.

## Out of scope for v1
- Export to the Seestar app / N.I.N.A.
- Catalogs beyond Messier + NGC/IC.
- Offline survey caching.
