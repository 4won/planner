// ICS subscription feed: GET /calendar-feed?token=… returns the owner's events and task deadlines.
// Google Calendar ("URL로 추가") and Apple Calendar (구독 캘린더) poll this address.
// Deploy with --no-verify-jwt: calendar apps can't send headers, so the token is the key.
import { adminClient, DAY, fmtDate, seoulToday, parseDate } from '../_shared/push.ts';
import { rruleLines, type Recur } from '../_shared/recur.ts';

type Ev = { id: string; title: string; start_date: string; start_time: string | null; end_date: string; end_time: string | null; location: string; memo: string; updated_at: string; recur: Recur | null };
type Task = { id: string; title: string; due: string; done: boolean; memo: string; updated_at: string };

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const enc = new TextEncoder();
// RFC 5545: lines longer than 75 octets continue on the next line after a space.
function fold(line: string) {
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '', size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; size = 0; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const d8 = (date: string) => date.replaceAll('-', '');
const dt = (date: string, time: string) => `${d8(date)}T${time.replace(':', '')}00`;
const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const nextDay = (date: string) => fmtDate(parseDate(date) + DAY);

Deno.serve(async req => {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!/^[a-f0-9]{32,128}$/.test(token)) return new Response('Not found', { status: 404 });
  const admin = adminClient();
  const { data: feed } = await admin.from('calendar_feeds').select('user_id').eq('token', token).maybeSingle();
  if (!feed) return new Response('Not found', { status: 404 });

  const from = fmtDate(seoulToday() - 90 * DAY);
  const [{ data: evs }, { data: tasks }] = await Promise.all([
    admin.from('events').select('id,title,start_date,start_time,end_date,end_time,location,memo,updated_at,recur').eq('user_id', feed.user_id).or(`end_date.gte.${from},recur.not.is.null`),
    admin.from('tasks').select('id,title,due,done,memo,updated_at').eq('user_id', feed.user_id).not('due', 'is', null).gte('due', from),
  ]);

  const L: string[] = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//weekly-check-planner//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    "X-WR-CALNAME:4WON'S PLANNER", 'X-WR-TIMEZONE:Asia/Seoul', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
    'BEGIN:VTIMEZONE', 'TZID:Asia/Seoul', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:KST', 'END:STANDARD', 'END:VTIMEZONE',
  ];
  for (const e of (evs ?? []) as Ev[]) {
    L.push('BEGIN:VEVENT', `UID:${e.id}@planner`, `DTSTAMP:${stamp(e.updated_at)}`);
    if (e.start_time) {
      L.push(`DTSTART;TZID=Asia/Seoul:${dt(e.start_date, e.start_time)}`);
      const endTime = e.end_time ?? e.start_time;
      L.push(`DTEND;TZID=Asia/Seoul:${dt(e.end_date, e.end_time || e.end_date !== e.start_date ? endTime : addHour(e.start_time))}`);
    } else {
      L.push(`DTSTART;VALUE=DATE:${d8(e.start_date)}`, `DTEND;VALUE=DATE:${d8(nextDay(e.end_date))}`);
    }
    L.push(...rruleLines(e, d => e.start_time ? `;TZID=Asia/Seoul:${dt(d, e.start_time)}` : `;VALUE=DATE:${d8(d)}`));
    L.push(`SUMMARY:${esc(e.title)}`);
    if (e.location) L.push(`LOCATION:${esc(e.location)}`);
    if (e.memo) L.push(`DESCRIPTION:${esc(e.memo)}`);
    L.push('END:VEVENT');
  }
  for (const t of (tasks ?? []) as Task[]) {
    L.push('BEGIN:VEVENT', `UID:${t.id}-due@planner`, `DTSTAMP:${stamp(t.updated_at)}`,
      `DTSTART;VALUE=DATE:${d8(t.due)}`, `DTEND;VALUE=DATE:${d8(nextDay(t.due))}`,
      `SUMMARY:${esc(`${t.done ? '✓ ' : ''}마감: ${t.title}`)}`, 'TRANSP:TRANSPARENT');
    if (t.memo) L.push(`DESCRIPTION:${esc(t.memo)}`);
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return new Response(L.map(fold).join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': 'inline; filename="planner.ics"' },
  });
});

function addHour(time: string) {
  const h = Math.min(23, +time.slice(0, 2) + 1);
  return `${String(h).padStart(2, '0')}:${time.slice(3, 5)}`;
}
