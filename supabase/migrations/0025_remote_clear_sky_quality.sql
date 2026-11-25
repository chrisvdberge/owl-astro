-- The darkest sky of a night now counts clear readings only. Clouds over a site without town lights block the starlight,
-- so a cloudy sky reads darker than any clear one (Nebula Nest: 23.15 mag/arcsec² under cloud, natural sky about 22).
-- Otherwise the view is as in 0019.
create or replace view public.remote_nights with (security_invoker = true) as
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
         max(w.rain_rate) as max_rain_rate, max(w.sky_quality) filter (where w.clear) as best_sky_quality, min(w.fwhm) as best_fwhm,
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
