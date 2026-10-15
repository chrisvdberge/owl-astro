# Owl Astro

Astrophotography planner: sky surveys with a field-of-view overlay, saved locations with a horizon profile,
a Messier/NGC wishlist, a calendar that ranks your targets per night (altitude, moon, cloud forecast), a gear planner
that compares telescopes and cameras, and a site view with light pollution and light domes from the Light Pollution Atlas.
Requirements: [REQUIREMENTS.md](REQUIREMENTS.md).

## Run it

```bash
cd app && npm install && npm run dev
```

Without any configuration everything is stored in your browser (local only).

## Install and offline use (PWA)

The app is a progressive web app: on a phone use "Add to Home Screen", on desktop Chrome/Edge use the install icon in the address bar.
After the first visit it works without a connection: the app, the catalogue, the planning maths and your saved data are stored on the
device; forecasts, survey tiles and example images you have already seen are cached, and an **Offline** chip shows when there is
no network. Changes made offline sync when the connection returns. A new deploy shows a "new version ready" banner (Reload / Later).
Icons are generated from `app/public/favicon.svg` with `npm run icons`. It has no effect in `npm run dev`; try it with
`npm run build && npx vite preview`.

## Comets

Targets → Comets lists the comets brighter than a chosen magnitude. Orbits come from the Minor Planet Center's
`CometEls.txt` (fetched by the browser, cached a day); positions are two-body orbits computed in `app/src/lib/comets.ts`.
Brightness is the latest observed magnitude from [COBS](https://cobs.si), which has no CORS headers: in production
the worker in `app/worker/index.js` proxies it at `/api/cobs/comets` (cached 6 h); `npm run dev` proxies it through Vite.
A comet added as a target keeps its elements, moves night by night in all planning, gets a finder chart from your site
in its details, and its path over the coming weeks on the sky view.

## Events

Targets → Events lists what is worth imaging from the active site over the next 30–180 days, computed in the browser
(`app/src/lib/events.ts`, astronomy-engine): lunar occultations of bright stars and planets and the Moon crossing
clusters (the Pleiades, the Beehive), close passes of planets with bright stars, Messier/bright deep-sky objects and
each other, comets passing deep-sky objects, and lunar/solar eclipses. "Show on sky" opens the sky view at that moment
(`/sky?at=<ms>&ra&dec&fov`), which draws the Moon and planets where they are. Bright stars (V < 4.5) come from SIMBAD
via `app/scripts/build-stars.mjs` into `app/public/stars.json`.

## Catalog

`app/public/catalog.json` is generated: `node app/scripts/fetch-catalogs.mjs` downloads the extra catalogs into
`data/raw/`, then `node app/scripts/build-catalog.mjs` merges them with OpenNGC (cross-identifying objects, e.g. Sh2-190 = IC 1805).

## Optional: sync with Supabase

Sync needs a Supabase backend. Run one locally (needs Docker) or use a hosted project.

### Local (development)

```bash
brew install supabase/tap/supabase
supabase start          # first run downloads the images; applies supabase/migrations
supabase status -o env  # shows API_URL and ANON_KEY
```

Create `app/.env.local` (copy `app/.env.example`) with `VITE_SUPABASE_URL=http://127.0.0.1:54321` and the `ANON_KEY`
from the status output, then restart the dev server. Sign-in emails land in the local inbox at http://127.0.0.1:54324
and the database admin is at http://127.0.0.1:54323. `supabase stop` shuts it down; data is kept in a Docker volume.

A local backend is only reachable from this machine, so it won't serve your phone in the field.

### Hosted (works from any device)

1. Create a project at https://supabase.com.
2. SQL editor → run [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql).
3. Authentication → URL Configuration: set the Site URL to your app URL and add it to the redirect URLs.
4. Put the project URL and anon key into `app/.env.local` and restart the dev server.

### Behaviour

A "Sign in" button appears once keys are configured; sign in with the emailed link. On first sign-in your local data is
uploaded. On later sign-ins the account's data replaces what is in the browser (last write wins; no merge between
devices). Row level security keeps each user's rows private.
