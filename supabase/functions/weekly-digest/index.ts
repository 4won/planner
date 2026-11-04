// Sends each person a push summary of this week's checklist.
// Called two ways:
//   - by pg_cron every Monday with the x-cron-secret header → everyone with a subscription
//   - by the app's "테스트 알림" button with the signed-in user's token → only that person
// Deploy with --no-verify-jwt; this function checks the caller itself.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import webpush from 'npm:web-push@3.6.7';

type Task = { id: string; user_id: string; title: string; due: string | null; lead: number; repeat: boolean; done: boolean; created: string };
type Sub = { endpoint: string; user_id: string; p256dh: string; auth: string };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ---- dates: all math on Seoul calendar dates held as UTC midnights ----
const DAY = 864e5;
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const parse = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const weekStart = (t: number) => t - ((new Date(t).getUTCDay() + 6) % 7) * DAY;
const seoulToday = () => parse(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }));
const md = (t: number) => { const d = new Date(t); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DOW[d.getUTCDay()]})`; };

// Same rule as weekRole() in docs/app.js, for open items only.
function role(t: Task, W: number, thisW: number): 'overdue' | 'due' | 'ahead' | 'nodue' | null {
  if (t.done) return null;
  if (!t.due) return W >= weekStart(parse(t.created)) ? 'nodue' : null;
  const due = parse(t.due), dueW = weekStart(due), startW = weekStart(due - t.lead * DAY);
  if (W === dueW) return 'due';
  if (W >= startW && W < dueW) return 'ahead';
  if (W > dueW && W <= thisW) return 'overdue';
  return null;
}

function summarize(tasks: Task[]) {
  const today = seoulToday(), W = weekStart(today);
  const g = { overdue: [] as Task[], due: [] as Task[], ahead: [] as Task[], nodue: [] as Task[] };
  for (const t of tasks) { const r = role(t, W, W); if (r) g[r].push(t); }
  const byDue = (a: Task, b: Task) => (a.due ?? '9999').localeCompare(b.due ?? '9999');
  Object.values(g).forEach(a => a.sort(byDue));
  const total = g.overdue.length + g.due.length + g.ahead.length + g.nodue.length;
  if (!total) return { total, title: '이번 주 체크리스트', body: '이번 주에 챙길 일이 없습니다.' };

  const counts = [
    g.overdue.length && `기한 지남 ${g.overdue.length}`,
    g.due.length && `이번 주 마감 ${g.due.length}`,
    g.ahead.length && `미리 챙길 일 ${g.ahead.length}`,
    g.nodue.length && `기한 없음 ${g.nodue.length}`,
  ].filter(Boolean).join(' · ');
  const top = [...g.overdue, ...g.due, ...g.ahead, ...g.nodue].slice(0, 3).map(t => {
    if (!t.due) return `· ${t.title}`;
    const diff = Math.round((parse(t.due) - today) / DAY);
    const dd = diff > 0 ? `D-${diff}` : diff === 0 ? 'D-DAY' : `D+${-diff}`;
    return `· ${t.title} (${md(parse(t.due))} ${dd})`;
  });
  const more = total > 3 ? `\n외 ${total - 3}건` : '';
  return { total, title: `이번 주 체크 ${total}건`, body: `${counts}\n${top.join('\n')}${more}` };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

  // Who is asking?
  let onlyUser: string | null = null;
  const cronSecret = Deno.env.get('CRON_SECRET');
  const fromCron = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret;
  if (!fromCron) {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return json({ error: 'unauthorized' }, 401);
    onlyUser = data.user.id;
  }

  let subQ = admin.from('push_subscriptions').select('endpoint,user_id,p256dh,auth');
  if (onlyUser) subQ = subQ.eq('user_id', onlyUser);
  const { data: subs, error: subErr } = await subQ;
  if (subErr) return json({ error: subErr.message }, 500);
  if (!subs?.length) return json({ sent: 0, users: 0 });

  const userIds = [...new Set((subs as Sub[]).map(s => s.user_id))];
  const { data: tasks, error: taskErr } = await admin.from('tasks')
    .select('id,user_id,title,due,lead,repeat,done,created').in('user_id', userIds).eq('done', false);
  if (taskErr) return json({ error: taskErr.message }, 500);

  let sent = 0, removed = 0;
  const failures: string[] = [];
  for (const uid of userIds) {
    const s = summarize((tasks as Task[]).filter(t => t.user_id === uid));
    if (!s.total && fromCron) continue; // nothing to nag about on a quiet week
    const payload = JSON.stringify({ title: s.title, body: s.body, url: './#week', tag: 'weekly-digest' });
    for (const sub of (subs as Sub[]).filter(x => x.user_id === uid)) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 60 * 60 * 12, urgency: 'normal' });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) { await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); removed++; }
        else failures.push(`${code ?? ''} ${(e as Error).message}`.trim());
      }
    }
  }
  return json({ sent, removed, users: userIds.length, failures });
});
