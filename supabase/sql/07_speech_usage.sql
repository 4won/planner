-- Azure speech (translation tab, speaker separation): seconds used per user per month (UTC),
-- so the speech-token function can stop handing out tokens at the free 5 hours. Only the
-- server function (service role) touches it; RLS is on with no policies for app users.
create table if not exists public.speech_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  seconds integer not null default 0 check (seconds >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);
alter table public.speech_usage enable row level security;

create or replace function public.add_speech_usage(p_user uuid, p_month text, p_seconds integer)
returns integer language sql security definer set search_path = public as $$
  insert into public.speech_usage (user_id, month, seconds) values (p_user, p_month, greatest(p_seconds, 0))
  on conflict (user_id, month) do update set seconds = public.speech_usage.seconds + greatest(p_seconds, 0), updated_at = now()
  returning seconds;
$$;
revoke all on function public.add_speech_usage(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.add_speech_usage(uuid, text, integer) to service_role;
