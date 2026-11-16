-- Remote observatory tracking for owlastro.com/remote. The app's worker (app/worker/remote.js) polls the public status
-- feeds of remote observatories every 10 minutes while the Sun is down there and records each poll with
-- remote_record(), which only the worker's secret key may call. Everything here is public to read: the site's
-- dashboard reads remote_status (now) and remote_nights (one row per observatory per night).

create table public.remote_observatories (
  slug text primary key check (slug ~ '^[a-z0-9-]{1,60}$'),  -- matches the site's src/content/observatories/<slug>
  name text not null,
  tz   text not null,                                          -- IANA zone: a "night" is the local evening's date
  lat  double precision not null,
  lon  double precision not null
);
insert into public.remote_observatories values
  ('starfront', 'Starfront Observatories', 'America/Chicago', 31.546934, -99.381944),
  ('obstech-el-sauce', 'Obstech – El Sauce', 'America/Santiago', -30.471, -70.765),
  ('sierra-remote-observatories', 'Sierra Remote Observatories', 'America/Los_Angeles', 37.07, -119.41);

-- every poll, including the failed ones: a failed poll at night is an outage of the observatory's public feed
create table public.remote_polls (
  id          bigint generated always as identity primary key,
  observatory text not null references public.remote_observatories on delete cascade,
  at          timestamptz not null default now(),
  ok          boolean not null,
  error       text,
  roofs_open  smallint,
  roofs_total smallint
);
create index remote_polls_obs_at_idx on public.remote_polls (observatory, at);

-- the site's weather station at each successful poll; null where the station doesn't report a value
create table public.remote_weather (
  observatory    text not null references public.remote_observatories on delete cascade,
  at             timestamptz not null default now(),
  temperature    real,  -- °C
  humidity       real,  -- %
  dew_point      real,  -- °C
  pressure       real,  -- hPa
  wind_speed     real,  -- m/s
  wind_gust      real,  -- m/s
  wind_dir       real,  -- degrees
  rain_rate      real,  -- mm/h
  sky_temp       real,  -- °C from the IR cloud sensor: far below ambient (−20 °C or more) means clear
  sky_brightness real,  -- lux
  sky_quality    real,  -- mag/arcsec² (SQM)
  fwhm           real,  -- seeing, arcsec
  clear          boolean, -- the cloud sensor says clear: by the operator's own limit where published (worker decides)
  primary key (observatory, at)
);

-- current state of each roof, and every change (to the precision of the poll interval)
create table public.remote_roofs (
  observatory text not null references public.remote_observatories on delete cascade,
  building    text not null,
  is_open     boolean not null,
  since       timestamptz not null,
  checked_at  timestamptz not null,
  primary key (observatory, building)
);
create table public.remote_roof_events (
  observatory text not null references public.remote_observatories on delete cascade,
  building    text not null,
  is_open     boolean not null,
  at          timestamptz not null,
  primary key (observatory, building, at)
);

alter table public.remote_observatories enable row level security;
alter table public.remote_polls enable row level security;
alter table public.remote_weather enable row level security;
alter table public.remote_roofs enable row level security;
alter table public.remote_roof_events enable row level security;
revoke all on public.remote_observatories, public.remote_polls, public.remote_weather, public.remote_roofs, public.remote_roof_events
  from anon, authenticated;
grant select on public.remote_observatories, public.remote_polls, public.remote_weather, public.remote_roofs, public.remote_roof_events
  to anon, authenticated;
create policy "public" on public.remote_observatories for select to anon, authenticated using (true);
create policy "public" on public.remote_polls for select to anon, authenticated using (true);
create policy "public" on public.remote_weather for select to anon, authenticated using (true);
create policy "public" on public.remote_roofs for select to anon, authenticated using (true);
create policy "public" on public.remote_roof_events for select to anon, authenticated using (true);

-- One poll from the worker. roofs: [{"building": "Building 1", "is_open": false}, ...] or null when the feed has none;
-- weather: {"temperature": 8.2, ...} with the column names above, or null.
create function public.remote_record(observatory text, ok boolean, error text default null, roofs jsonb default null, weather jsonb default null)
returns void
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  t timestamptz := now();
  r record;
begin
  insert into public.remote_polls (observatory, at, ok, error, roofs_open, roofs_total)
  values (remote_record.observatory, t, remote_record.ok, left(remote_record.error, 500),
          case when roofs is not null then (select count(*) filter (where (x ->> 'is_open')::boolean) from jsonb_array_elements(roofs) x) end,
          case when roofs is not null then (select count(*) from jsonb_array_elements(roofs) x) end);

  if weather is not null then
    insert into public.remote_weather
    select remote_record.observatory, t, w.temperature, w.humidity, w.dew_point, w.pressure, w.wind_speed, w.wind_gust, w.wind_dir,
           w.rain_rate, w.sky_temp, w.sky_brightness, w.sky_quality, w.fwhm, w.clear
    from jsonb_populate_record(null::public.remote_weather, weather) w;
  end if;

  for r in select x ->> 'building' as building, (x ->> 'is_open')::boolean as is_open from jsonb_array_elements(coalesce(roofs, '[]')) x loop
    -- a roof seen for the first time, or one that changed: log it
    if not exists (select 1 from public.remote_roofs s where s.observatory = remote_record.observatory and s.building = r.building and s.is_open = r.is_open) then
      insert into public.remote_roof_events values (remote_record.observatory, r.building, r.is_open, t);
      insert into public.remote_roofs values (remote_record.observatory, r.building, r.is_open, t, t)
      on conflict (observatory, building) do update set is_open = excluded.is_open, since = t, checked_at = t;
    else
      update public.remote_roofs s set checked_at = t where s.observatory = remote_record.observatory and s.building = r.building;
    end if;
  end loop;
end;
$$;
revoke execute on function public.remote_record(text, boolean, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.remote_record(text, boolean, text, jsonb, jsonb) to service_role;

-- Now: last poll, roofs open, latest weather per observatory
create view public.remote_status with (security_invoker = true) as
select o.slug as observatory, o.name, o.tz,
       p.at as polled_at, p.ok, p.error, p.roofs_open, p.roofs_total,
       w.at as weather_at, w.temperature, w.humidity, w.dew_point, w.wind_speed, w.wind_gust, w.rain_rate, w.sky_temp,
       w.sky_quality, w.fwhm, w.clear,
       (select max(at) from public.remote_polls q where q.observatory = o.slug and q.ok) as last_ok_at
from public.remote_observatories o
left join lateral (select * from public.remote_polls q where q.observatory = o.slug order by at desc limit 1) p on true
left join lateral (select * from public.remote_weather q where q.observatory = o.slug order by at desc limit 1) w on true;

-- One row per observatory per night (the local date the evening falls on). Roof time is counted from the open/close
-- events; a roof still open counts up to its last check. clear_fraction is the share of weather samples the cloud
-- sensor called clear (remote_weather.clear).
create view public.remote_nights with (security_invoker = true) as
with spans as (
  select e.observatory, e.building, e.at as opened,
         coalesce(lead(e.at) over w, s.checked_at) as closed, e.is_open
  from public.remote_roof_events e
  join public.remote_roofs s using (observatory, building)
  window w as (partition by e.observatory, e.building order by e.at)
),
open_spans as (
  select sp.observatory, sp.building, (sp.opened at time zone o.tz - interval '12 hours')::date as night,
         extract(epoch from sp.closed - sp.opened) / 60 as minutes
  from spans sp join public.remote_observatories o on o.slug = sp.observatory
  where sp.is_open
),
roof as (
  select observatory, night, count(distinct building) as buildings_opened, max(per_building) as max_open_minutes
  from (select observatory, night, building, sum(minutes) as per_building from open_spans group by 1, 2, 3) b
  group by 1, 2
),
polls as (
  select p.observatory, (p.at at time zone o.tz - interval '12 hours')::date as night,
         count(*) as polls, count(*) filter (where not p.ok) as failed_polls, max(p.roofs_total) as buildings
  from public.remote_polls p join public.remote_observatories o on o.slug = p.observatory
  group by 1, 2
),
weather as (
  select w.observatory, (w.at at time zone o.tz - interval '12 hours')::date as night,
         round(avg(w.clear::int)::numeric, 2) as clear_fraction,
         min(w.temperature) as min_temperature, max(w.humidity) as max_humidity, max(w.wind_gust) as max_wind_gust,
         max(w.rain_rate) as max_rain_rate, max(w.sky_quality) as best_sky_quality, min(w.fwhm) as best_fwhm,
         percentile_cont(0.5) within group (order by w.fwhm) as median_fwhm
  from public.remote_weather w join public.remote_observatories o on o.slug = w.observatory
  group by 1, 2
)
select p.observatory, p.night, p.polls, p.failed_polls, p.buildings,
       coalesce(r.buildings_opened, 0) as buildings_opened, round(coalesce(r.max_open_minutes, 0)) as max_open_minutes,
       w.clear_fraction, w.min_temperature, w.max_humidity, w.max_wind_gust, w.max_rain_rate, w.best_sky_quality, w.best_fwhm, w.median_fwhm
from polls p
left join roof r using (observatory, night)
left join weather w using (observatory, night);

grant select on public.remote_status, public.remote_nights to anon, authenticated;
