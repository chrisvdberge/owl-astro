-- Comments on the guides at owlastro.com/guides. Anyone can post with just a name, no account. Every comment waits
-- until the site owner approves it in the app (Account → Comments), and only approved comments are public.
-- Visitors post through submit_guide_comment(), which checks lengths, a honeypot field and a rate limit per visitor.

create schema if not exists private;

-- who moderates the comments
create table private.admins (user_id uuid primary key references auth.users on delete cascade);
insert into private.admins (user_id) select id from auth.users where email = 'c.vdberge@gmail.com';

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.admins where user_id = (select auth.uid()))
$$;
revoke execute on function private.is_admin() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

create table public.guide_comments (
  id         uuid primary key default gen_random_uuid(),
  page_id    text not null check (page_id ~ '^[a-z0-9-]{1,120}$'),   -- the guide's slug
  parent_id  uuid references public.guide_comments on delete cascade, -- a reply; replies are one level deep
  name       text not null check (char_length(name) between 1 and 60),
  body       text not null check (char_length(body) between 1 and 4000),
  is_author  boolean not null default false,                           -- written by the site owner
  approved   boolean not null default false,
  created_at timestamptz not null default now(),
  visitor    text  -- hash of the poster's IP and the day, only for the rate limit; not readable through the API
);
create index guide_comments_page_idx on public.guide_comments (page_id, created_at) where approved;
create index guide_comments_pending_idx on public.guide_comments (created_at) where not approved;
create index guide_comments_visitor_idx on public.guide_comments (visitor, created_at);
create index guide_comments_parent_idx on public.guide_comments (parent_id);

alter table public.guide_comments enable row level security;

revoke all on public.guide_comments from anon, authenticated;
grant select (id, page_id, parent_id, name, body, is_author, approved, created_at) on public.guide_comments to anon, authenticated;
grant insert (page_id, parent_id, name, body, is_author, approved) on public.guide_comments to authenticated;
grant update (approved, body) on public.guide_comments to authenticated;
grant delete on public.guide_comments to authenticated;

create policy "approved comments are public" on public.guide_comments for select to anon, authenticated
  using (approved);
create policy "admin reads all" on public.guide_comments for select to authenticated
  using ((select private.is_admin()));
create policy "admin replies" on public.guide_comments for insert to authenticated
  with check ((select private.is_admin()));
create policy "admin moderates" on public.guide_comments for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin deletes" on public.guide_comments for delete to authenticated
  using ((select private.is_admin()));

-- whether the signed-in user moderates comments (the app shows the Comments page only then)
create function public.is_comment_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin()
$$;
revoke execute on function public.is_comment_admin() from public, anon;
grant execute on function public.is_comment_admin() to authenticated;

-- A visitor posts a comment; it's stored unapproved. Errors are short codes the site turns into messages.
create function public.submit_guide_comment(page_id text, name text, body text, parent_id uuid default null, website text default '')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  headers json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  ip text := coalesce(headers ->> 'cf-connecting-ip', headers ->> 'x-real-ip', split_part(headers ->> 'x-forwarded-for', ',', 1), '');
  v text := encode(sha256(convert_to(ip || '|' || current_date::text, 'UTF8')), 'hex');
  n text := btrim(name);
  b text := btrim(body);
  parent public.guide_comments%rowtype;
begin
  -- honeypot: a field people never see, which bots fill in; pretend it worked
  if coalesce(website, '') <> '' then return; end if;
  if n = '' or b = '' then raise exception 'empty'; end if;
  if char_length(n) > 60 or char_length(b) > 4000 then raise exception 'too_long'; end if;
  if (select count(*) from regexp_matches(b, 'https?://|www\.', 'gi')) > 3 then raise exception 'too_many_links'; end if;
  if (select count(*) from public.guide_comments c where c.visitor = v and c.created_at > now() - interval '10 minutes') >= 3
    or (select count(*) from public.guide_comments c where c.visitor = v and c.created_at > now() - interval '1 day') >= 10
    then raise exception 'rate_limited'; end if;
  -- a flood of unreviewed comments: stop taking more until they're dealt with
  if (select count(*) from public.guide_comments c where not c.approved) >= 200 then raise exception 'rate_limited'; end if;
  if parent_id is not null then
    select * into parent from public.guide_comments c where c.id = submit_guide_comment.parent_id and c.approved;
    if not found or parent.page_id <> submit_guide_comment.page_id then raise exception 'bad_parent'; end if;
  end if;
  insert into public.guide_comments (page_id, parent_id, name, body, visitor)
  values (submit_guide_comment.page_id, coalesce(parent.parent_id, parent.id), n, b, v);
end;
$$;
revoke execute on function public.submit_guide_comment(text, text, text, uuid, text) from public;
grant execute on function public.submit_guide_comment(text, text, text, uuid, text) to anon, authenticated;
