// deno-lint-ignore-file no-explicit-any
// Pulls each external calendar's iCal address (Google private address, iCloud public link),
// expands recurring events from 60 days back to 180 days ahead, and replaces that calendar's
// rows in external_events. pg_cron runs it every 15 minutes for everyone; the app's
// "지금 동기화" runs it for the signed-in user (optionally one calendar).
import ICAL from 'npm:ical.js@2.2.1';
import { CORS, json, adminClient, caller, DAY } from '../_shared/push.ts';

type Cal = { id: string; user_id: string; url: string };
type Row = { id: string; user_id: string; calendar_id: string; title: string; start_date: string; start_time: string | null; end_date: string; end_time: string | null; location: string };

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 3000;

async function sha(s: string) {
  const b = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 24);
}
// ICAL.Time → Seoul wall-clock date and time.
function seoul(t: any): { date: string; time: string | null } {
  if (t.isDate) return { date: `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`, time: null };
  const d = new Date(t.toJSDate().getTime() + 9 * 3600000).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
}
const minusDay = (date: string) => new Date(Date.parse(date + 'T00:00:00Z') - DAY).toISOString().slice(0, 10);

async function fetchIcs(url: string) {
  const res = await fetch(url.replace(/^webcal:/i, 'https:'), { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'weekly-check-planner calendar sync' } });
  if (!res.ok) throw new Error(`주소에서 ${res.status} 응답`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new Error('캘린더 파일이 너무 큽니다');
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('캘린더 파일이 너무 큽니다');
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('iCal 형식이 아닙니다');
  return text;
}

async function expand(cal: Cal, text: string): Promise<Row[]> {
  const comp = new ICAL.Component(ICAL.parse(text));
  for (const tz of comp.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);
  const lo = Date.now() - 60 * DAY, hi = Date.now() + 180 * DAY;
  const vevents = comp.getAllSubcomponents('vevent');
  const exceptions = vevents.filter(v => v.hasProperty('recurrence-id'));
  const rows: Row[] = [];
  for (const v of vevents) {
    if (v.hasProperty('recurrence-id')) continue;
    if (String(v.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') continue;
    const ev = new ICAL.Event(v);
    if (!ev.startDate) continue;
    for (const x of exceptions) if (x.getFirstPropertyValue('uid') === ev.uid) ev.relateException(x);
    const push = async (item: any, s: any, e: any) => {
      if (rows.length >= MAX_ROWS) return;
      const st = seoul(s);
      let en = e ? seoul(e) : st;
      if (st.time === null && e) en = { date: minusDay(en.date), time: null }; // all-day end is exclusive
      if (en.date < st.date) en = st;
      rows.push({
        id: await sha(`${cal.id}|${ev.uid}|${s.toString()}`), user_id: cal.user_id, calendar_id: cal.id,
        title: String(item.summary || '(제목 없음)').slice(0, 200),
        start_date: st.date, start_time: st.time, end_date: en.date, end_time: en.time && en.date === st.date && en.time < (st.time ?? '') ? null : en.time,
        location: String(item.location || '').slice(0, 200),
      });
    };
    if (ev.isRecurring()) {
      const it = ev.iterator();
      for (let n = 0, next: any; (next = it.next()) && n < 1000; n++) {
        const at = next.toJSDate().getTime();
        if (at > hi) break;
        const det = ev.getOccurrenceDetails(next);
        if (det.endDate.toJSDate().getTime() < lo) continue;
        if (String(det.item.component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') continue;
        await push(det.item, det.startDate, det.endDate);
      }
    } else {
      const end = ev.endDate ?? null;
      const endAt = (end ?? ev.startDate).toJSDate().getTime();
      if (endAt < lo || ev.startDate.toJSDate().getTime() > hi) continue;
      await push(ev, ev.startDate, end);
    }
  }
  // Same occurrence listed twice in a feed: keep one.
  return [...new Map(rows.map(r => [r.id, r])).values()];
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const admin = adminClient();
  const who = await caller(req, admin);
  if (!who) return json({ error: 'unauthorized' }, 401);
  const body = await req.json().catch(() => ({})) as { calendarId?: string };

  let q = admin.from('external_calendars').select('id,user_id,url');
  if (who.userId) q = q.eq('user_id', who.userId);
  if (body.calendarId) q = q.eq('id', body.calendarId);
  const { data: cals, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const results: { id: string; events?: number; error?: string }[] = [];
  let total = 0;
  for (const cal of (cals ?? []) as Cal[]) {
    try {
      const rows = await expand(cal, await fetchIcs(cal.url));
      const del = await admin.from('external_events').delete().eq('calendar_id', cal.id);
      if (del.error) throw new Error(del.error.message);
      for (let i = 0; i < rows.length; i += 500) {
        const ins = await admin.from('external_events').insert(rows.slice(i, i + 500));
        if (ins.error) throw new Error(ins.error.message);
      }
      await admin.from('external_calendars').update({ last_synced_at: new Date().toISOString(), last_error: null }).eq('id', cal.id);
      results.push({ id: cal.id, events: rows.length }); total += rows.length;
    } catch (e) {
      const msg = ((e as Error).message || String(e)).slice(0, 300);
      await admin.from('external_calendars').update({ last_error: msg }).eq('id', cal.id);
      results.push({ id: cal.id, error: msg });
    }
  }
  return json({ calendars: results.length, events: total, results });
});
