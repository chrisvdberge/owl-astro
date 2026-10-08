# Astroplanner

Astrophotography planner: sky surveys with a field-of-view overlay, saved locations with a horizon profile,
a Messier/NGC wishlist, and a calendar that ranks your targets per night (altitude, moon, cloud forecast).
Requirements: [REQUIREMENTS.md](REQUIREMENTS.md).

## Run it

```bash
cd app && npm install && npm run dev
```

Without any configuration everything is stored in your browser (local only).

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
