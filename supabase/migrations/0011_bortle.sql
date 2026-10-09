-- Sky darkness of a location (Bortle class 1-9), used for exposure-time estimates.
alter table public.locations add column bortle smallint check (bortle between 1 and 9);
