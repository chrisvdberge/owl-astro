-- Sharing an image review: a review with a share_id can be opened by anyone at /r/<share_id>, signed in or not.
-- Visitors never touch the table: get_shared_review() returns the one review for a valid token, so shared reviews
-- can't be listed. Their images become readable (download or a signed link, not listing) for as long as they're shared.

alter table public.image_reviews add column share_id text unique check (share_id is null or length(share_id) >= 16);

create function public.get_shared_review(token text)
returns table (name text, created timestamptz, target_id text, path text, result jsonb)
language sql stable security definer set search_path = '' as $$
  select r.name, r.created, r.target_id, r.path, r.result
  from public.image_reviews r
  where r.share_id = token and length(token) >= 16
$$;
revoke execute on function public.get_shared_review(text) from public;
grant execute on function public.get_shared_review(text) to anon, authenticated;

create function private.is_shared_review_image(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.image_reviews r where r.path = object_name and r.share_id is not null)
$$;
revoke execute on function private.is_shared_review_image(text) from public;
grant usage on schema private to anon;
grant execute on function private.is_shared_review_image(text) to anon, authenticated;

-- read (download or sign a link), but not list, when the storage version knows which operation is running
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'storage' and p.proname = 'allow_any_operation') then
    create policy "shared review images: read" on storage.objects for select to anon, authenticated
      using (bucket_id = 'reviews'
        and storage.allow_any_operation(array['storage.object.sign', 'storage.object.get_authenticated'])
        and private.is_shared_review_image(name));
  else
    create policy "shared review images: read" on storage.objects for select to anon, authenticated
      using (bucket_id = 'reviews' and private.is_shared_review_image(name));
  end if;
end $$;
