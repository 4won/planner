// Desktop wallpaper widget (widget.html?token=…): clock, weather, today's schedule,
// this week's checklist and the next few days. Read-only; refreshes itself.
// Options in the address: side=left|right, theme=dark|light, scale=0.8~1.6, bg=none
import { ymd, parse, addDays, today, weekStart, DOW, pad, ddayText, nowTime } from './dates.js';
import { normTask, normEvent, normExtEvent, weekRole, isCheckedIn, eventsOn, eventTimeText, occurrences, byDue } from './model.js';
import { HOME_PLACE, WMO, ICONS, weatherUrl, compareYesterday, todayTip } from './weather.js';

const q = new URLSearchParams(location.search);
const token = (q.get('token') || '').trim();
const root = document.documentElement;
root.dataset.side = q.get('side') === 'left' ? 'left' : 'right';
root.dataset.theme = q.get('theme') === 'light' ? 'light' : 'dark';
if (q.get('bg') === 'none') root.dataset.bg = 'none';
const scale = Math.min(1.6, Math.max(0.8, Number(q.get('scale')) || 1));
root.style.setProperty('--scale', scale);

const DATA_EVERY = 5 * 60000, WEATHER_EVERY = 30 * 60000;
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const svg = k => { const s = el('span'); s.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[k] || ICONS.cloud}</svg>`; return s; };

// snake_case rows from the server → the app's camelCase records
const camel = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]));
const timeOk = t => typeof t === 'string' ? t.slice(0, 5) : t;

let data = lsGet('wcp:widget');       // { at, tasks, events, ext } (already camelCase)
let weather = lsGet('wcp:widget-wx'); // { at, cur, hourly, daily }
let lastError = '';

async function loadData() {
  const base = (window.PLANNER_CONFIG || {}).supabaseUrl;
  if (!base || !token) return;
  try {
    const r = await fetch(`${base}/functions/v1/widget-data?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
    if (r.status === 404) throw new Error('주소가 맞지 않습니다. 앱 설정에서 위젯 주소를 다시 복사해 주세요.');
    if (!r.ok) throw new Error(`서버 응답 ${r.status}`);
    const j = await r.json();
    const colorOf = Object.fromEntries((j.externalCalendars || []).map(c => [c.id, c.color]));
    data = {
      at: Date.now(),
      tasks: j.tasks.map(camel),
      events: j.events.map(camel).map(e => ({ ...e, startTime: timeOk(e.startTime), endTime: timeOk(e.endTime) })),
      ext: j.externalEvents.map(camel).map(e => ({ ...e, color: colorOf[e.calendarId] || 'slate' })),
    };
    lsSet('wcp:widget', data);
    lastError = '';
  } catch (e) { lastError = e.message || '연결할 수 없습니다'; }
  render();
}

async function loadWeather() {
  if (weather && Date.now() - weather.at < WEATHER_EVERY - 60000) return;
  try {
    const r = await fetch(weatherUrl(HOME_PLACE)); if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    weather = { at: Date.now(), cur: j.current, hourly: j.hourly, daily: j.daily };
    lsSet('wcp:widget-wx', weather);
  } catch (e) { /* keep the last forecast */ }
  renderWeather();
}

// ---------- drawing ----------
function renderClock() {
  const n = new Date();
  $('wgTime').textContent = `${pad(n.getHours())}:${pad(n.getMinutes())}`;
  $('wgDate').textContent = `${n.getMonth() + 1}월 ${n.getDate()}일 ${DOW[n.getDay()]}요일`;
}

function renderWeather() {
  const box = $('wgWeather'); box.textContent = '';
  const w = weather;
  if (!w || !w.cur || !w.daily) { box.append(el('div', 'wg-empty', '날씨를 불러오는 중…')); return; }
  const [label, key] = WMO(w.cur.weather_code);
  const ic = svg(key); ic.className = 'wg-wicon'; box.append(ic);
  const di = w.daily.time.indexOf(ymd(today()));
  const temp = el('div', 'wg-temp', `${Math.round(w.cur.temperature_2m)}°`);
  if (di >= 0) temp.append(el('small', null, `최고 ${Math.round(w.daily.temperature_2m_max[di])}° · 최저 ${Math.round(w.daily.temperature_2m_min[di])}°`));
  box.append(temp);
  const cmp = compareYesterday(w), line = el('div', 'wg-cmp');
  if (cmp) line.append(el('b', cmp.cls, cmp.text), ` · ${label}`); else line.textContent = `${HOME_PLACE.label} · ${label}`;
  box.append(line);
  if (di >= 0) {
    const tip = todayTip(w), t = el('div', 'wg-tip');
    t.append(svg(tip.key), el('span', null, tip.text));
    box.append(t);
  }
}

function eventRowEl(e, dayStr, nowStr) {
  const r = el('div', 'wg-row');
  if (dayStr && nowStr && e.startTime && e.startDate === dayStr) {
    const end = e.endDate === dayStr ? e.endTime : '24:00';
    if (end ? end <= nowStr : e.startTime < nowStr) r.classList.add('past');
    else if (e.startTime <= nowStr) r.classList.add('now');
  }
  const dot = el('span', 'wg-dot c-' + (e.color || 'violet'));
  r.append(el('span', 'wg-t', eventTimeText(e, dayStr)), dot, el('span', 'wg-title', e.title));
  if (e.location) r.append(el('span', 'wg-sub', e.location));
  r.title = e.title;
  return r;
}

function eventsIn(from, to) {
  if (!data) return [];
  const own = data.events.map(d => normEvent(d.id, d)).flatMap(e => occurrences(e, from, to));
  const ext = data.ext.map(d => ({ ...normExtEvent(d.id, d), color: d.color }));
  return [...own, ...ext.filter(e => e.endDate >= from && e.startDate <= to)];
}

function render() {
  renderClock();
  const t = today(), tStr = ymd(t), W = weekStart(t), nowStr = nowTime();

  // today
  const td = $('wgToday'); td.textContent = '';
  if (!data) td.append(el('div', 'wg-empty', token ? '불러오는 중…' : ''));
  else {
    const evs = eventsOn(eventsIn(tStr, tStr), tStr);
    if (!evs.length) td.append(el('div', 'wg-empty', '오늘은 일정이 없습니다.'));
    const MAX = 6;
    evs.slice(0, MAX).forEach(e => td.append(eventRowEl(e, tStr, nowStr)));
    if (evs.length > MAX) td.append(el('div', 'wg-more', `외 ${evs.length - MAX}개`));
  }

  // this week
  const wk = $('wgWeek'); wk.textContent = '';
  if (data) {
    const groups = { overdue: [], due: [], ahead: [], nodue: [], done: [] };
    data.tasks.map(d => normTask(d.id, d)).forEach(it => { const r = weekRole(it, W); if (r) groups[r].push(it); });
    const active = [...groups.overdue, ...groups.due, ...groups.ahead, ...groups.nodue];
    const checked = active.filter(it => isCheckedIn(it, W)).length + groups.done.length;
    const total = active.length + groups.done.length;
    $('wgWeekCount').textContent = total ? `${checked} / ${total}` : '';
    $('wgWeekBar').style.width = total ? `${Math.round(checked / total * 100)}%` : '0%';
    const MAX = 8; let shown = 0, left = 0;
    [['overdue', '기한 지남'], ['due', '이번 주 마감'], ['ahead', '미리 챙길 일']].forEach(([k, label]) => {
      const list = groups[k].filter(it => !isCheckedIn(it, W)).sort(byDue);
      if (!list.length) return;
      const room = MAX - shown;
      if (room <= 0) { left += list.length; return; }
      wk.append(el('div', 'wg-sec', label));
      list.slice(0, room).forEach(it => {
        const r = el('div', 'wg-row'); r.title = it.title;
        const dd = it.due ? ddayText(it.due) : null;
        r.append(el('span', 'wg-dot c-' + it.color), el('span', 'wg-title', it.title),
          el('span', 'wg-dd' + (k === 'overdue' ? ' late' : k === 'due' ? ' due' : ''), dd ? dd.text : ''));
        wk.append(r); shown++;
      });
      left += Math.max(0, list.length - room);
    });
    const nodue = groups.nodue.filter(it => !isCheckedIn(it, W)).length;
    if (!shown) wk.append(el('div', 'wg-empty', total ? '급한 일은 모두 챙겼습니다.' : '이번 주 체크리스트가 비어 있습니다.'));
    const extra = [left && `외 ${left}개`, nodue && `기한 없는 일 ${nodue}개`].filter(Boolean).join(' · ');
    if (extra) wk.append(el('div', 'wg-more', extra));
  }

  // next days
  const nx = $('wgNext'); nx.textContent = '';
  if (data) {
    const MAX = 6; let n = 0;
    for (let i = 1; i <= 7 && n < MAX; i++) {
      const d = addDays(t, i), ds = ymd(d);
      const evs = eventsOn(eventsIn(ds, ds), ds).filter(e => e.startDate === ds || i === 1);
      if (!evs.length) continue;
      nx.append(el('div', 'wg-day', `${i === 1 ? '내일' : i === 2 ? '모레' : `${d.getMonth() + 1}/${d.getDate()}`} ${DOW[d.getDay()]}`));
      evs.slice(0, MAX - n).forEach(e => { nx.append(eventRowEl(e, ds)); n++; });
    }
    if (!n) nx.append(el('div', 'wg-empty', '일주일 안에 다른 일정이 없습니다.'));
  }

  // footer
  const f = $('wgFoot');
  const at = data && data.at ? new Date(data.at) : null;
  const when = at ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : '';
  f.className = 'wg-foot' + (lastError ? ' err' : '');
  f.textContent = lastError ? `${lastError}${when ? ` · 마지막 업데이트 ${when}` : ''}` : when ? `${when} 업데이트 · 5분마다 새로 고침` : '';
}

// ---------- start ----------
if (!token) {
  document.body.textContent = '';
  const s = el('div', 'wg-setup'), box = el('div');
  box.append(el('h1', null, '위젯 주소가 필요합니다'), el('p', null, '플래너 앱의 설정 → 바탕화면 위젯에서 주소를 복사해 이 주소 대신 넣어 주세요.'));
  s.append(box); document.body.append(s);
} else {
  render(); renderWeather();
  loadData(); loadWeather();
  setInterval(loadData, DATA_EVERY);
  setInterval(loadWeather, 5 * 60000);
  let lastDay = ymd(today()), lastMin = '';
  setInterval(() => {
    const m = nowTime();
    if (m === lastMin) return;
    lastMin = m;
    if (ymd(today()) !== lastDay) { lastDay = ymd(today()); loadData(); loadWeather(); }
    render();
  }, 5000);
  window.addEventListener('online', () => { loadData(); loadWeather(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && data && Date.now() - data.at > 60000) loadData(); });
}
