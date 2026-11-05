// 홈: today at a glance — this week's checklist, weather, upcoming deadlines, today's schedule,
// project progress, and recap suggestions waiting for review.
import { $, el, btn, ddayEl } from '../ui.js';
import { ymd, parse, addDays, today, weekStart, md, mdLong, DOW, pad } from '../dates.js';
import { weekRole, isCheckedIn, eventsOn, byDue } from '../model.js';
import { tasks, recaps, memos, activeProjects, allEvents } from '../db.js';
import { state } from '../store.js';
import { openTask, closeX } from '../editors.js';
import { eventRow, taskRow } from './common.js';
import { battery } from './projects.js';
import { HOME_PLACE, WMO, ICONS, weatherUrl, hoursOf, compareYesterday, todayTip } from '../weather.js';

let nav = () => {};
export const setDashNav = fn => { nav = fn; };
const rerender = () => window.dispatchEvent(new Event('planner:render'));

// ---------- weather (Open-Meteo, no key) ----------
const lsGet = (k, f) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch (e) { return f; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const place = () => { const p = lsGet('wcp:place', null); return p && p.label !== '서울' ? p : HOME_PLACE; };
let weather = lsGet('wcp:weather2', null);
let loadingWeather = false;
const icon = (k, cls = 'wx-icon') => { const s = el('span', cls); s.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[k] || ICONS.cloud}</svg>`; return s; };

async function loadWeather(force) {
  const p = place();
  if (!force && weather && weather.place === p.label && Date.now() - weather.at < 30 * 60000) return;
  if (loadingWeather || !navigator.onLine) return;
  loadingWeather = true;
  try {
    const u = weatherUrl(p);
    const r = await fetch(u); if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    weather = { at: Date.now(), place: p.label, cur: j.current, hourly: j.hourly, daily: j.daily };
    lsSet('wcp:weather2', weather);
  } catch (e) { weather = weather ? { ...weather, error: true } : { error: true, place: p.label }; }
  loadingWeather = false;
  rerender();
}
function useMyLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    lsSet('wcp:place', { lat: +pos.coords.latitude.toFixed(3), lon: +pos.coords.longitude.toFixed(3), label: '현재 위치' });
    loadWeather(true);
  }, () => { lsSet('wcp:place', HOME_PLACE); loadWeather(true); }, { timeout: 10000, maximumAge: 3600000 });
}

function weatherCard() {
  const w = el('div', 'widget wx');
  w.tabIndex = 0; w.setAttribute('role', 'button'); w.setAttribute('aria-label', '날씨 자세히 보기');
  loadWeather(false);
  const p = place();
  const head = el('div', 'wx-head');
  head.append(el('h3', null, '날씨'), el('span', 'spacer'));
  const toggle = btn('linkbtn', p.label === '현재 위치' ? '강남구로' : '현재 위치로', e => {
    e.stopPropagation();
    if (p.label === '현재 위치') { lsSet('wcp:place', HOME_PLACE); loadWeather(true); } else useMyLocation();
  });
  head.append(toggle);
  w.append(head);
  if (!weather || !weather.cur || !weather.hourly) { w.append(el('p', 'quiet', weather && weather.error ? '날씨를 불러오지 못했습니다.' : '날씨를 불러오는 중…')); return w; }
  const [label, key] = WMO(weather.cur.weather_code);
  const now = el('div', 'wx-now');
  now.append(icon(key, 'wx-icon big'));
  const t = el('div', 'wx-temp');
  t.append(el('b', null, `${Math.round(weather.cur.temperature_2m)}°`));
  const cmp = compareYesterday(weather);
  const line = el('span', 'wx-compare');
  if (cmp) { const b = el('b', cmp.cls, cmp.text); line.append(b, ` / ${label}`); } else line.textContent = label;
  t.append(line);
  now.append(t);
  const d = weather.daily, ti = d.time.indexOf(ymd(today()));
  now.append(el('div', 'wx-range', `${weather.place} · 최고 ${Math.round(d.temperature_2m_max[ti])}° / 최저 ${Math.round(d.temperature_2m_min[ti])}° · 체감 ${Math.round(weather.cur.apparent_temperature)}°`));
  w.append(now);
  const days = el('div', 'wx-days');
  for (let i = ti + 1; i <= ti + 3 && i < d.time.length; i++) {
    const dd = parse(d.time[i]);
    const c = el('div', 'wx-day');
    c.append(el('span', null, i === ti + 1 ? '내일' : DOW[dd.getDay()]), icon(WMO(d.weather_code[i])[1]), el('span', 'wx-hl', `${Math.round(d.temperature_2m_max[i])}° ${Math.round(d.temperature_2m_min[i])}°`), el('span', 'wx-pop', `${d.precipitation_probability_max[i] ?? 0}%`));
    days.append(c);
  }
  w.append(days);
  const tip = todayTip(weather);
  const tipEl = el('div', 'wx-tip'); tipEl.append(icon(tip.key), el('span', null, tip.text)); w.append(tipEl);
  w.append(el('div', 'wx-more', '눌러서 시간별·주간 예보 보기'));
  const openIt = () => openWeather();
  w.addEventListener('click', openIt);
  w.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openIt(); } });
  return w;
}

// ---------- weather detail: next 24 hours + yesterday through next week ----------
function openWeather() {
  if (!weather || !weather.hourly) return;
  const sheet = $('#sheet'); sheet.textContent = '';
  const box = el('div', 'wxd');
  box.append(el('h2', null, `날씨 · ${weather.place}`));
  box.append(el('div', 'wxd-sub', `Open-Meteo 예보 · ${new Date(weather.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준`));

  // hourly strip: temperature line, icons, rain chance
  const nowKey = `${ymd(today())}T${pad(new Date().getHours())}:00`;
  const start = Math.max(0, weather.hourly.time.indexOf(nowKey));
  const hrs = weather.hourly.time.slice(start, start + 25).map((t, k) => ({ t, temp: weather.hourly.temperature_2m[start + k], pop: weather.hourly.precipitation_probability[start + k] ?? 0, code: weather.hourly.weather_code[start + k] }));
  const W = 54, H = 150, n = hrs.length;
  const temps = hrs.map(h => h.temp), tmax = Math.max(...temps), tmin = Math.min(...temps);
  const y = v => 34 + (tmax === tmin ? 20 : (tmax - v) / (tmax - tmin) * 40);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('width', n * W); svg.setAttribute('height', H); svg.setAttribute('viewBox', `0 0 ${n * W} ${H}`);
  const mk = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); if (text != null) e.textContent = text; svg.append(e); return e; };
  mk('polyline', { points: hrs.map((h, i) => `${i * W + W / 2},${y(h.temp)}`).join(' '), fill: 'none', stroke: 'var(--line)', 'stroke-width': 2 });
  hrs.forEach((h, i) => {
    const x = i * W + W / 2, hour = +h.t.slice(11, 13), dateChange = hour === 0;
    mk('text', { x, y: y(h.temp) - 9, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--ink)' }, `${Math.round(h.temp)}°`);
    mk('circle', { cx: x, cy: y(h.temp), r: i === 0 ? 4 : 2.5, fill: i === 0 ? 'var(--accent)' : 'var(--muted)' });
    const g = document.createElementNS(ns, 'g'); g.setAttribute('transform', `translate(${x - 11} 86)`); g.innerHTML = ICONS[WMO(h.code)[1]];
    g.setAttribute('fill', 'none'); g.setAttribute('stroke', 'var(--accent)'); g.setAttribute('stroke-width', '1.6'); g.setAttribute('stroke-linecap', 'round');
    const sc = document.createElementNS(ns, 'g'); sc.setAttribute('transform', 'scale(0.92)'); sc.innerHTML = g.innerHTML; g.innerHTML = ''; g.append(sc); svg.append(g);
    if (h.pop >= 20) mk('text', { x, y: 122, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--sat)' }, `${h.pop}%`);
    mk('text', { x, y: 142, 'text-anchor': 'middle', 'font-size': 11, fill: dateChange ? 'var(--accent)' : 'var(--muted)', 'font-weight': dateChange ? 700 : 400 }, i === 0 ? '지금' : dateChange ? '내일' : `${hour}시`);
  });
  const hoursBox = el('div', 'wxd-hours'); hoursBox.append(svg); box.append(hoursBox);

  // yesterday → next week, morning / afternoon
  box.append(el('h3', null, '주간 예보'));
  const week = el('div', 'wxd-week');
  const d = weather.daily, tStr = ymd(today());
  const half = (dateStr, from, to) => {
    const hs = hoursOf(weather, dateStr).filter(x => x.h >= from && x.h < to);
    if (!hs.length) return null;
    const pop = Math.max(...hs.map(x => x.pop));
    const mid = hs[Math.floor(hs.length / 2)];
    const worst = hs.reduce((a, b) => b.code > a.code ? b : a, mid);
    return { pop, code: worst.code >= 51 ? worst.code : mid.code };
  };
  d.time.forEach((ds, i) => {
    const dd = parse(ds);
    const row = el('div', 'wxd-day' + (ds === tStr ? ' today' : ds < tStr ? ' past' : ''));
    const nm = el('div', 'wxd-name' + (dd.getDay() === 0 ? ' sun' : dd.getDay() === 6 ? ' sat' : ''));
    nm.append(el('b', null, ds === tStr ? '오늘' : ds < tStr ? '어제' : ds === ymd(addDays(today(), 1)) ? '내일' : DOW[dd.getDay()]), el('span', null, `${pad(dd.getMonth() + 1)}.${pad(dd.getDate())}.`));
    row.append(nm);
    [half(ds, 6, 12), half(ds, 12, 21)].forEach((hf, k) => {
      const c = el('div', 'wxd-half');
      if (hf) { c.append(el('span', null, `${hf.pop}%`), icon(WMO(hf.code)[1])); c.title = `${k ? '오후' : '오전'} ${WMO(hf.code)[0]} · 강수 ${hf.pop}%`; }
      row.append(c);
    });
    const tp = el('div', 'wxd-temp'); tp.append(el('span', 'lo', `${Math.round(d.temperature_2m_min[i])}°`), ' / ', el('span', 'hi', `${Math.round(d.temperature_2m_max[i])}°`));
    row.append(tp);
    week.append(row);
  });
  box.append(week);
  box.append(el('div', 'wxd-note', '왼쪽은 오전(6–12시), 오른쪽은 오후(12–21시) 날씨와 가장 높은 강수 확률입니다.'));
  const a = el('div', 'ed-actions'); a.append(el('span', 'spacer'), btn('btn', '닫기', () => sheet.close())); box.append(a);
  sheet.append(closeX(() => sheet.close()), box);
  if (!sheet.open) sheet.showModal();
  sheet.querySelector('.sheet-x').focus({ preventScroll: true });
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
  body.className = 'home-grid';
  const t = today(), tStr = ymd(t), W = weekStart(t);
  const hour = new Date().getHours();
  $('#dashHello').textContent = hour < 12 ? '좋은 아침입니다' : hour < 18 ? '좋은 오후입니다' : '오늘도 수고하셨습니다';
  $('#dashDate').textContent = `${t.getFullYear()}년 ${mdLong(t)}`;
  if (!state.loaded) { body.append(el('div', 'empty span2', '불러오는 중…')); return; }

  // ---- row 1: this week (wide) + weather ----
  const groups = { overdue: [], due: [], ahead: [], nodue: [], done: [] };
  tasks.all().forEach(it => { const r = weekRole(it, W); if (r) groups[r].push(it); });
  const active = [...groups.overdue, ...groups.due, ...groups.ahead, ...groups.nodue];
  const checked = active.filter(it => isCheckedIn(it, W)).length + groups.done.length;
  const totalWeek = active.length + groups.done.length;
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
  body.append(wk, weatherCard());

  // ---- row 2: upcoming deadlines (wide) + today ----
  const up = el('div', 'widget');
  up.append(el('h3', null, '다가오는 마감 (14일)'));
  const until = ymd(addDays(t, 14));
  const soon = tasks.all().filter(x => !x.done && x.due && x.due <= until).sort(byDue).slice(0, 8);
  if (!soon.length) up.append(el('p', 'quiet', '2주 안에 마감되는 업무가 없습니다.'));
  const ul = el('div', 'group');
  soon.forEach(x => { const r = btn('mini-row', '', () => openTask(x.id)); r.title = x.title; r.append(ddayEl(x.due, false), el('span', 'mini-title', x.title), el('span', 'mini-time', md(parse(x.due)))); ul.append(r); });
  up.append(ul);

  const td = el('div', 'widget');
  const th = el('div', 'wx-head'); th.append(el('h3', null, '오늘 일정'), el('span', 'spacer'), btn('linkbtn', '캘린더', () => nav('calendar'))); td.append(th);
  const evs = eventsOn(allEvents(tStr, tStr), tStr);
  if (!evs.length) td.append(el('p', 'quiet', '오늘은 일정이 없습니다.'));
  else { const g = el('div', 'group'); evs.forEach(e => g.append(eventRow(e, tStr))); td.append(g); }
  const tomorrow = ymd(addDays(t, 1)), tmr = eventsOn(allEvents(tomorrow, tomorrow), tomorrow);
  if (tmr.length) { td.append(el('h4', 'sub-h', `내일 ${tmr.length}개`)); const g = el('div', 'group'); tmr.slice(0, 3).forEach(e => g.append(eventRow(e, tomorrow))); td.append(g); }
  body.append(up, td);

  // ---- row 3: projects ----
  const pr = el('div', 'widget span2');
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
    const rc = el('div', 'widget span2 recap-wait');
    rc.append(el('h3', null, `검토할 리캡 제안 ${waiting.reduce((a, x) => a + x.n, 0)}건`));
    waiting.forEach(x => { const r = btn('mini-row', '', () => nav('memos', { memo: x.m.id })); r.append(el('span', 'pill recap-pill', `${x.n}건`), el('span', 'mini-title', x.m.title)); rc.append(r); });
    body.append(rc);
  }
}
