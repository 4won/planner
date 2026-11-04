-- v4: repeating events and promotions copied from the work hub. Safe to re-run.

-- recur: {"freq":"weekly|monthly|yearly","days":[0-6],"monthMode":"date|nth","until":"YYYY-MM-DD"|null,"exdates":[...]}
alter table public.events add column if not exists recur jsonb;

-- Filled by tools/sync-promotions.mjs from kangol-work-hub/data/summary/promotion.json.
create table if not exists public.promotions (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  start_date date not null,
  end_date date not null,
  channel text not null default 'both',
  status text not null default '',
  memo text not null default '',
  source text not null default 'hub',
  synced_at timestamptz not null default now(),
  check (end_date >= start_date)
);
alter table public.promotions enable row level security;
drop policy if exists "own rows read" on public.promotions;
create policy "own rows read" on public.promotions for select to authenticated using (user_id = (select auth.uid()));
