// Runs every minute from pg_cron. Sends "n분 후 · 회의" pushes for event reminders that came due
// in the last few minutes. reminder_log makes each (event, minutes, moment) fire only once, and a
// moved event gets its reminders again because the moment is part of the key.
import { CORS, json, adminClient, caller, sendPush, type Sub, DAY, fmtDate, seoulToday, seoulInstant } from '../_shared/push.ts';
import { occurrenceStarts, type Recur } from '../_shared/recur.ts';

type Ev = { id: string; user_id: string; title: string; start_date: string; end_date: string; start_time: string | null; end_time: string | null; location: string; remind_minutes: number[]; recur: Recur | null };
const ALL_DAY_AT = '09:00'; // all-day events remind relative to 9 AM
const WINDOW = 5 * 60000;   // tolerate a late or skipped cron tick

const label = (m: number) => m === 0 ? '지금' : m % 1440 === 0 ? `${m / 1440}일 후` : m % 60 === 0 ? `${m / 60}시간 후` : `${m}분 후`;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const admin = adminClient();
  const who = await caller(req, admin);
  if (!who || !who.cron) return json({ error: 'unauthorized' }, 401);

  const now = Date.now();
  const today = seoulToday();
  // Reminders reach at most a week ahead; repeating events are expanded into that window.
  const from = fmtDate(today - DAY), to = fmtDate(today + 8 * DAY);
  const { data: evs, error } = await admin.from('events')
    .select('id,user_id,title,start_date,end_date,start_time,end_time,location,remind_minutes,recur')
    .lte('start_date', to).or(`start_date.gte.${from},recur.not.is.null`);
  if (error) return json({ error: error.message }, 500);

  const due: { ev: Ev; minutes: number; fireAt: number; startAt: number }[] = [];
  for (const ev of (evs ?? []) as Ev[]) {
    for (const day of occurrenceStarts(ev, from, to)) {
      const startAt = seoulInstant(day, ev.start_time ?? ALL_DAY_AT);
      for (const m of ev.remind_minutes ?? []) {
        const fireAt = startAt - m * 60000;
        if (fireAt <= now && fireAt > now - WINDOW) due.push({ ev, minutes: m, fireAt, startAt });
      }
    }
  }
  if (!due.length) return json({ checked: evs?.length ?? 0, sent: 0 });

  const userIds = [...new Set(due.map(d => d.ev.user_id))];
  const { data: subs } = await admin.from('push_subscriptions').select('endpoint,user_id,p256dh,auth').in('user_id', userIds);
  let sent = 0;
  const failures: string[] = [];
  for (const d of due) {
    // Claim the reminder first so overlapping runs can't both send it.
    const { data: claimed, error: claimErr } = await admin.from('reminder_log')
      .upsert({ event_id: d.ev.id, user_id: d.ev.user_id, minutes: d.minutes, fire_at: new Date(d.fireAt).toISOString() }, { onConflict: 'event_id,minutes,fire_at', ignoreDuplicates: true })
      .select('event_id');
    if (claimErr) { failures.push(claimErr.message); continue; }
    if (!claimed?.length) continue;
    const mine = ((subs ?? []) as Sub[]).filter(s => s.user_id === d.ev.user_id);
    if (!mine.length) continue;
    const when = d.ev.start_time ? `${d.ev.start_time}${d.ev.end_time ? `–${d.ev.end_time}` : ''}` : '종일';
    const r = await sendPush(admin, mine, {
      title: `${label(d.minutes)} · ${d.ev.title}`,
      body: [when, d.ev.location].filter(Boolean).join(' · '),
      url: './#home',
      tag: `event-${d.ev.id}-${d.minutes}`,
    });
    sent += r.sent; failures.push(...r.failures);
  }
  return json({ checked: evs?.length ?? 0, due: due.length, sent, failures });
});
