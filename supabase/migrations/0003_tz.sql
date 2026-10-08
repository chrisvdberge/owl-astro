-- IANA time zone per location (null = use the browser's zone).
alter table public.locations add column tz text;
