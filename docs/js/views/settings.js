// Settings sheet: account, push, install, calendar links, backup.
import { $, el, btn, option, armedDelete, copyText } from '../ui.js';
import { ymd, today, newId } from '../dates.js';
import { COLORS, normExtCal } from '../model.js';
import { CLOUD, sb, state, config, refresh } from '../store.js';
import { tasks, projects, groups, events, memos, entries, recaps, extCals, extEvents } from '../db.js';
import { normTask, normProject, normGroup, normEvent, normMemo, normEntry } from '../model.js';

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64ToBytes = s => { const p = '='.repeat((4 - s.length % 4) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, c => c.charCodeAt(0)); };

let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });

export async function currentSub() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

function section(title) { const s = el('div', 'set-sec'); s.append(el('h3', null, title)); return s; }
const msgEl = () => el('div', 'set-msg');
function say(m, text, err) { m.textContent = text; m.className = 'set-msg' + (err ? ' err' : ''); }

export function openSettings() {
  const d = $('#sheet'); d.textContent = '';
  const wrap = el('div', 'ed');
  wrap.append(el('h2', null, '설정'));

  // ---- account ----
  if (CLOUD) {
    const s = section('계정');
    s.append(el('p', null, state.email ? `${state.email} 로 로그인됨` : ''));
    const a = el('div', 'acts');
    a.append(btn('btn', '로그아웃', async () => {
      const sub = await currentSub().catch(() => null);
      if (sub) { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe().catch(() => {}); }
      d.close(); await sb.auth.signOut();
    }));
    s.append(a); wrap.append(s);
  }

  // ---- push ----
  if (CLOUD) {
    const s = section('알림');
    s.append(el('p', null, '일정 시작 전 알림과 매주 월요일 오전 8:30 체크리스트 요약을 이 기기로 보냅니다.'));
    const a = el('div', 'acts'); const m = msgEl();
    const on = btn('btn primary', '이 기기에서 알림 켜기'), off = btn('btn', '알림 끄기'), test = btn('btn', '테스트 알림 받기');
    a.append(on, off, test); s.append(a, m); wrap.append(s);
    const paint = async () => {
      on.hidden = off.hidden = test.hidden = true;
      if (isIOS && !standalone()) return say(m, 'iPhone은 먼저 Safari 공유 → ‘홈 화면에 추가’로 설치하고, 홈 화면 아이콘으로 연 다음 알림을 켤 수 있습니다.');
      if (!pushSupported()) return say(m, '이 브라우저는 푸시 알림을 지원하지 않습니다.');
      if (Notification.permission === 'denied') return say(m, '이 기기에서 알림이 차단되어 있습니다. 브라우저나 휴대폰 설정에서 이 앱의 알림을 허용해 주세요.', true);
      const sub = await currentSub();
      if (sub) { off.hidden = test.hidden = false; say(m, '이 기기에서 알림이 켜져 있습니다.'); } else { on.hidden = false; say(m, ''); }
    };
    on.addEventListener('click', async () => {
      try {
        say(m, '알림 권한을 요청하는 중…');
        if (await Notification.requestPermission() !== 'granted') { say(m, '알림 권한이 허용되지 않았습니다.', true); return paint(); }
        const reg = await navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(config.vapidPublicKey) });
        const j = sub.toJSON();
        const { error } = await sb.from('push_subscriptions').upsert({ endpoint: j.endpoint, user_id: state.uid, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200) });
        if (error) throw error;
        await paint(); say(m, '알림을 켰습니다. ‘테스트 알림 받기’로 확인해 보세요.');
      } catch (e) { say(m, `알림을 켜지 못했습니다: ${(e && e.message) || e}`, true); }
    });
    off.addEventListener('click', async () => {
      try { const sub = await currentSub(); if (sub) { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); } await paint(); say(m, '이 기기의 알림을 껐습니다.'); }
      catch (e) { say(m, `알림을 끄지 못했습니다: ${(e && e.message) || e}`, true); }
    });
    test.addEventListener('click', async () => {
      say(m, '테스트 알림을 보내는 중…');
      try {
        const { data, error } = await sb.functions.invoke('weekly-digest', { body: { test: true } });
        if (error) throw error;
        say(m, data && data.sent ? `보냈습니다 (${data.sent}대). 몇 초 안에 도착합니다.` : '보낼 기기를 찾지 못했습니다. 알림을 껐다가 다시 켜 보세요.', !(data && data.sent));
      } catch (e) { say(m, `테스트 알림을 보내지 못했습니다: ${(e && e.message) || e}`, true); }
    });
    paint();
  }

  // ---- calendars ----
  if (CLOUD) wrap.append(calendarSection());

  // ---- install ----
  {
    const s = section('앱으로 설치'); const p = el('p'); const a = el('div', 'acts');
    if (standalone()) p.textContent = '설치된 앱으로 실행 중입니다.';
    else if (installPrompt) { p.textContent = '이 기기에 앱으로 설치하면 아이콘으로 바로 열 수 있습니다.'; a.append(btn('btn', '이 기기에 설치', async () => { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; d.close(); })); }
    else if (isIOS) p.textContent = 'Safari 아래쪽의 공유 버튼 → ‘홈 화면에 추가’를 누르면 앱 아이콘이 생깁니다.';
    else p.textContent = 'Chrome·Edge 주소창 오른쪽의 설치 아이콘이나 브라우저 메뉴의 ‘앱 설치 / 홈 화면에 추가’를 누르세요.';
    s.append(p, a); wrap.append(s);
  }

  // ---- backup ----
  {
    const s = section('백업');
    s.append(el('p', null, '모든 업무·프로젝트·일정·메모를 JSON 파일로 내려받거나, 백업 파일에서 불러옵니다. 같은 항목은 파일 내용으로 덮어씁니다.'));
    const a = el('div', 'acts'); const m = msgEl();
    const file = el('input'); file.type = 'file'; file.accept = 'application/json,.json'; file.hidden = true;
    a.append(btn('btn', '내보내기', () => exportData(m)), btn('btn', '가져오기', () => file.click()), file);
    file.addEventListener('change', e => { const f = e.target.files[0]; if (f) importData(f, m); e.target.value = ''; });
    s.append(a, m); wrap.append(s);
  }

  const acts = el('div', 'ed-actions'); acts.append(el('span', 'spacer'), btn('btn', '닫기', () => d.close())); wrap.append(acts);
  d.append(wrap);
  if (!d.open) d.showModal();
}

// ---------- calendar links ----------
function calendarSection() {
  const s = section('구글 · 애플 캘린더');

  // export feed
  s.append(el('h4', null, '이 앱 일정을 내 캘린더에 보이게 하기'));
  s.append(el('p', 'set-small', '아래 구독 주소를 구글 캘린더나 아이폰 캘린더에 추가하면, 이 앱의 일정과 업무 마감이 그쪽에도 보입니다. 구글은 몇 시간 간격으로 새로 읽어 와서 반영이 늦을 수 있습니다.'));
  const feedBox = el('div', 'feed'); const fm = msgEl();
  s.append(feedBox, fm);
  const paintFeed = async () => {
    feedBox.textContent = '';
    const { data, error } = await sb.from('calendar_feeds').select('token').maybeSingle();
    if (error) return say(fm, `구독 주소를 불러오지 못했습니다: ${error.message}`, true);
    if (!data) { feedBox.append(btn('btn', '구독 주소 만들기', () => makeToken())); return; }
    const url = `${config.supabaseUrl}/functions/v1/calendar-feed?token=${data.token}`;
    const box = el('input', 'feed-url'); box.readOnly = true; box.value = url; box.setAttribute('aria-label', '구독 주소');
    box.addEventListener('focus', () => box.select());
    const a = el('div', 'acts');
    a.append(btn('btn', '주소 복사', ev => copyText(url, ev.currentTarget)));
    const link = el('a', 'btn'); link.href = url.replace(/^https:/, 'webcal:'); link.textContent = '아이폰·맥에서 바로 구독';
    a.append(link);
    const regen = btn('btn ghost', '주소 새로 만들기'); armedDelete(regen, () => makeToken(), '주소 새로 만들기');
    a.append(regen);
    feedBox.append(box, a);
    const how = el('details', 'how'); how.append(el('summary', null, '추가하는 방법'));
    const ol = el('ol');
    ['구글: PC에서 calendar.google.com → 왼쪽 ‘다른 캘린더’ 옆 + → ‘URL로 추가’ → 주소 붙여 넣기',
      '아이폰: 설정 → 캘린더 → 계정 → 계정 추가 → 기타 → ‘구독 캘린더 추가’ → 주소 붙여 넣기 (또는 위의 ‘바로 구독’)',
      '주소를 아는 사람은 일정을 볼 수 있으니 다른 사람과 공유하지 마세요. 유출되면 ‘주소 새로 만들기’를 누르세요.'].forEach(t => ol.append(el('li', null, t)));
    how.append(ol); feedBox.append(how);
  };
  const makeToken = async () => {
    const token = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');
    const { error } = await sb.from('calendar_feeds').upsert({ user_id: state.uid, token });
    if (error) say(fm, `주소를 만들지 못했습니다: ${error.message}`, true); else { say(fm, '새 구독 주소를 만들었습니다. 예전 주소는 더 이상 동작하지 않습니다.'); paintFeed(); }
  };
  paintFeed();

  // import calendars
  s.append(el('h4', null, '구글·애플 일정을 이 앱에서 보기'));
  s.append(el('p', 'set-small', '캘린더의 iCal 주소를 넣으면 15분마다 가져와 캘린더와 이번 주 화면에 함께 보여 줍니다. 가져온 일정은 읽기 전용입니다.'));
  const list = el('div', 'cal-list'); const im = msgEl();
  const paintList = () => {
    list.textContent = '';
    extCals.all().forEach(c => {
      const row = el('div', 'cal-row');
      const info = el('div', 'cal-info');
      const n = el('div', 'cal-name'); n.append(el('span', 'dot c-' + c.color), el('span', null, c.name)); info.append(n);
      const cnt = extEvents.all().filter(e => e.calendarId === c.id).length;
      info.append(el('div', 'set-small', c.lastError ? `오류: ${c.lastError}` : c.lastSyncedAt ? `${new Date(c.lastSyncedAt).toLocaleString('ko-KR')} 동기화 · 일정 ${cnt}개` : '아직 동기화 전'));
      row.append(info);
      const del = btn('linkbtn danger', '삭제'); armedDelete(del, () => {
        extEvents.all().filter(e => e.calendarId === c.id).forEach(e => extEvents.remove(e.id));
        extCals.remove(c.id); paintList();
      });
      row.append(del);
      list.append(row);
    });
    if (!extCals.all().length) list.append(el('p', 'set-small', '연결된 캘린더가 없습니다.'));
  };
  paintList();
  s.append(list);

  const form = el('form', 'cal-add');
  const name = el('input'); name.type = 'text'; name.placeholder = '이름 (예: 회사 구글)'; name.maxLength = 60; name.setAttribute('aria-label', '캘린더 이름');
  const url = el('input'); url.type = 'url'; url.placeholder = 'https://… 또는 webcal://… (.ics)'; url.setAttribute('aria-label', 'iCal 주소');
  const color = el('select'); color.setAttribute('aria-label', '색');
  [['slate', '회청'], ['teal', '청록'], ['amber', '호박'], ['rose', '장미'], ['violet', '보라']].forEach(([v, l]) => color.append(option(v, l)));
  const add = el('button', 'btn', '추가'); add.type = 'submit';
  form.append(name, url, color, add);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const u = url.value.trim().replace(/^webcal:/i, 'https:');
    if (!/^https:\/\/\S+$/i.test(u)) return say(im, 'https:// 또는 webcal:// 로 시작하는 iCal 주소를 넣어 주세요.', true);
    const c = normExtCal(newId('c'), { name: name.value.trim() || '외부 캘린더', url: u, color: color.value });
    extCals.put(c); name.value = url.value = ''; paintList();
    await syncNow(c.id, im); paintList();
  });
  s.append(form);
  const syncAll = btn('btn ghost', '지금 동기화', async () => { await syncNow(null, im); paintList(); });
  if (extCals.all().length) s.append(syncAll);
  s.append(im);

  const how = el('details', 'how'); how.append(el('summary', null, 'iCal 주소 찾는 방법'));
  const ol = el('ol');
  ['구글: PC에서 calendar.google.com → 톱니바퀴 → 설정 → 왼쪽에서 캘린더 선택 → ‘캘린더 통합’ → ‘iCal 형식의 비공개 주소’ 복사. 회사 계정은 관리자가 막아 두어 보이지 않을 수 있습니다.',
    '애플(iCloud): 아이폰 캘린더 앱 → 아래 ‘캘린더’ → 캘린더 옆 ⓘ → ‘공개 캘린더’ 켜기 → ‘링크 공유’로 주소 복사. 주소를 아는 사람은 누구나 볼 수 있으니 주의하세요.'].forEach(t => ol.append(el('li', null, t)));
  how.append(ol); s.append(how);
  return s;
}

async function syncNow(calendarId, m) {
  say(m, '캘린더를 가져오는 중…');
  try {
    // Push any just-added calendar to the server before asking it to sync.
    const { flush } = await import('../store.js'); await flush();
    const { data, error } = await sb.functions.invoke('calendar-sync', { body: calendarId ? { calendarId } : {} });
    if (error) throw error;
    await refresh();
    const failed = (data && data.results || []).filter(r => r.error);
    say(m, failed.length ? `일부 캘린더를 가져오지 못했습니다: ${failed.map(f => f.error).join(', ')}` : `가져왔습니다 (일정 ${data ? data.events : 0}개).`, !!failed.length);
  } catch (e) { say(m, `가져오지 못했습니다: ${(e && e.message) || e}`, true); }
}

// ---------- backup ----------
function exportData(m) {
  const data = {
    app: 'weekly-check-planner', version: 2, exported: new Date().toISOString(),
    items: tasks.all(), projects: projects.all(), groups: groups.all(), events: events.all(), memos: memos.all(), entries: entries.all(), recaps: recaps.all(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `플래너-백업-${ymd(today())}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  say(m, `업무 ${data.items.length} · 일정 ${data.events.length} · 메모 ${data.memos.length}개를 내보냈습니다.`);
}
async function importData(file, m) {
  try {
    const parsed = JSON.parse(await file.text());
    const take = (list, coll, norm, idPrefix) => {
      let n = 0;
      (Array.isArray(list) ? list : []).forEach(o => {
        if (!o || typeof o !== 'object') return;
        const src = o.data && typeof o.data === 'object' ? o.data : o; // Claude artifact rows wrap the body in `data`
        const id = typeof o.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(o.id) ? o.id : (typeof o.doc_id === 'string' ? o.doc_id : newId(idPrefix));
        coll.put(norm(id, src)); n++;
      });
      return n;
    };
    const items = Array.isArray(parsed) ? parsed : parsed.items;
    const n = take(items, tasks, normTask, 't') + take(parsed.projects, projects, normProject, 'p') + take(parsed.groups, groups, normGroup, 'g')
      + take(parsed.events, events, normEvent, 'e') + take(parsed.memos, memos, normMemo, 'n') + take(parsed.entries, entries, normEntry, 'm');
    if (!n) throw new Error('불러올 항목을 찾지 못했습니다');
    say(m, `${n}개 항목을 불러왔습니다.`);
  } catch (e) { say(m, `불러오지 못했습니다: ${e.message}`, true); }
}
export { COLORS };
