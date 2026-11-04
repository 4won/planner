-- Event alerts every minute; external calendar refresh every 15 minutes.
-- tools/fill-cron-sql.js fills __PROJECT_URL__ and __CRON_SECRET__ into 04_more_cron.local.sql.

select cron.unschedule(jobname) from cron.job where jobname in ('event-reminders', 'calendar-sync');

select cron.schedule('event-reminders', '* * * * *', $$
  select net.http_post(
    url     := '__PROJECT_URL__/functions/v1/event-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '__CRON_SECRET__'),
    body    := '{}'::jsonb
  );
$$);

select cron.schedule('calendar-sync', '*/15 * * * *', $$
  select net.http_post(
    url     := '__PROJECT_URL__/functions/v1/calendar-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '__CRON_SECRET__'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);

-- Keep the bookkeeping tables small.
select cron.unschedule(jobname) from cron.job where jobname = 'planner-cleanup';
select cron.schedule('planner-cleanup', '17 4 * * *', $$
  delete from public.reminder_log where fire_at < now() - interval '14 days';
  delete from cron.job_run_details where end_time < now() - interval '7 days';
$$);
