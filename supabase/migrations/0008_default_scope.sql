-- The user's default telescope + camera (preset id and optics), used for framing previews.
alter table public.settings add column scope jsonb;
