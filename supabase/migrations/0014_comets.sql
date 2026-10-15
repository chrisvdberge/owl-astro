-- Comets as targets (id 'comet:<designation>'): designation, MPC name and orbital elements, so the target moves on its own.
alter table public.wishlist add column comet jsonb;
