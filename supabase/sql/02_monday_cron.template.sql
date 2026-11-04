-- Calls the weekly-digest function every Monday 08:30 KST (= Sunday 23:30 UTC).
-- tools/fill-cron-sql.js fills in __PROJECT_URL__ and __CRON_SECRET__ and writes 02_monday_cron.local.sql.
-- Run that filled file once in Supabase Dashboard → SQL Editor.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('weekly-digest') where exists (select 1 from cron.job where jobname = 'weekly-digest');

select cron.schedule(
  'weekly-digest',
  '30 23 * * 0',
  $$
  select net.http_post(
    url     := '__PROJECT_URL__/functions/v1/weekly-digest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '__CRON_SECRET__'),
    body    := '{}'::jsonb
  );
  $$
);
