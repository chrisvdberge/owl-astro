-- A night's schedule: which targets to image when. Times are minutes after 17:00 site time on the night starting `date`.
create table public.plan_blocks (
  user_id   uuid not null default auth.uid() references auth.users on delete cascade,
  id        text not null,
  date      date not null,
  target_id text not null,        -- catalog id, or 'custom:<uuid>' for a custom field
  start_min integer not null,
  end_min   integer not null check (end_min > start_min),
  primary key (user_id, id)
);
alter table public.plan_blocks enable row level security;
create policy "own rows" on public.plan_blocks for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
