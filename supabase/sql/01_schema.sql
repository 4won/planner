-- 주간 체크 플래너: tables and access rules.
-- Run once in Supabase Dashboard → SQL Editor. Safe to re-run.

create table if not exists public.tasks (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) <= 120),
  due         date,
  lead        integer not null default 0 check (lead between 0 and 365),
  repeat      boolean not null default false,
  color       text not null default 'teal',
  memo        text not null default '' check (char_length(memo) <= 2000),
  checks      date[] not null default '{}',
  done        boolean not null default false,
  done_at     date,
  created     date not null default current_date,
  updated_at  timestamptz not null default now()
);
create index if not exists tasks_user_idx on public.tasks (user_id);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists push_user_idx on public.push_subscriptions (user_id);

-- Each person sees and changes only their own rows.
alter table public.tasks enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "own tasks" on public.tasks;
create policy "own tasks" on public.tasks
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Live updates between devices.
do $$ begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null; end $$;
