-- Priority (high / medium / low) of a wishlist target; the planner ranks higher priorities first.
alter table public.wishlist add column priority text check (priority in ('high', 'medium', 'low'));
