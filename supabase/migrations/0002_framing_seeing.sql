-- Per-target framing (rotation, mosaic grid, survey) and per-location seeing.
alter table public.wishlist  add column framing jsonb;
alter table public.locations add column seeing double precision not null default 3;
