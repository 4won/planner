// Desktop widget data: GET /widget-data?token=… returns what the wallpaper widget shows
// (open tasks, this fortnight's events, imported calendar events, project names).
// Uses the same secret token as the calendar feed, because a wallpaper can't sign in.
// Deploy with --no-verify-jwt.
import { adminClient, CORS, DAY, fmtDate, seoulToday } from '../_shared/push.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!/^[a-f0-9]{32,128}$/.test(token)) return json({ error: 'not found' }, 404);
  const admin = adminClient();
  const { data: feed } = await admin.from('calendar_feeds').select('user_id').eq('token', token).maybeSingle();
  if (!feed) return json({ error: 'not found' }, 404);
  const uid = feed.user_id;

  const t = seoulToday();
  const from = fmtDate(t - 14 * DAY), to = fmtDate(t + 14 * DAY);
  const [tasks, events, ext, cals, projects] = await Promise.all([
    admin.from('tasks').select('id,title,due,lead,repeat,color,checks,done,done_at,created,project_id,tags,status,priority')
      .eq('user_id', uid).or(`done.eq.false,done_at.gte.${from}`),
    admin.from('events').select('id,title,start_date,start_time,end_date,end_time,location,color,project_id,recur')
      .eq('user_id', uid).lte('start_date', to).or(`end_date.gte.${from},recur.not.is.null`),
    admin.from('external_events').select('id,calendar_id,title,start_date,start_time,end_date,end_time,location')
      .eq('user_id', uid).lte('start_date', to).gte('end_date', from),
    admin.from('external_calendars').select('id,color').eq('user_id', uid),
    admin.from('projects').select('id,name,color,archived').eq('user_id', uid),
  ]);
  const err = [tasks, events, ext, cals, projects].find(r => r.error);
  if (err) return json({ error: err.error!.message }, 500);
  return json({
    at: new Date().toISOString(),
    tasks: tasks.data, events: events.data, externalEvents: ext.data, externalCalendars: cals.data, projects: projects.data,
  });
});
