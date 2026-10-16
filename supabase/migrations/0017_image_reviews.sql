-- Image reviews saved to the account: the review result as JSON, a small thumbnail, and the image itself in the
-- private "reviews" storage bucket under <user id>/<review id>.<ext>.
create table public.image_reviews (
  user_id   uuid not null default auth.uid() references auth.users on delete cascade,
  id        uuid not null,
  created   timestamptz not null default now(),
  name      text not null,
  target_id text,
  path      text not null,
  thumb     text,
  result    jsonb not null,
  primary key (user_id, id)
);
create index image_reviews_user_created on public.image_reviews (user_id, created desc);

alter table public.image_reviews enable row level security;
grant select, insert, update, delete on public.image_reviews to authenticated;
create policy "own rows" on public.image_reviews for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 25 MB covers a full-size JPEG or PNG export; larger files are uploaded as a scaled JPEG
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reviews', 'reviews', false, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'image/tiff'])
on conflict (id) do nothing;

-- each user reads, writes and deletes only their own folder
create policy "own review images: read" on storage.objects for select to authenticated
  using (bucket_id = 'reviews' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own review images: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'reviews' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own review images: replace" on storage.objects for update to authenticated
  using (bucket_id = 'reviews' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'reviews' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own review images: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'reviews' and (storage.foldername(name))[1] = (select auth.uid())::text);
