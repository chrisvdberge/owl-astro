-- User-named fields that are not catalog objects (id 'custom:<uuid>'): name, centre and constellation.
alter table public.wishlist add column custom jsonb;
