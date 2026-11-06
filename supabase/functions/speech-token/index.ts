// Live translation tab, "Azure 화자 구분" mode: trades the Azure Speech key (secret
// AZURE_SPEECH_KEY, region AZURE_SPEECH_REGION) for a 10-minute authorization token, so the key
// never reaches the browser. Only signed-in users listed in SPEECH_USER_IDS (comma separated)
// may ask, when that secret is set. The F0 (free) resource stops at its monthly 5 audio hours.
import { CORS, json, adminClient, caller } from '../_shared/push.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const who = await caller(req, adminClient());
  if (!who?.userId) return json({ error: '로그인이 필요합니다.' }, 401);
  const allowed = (Deno.env.get('SPEECH_USER_IDS') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(who.userId)) return json({ error: '이 계정은 Azure 음성 인식을 쓸 수 없습니다.' }, 403);
  const key = Deno.env.get('AZURE_SPEECH_KEY'), region = Deno.env.get('AZURE_SPEECH_REGION');
  if (!key || !region) return json({ error: 'Azure 음성 키가 서버에 아직 등록되지 않았습니다.', setup: true }, 503);

  const r = await fetch(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
    method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Length': '0' },
  });
  if (!r.ok) return json({ error: `Azure 토큰 발급 실패 (${r.status}). 키와 지역을 확인하세요.` }, 502);
  return json({ token: await r.text(), region, expiresIn: 540 });
});
