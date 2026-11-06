// Live meeting captions + translation (EN/JA/KO). Speech recognition is the browser's own
// (Safari on iPhone/iPad, Chrome/Edge on PC), translation is Google's free web endpoint with
// MyMemory as fallback, or an Azure Translator free key. Lines stay on this device until
// "메모로 저장" copies them into a memo, where AI 리캡 can turn them into meeting notes.
import { $, el, btn, toast } from '../ui.js';
import { md, today, hhmm, newId } from '../dates.js';
import { normMemo, normEntry } from '../model.js';
import { memos, entries } from '../db.js';

const LOCALE = { en: 'en-US', ja: 'ja-JP', ko: 'ko-KR' };
const NAME = { en: 'EN', ja: 'JA', ko: 'KO' };
const ENTRY_MAX = 3800; // memo_entries.body is capped at 4000 chars

const KEY = 'wcp:translate:';
const load = (k, d) => { try { const v = localStorage.getItem(KEY + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch {} };

const cfg = Object.assign({ src: 'en', targets: ['ko'], engine: 'google', azKey: '', azRegion: '', pause: 1300, preview: true, wake: true, fs: 20 }, load('cfg', {}));
const saveCfg = () => save('cfg', cfg);
let lines = load('lines', []);          // {id, t, src, lang, tr:{ko:'..'|null|{err:1}}}
let session = load('session', { memoId: null, saved: 0 }); // memo this run was saved into, and how many lines
const saveLines = () => save('lines', lines.slice(-2000));
const saveSession = () => save('session', session);
const targets = () => cfg.targets.filter(l => l !== cfg.src);

let nav = () => {};
export const setTransNav = fn => { nav = fn; };

// ---------- translation ----------
const cache = new Map();
async function gtx(text, sl, tl) {
  const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${sl}&tl=${tl}&q=${encodeURIComponent(text)}`);
  if (!r.ok) throw new Error('google ' + r.status);
  return (await r.json())[0].map(x => x[0]).join('');
}
async function mymemory(text, sl, tl) {
  const r = await fetch(`https://api.mymemory.translated.net/get?langpair=${sl}|${tl}&q=${encodeURIComponent(text.slice(0, 480))}`);
  if (!r.ok) throw new Error('mymemory ' + r.status);
  const j = await r.json();
  if (String(j.responseStatus) !== '200') throw new Error('mymemory ' + j.responseStatus);
  return j.responseData.translatedText;
}
async function azure(text, sl, tls) {
  const h = { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': cfg.azKey };
  if (cfg.azRegion) h['Ocp-Apim-Subscription-Region'] = cfg.azRegion;
  const r = await fetch(`https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=${sl}${tls.map(l => '&to=' + l).join('')}`,
    { method: 'POST', headers: h, body: JSON.stringify([{ Text: text }]) });
  if (!r.ok) throw new Error('azure ' + r.status);
  const out = {};
  (await r.json())[0].translations.forEach(t => { out[t.to.split('-')[0]] = t.text; });
  return out;
}
async function translate(text, sl, tls) {
  const key = `${sl}|${tls}|${text}`;
  if (cache.has(key)) return cache.get(key);
  let out = {};
  if (cfg.engine === 'azure' && cfg.azKey) { try { out = await azure(text, sl, tls); } catch (e) { console.warn(e); } }
  await Promise.all(tls.filter(l => out[l] == null).map(async l => {
    try { out[l] = await gtx(text, sl, l); } catch (e) { console.warn(e); out[l] = await mymemory(text, sl, l); }
  }));
  cache.set(key, out);
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return out;
}

// ---------- rendering ----------
let logEl = null, interimEl = null, stick = true;
const scrollEnd = () => { if (logEl && stick) logEl.scrollTop = logEl.scrollHeight; };

function lineEl(it) {
  const box = el('div', 'lt-line'); box.id = 'lt-' + it.id;
  box.append(el('div', 'lt-meta', `${hhmm(new Date(it.t))} · ${NAME[it.lang]}`), el('div', 'lt-src', it.src));
  Object.entries(it.tr).forEach(([l, v]) => {
    const row = el('div', 'lt-tr' + (v === null ? ' pending' : v && v.err ? ' err' : ''));
    row.append(el('span', 'lt-tag', NAME[l]), document.createTextNode(v === null ? '번역 중…' : v && v.err ? '번역 실패 — 눌러서 다시 시도' : v));
    box.append(row);
  });
  if (Object.values(it.tr).some(v => v && v.err)) box.onclick = () => translateLine(it);
  return box;
}
function paintLine(it) {
  if (!logEl) return;
  const old = document.getElementById('lt-' + it.id), fresh = lineEl(it);
  if (old) old.replaceWith(fresh); else logEl.insertBefore(fresh, interimEl);
  $('#tlEmpty').hidden = true;
}
function setInterim(text, preview) {
  if (!interimEl) return;
  interimEl.textContent = '';
  interimEl.hidden = !text;
  if (!text) return;
  $('#tlEmpty').hidden = true;
  interimEl.append(el('div', 'lt-meta', '듣는 중…'), el('div', 'lt-src', text));
  if (preview) interimEl.append(el('div', 'lt-tr', preview));
  scrollEnd();
}
function paintStatus(text) { const s = $('#tlStatus'); if (s) s.textContent = text; }
const listeningText = () => `듣는 중 · ${NAME[cfg.src]} → ${targets().map(l => NAME[l]).join(', ') || '번역 없음'}`;

function paintSaveBtn() {
  const b = $('#tlSave'); if (!b) return;
  const fresh = lines.length - session.saved;
  b.disabled = !fresh;
  b.textContent = session.memoId && memos.get(session.memoId) ? (fresh ? `메모에 이어 저장 (${fresh})` : '메모에 저장됨') : '메모로 저장';
  $('#tlOpenMemo').hidden = !(session.memoId && memos.get(session.memoId));
}

export function renderTranslate() {
  // Controls reflect cfg; the log is built once and kept live while recognition runs.
  document.querySelectorAll('#tlSrc button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.lang === cfg.src)));
  document.querySelectorAll('#tlTargets input').forEach(i => { i.disabled = i.value === cfg.src; i.checked = targets().includes(i.value); });
  $('#view-translate').style.setProperty('--tl-fs', cfg.fs + 'px');
  if (!logEl) {
    logEl = $('#tlLog');
    interimEl = el('div', 'lt-line interim'); interimEl.hidden = true;
    logEl.append(interimEl);
    lines.forEach(paintLine);
    $('#tlEmpty').hidden = lines.length > 0;
    logEl.addEventListener('scroll', () => { stick = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 80; });
  }
  paintSaveBtn();
  if (!SR) paintStatus('이 브라우저는 음성 인식을 지원하지 않습니다. 아이폰·아이패드는 Safari, PC는 Chrome·Edge에서 열어 주세요.');
  requestAnimationFrame(() => { stick = true; scrollEnd(); });
}

// ---------- lines ----------
async function translateLine(it) {
  const tls = Object.keys(it.tr);
  if (!tls.length) return;
  tls.forEach(l => { it.tr[l] = null; }); paintLine(it);
  try {
    const out = await translate(it.src, it.lang, tls);
    tls.forEach(l => { it.tr[l] = out[l] ?? { err: 1 }; });
  } catch (e) { console.warn(e); tls.forEach(l => { if (it.tr[l] == null) it.tr[l] = { err: 1 }; }); }
  paintLine(it); saveLines(); scrollEnd();
}
function commit(text) {
  text = text.trim();
  if (!text) return;
  const it = { id: newId('t'), t: Date.now(), src: text, lang: cfg.src, tr: {} };
  targets().forEach(l => { it.tr[l] = null; });
  lines.push(it); saveLines(); paintLine(it); paintSaveBtn(); scrollEnd();
  translateLine(it);
}

// ---------- speech recognition ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, interim = '', silenceT, restartT, previewT = null, previewFor = '', previewText = '', wakeLock = null;

function finalizeInterim() {
  if (interim.trim()) commit(interim);
  interim = ''; previewFor = ''; previewText = '';
  setInterim('');
}
function schedulePreview() {
  if (!cfg.preview || previewT || !targets().length) return;
  previewT = setTimeout(async () => {
    previewT = null;
    const text = interim.trim();
    if (!text || text === previewFor || text.length < 12) return;
    previewFor = text;
    const tl = targets()[0];
    try {
      const out = await translate(text, cfg.src, [tl]);
      if (interim.trim().startsWith(text.slice(0, 10))) { previewText = out[tl]; setInterim(interim, previewText); }
    } catch {}
  }, 2000);
}
// Each recognizer gets a generation number; events from an older one are ignored, so a late
// onend can never spawn a second recognizer. A watchdog replaces a recognizer that went quiet
// (Safari sometimes stops without firing onend, or never fires onstart after a restart).
let gen = 0, lastAlive = 0, startedAt = 0, everStarted = false, deniedTries = 0, restarts = 0, lastHeard = 0, watchT = null;
const clock = t => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
function liveStatus() {
  if (!listening) return;
  paintStatus(listeningText() + (lastHeard ? ` · 마지막 인식 ${clock(lastHeard)}` : '') + (restarts ? ` · 재연결 ${restarts}회` : ''));
}
function makeRec(g) {
  const r = new SR();
  r.lang = LOCALE[cfg.src]; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
  const alive = () => { if (g === gen) lastAlive = Date.now(); };
  r.onstart = () => { if (g !== gen) return; alive(); everStarted = true; deniedTries = 0; liveStatus(); };
  r.onaudiostart = r.onsoundstart = r.onspeechstart = alive;
  r.onresult = e => {
    if (g !== gen) return;
    alive(); lastHeard = Date.now();
    let finals = '', live = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finals += t; else live += t;
    }
    if (finals.trim()) { commit(finals); previewFor = ''; previewText = ''; }
    interim = live;
    setInterim(interim, previewText);
    liveStatus();
    clearTimeout(silenceT);
    if (interim.trim()) {
      schedulePreview();
      // iPhone Safari rarely marks results final mid-stream: a pause closes the sentence instead.
      silenceT = setTimeout(() => { if (listening && g === gen) { finalizeInterim(); restart(150); } }, cfg.pause);
    }
  };
  r.onerror = e => {
    if (g !== gen) return;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      // Mid-meeting Safari sometimes reports this on an automatic restart; retry a few times first.
      if (everStarted && deniedTries < 3) { deniedTries++; restart(1000); return; }
      stop(); paintStatus('마이크·음성 인식이 막혔습니다. 듣기를 다시 눌러 주세요. 계속되면 브라우저 권한과 아이폰 설정 › Siri › 받아쓰기를 확인하세요.');
    } else if (e.error === 'language-not-supported') { stop(); paintStatus('이 기기에서 해당 언어 인식을 지원하지 않습니다.'); }
    else if (e.error === 'no-speech' || e.error === 'aborted') { /* onend restarts */ }
    else { console.warn("speech", e.error); restarts++; restart(800); }
  };
  r.onend = () => { if (g !== gen) return; if (interim.trim()) finalizeInterim(); if (listening) restart(150); };
  return r;
}
function restart(delay = 150) {
  if (!listening) return;
  const old = rec; rec = null; gen++;
  if (old) { old.onstart = old.onresult = old.onerror = old.onend = old.onaudiostart = old.onsoundstart = old.onspeechstart = null; try { old.abort(); } catch {} }
  clearTimeout(restartT); restartT = setTimeout(startRec, delay);
}
function startRec() {
  if (!listening || rec) return;
  const g = ++gen;
  startedAt = Date.now(); lastAlive = 0;
  try { rec = makeRec(g); rec.start(); }
  catch (e) { console.warn(e); rec = null; restartT = setTimeout(startRec, 600); }
}
function watchdog() {
  if (!listening || document.visibilityState !== 'visible') return;
  const now = Date.now();
  if (!rec) { if (now - startedAt > 3000) startRec(); return; }
  const neverStarted = !lastAlive && now - startedAt > 5000;   // start() swallowed silently
  const quiet = lastAlive && now - lastAlive > 10000;           // no audio events at all for 10s
  if (neverStarted || quiet) { if (interim.trim()) finalizeInterim(); restarts++; restart(100); }
}
async function requestWake() {
  if (!cfg.wake || !('wakeLock' in navigator)) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
}
function setMic(on) {
  const b = $('#tlMic');
  b.classList.toggle('on', on);
  b.setAttribute('aria-label', on ? '듣기 멈춤' : '듣기 시작');
  b.querySelector('span').textContent = on ? '멈춤' : '듣기';
  document.body.classList.toggle('lt-listening', on);
}
function start() {
  if (!SR) return;
  listening = true; everStarted = false; deniedTries = 0; restarts = 0; lastHeard = 0;
  setMic(true); paintStatus('마이크 준비 중…');
  requestWake(); startRec();
  clearInterval(watchT); watchT = setInterval(watchdog, 3000);
}
function stop() {
  listening = false;
  clearInterval(watchT); clearTimeout(silenceT); clearTimeout(restartT); clearTimeout(previewT); previewT = null;
  const old = rec; rec = null; gen++;
  if (old) { old.onstart = old.onresult = old.onerror = old.onend = null; try { old.stop(); } catch {} }
  finalizeInterim(); setMic(false); paintStatus('대기 중');
  try { wakeLock && wakeLock.release(); } catch {}
  wakeLock = null;
}
const restartIfListening = () => { if (listening) restart(150); };

// ---------- save to memo ----------
const lineText = it => {
  const tr = Object.entries(it.tr).filter(([, v]) => typeof v === 'string').map(([l, v]) => `  → ${NAME[l]} ${v}`).join('\n');
  return `[${hhmm(new Date(it.t))}] ${NAME[it.lang]} ${it.src}` + (tr ? '\n' + tr : '');
};
function saveToMemo() {
  const fresh = lines.slice(session.saved);
  if (!fresh.length) return;
  const now = new Date().toISOString();
  let m = session.memoId && memos.get(session.memoId);
  if (!m) {
    m = normMemo(newId('n'), { title: `${md(today())} 회의 (번역)`, createdAt: now, updatedAt: now });
    memos.put(m);
  }
  // Pack lines into entries under the 4000-char cap, one meeting line never split across two.
  const chunks = []; let cur = '';
  fresh.forEach(it => {
    const t = lineText(it).slice(0, ENTRY_MAX);
    if (cur && cur.length + t.length + 2 > ENTRY_MAX) { chunks.push(cur); cur = ''; }
    cur = cur ? cur + '\n\n' + t : t;
  });
  if (cur) chunks.push(cur);
  const base = Date.now();
  chunks.forEach((body, i) => entries.put(normEntry(newId('m'), { memoId: m.id, body, createdAt: new Date(base + i).toISOString() })));
  memos.put({ ...m, updatedAt: now });
  session = { memoId: m.id, saved: lines.length }; saveSession();
  paintSaveBtn();
  toast(`메모 "${m.title}"에 ${fresh.length}문장을 저장했습니다`);
}
function clearAll() {
  if (listening) stop();
  lines = []; session = { memoId: null, saved: 0 }; saveLines(); saveSession();
  logEl.querySelectorAll('.lt-line:not(.interim)').forEach(n => n.remove());
  $('#tlEmpty').hidden = false; paintSaveBtn();
}

// ---------- wiring ----------
export function wireTranslate() {
  $('#tlMic').addEventListener('click', () => (listening ? stop() : start()));
  document.querySelectorAll('#tlSrc button').forEach(b => b.addEventListener('click', () => {
    cfg.src = b.dataset.lang;
    if (!targets().length) cfg.targets = [cfg.src === 'ko' ? 'en' : 'ko'];
    saveCfg(); renderTranslate(); restartIfListening();
  }));
  document.querySelectorAll('#tlTargets input').forEach(i => i.addEventListener('change', () => {
    cfg.targets = [...document.querySelectorAll('#tlTargets input:checked')].map(x => x.value);
    saveCfg(); if (listening) paintStatus(listeningText());
  }));
  $('#tlFsUp').addEventListener('click', () => { cfg.fs = Math.min(44, cfg.fs + 2); saveCfg(); renderTranslate(); });
  $('#tlFsDown').addEventListener('click', () => { cfg.fs = Math.max(14, cfg.fs - 2); saveCfg(); renderTranslate(); });
  $('#tlSave').addEventListener('click', saveToMemo);
  $('#tlOpenMemo').addEventListener('click', () => nav('memos', { memo: session.memoId }));
  const clr = $('#tlClear'); let armed = 0;
  clr.addEventListener('click', () => {
    if (Date.now() - armed < 3000) { armed = 0; clr.textContent = '새 회의'; clr.classList.remove('armed'); clearAll(); return; }
    armed = Date.now(); clr.textContent = lines.length - session.saved > 0 ? '저장 안 한 문장도 지워요. 한 번 더' : '한 번 더 누르면 비움'; clr.classList.add('armed');
    setTimeout(() => { if (armed && Date.now() - armed >= 3000) { armed = 0; clr.textContent = '새 회의'; clr.classList.remove('armed'); } }, 3100);
  });

  // settings panel
  const f = id => $('#' + id);
  f('tlEngine').value = cfg.engine; f('tlAzKey').value = cfg.azKey; f('tlAzRegion').value = cfg.azRegion;
  f('tlPause').value = String(cfg.pause); f('tlPreview').checked = cfg.preview; f('tlWake').checked = cfg.wake;
  f('tlAzure').hidden = cfg.engine !== 'azure';
  const readSettings = () => {
    cfg.engine = f('tlEngine').value; cfg.azKey = f('tlAzKey').value.trim(); cfg.azRegion = f('tlAzRegion').value.trim();
    cfg.pause = +f('tlPause').value; cfg.preview = f('tlPreview').checked; cfg.wake = f('tlWake').checked;
    f('tlAzure').hidden = cfg.engine !== 'azure'; saveCfg();
  };
  ['tlEngine', 'tlPause', 'tlPreview', 'tlWake', 'tlAzKey', 'tlAzRegion'].forEach(id => f(id).addEventListener('change', readSettings));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && listening) { requestWake(); if (!rec) startRec(); }
  });
}
