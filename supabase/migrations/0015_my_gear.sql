-- The user's own telescope + camera setups ("my gear"): [{ id, name?, presetId, optics, mount?, guided? }].
alter table public.settings add column gear jsonb;
