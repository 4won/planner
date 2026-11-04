-- v2: projects, events, memos, recaps, calendar links. Safe to re-run.

-- ---------- tasks: project fields ----------
alter table public.tasks
  add column if not exists project_id text,
  add column if not exists group_id   text,
  add column if not exists status     text not null default 'todo',
  add column if not exists priority   smallint not null default 0,
  add column if not exists start_date date,
  add column if not exists sort       double precision not null default 0;
do $$ begin
  alter table public.tasks add constraint tasks_status_chk check (status in ('todo','doing','stuck','done'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tasks add constraint tasks_priority_chk check (priority between 0 and 3);
exception when duplicate_object then null; end $$;
update public.tasks set status = 'done' where done and status <> 'done';
create index if not exists tasks_project_idx on public.tasks (project_id);

-- ---------- new tables ----------
-- project/group/memo links are plain ids (no foreign keys) so offline edits can reach the
-- server in any order; the app clears links itself when it deletes a project or memo.
create table if not exists public.projects (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) <= 80),
  color text not null default 'teal',
  archived boolean not null default false,
  sort double precision not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists public.project_groups (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id text,
  name text not null check (char_length(name) <= 60),
  sort double precision not null default 0,
  updated_at timestamptz not null default now()
);
-- Times are Seoul wall-clock values; start_time null means an all-day event.
create table if not exists public.events (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) <= 120),
  start_date date not null,
  start_time text check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_date date not null,
  end_time text check (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  location text not null default '',
  memo text not null default '',
  color text not null default 'violet',
  project_id text,
  remind_minutes integer[] not null default '{10}',
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists events_user_date_idx on public.events (user_id, start_date);
create table if not exists public.reminder_log (
  event_id text not null,
  user_id uuid not null,
  minutes integer not null,
  fire_at timestamptz not null,
  sent_at timestamptz not null default now(),
  primary key (event_id, minutes, fire_at)
);
create table if not exists public.memos (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) <= 80),
  project_id text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  touched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.memo_entries (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  memo_id text not null,
  body text not null check (char_length(body) <= 4000),
  created_at timestamptz not null default now(),
  sent_to text,
  updated_at timestamptz not null default now()
);
create index if not exists memo_entries_memo_idx on public.memo_entries (memo_id, created_at);
create table if not exists public.recaps (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  memo_id text not null,
  summary text not null default '',
  proposals jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.calendar_feeds (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  token text not null unique check (char_length(token) >= 32),
  created_at timestamptz not null default now()
);
create table if not exists public.external_calendars (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) <= 60),
  url text not null check (url ~* '^https://'),
  color text not null default 'slate',
  last_synced_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
create table if not exists public.external_events (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  calendar_id text not null references public.external_calendars (id) on delete cascade,
  title text not null,
  start_date date not null,
  start_time text,
  end_date date not null,
  end_time text,
  location text not null default ''
);
create index if not exists external_events_cal_idx on public.external_events (calendar_id);

-- ---------- updated_at ----------
do $$ declare t text; begin
  foreach t in array array['projects','project_groups','events','memos','memo_entries','recaps','external_calendars'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- ---------- access: each person only their own rows ----------
do $$ declare t text; begin
  foreach t in array array['projects','project_groups','events','memos','memo_entries','recaps','calendar_feeds','external_calendars'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;
-- Read-only for the app; only the sync function writes these.
alter table public.external_events enable row level security;
drop policy if exists "own rows read" on public.external_events;
create policy "own rows read" on public.external_events for select to authenticated using (user_id = (select auth.uid()));
-- Server-only bookkeeping.
alter table public.reminder_log enable row level security;

-- ---------- live updates ----------
do $$ declare t text; begin
  foreach t in array array['projects','project_groups','events','memos','memo_entries','recaps'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;
