import { $, $$, showBanner, hideBanner } from './ui.js';
import { CLOUD, sb, state, onChange, startLocal, startSession, stopSession, refresh, flush, pendingCount } from './store.js';
import './db.js';
import { setNavigator, openAdd } from './editors.js';
import { renderHome, wireHome, rollWeekIfNeeded } from './views/home.js';
import { renderCalendar, wireCalendar } from './views/calendar.js';
import { renderProjects, wireProjects } from './views/projects.js';
import { renderMemos, wireMemos, memoState, newMemo } from './views/memos.js';
import { openSettings } from './views/settings.js';

const VIEWS = ['home', 'calendar', 'projects', 'memos'];
let view = 'home';

function setView(v, opts = {}) {
  view = VIEWS.includes(v) ? v : 'home';
  history.replaceState(null, '', '#' + view);
  if (view === 'memos' && opts.newMemo) { render(); newMemo(); return; }
  render();
  window.scrollTo(0, 0);
}

function render() {
  if ($('#main').hidden) return;
  $$('[data-view]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === view)));
  VIEWS.forEach(v => { $('#view-' + v).hidden = v !== view; });
  document.body.dataset.view = view;
  if (view === 'home') renderHome();
  else if (view === 'calendar') renderCalendar();
  else if (view === 'projects') renderProjects();
  else renderMemos();
  updateSync();
}

function updateSync() {
  const dot = $('#syncDot'), note = $('#syncNote');
  if (!CLOUD) { dot.className = 'sync-dot'; note.textContent = '이 기기에만 저장됩니다'; return; }
  if (!state.uid) return;
  const n = pendingCount();
  if (state.syncError) { dot.className = 'sync-dot err'; note.textContent = `동기화 오류 · 변경 ${n}건 대기`; }
  else if (!navigator.onLine) { dot.className = 'sync-dot wait'; note.textContent = n ? `오프라인 · 변경 ${n}건은 연결되면 저장` : '오프라인 · 저장된 내용 표시 중'; }
  else if (n || state.flushing) { dot.className = 'sync-dot wait'; note.textContent = '저장 중…'; }
  else { dot.className = 'sync-dot ok'; note.textContent = '동기화됨'; }
  if (state.syncError) showBanner(`서버에 저장하지 못했습니다: ${state.syncError}. 연결이 돌아오면 다시 시도합니다.`, true, 'sync');
  else hideBanner('sync');
}

// ---------- auth ----------
const AUTH_ERRORS = [
  [/invalid login credentials/i, '이메일 또는 비밀번호가 맞지 않습니다.'],
  [/email not confirmed/i, '메일 인증이 아직 안 됐습니다. 받은 메일의 링크를 누른 뒤 다시 로그인하세요.'],
  [/signups? not allowed|signup is disabled/i, '새 가입이 막혀 있습니다. 기존 계정으로 로그인하세요.'],
  [/already registered/i, '이미 가입된 이메일입니다. 로그인하세요.'],
  [/password should be at least/i, '비밀번호는 8자 이상이어야 합니다.'],
  [/rate limit/i, '시도가 너무 많습니다. 잠시 후 다시 해 주세요.'],
];
const authErr = e => { const m = (e && e.message) || ''; const hit = AUTH_ERRORS.find(([re]) => re.test(m)); return hit ? hit[1] : `로그인하지 못했습니다: ${m}`; };
async function onAuth(mode) {
  const email = $('#a-email').value.trim(), password = $('#a-pw').value, msg = $('#authMsg');
  msg.className = 'auth-msg err';
  if (!email || !email.includes('@')) { msg.textContent = '이메일을 입력하세요.'; return; }
  if (password.length < 8) { msg.textContent = '비밀번호는 8자 이상이어야 합니다.'; return; }
  msg.className = 'auth-msg'; msg.textContent = mode === 'signup' ? '가입하는 중…' : '로그인하는 중…';
  $('#authLogin').disabled = $('#authSignup').disabled = true;
  try {
    const res = mode === 'signup'
      ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } })
      : await sb.auth.signInWithPassword({ email, password });
    if (res.error) { msg.className = 'auth-msg err'; msg.textContent = authErr(res.error); }
    else if (mode === 'signup' && !res.data.session) msg.textContent = '확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 여기서 로그인하세요.';
    else msg.textContent = '';
  } catch (e) { msg.className = 'auth-msg err'; msg.textContent = '서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.'; }
  finally { $('#authLogin').disabled = $('#authSignup').disabled = false; }
}
const showAuth = () => { $('#main').hidden = true; $('#auth').hidden = false; };
const showMain = () => { $('#auth').hidden = true; $('#main').hidden = false; };

// ---------- boot ----------
function wire() {
  $$('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#addBtn').addEventListener('click', () => openAdd());
  $('#setBtn').addEventListener('click', openSettings);
  $('#authForm').addEventListener('submit', e => { e.preventDefault(); onAuth('login'); });
  $('#authSignup').addEventListener('click', () => onAuth('signup'));
  wireHome(); wireCalendar(); wireProjects(); wireMemos();
  setNavigator(setView);
  onChange(render);
  window.addEventListener('planner:render', render);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    rollWeekIfNeeded();
    refresh().then(flush); render();
  });
}

function boot() {
  const h = (location.hash || '').slice(1);
  if (h === 'week') view = 'home'; else if (VIEWS.includes(h)) view = h;
  wire();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!CLOUD) { showMain(); startLocal(); return; }
  sb.auth.onAuthStateChange((event, session) => {
    // Defer: calling other supabase methods inside this callback can deadlock.
    setTimeout(() => {
      const user = session && session.user;
      if (user) { if (user.id !== state.uid) { showMain(); startSession(user); } }
      else { stopSession(); showAuth(); }
    }, 0);
  });
}

boot();
export { memoState };
