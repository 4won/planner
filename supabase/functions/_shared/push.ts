// Shared by the push-sending functions: CORS, caller check, and Web Push delivery.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import webpush from 'npm:web-push@3.6.7';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export const adminClient = (): SupabaseClient =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

// Either pg_cron (shared secret header) or a signed-in user (their access token).
export async function caller(req: Request, admin: SupabaseClient): Promise<{ cron: boolean; userId: string | null } | null> {
  const secret = Deno.env.get('CRON_SECRET');
  if (secret && req.headers.get('x-cron-secret') === secret) return { cron: true, userId: null };
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error || !data.user ? null : { cron: false, userId: data.user.id };
}

export type Sub = { endpoint: string; user_id: string; p256dh: string; auth: string };

let vapidReady = false;
export async function sendPush(admin: SupabaseClient, subs: Sub[], payload: Record<string, unknown>) {
  if (!vapidReady) {
    webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);
    vapidReady = true;
  }
  let sent = 0, removed = 0;
  const failures: string[] = [];
  const body = JSON.stringify(payload);
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body, { TTL: 60 * 60 * 12, urgency: 'high' });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) { await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); removed++; }
      else failures.push(`${code ?? ''} ${(e as Error).message}`.trim());
    }
  }
  return { sent, removed, failures };
}

// ---- Seoul calendar math: dates as UTC midnights, wall times in minutes ----
export const DAY = 864e5;
export const DOW = ['일', '월', '화', '수', '목', '금', '토'];
export const parseDate = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
export const fmtDate = (t: number) => new Date(t).toISOString().slice(0, 10);
export const seoulToday = () => parseDate(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }));
export const weekStart = (t: number) => t - ((new Date(t).getUTCDay() + 6) % 7) * DAY;
export const md = (t: number) => { const d = new Date(t); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DOW[d.getUTCDay()]})`; };
// Epoch ms of a Seoul wall-clock moment.
export const seoulInstant = (date: string, time: string) => parseDate(date) + (+time.slice(0, 2) * 60 + +time.slice(3, 5)) * 60000 - 9 * 3600000;
