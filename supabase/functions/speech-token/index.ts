// Live translation tab, "Azure 화자 구분" mode. Keeps the Azure Speech key (secret
// AZURE_SPEECH_KEY, region AZURE_SPEECH_REGION) on the server and enforces a monthly cap.
//   { action: 'token' }            -> { token, region, usedSec, limitSec } or { exhausted: true, ... }
//   { action: 'usage', seconds }   -> adds listening time, -> { usedSec, limitSec, exhausted }
// Usage is wall-clock time with the microphone streaming to Azure, counted per user per UTC month
// in speech_usage; at SPEECH_LIMIT_SEC (default 5 h, the free F0 allowance) no more tokens are
// issued and the app falls back to the browser's own recognizer. Only users listed in
// SPEECH_USER_IDS (comma separated) may ask, when that secret is set.
import { CORS, json, adminClient, caller } from '../_shared/push.ts';

const LIMIT = Number(Deno.env.get('SPEECH_LIMIT_SEC')) || 5 * 3600;
const month = () => new Date().toISOString().slice(0, 7);

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const admin = adminClient();
  const who = await caller(req, admin);
  if (!who?.userId) return json({ error: '로그인이 필요합니다.' }, 401);
  const allowed = (Deno.env.get('SPEECH_USER_IDS') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(who.userId)) return json({ error: '이 계정은 Azure 음성 인식을 쓸 수 없습니다.' }, 403);

  const body = await req.json().catch(() => ({})) as { action?: string; seconds?: number };
  // Report at most two minutes per call, so a stuck client can't burn the month at once.
  const add = body.action === 'usage' ? Math.max(0, Math.min(120, Math.round(Number(body.seconds) || 0))) : 0;
  const { data: used, error } = await admin.rpc('add_speech_usage', { p_user: who.userId, p_month: month(), p_seconds: add });
  if (error) return json({ error: '사용량을 확인하지 못했습니다: ' + error.message }, 500);
  const usedSec = Number(used) || 0;
  const state = { usedSec, limitSec: LIMIT, exhausted: usedSec >= LIMIT };
  if (body.action === 'usage' || state.exhausted) return json(state);

  const key = Deno.env.get('AZURE_SPEECH_KEY'), region = Deno.env.get('AZURE_SPEECH_REGION');
  if (!key || !region) return json({ error: 'Azure 음성 키가 서버에 아직 등록되지 않았습니다.', setup: true, ...state }, 503);
  const r = await fetch(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
    method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Length': '0' },
  });
  if (!r.ok) return json({ error: `Azure 토큰 발급 실패 (${r.status}). 키와 지역을 확인하세요.`, ...state }, 502);
  return json({ token: await r.text(), region, ...state });
});
