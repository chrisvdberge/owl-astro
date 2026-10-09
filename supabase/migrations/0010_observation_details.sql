-- Observation details on a session: which setup was used, and the frame count and exposure behind the hours.
alter table public.sessions add column setup text, add column frames integer, add column exposure double precision;
