// Sends each person a push summary of this week's checklist and events.
// Called two ways:
//   - by pg_cron every Monday with the x-cron-secret header → everyone with a subscription
//   - by the app's "테스트 알림" button with the signed-in user's token → only that person
// Deploy with --no-verify-jwt; this function checks the caller itself.
import { CORS, json, adminClient, caller, sendPush, type Sub, DAY, parseDate, fmtDate, seoulToday, weekStart, md } from '../_shared/push.ts';
import { occurrenceStarts, type Recur } from '../_shared/recur.ts';

type Task = { id: string; user_id: string; title: string; due: string | null; lead: number; repeat: boolean; done: boolean; created: string };
type Ev = { user_id: string; title: string; start_date: string; end_date: string; start_time: string | null; recur: Recur | null };

// Same rule as weekRole() in docs/js/model.js, for open items only.
function role(t: Task, W: number): 'overdue' | 'due' | 'ahead' | 'nodue' | null {
  if (t.done) return null;
  if (!t.due) return W >= weekStart(parseDate(t.created)) ? 'nodue' : null;
  const due = parseDate(t.due), dueW = weekStart(due), startW = weekStart(due - t.lead * DAY);
  if (W === dueW) return 'due';
  if (W >= startW && W < dueW) return 'ahead';
  if (W > dueW) return 'overdue';
  return null;
}

function summarize(tasks: Task[], evs: Ev[]) {
  const today = seoulToday(), W = weekStart(today);
  const g = { overdue: [] as Task[], due: [] as Task[], ahead: [] as Task[], nodue: [] as Task[] };
  for (const t of tasks) { const r = role(t, W); if (r) g[r].push(t); }
  const byDue = (a: Task, b: Task) => (a.due ?? '9999').localeCompare(b.due ?? '9999');
  Object.values(g).forEach(a => a.sort(byDue));
  const total = g.overdue.length + g.due.length + g.ahead.length + g.nodue.length;
  if (!total && !evs.length) return { total: 0, title: '이번 주 체크리스트', body: '이번 주에 챙길 일과 일정이 없습니다.' };

  const counts = [
    evs.length && `일정 ${evs.length}`,
    g.overdue.length && `기한 지남 ${g.overdue.length}`,
    g.due.length && `이번 주 마감 ${g.due.length}`,
    g.ahead.length && `미리 챙길 일 ${g.ahead.length}`,
    g.nodue.length && `기한 없음 ${g.nodue.length}`,
  ].filter(Boolean).join(' · ');
  const top = [...g.overdue, ...g.due, ...g.ahead, ...g.nodue].slice(0, 3).map(t => {
    if (!t.due) return `· ${t.title}`;
    const diff = Math.round((parseDate(t.due) - today) / DAY);
    const dd = diff > 0 ? `D-${diff}` : diff === 0 ? 'D-DAY' : `D+${-diff}`;
    return `· ${t.title} (${md(parseDate(t.due))} ${dd})`;
  });
  const more = total > 3 ? `\n외 ${total - 3}건` : '';
  return { total: total + evs.length, title: `이번 주 체크 ${total}건${evs.length ? ` · 일정 ${evs.length}개` : ''}`, body: `${counts}\n${top.join('\n')}${more}`.trim() };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const admin = adminClient();
  const who = await caller(req, admin);
  if (!who) return json({ error: 'unauthorized' }, 401);

  let subQ = admin.from('push_subscriptions').select('endpoint,user_id,p256dh,auth');
  if (who.userId) subQ = subQ.eq('user_id', who.userId);
  const { data: subs, error: subErr } = await subQ;
  if (subErr) return json({ error: subErr.message }, 500);
  if (!subs?.length) return json({ sent: 0, users: 0 });

  const userIds = [...new Set((subs as Sub[]).map(s => s.user_id))];
  const W = weekStart(seoulToday());
  const [{ data: tasks, error: taskErr }, { data: evs, error: evErr }] = await Promise.all([
    admin.from('tasks').select('id,user_id,title,due,lead,repeat,done,created').in('user_id', userIds).eq('done', false),
    admin.from('events').select('user_id,title,start_date,end_date,start_time,recur').in('user_id', userIds)
      .lte('start_date', fmtDate(W + 6 * DAY)).or(`end_date.gte.${fmtDate(W)},recur.not.is.null`),
  ]);
  if (taskErr || evErr) return json({ error: (taskErr || evErr)!.message }, 500);

  let sent = 0, removed = 0;
  const failures: string[] = [];
  for (const uid of userIds) {
    // One entry per occurrence this week (repeating events count each time they happen).
    const weekEvs = (evs as Ev[]).filter(e => e.user_id === uid).flatMap(e => occurrenceStarts(e, fmtDate(W), fmtDate(W + 6 * DAY)).map(() => e));
    const s = summarize((tasks as Task[]).filter(t => t.user_id === uid), weekEvs);
    if (!s.total && who.cron) continue; // nothing to nag about on a quiet week
    const r = await sendPush(admin, (subs as Sub[]).filter(x => x.user_id === uid), { title: s.title, body: s.body, url: './#home', tag: 'weekly-digest' });
    sent += r.sent; removed += r.removed; failures.push(...r.failures);
  }
  return json({ sent, removed, users: userIds.length, failures });
});
