-- NASA Astronomy Picture of the Day images taken at the remote observatories on owlastro.com/remote. APOD now lives on
-- science.nasa.gov (its own API returns placeholder data since the move), so the app's worker reads new APODs from
-- that site's WordPress API once a day and adds those that name an observatory, in the credit line or the explanation
-- (app/worker/apod.js). The seed below is every match in the APOD archive up to 16 Nov 2026, checked by hand: it
-- leaves out mentions that weren't images from the site ("Space Telescope Live", a nightscape "not far from El Sauce",
-- a photographer credited with E-Eye for a photo taken elsewhere). Hakos APODs are counted for the site (skygems-hakos).

create table public.remote_apods (
  observatory text not null check (observatory ~ '^[a-z0-9-]{1,60}$'),  -- the site's src/content/observatories/<slug>
  apod_date   date not null,
  title       text not null,
  link        text not null,
  in_credit   boolean not null,  -- named in the credit line (otherwise only in the explanation)
  primary key (observatory, apod_date)
);

alter table public.remote_apods enable row level security;
revoke all on public.remote_apods from anon, authenticated;
grant select on public.remote_apods to anon, authenticated;
grant select, insert, update on public.remote_apods to service_role;
create policy "public" on public.remote_apods for select to anon, authenticated using (true);

insert into public.remote_apods (observatory, apod_date, title, link, in_credit) values
  ('deep-sky-chile', '2026-02-04', 'Spiral Galaxy NGC 1512: Wide Field', 'https://science.nasa.gov/image-article/apod-2026-february-4-spiral-galaxy-ngc-1512-wide-field/', false),
  ('itelescope', '2022-01-12', 'Comet Leonard Closeup from Australia', 'https://science.nasa.gov/image-article/apod-2022-january-12-comet-leonard-closeup-from-australia/', true),
  ('itelescope', '2022-12-05', 'Pleiades: The Seven Sisters Star Cluster', 'https://science.nasa.gov/image-article/apod-2022-december-5-pleiades-the-seven-sisters-star-cluster/', true),
  ('itelescope', '2026-04-03', 'Caught in the Web', 'https://science.nasa.gov/image-article/apod-2026-april-caught-in-the-web/', true),
  ('obstech-el-sauce', '2022-06-03', 'A 10,000 Kilometer Galactic Bridge', 'https://science.nasa.gov/image-article/apod-2022-june-3-a-10000-kilometer-galactic-bridge/', false),
  ('obstech-el-sauce', '2023-01-10', 'NGC 2264: The Cone Nebula', 'https://science.nasa.gov/image-article/apod-2023-january-10-ngc-2264-the-cone-nebula/', false),
  ('obstech-el-sauce', '2023-06-23', 'Giant Galaxies in Pavo', 'https://science.nasa.gov/image-article/apod-2023-june-23-giant-galaxies-in-pavo/', true),
  ('obstech-el-sauce', '2023-07-12', 'Rings and Bar of Spiral Galaxy NGC 1398', 'https://science.nasa.gov/image-article/apod-2023-july-12-rings-and-bar-of-spiral-galaxy-ngc-1398/', false),
  ('obstech-el-sauce', '2023-08-16', 'Arp 93: A Cosmic Embrace', 'https://science.nasa.gov/image-article/apod-2023-august-16-arp-93-a-cosmic-embrace/', true),
  ('obstech-el-sauce', '2024-07-16', 'Cometary Globules', 'https://science.nasa.gov/image-article/apod-2024-july-16-cometary-globules/', true),
  ('obstech-el-sauce', '2024-12-18', 'NGC 660: Polar Ring Galaxy', 'https://science.nasa.gov/image-article/apod-2024-december-18-ngc-660-polar-ring-galaxy/', false),
  ('obstech-el-sauce', '2025-12-31', 'HH 222: The Waterfall Nebula', 'https://science.nasa.gov/image-article/apod-2025-december-31-hh-222-the-waterfall-nebula/', false),
  ('obstech-el-sauce', '2026-05-25', 'Thackerays Globules', 'https://science.nasa.gov/image-article/apod-2026-may-25-thackerays-globules/', false),
  ('obstech-el-sauce', '2026-05-26', 'NGC 3660 and Burcins Galaxy', 'https://science.nasa.gov/image-article/apod-2026-may-26-ngc-3660-and-burcins-galaxy/', true),
  ('obstech-el-sauce', '2026-06-17', 'Longmore 8: The Hamster Wheel Nebula', 'https://science.nasa.gov/image-article/apod-2026-june-17-longmore-8-the-hamster-wheel-nebula/', false),
  ('sierra-remote-observatories', '2008-04-25', 'M86 in the Virgo Cluster', 'https://science.nasa.gov/image-article/apod-2008-april-25-m86-in-the-virgo-cluster/', true),
  ('sierra-remote-observatories', '2008-07-12', 'NGC 7331 and Beyond', 'https://science.nasa.gov/image-article/apod-2008-july-12-ngc-7331-and-beyond/', true),
  ('sierra-remote-observatories', '2008-09-04', 'Spokes in the Helix Nebula', 'https://science.nasa.gov/image-article/apod-2008-september-4-spokes-in-the-helix-nebula/', true),
  ('sierra-remote-observatories', '2008-11-13', 'A Bubble in Cygnus', 'https://science.nasa.gov/image-article/apod-2008-november-13-a-bubble-in-cygnus/', false),
  ('sierra-remote-observatories', '2013-06-14', 'Sharpless 115', 'https://science.nasa.gov/image-article/apod-2013-june-14-sharpless-115/', true),
  ('sierra-remote-observatories', '2014-03-13', 'Messier 63: The Sunflower Galaxy', 'https://science.nasa.gov/image-article/apod-2014-march-13-messier-63-the-sunflower-galaxy/', true),
  ('sierra-remote-observatories', '2014-05-03', 'T Tauri and Hind s Variable Nebula', 'https://science.nasa.gov/image-article/apod-2014-may-3-t-tauri-and-hind-s-variable-nebula/', true),
  ('sierra-remote-observatories', '2015-01-13', 'The Soap Bubble Nebula', 'https://science.nasa.gov/image-article/apod-2015-january-13-the-soap-bubble-nebula/', false),
  ('skygems-hakos', '2006-06-23', 'East of Antares', 'https://science.nasa.gov/image-article/apod-2006-june-23-east-of-antares/', false),
  ('skygems-hakos', '2012-09-12', 'M7: Open Star Cluster in Scorpius', 'https://science.nasa.gov/image-article/apod-2012-september-12-m7-open-star-cluster-in-scorpius/', false),
  ('skygems-hakos', '2022-05-10', 'NGC 6334: The Cats Paw Nebula', 'https://science.nasa.gov/image-article/apod-2022-may-10-ngc-6334-the-cats-paw-nebula/', true),
  ('starfront', '2025-07-08', 'The Pleiades in Red and Blue', 'https://science.nasa.gov/image-article/apod-2025-july-8-the-pleiades-in-red-and-blue/', false),
  ('starfront', '2026-09-09', 'Witness XZ Andromedae Wink', 'https://science.nasa.gov/image-article/apod-2026-september-9-witness-xz-andromedae-wink/', true),
  ('starfront', '2026-10-21', 'New Ghosts Revealed in Cassiopeia', 'https://science.nasa.gov/image-article/apod-2026-october-21-new-ghosts-revealed-in-cassiopeia/', true),
  ('telescope-live', '2022-01-17', 'Chamaeleon Dark Nebulas', 'https://science.nasa.gov/image-article/apod-2022-january-17-chamaeleon-dark-nebulas/', true),
  ('telescope-live', '2022-06-23', 'Spiral Galaxy NGC 6744', 'https://science.nasa.gov/image-article/apod-2022-june-23-spiral-galaxy-ngc-6744/', true),
  ('telescope-live', '2022-09-14', 'Waves of the Great Lacerta Nebula', 'https://science.nasa.gov/image-article/apod-2022-september-14-waves-of-the-great-lacerta-nebula/', true),
  ('telescope-live', '2023-07-10', 'Stars, Dust and Nebula in NGC 6559', 'https://science.nasa.gov/image-article/apod-2023-july-10-stars-dust-and-nebula-in-ngc-6559/', true),
  ('telescope-live', '2023-10-11', 'NGC 1097: Spiral Galaxy with Supernova', 'https://science.nasa.gov/image-article/apod-2023-october-11-ngc-1097-spiral-galaxy-with-supernova/', true),
  ('telescope-live', '2023-12-13', 'Deep Field: The Heart Nebula', 'https://science.nasa.gov/image-article/apod-2023-december-13-deep-field-the-heart-nebula/', true),
  ('telescope-live', '2024-01-05', 'Trapezium: At the Heart of Orion', 'https://science.nasa.gov/image-article/apod-2024-january-5-trapezium-at-the-heart-of-orion/', true),
  ('telescope-live', '2025-01-01', 'Alpha Centauri: The Closest Star System', 'https://science.nasa.gov/image-article/apod-2025-january-1-alpha-centauri-the-closest-star-system/', true),
  ('telescope-live', '2026-05-22', 'The Nebulous Realm of WR 134', 'https://science.nasa.gov/image-article/apod-2026-may-22-the-nebulous-realm-of-wr-134/', true);
