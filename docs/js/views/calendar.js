// Calendar in the Google/Naver style.
// Month: one grid per week; multi-day and all-day items are bars laid out in lanes,
// timed events are "dot · time · title" lines, task deadlines have a check mark.
// Week: an all-day lane strip plus an hourly time grid with a "now" line.
// Phones: tap a day to see its list under the month grid.
import { $, el, btn } from '../ui.js';
import { ymd, parse, addDays, today, sunStart, daysBetween, pad, md, mdLong, DOW } from '../dates.js';
import { eventTimeText } from '../model.js';
import { holidayOf } from '../holidays.js';
import { tasks, allEvents, promosIn } from '../db.js';
import { state } from '../store.js';
import { openTask, openEvent, openDay, openPromo, promoColor } from '../editors.js';
import { taskRow, eventRow } from './common.js';

const lsGet = (k, f) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch (e) { return f; } };
export const calState = { month: new Date(today().getFullYear(), today().getMonth(), 1), week: sunStart(today()), view: lsGet('wcp:calview', 'month'), selected: ymd(today()), filters: { todo: true, event: true, promo: false, ...lsGet('wcp:calfilters', {}) } };
const rerender = () => window.dispatchEvent(new Event('planner:render'));
const phone = () => matchMedia('(max-width: 640px)').matches;
const HOUR = 44; // px per hour in week view

// Everything shown on the calendar, as one shape, following the Todo / 일정 / 프로모션 filters.
// rank orders the lanes: meetings and other own events first, promotions last.
function itemsIn(from, to) {
  const f = calState.filters, out = [];
  if (f.event) allEvents(from, to).forEach(e => {
    if (e.endDate < from || e.startDate > to) return;
    const span = !e.startTime || e.endDate !== e.startDate;
    out.push({ kind: e.external ? 'ext' : 'event', id: e.seriesId || e.id, occ: e.occDate, title: e.title, color: e.color, start: e.startDate, end: e.endDate, time: e.startTime, endTime: e.endTime, span, rank: e.external ? 2 : span ? 0 : 1, src: e });
  });
  if (f.todo) tasks.all().forEach(t => {
    if (!t.due || t.due < from || t.due > to) return;
    out.push({ kind: 'task', id: t.id, title: t.title, color: t.color, start: t.due, end: t.due, time: null, span: false, done: t.done, rank: 3, src: t });
  });
  if (f.promo) promosIn(from, to).forEach(p => out.push({ kind: 'promo', id: p.id, title: p.status === 'discuss' ? p.title + ' (논의)' : p.title, color: promoColor(p), start: p.startDate, end: p.endDate, time: null, span: true, rank: 4, src: p }));
  return out;
}
const openItem = it => it.kind === 'task' ? openTask(it.id) : it.kind === 'event' ? openEvent(it.id, { occDate: it.occ }) : it.kind === 'promo' ? openPromo(it.src) : openDay(it.start);

export function renderCalendar() {
  const isMonth = calState.view === 'month';
  document.querySelectorAll('[data-calview]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.calview === calState.view)));
  const lbl = $('#mLabel');
  if (isMonth) lbl.textContent = `${calState.month.getFullYear()}년 ${calState.month.getMonth() + 1}월`;
  else { const W = calState.week, E = addDays(W, 6); lbl.textContent = `${W.getFullYear()}년 ${W.getMonth() + 1}월 ${W.getDate()}일 – ${E.getMonth() !== W.getMonth() ? `${E.getMonth() + 1}월 ` : ''}${E.getDate()}일`; }
  const host = $('#cal'); host.textContent = ''; host.className = isMonth ? 'mcal' : 'wcal';
  const ag = $('#agenda'); ag.textContent = '';
  if (isMonth) month(host); else week(host);
  if (isMonth && phone() && state.loaded) dayList(ag, calState.selected);
}

// ---------- month ----------
function month(host) {
  const M = calState.month, m = M.getMonth();
  const first = new Date(M.getFullYear(), m, 1), last = new Date(M.getFullYear(), m + 1, 0);
  const start = sunStart(first), weeks = Math.ceil((daysBetween(start, last) + 1) / 7);
  const tStr = ymd(today());
  const maxLanes = phone() ? 3 : 4;

  const dow = el('div', 'mcal-dow');
  ['일', '월', '화', '수', '목', '금', '토'].forEach((d, i) => dow.append(el('span', i === 6 ? 'sat' : i === 0 ? 'sun' : '', d)));
  host.append(dow);

  for (let w = 0; w < weeks; w++) {
    const ws = addDays(start, w * 7), we = addDays(ws, 6);
    const wsS = ymd(ws), weS = ymd(we);
    const row = el('div', 'mweek');
    row.style.setProperty('--lanes', maxLanes);
    const dayStrs = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i), ds = ymd(d); dayStrs.push(ds);
      const cell = el('div', 'mday' + (d.getMonth() !== m ? ' out' : '') + (ds === tStr ? ' today' : '') + (ds === calState.selected && phone() ? ' sel' : '') + (i === 0 || i === 6 ? ' wkend' : ''));
      cell.style.gridColumn = `${i + 1}`;
      cell.addEventListener('click', () => { if (phone()) { calState.selected = ds; rerender(); } else openDay(ds); });
      cell.addEventListener('dblclick', () => openEvent(null, { startDate: ds, endDate: ds }));
      row.append(cell);
      const hol = holidayOf(ds);
      const num = el('span', 'mnum' + (hol || i === 0 ? ' sun' : i === 6 ? ' sat' : ''), d.getDate() === 1 ? `${d.getMonth() + 1}월 1일` : String(d.getDate()));
      num.style.gridColumn = `${i + 1}`;
      row.append(num);
      if (hol) { const hl = el('span', 'mhol' + (d.getMonth() !== m ? ' dim' : ''), hol); hl.style.gridColumn = `${i + 1}`; hl.title = hol; row.append(hl); cell.title = hol; }
    }
    // lane layout
    const items = itemsIn(wsS, weS).map(it => {
      const s = Math.max(0, daysBetween(ws, parse(it.start))), e = Math.min(6, daysBetween(ws, parse(it.end)));
      return { ...it, s, e };
    }).sort((a, b) => a.rank - b.rank || a.s - b.s || (b.e - b.s) - (a.e - a.s) || (a.time || '').localeCompare(b.time || ''));
    // Meetings, events and to-dos fill the main lanes; promotions get their own thin lanes below,
    // so a busy promotion calendar never pushes a meeting out of view.
    const hidden = Array(7).fill(0);
    const place = (list, cap, rowOf) => {
      const lanes = [];
      list.forEach(it => {
        let lane = 0;
        while (lanes[lane] && lanes[lane].some(x => !(it.e < x.s || it.s > x.e))) lane++;
        if (lane >= cap) { for (let d = it.s; d <= it.e; d++) hidden[d]++; return; }
        (lanes[lane] = lanes[lane] || []).push(it);
        const c = chip(it, lane, ws); c.style.gridRow = String(rowOf(lane)); row.append(c);
      });
      return lanes.length;
    };
    place(items.filter(i => i.kind !== 'promo'), maxLanes, lane => lane + 2);
    const promoCap = phone() ? 2 : 3;
    const plines = place(items.filter(i => i.kind === 'promo'), promoCap, lane => maxLanes + 2 + lane);
    row.style.setProperty('--plines', plines);
    hidden.forEach((n, i) => {
      if (!n) return;
      const more = btn('mmore', `+${n}개`, e => { e.stopPropagation(); if (phone()) { calState.selected = dayStrs[i]; rerender(); } else openDay(dayStrs[i]); });
      more.style.gridColumn = `${i + 1}`; more.style.gridRow = `${maxLanes + 2 + plines}`;
      row.append(more);
    });
    host.append(row);
  }
}

function chip(it, lane, ws) {
  const cls = ['mitem', 'c-' + it.color, 'k-' + it.kind];
  if (it.kind === 'promo' && it.src.status === 'discuss') cls.push('tentative');
  if (it.span) cls.push('bar');
  if (it.done) cls.push('done');
  if (it.span && it.start < ymd(ws)) cls.push('cont-l');
  if (it.span && it.end > ymd(addDays(ws, 6))) cls.push('cont-r');
  const b = btn(cls.join(' '), '', e => { e.stopPropagation(); openItem(it); });
  b.style.gridColumn = `${it.s + 1} / ${it.e + 2}`;
  b.style.gridRow = `${lane + 2}`;
  if (it.span) b.append(el('span', 'mi-title', it.title));
  else if (it.kind === 'task') b.append(el('span', 'mi-check', it.done ? '✓' : ''), el('span', 'mi-title', it.title));
  else b.append(el('span', 'mi-dot'), el('span', 'mi-time', it.time || ''), el('span', 'mi-title', it.title));
  b.title = `${it.kind === 'task' ? '마감 · ' : it.kind === 'ext' ? '외부 · ' : it.kind === 'promo' ? '프로모션 · ' : ''}${it.time ? it.time + ' ' : ''}${it.title}`;
  return b;
}

// ---------- phone: list under the month ----------
function dayList(host, ds) {
  const d = parse(ds);
  const head = el('div', 'daylist-head');
  head.append(el('h3', null, `${mdLong(d)}${ds === ymd(today()) ? ' · 오늘' : ''}${holidayOf(ds) ? ` · ${holidayOf(ds)}` : ''}`), el('span', 'spacer'),
    btn('linkbtn', '+ 일정', () => openEvent(null, { startDate: ds, endDate: ds })), btn('linkbtn', '+ 업무', () => openTask(null, { due: ds })));
  host.append(head);
  const g = el('div', 'group');
  const its = itemsIn(ds, ds);
  if (!its.length) g.append(el('p', 'quiet', '일정과 마감이 없습니다.'));
  its.filter(i => i.kind === 'event' || i.kind === 'ext').sort((a, b) => (a.time || '').localeCompare(b.time || '')).forEach(i => g.append(eventRow(i.src, ds)));
  its.filter(i => i.kind === 'task').forEach(i => g.append(taskRow(i.src, null)));
  its.filter(i => i.kind === 'promo').forEach(i => { const r = btn('mini-row promo', '', () => openPromo(i.src)); r.append(el('span', 'dot c-' + i.color), el('span', 'mini-time', '프로모션'), el('span', 'mini-title', i.title)); g.append(r); });
  host.append(g);
}

// ---------- week ----------
function week(host) {
  const W = calState.week, tStr = ymd(today());
  const days = [...Array(7)].map((_, i) => addDays(W, i));
  const dayStrs = days.map(ymd);

  const head = el('div', 'wc-head');
  head.append(el('span', 'wc-gutter'));
  days.forEach((d, i) => {
    const hol = holidayOf(dayStrs[i]);
    const h = btn('wc-day' + (dayStrs[i] === tStr ? ' today' : '') + (i === 0 || i === 6 ? ' wkend' : '') + (hol || i === 0 ? ' sun' : i === 6 ? ' sat' : ''), '', () => openDay(dayStrs[i]));
    h.append(el('span', 'wc-dow', hol ? `${DOW[d.getDay()]} · ${hol}` : DOW[d.getDay()]), el('span', 'wc-num', String(d.getDate())));
    if (hol) h.title = hol;
    head.append(h);
  });
  host.append(head);

  // all-day strip
  const items = itemsIn(dayStrs[0], dayStrs[6]);
  const spans = items.filter(i => i.span || i.kind === 'task' || !i.time).map(it => ({ ...it, s: Math.max(0, daysBetween(W, parse(it.start))), e: Math.min(6, daysBetween(W, parse(it.end))) }))
    .sort((a, b) => a.rank - b.rank || a.s - b.s || (b.e - b.s) - (a.e - a.s));
  const strip = el('div', 'wc-allday');
  strip.append(el('span', 'wc-gutter wc-label', '종일'));
  const lanes = [];
  spans.forEach(it => {
    let lane = 0;
    while (lanes[lane] && lanes[lane].some(x => !(it.e < x.s || it.s > x.e))) lane++;
    (lanes[lane] = lanes[lane] || []).push(it);
    const c = chip({ ...it, span: it.kind !== 'task' }, lane, W);
    c.style.gridColumn = `${it.s + 2} / ${it.e + 3}`; c.style.gridRow = `${lane + 1}`;
    strip.append(c);
  });
  strip.style.setProperty('--rows', Math.max(1, lanes.length));
  host.append(strip);

  // time grid
  const scroll = el('div', 'wc-scroll');
  const grid = el('div', 'wc-grid'); grid.style.setProperty('--hour', HOUR + 'px');
  const gut = el('div', 'wc-hours');
  for (let h = 0; h < 24; h++) gut.append(el('span', null, h ? `${h < 12 ? '오전' : '오후'} ${((h + 11) % 12) + 1}시` : ''));
  grid.append(gut);
  days.forEach((d, i) => {
    const col = el('div', 'wc-col' + (dayStrs[i] === tStr ? ' today' : '') + (i === 0 || i === 6 ? ' wkend' : ''));
    col.addEventListener('click', e => {
      if (e.target !== col) return;
      const y = e.offsetY, hh = Math.min(23, Math.floor(y / HOUR)), mm = (y % HOUR) < HOUR / 2 ? '00' : '30';
      const st = `${pad(hh)}:${mm}`, en = `${pad(Math.min(23, hh + 1))}:${mm}`;
      openEvent(null, { startDate: dayStrs[i], endDate: dayStrs[i], startTime: st, endTime: en });
    });
    const timed = items.filter(it => !it.span && it.kind !== 'task' && it.time && it.start === dayStrs[i])
      .map(it => {
        const s = toMin(it.time), e = it.endTime ? Math.max(toMin(it.endTime), s + 20) : s + 60;
        return { ...it, sMin: s, eMin: Math.min(e, 24 * 60) };
      }).sort((a, b) => a.sMin - b.sMin || b.eMin - a.eMin);
    // side-by-side columns for overlaps
    let cluster = [], clusterEnd = -1;
    const flush = () => { const cols = Math.max(...cluster.map(x => x.col)) + 1; cluster.forEach(x => { x.cols = cols; }); cluster = []; };
    const colsEnd = [];
    timed.forEach(it => {
      if (cluster.length && it.sMin >= clusterEnd) { flush(); colsEnd.length = 0; }
      let c = colsEnd.findIndex(end => end <= it.sMin); if (c < 0) c = colsEnd.length;
      colsEnd[c] = it.eMin; it.col = c; cluster.push(it); clusterEnd = Math.max(clusterEnd, it.eMin);
    });
    if (cluster.length) flush();
    timed.forEach(it => {
      const b = btn('wc-ev c-' + it.color + (it.kind === 'ext' ? ' k-ext' : ''), '', ev => { ev.stopPropagation(); openItem(it); });
      b.style.top = `${it.sMin / 60 * HOUR}px`; b.style.height = `${Math.max(18, (it.eMin - it.sMin) / 60 * HOUR - 2)}px`;
      b.style.left = `calc(${it.col / it.cols * 100}% + 1px)`; b.style.width = `calc(${100 / it.cols}% - 3px)`;
      b.append(el('span', 'wc-ev-title', it.title), el('span', 'wc-ev-time', eventTimeText(it.src, it.start)));
      if (it.src.location) b.append(el('span', 'wc-ev-time', it.src.location));
      col.append(b);
    });
    if (dayStrs[i] === tStr) { const now = new Date(); const line = el('div', 'wc-now'); line.style.top = `${(now.getHours() * 60 + now.getMinutes()) / 60 * HOUR}px`; col.append(line); }
    grid.append(col);
  });
  scroll.append(grid);
  host.append(scroll);
  requestAnimationFrame(() => { scroll.scrollTop = 8 * HOUR - 8; });
}
const toMin = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);

export function wireCalendar() {
  const go = n => {
    if (calState.view === 'month') calState.month = new Date(calState.month.getFullYear(), calState.month.getMonth() + n, 1);
    else calState.week = addDays(calState.week, 7 * n);
    rerender();
  };
  $('#mPrev').addEventListener('click', () => go(-1));
  $('#mNext').addEventListener('click', () => go(1));
  $('#mToday').addEventListener('click', () => { calState.month = new Date(today().getFullYear(), today().getMonth(), 1); calState.week = sunStart(today()); calState.selected = ymd(today()); rerender(); });
  document.querySelectorAll('[data-cf]').forEach(c => {
    c.checked = !!calState.filters[c.dataset.cf];
    c.addEventListener('change', () => {
      calState.filters[c.dataset.cf] = c.checked;
      try { localStorage.setItem('wcp:calfilters', JSON.stringify(calState.filters)); } catch (e) {}
      rerender();
    });
  });
  document.querySelectorAll('[data-calview]').forEach(b => b.addEventListener('click', () => {
    calState.view = b.dataset.calview;
    try { localStorage.setItem('wcp:calview', JSON.stringify(calState.view)); } catch (e) {}
    // Keep the period in view when switching.
    if (calState.view === 'week') { const t = today(); calState.week = sunStart(t.getMonth() === calState.month.getMonth() ? t : calState.month); }
    else calState.month = new Date(calState.week.getFullYear(), calState.week.getMonth(), 1);
    rerender();
  }));
}
