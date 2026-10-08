-- Astroplanner schema. Run in the Supabase SQL editor (or `supabase db push`).
-- Every row belongs to a user; row level security keeps users apart.

create table public.locations (
  user_id   uuid not null default auth.uid() references auth.users on delete cascade,
  id        text not null,
  name      text not null,
  lat       double precision not null,
  lon       double precision not null,
  elevation double precision not null default 0,
  horizon   jsonb not null default '[]',
  primary key (user_id, id)
);

create table public.wishlist (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  id         text not null,               -- catalog object id, e.g. 'NGC 7000'
  status     text not null default 'wishlist' check (status in ('wishlist', 'progress', 'done')),
  goal_hours double precision,
  notes      text not null default '',
  moon       text check (moon in ('tolerant', 'dark')),
  added      date not null default current_date,
  primary key (user_id, id)
);

create table public.sessions (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id      text not null,
  wish_id text not null,
  date    date not null,
  hours   double precision not null check (hours > 0),
  note    text not null default '',
  primary key (user_id, id),
  foreign key (user_id, wish_id) references public.wishlist (user_id, id) on delete cascade
);

create table public.settings (
  user_id   uuid primary key default auth.uid() references auth.users on delete cascade,
  min_alt   double precision not null default 25,
  min_hours double precision not null default 2,
  active_id text
);

alter table public.locations enable row level security;
alter table public.wishlist  enable row level security;
alter table public.sessions  enable row level security;
alter table public.settings  enable row level security;

create policy "own rows" on public.locations for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.wishlist for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.sessions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.settings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
