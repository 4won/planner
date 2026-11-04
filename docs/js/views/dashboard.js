// 홈: today at a glance — weather, today's schedule, this week's checklist progress,
// upcoming deadlines, project progress, and recap suggestions waiting for review.
import { $, el, btn, ddayEl } from '../ui.js';
import { ymd, parse, addDays, today, weekStart, md, mdLong, DOW } from '../dates.js';
import { weekRole, isCheckedIn, eventsOn, byDue } from '../model.js';
import { tasks, recaps, memos, activeProjects, allEvents } from '../db.js';
import { state } from '../store.js';
import { openTask } from '../editors.js';
import { eventRow, taskRow } from './common.js';
import { battery } from './projects.js';

let nav = () => {};
export const setDashNav = fn => { nav = fn; };
const rerender = () => window.dispatchEvent(new Event('planner:render'));

// ---------- weather (Open-Meteo, no key) ----------
const lsGet = (k, f) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch (e) { return f; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const SEOUL = { lat: 37.5665, lon: 126.978, label: '서울' };
let weather = lsGet('wcp:weather', null);
let loadingWeather = false;
const WMO = c => c === 0 ? ['맑음', 'sun'] : c <= 2 ? ['구름 조금', 'partly'] : c === 3 ? ['흐림', 'cloud'] : c <= 48 ? ['안개', 'fog'] : c <= 57 ? ['이슬비', 'rain'] : c <= 67 ? ['비', 'rain'] : c <= 77 ? ['눈', 'snow'] : c <= 82 ? ['소나기', 'rain'] : c <= 86 ? ['눈', 'snow'] : ['뇌우', 'storm'];
const ICONS = {
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  partly: '<circle cx="9" cy="9" r="3.5"/><path d="M9 2.5v1.5M2.5 9H4M4.4 4.4l1 1M13.6 4.4l-1 1"/><path d="M8 19h9a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.5 1.5A2.8 2.8 0 0 0 8 19z"/>',
  cloud: '<path d="M7 18.5h10a4 4 0 0 0 .3-8 6 6 0 0 0-11.6 1.6A3.3 3.3 0 0 0 7 18.5z"/>',
  fog: '<path d="M4 9h16M3 13h18M5 17h14"/>',
  rain: '<path d="M7 14.5h10a3.8 3.8 0 0 0 .3-7.6 5.6 5.6 0 0 0-10.9 1.5A3.1 3.1 0 0 0 7 14.5z"/><path d="M8 17.5l-1 3M12 17.5l-1 3M16 17.5l-1 3"/>',
  snow: '<path d="M7 14h10a3.8 3.8 0 0 0 .3-7.6 5.6 5.6 0 0 0-10.9 1.5A3.1 3.1 0 0 0 7 14z"/><path d="M8 18h.01M12 20h.01M16 18h.01M10 21.5h.01M14 21.5h.01"/>',
  storm: '<path d="M7 14h10a3.8 3.8 0 0 0 .3-7.6 5.6 5.6 0 0 0-10.9 1.5A3.1 3.1 0 0 0 7 14z"/><path d="M12.5 15l-2.5 4h3l-2 3.5"/>',
};
const icon = (k, cls = 'wx-icon') => { const s = el('span', cls); s.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[k] || ICONS.cloud}</svg>`; return s; };

async function loadWeather(force) {
  const place = lsGet('wcp:place', SEOUL);
  if (!force && weather && weather.place === place.label && Date.now() - weather.at < 30 * 60000) return;
  if (loadingWeather || !navigator.onLine) return;
  loadingWeather = true;
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&current=temperature_2m,apparent_temperature,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FSeoul&forecast_days=4`;
    const r = await fetch(u); if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    weather = { at: Date.now(), place: place.label, cur: j.current, daily: j.daily };
    lsSet('wcp:weather', weather);
  } catch (e) { weather = weather ? { ...weather, error: true } : { error: true, place: place.label }; }
  loadingWeather = false;
  rerender();
}
function useMyLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(p => {
    lsSet('wcp:place', { lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3), label: '현재 위치' });
    loadWeather(true);
  }, () => { lsSet('wcp:place', SEOUL); loadWeather(true); }, { timeout: 10000, maximumAge: 3600000 });
}

function weatherCard() {
  const w = el('div', 'widget wx');
  loadWeather(false);
  const head = el('div', 'wx-head');
  head.append(el('h3', null, '날씨'), el('span', 'spacer'));
  const place = lsGet('wcp:place', SEOUL);
  head.append(btn('linkbtn', place.label === '현재 위치' ? '서울로' : '현재 위치로', () => { if (place.label === '현재 위치') { lsSet('wcp:place', SEOUL); loadWeather(true); } else useMyLocation(); }));
  w.append(head);
  if (!weather || !weather.cur) { w.append(el('p', 'quiet', weather && weather.error ? '날씨를 불러오지 못했습니다.' : '날씨를 불러오는 중…')); return w; }
  const [label, key] = WMO(weather.cur.weather_code);
  const now = el('div', 'wx-now');
  now.append(icon(key, 'wx-icon big'));
  const t = el('div', 'wx-temp'); t.append(el('b', null, `${Math.round(weather.cur.temperature_2m)}°`), el('span', null, `${label} · 체감 ${Math.round(weather.cur.apparent_temperature)}°`));
  now.append(t);
  const d = weather.daily;
  now.append(el('div', 'wx-range', `${weather.place} · 최고 ${Math.round(d.temperature_2m_max[0])}° / 최저 ${Math.round(d.temperature_2m_min[0])}° · 강수 ${d.precipitation_probability_max[0] ?? 0}%`));
  w.append(now);
  const days = el('div', 'wx-days');
  for (let i = 1; i < d.time.length; i++) {
    const dd = parse(d.time[i]);
    const c = el('div', 'wx-day');
    c.append(el('span', null, i === 1 ? '내일' : DOW[dd.getDay()]), icon(WMO(d.weather_code[i])[1]), el('span', 'wx-hl', `${Math.round(d.temperature_2m_max[i])}° ${Math.round(d.temperature_2m_min[i])}°`), el('span', 'wx-pop', `${d.precipitation_probability_max[i] ?? 0}%`));
    days.append(c);
  }
  w.append(days);
  return w;
}

// ---------- progress ring ----------
function ring(done, total) {
  const pct = total ? done / total : 0;
  const s = el('div', 'ring');
  s.innerHTML = `<svg viewBox="0 0 42 42"><circle class="ring-bg" cx="21" cy="21" r="17"/><circle class="ring-fg" cx="21" cy="21" r="17" stroke-dasharray="${(pct * 106.8).toFixed(1)} 106.8"/></svg>`;
  s.append(el('b', null, total ? `${Math.round(pct * 100)}%` : '–'));
  return s;
}

export function renderDashboard() {
  const body = $('#dashBody'); body.textContent = '';
  const t = today(), tStr = ymd(t), W = weekStart(t);
  const hour = new Date().getHours();
  $('#dashHello').textContent = hour < 12 ? '좋은 아침입니다' : hour < 18 ? '좋은 오후입니다' : '오늘도 수고하셨습니다';
  $('#dashDate').textContent = `${t.getFullYear()}년 ${mdLong(t)}`;
  if (!state.loaded) { body.append(el('div', 'empty', '불러오는 중…')); return; }

  // ---- this week ----
  const groups = { overdue: [], due: [], ahead: [], nodue: [], done: [] };
  tasks.all().forEach(it => { const r = weekRole(it, W); if (r) groups[r].push(it); });
  const active = [...groups.overdue, ...groups.due, ...groups.ahead, ...groups.nodue];
  const checked = active.filter(it => isCheckedIn(it, W)).length + groups.done.length;
  const totalWeek = active.length + groups.done.length;

  const top = el('div', 'dash-top');
  const wk = el('div', 'widget week-card');
  const wh = el('div', 'wx-head'); wh.append(el('h3', null, '이번 주 체크리스트'), el('span', 'spacer'), btn('linkbtn', '전체 보기', () => nav('week'))); wk.append(wh);
  const wb = el('div', 'week-sum');
  wb.append(ring(checked, totalWeek));
  const nums = el('div', 'week-nums');
  [['확인·완료', checked], ['남은 일', totalWeek - checked], ['기한 지남', groups.overdue.length], ['이번 주 마감', groups.due.length]].forEach(([l, v], i) => {
    const n = el('div', 'wn' + (i === 2 && v ? ' late' : '')); n.append(el('b', null, String(v)), el('span', null, l)); nums.append(n);
  });
  wb.append(nums); wk.append(wb);
  const focus = [...groups.overdue, ...groups.due].sort(byDue).filter(it => !isCheckedIn(it, W)).slice(0, 4);
  if (focus.length) { const g = el('div', 'group'); focus.forEach(it => g.append(taskRow(it, W))); wk.append(g); }
  else wk.append(el('p', 'quiet', totalWeek ? '급한 일은 모두 챙겼습니다.' : '이번 주 체크리스트가 비어 있습니다.'));
  top.append(wk, weatherCard());
  body.append(top);

  const row = el('div', 'dash-row');
  // ---- today ----
  const td = el('div', 'widget');
  const th = el('div', 'wx-head'); th.append(el('h3', null, '오늘 일정'), el('span', 'spacer'), btn('linkbtn', '캘린더', () => nav('calendar'))); td.append(th);
  const evs = eventsOn(allEvents(), tStr);
  if (!evs.length) td.append(el('p', 'quiet', '오늘은 일정이 없습니다.'));
  else { const g = el('div', 'group'); evs.forEach(e => g.append(eventRow(e, tStr))); td.append(g); }
  const tomorrow = ymd(addDays(t, 1)), tmr = eventsOn(allEvents(), tomorrow);
  if (tmr.length) { td.append(el('h4', 'sub-h', `내일 ${tmr.length}개`)); const g = el('div', 'group'); tmr.slice(0, 3).forEach(e => g.append(eventRow(e, tomorrow))); td.append(g); }
  row.append(td);

  // ---- upcoming deadlines ----
  const up = el('div', 'widget');
  const uh = el('div', 'wx-head'); uh.append(el('h3', null, '다가오는 마감 (14일)')); up.append(uh);
  const until = ymd(addDays(t, 14));
  const soon = tasks.all().filter(x => !x.done && x.due && x.due <= until).sort(byDue).slice(0, 8);
  if (!soon.length) up.append(el('p', 'quiet', '2주 안에 마감되는 업무가 없습니다.'));
  soon.forEach(x => { const r = btn('mini-row', '', () => openTask(x.id)); r.append(ddayEl(x.due, false), el('span', 'mini-title', x.title), el('span', 'mini-time', md(parse(x.due)))); up.append(r); });
  row.append(up);
  body.append(row);

  // ---- projects ----
  const pr = el('div', 'widget');
  const ph = el('div', 'wx-head'); ph.append(el('h3', null, '업무 진행률'), el('span', 'spacer'), btn('linkbtn', '프로젝트', () => nav('projects'))); pr.append(ph);
  const ps = activeProjects();
  if (!ps.length) pr.append(el('p', 'quiet', '프로젝트를 만들면 진행률이 여기에 보입니다.'));
  const bars = el('div', 'hbars');
  ps.forEach(p => {
    const items = tasks.all().filter(x => x.projectId === p.id);
    const done = items.filter(x => x.done).length;
    const r = btn('hbar', '', () => nav('projects', { project: p.id }));
    const lab = el('span', 'hbar-label'); lab.append(el('span', 'dot c-' + p.color), el('span', null, p.name));
    r.append(lab, battery(items), el('span', 'hbar-num', items.length ? `${Math.round(done / items.length * 100)}%` : '–'));
    bars.append(r);
  });
  pr.append(bars);
  body.append(pr);

  // ---- recaps waiting ----
  const waiting = recaps.all().map(r => ({ r, n: r.proposals.filter(p => p.status === 'pending').length, m: memos.get(r.memoId) })).filter(x => x.n && x.m);
  if (waiting.length) {
    const rc = el('div', 'widget recap-wait');
    rc.append(el('h3', null, `검토할 리캡 제안 ${waiting.reduce((a, x) => a + x.n, 0)}건`));
    waiting.forEach(x => { const r = btn('mini-row', '', () => nav('memos', { memo: x.m.id })); r.append(el('span', 'pill recap-pill', `${x.n}건`), el('span', 'mini-title', x.m.title)); rc.append(r); });
    body.append(rc);
  }
}
