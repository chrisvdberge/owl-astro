-- Several saved framings per target, each with its own snapshot. Replaces wishlist.framing / wishlist.thumb.
create table public.framings (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id      text not null,
  wish_id text not null,
  name    text not null default '',
  created date not null default current_date,
  data    jsonb not null default '{}',   -- rotation, mosaic, survey, frame centre, view zoom, optics
  thumb   text,
  primary key (user_id, id),
  foreign key (user_id, wish_id) references public.wishlist (user_id, id) on delete cascade
);
alter table public.framings enable row level security;
create policy "own rows" on public.framings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- carry over the single framing each wishlist row had
insert into public.framings (user_id, id, wish_id, name, created, data, thumb)
select user_id, gen_random_uuid()::text, id, 'Framing 1', added, framing, thumb
from public.wishlist where framing is not null;
