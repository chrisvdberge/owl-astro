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

## Best ISO

Tools → Best ISO (`/tools/iso/<camera>`) gives the lowest ISO worth using for a photo camera: the point where dynamic range,
plotted against log ISO, joins the straight line of −1 stop per stop (read noise no longer matters). Data is the photographic
dynamic range by Bill Claff ([PhotonsToPhotos](https://www.photonstophotos.net/Charts/PDR.htm)) for a curated list of cameras
used for astrophotography, credited in the tool; `node app/scripts/build-iso.mjs` refreshes `app/src/lib/isodr.json`, and the
knee detection is in `app/src/lib/iso.ts`.

## Best gain

Tools → Best gain (`/tools/gain/<camera>`) picks the gain for a cooled astro camera under your sky: each gain needs subs long enough
for the sky background to reach 10× the read noise squared (read noise then adds ~5%); of the gains that get there within your
longest sub, the one with the most dynamic range wins, else the high-conversion-gain switch. The sky rate comes from the exposure
model (site Bortle, the camera's scope from My gear, filter, colour or mono). Read noise and full well per gain are approximated from
the makers' charts in `app/src/lib/gain.ts`.

## Image review

Tools → Image review (`/tools/review`) gives feedback on a finished (stretched) JPEG, PNG or WebP image from its pixels alone, in the browser
(a Web Worker; nothing is uploaded, no gear or exposure info needed). It fits a smooth background surface through the tiles that
aren't object and reports:
- **Background**: level, colour cast and gradients (linear, or radial like vignetting or flats that over-correct).
- **Noise**: at pixel and 4 px scale, colour noise, and histogram gaps from stretching in 8-bit.
- **Clipping**: black and white, per channel.
- **Stars**: size and roundness across the field, how much of the frame they cover, colour, blue halos and dark rings.
- **Object**: its colour.
- **Calibration leftovers**: dust motes, amp glow, banding, walking noise and hot pixels.

An optional "How it was made" panel (setup from My gear or a smart telescope, site, target, integration, sub length, filter, and
whether the image was resized) adds advice in `app/src/lib/reviewSetup.ts`: star size in arcseconds against seeing and aperture,
sampling, elongation explained by the mount, noise against the exposure model's expected signal-to-noise and hours for a good
result, sub length against the sky, and dual-band filter and Bortle context. A target fills in integration and sub length from the
observation log; the inputs are saved with the review.
The target is searched in the whole catalogue (wishlist first) and guessed from the file name ("M42_final.jpg", "pacman.png").
Reviews of the same target can be compared side by side (`ReviewCompare.tsx`): each measurement with the better one marked, noise
taken relative to the object's brightness above the background so different stretches compare fairly.
Signed in, each review is saved to the account: the result in `image_reviews` and the image in the private `reviews` storage
bucket under `<user id>/` (the original up to 24 MB, else the reviewed copy as JPEG). Signed out, reviews are kept on the device.
Overlay text (captions, watermarks, an app's credit line) is found as rows of flat-filled, letter-shaped bright marks near the
edges and left out of every measurement; "Ignore an area…" lets you box anything else (a logo, a frame) and reviews again.
A saved review can be shared: it gets a permanent link `/r/<token>` that anyone can open, signed in or not
(`SharedReview.tsx`). Visitors read it through `get_shared_review(token)` (no access to the table, so shared reviews can't be
listed) and may read, not list, the images of shared reviews. A shared review carries a snapshot of the numbers the setup advice
needs (scale, aperture, Bortle, seeing, integration), without site names or locations. "Export PDF" prints the review alone (a
print stylesheet), so the browser's Save as PDF gives a clean report.
When the object fills the frame, the background and calibration checks are skipped. The checks and their rules of thumb are in
`app/src/lib/review.ts`; it is pure TypeScript, so it runs under Node for tests.

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
