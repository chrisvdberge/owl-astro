-- Light domes around a location: altitude (deg) to stay above per 10° of azimuth, from the light-pollution atlas.
alter table public.locations add column glow jsonb;
