// Month grid: own events (filled), task deadlines (left stripe), external events (outlined),
// and thin bands for the "미리 챙기는 기간" of repeating tasks.
import { $, el, btn } from '../ui.js';
import { ymd, parse, addDays, today, weekStart, isoWeek, daysBetween, pad, md } from '../dates.js';
import { byDue, eventsOn, eventTimeText } from '../model.js';
import { tasks, allEvents } from '../db.js';
import { state } from '../store.js';
import { openTask, openEvent, openDay } from '../editors.js';
import { taskRow, eventRow } from './common.js';

export const calState = { month: new Date(today().getFullYear(), today().getMonth(), 1) };

export function renderCalendar() {
  const M = calState.month, y = M.getFullYear(), m = M.getMonth();
  $('#mLabel').textContent = `${y}년 ${m + 1}월`;
  const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
  const start = weekStart(first), weeks = Math.ceil((daysBetween(start, last) + 1) / 7);
  const ts = tasks.all(), evs = allEvents();
  const tStr = ymd(today()), thisW = +weekStart(today());

  const cal = $('#cal'); cal.textContent = '';
  cal.append(el('div', 'dow wh', ''));
  ['월', '화', '수', '목', '금', '토', '일'].forEach((d, i) => cal.append(el('div', 'dow' + (i === 6 ? ' sun' : ''), d)));

  for (let w = 0; w < weeks; w++) {
    const ws = addDays(start, w * 7);
    cal.append(el('div', 'wcol' + (+ws === thisW ? ' cur' : ''), `W${pad(isoWeek(ws))}`));
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i), ds = ymd(d);
      const c = el('div', 'cell' + (d.getMonth() !== m ? ' out' : '') + (ds === tStr ? ' today' : ''));
      c.append(el('span', 'dnum', String(d.getDate())));
      const dayEvs = eventsOn(evs, ds);
      const dues = ts.filter(t => t.due === ds).sort((a, b) => a.done - b.done);
      const items = [
        ...dayEvs.map(e => ({ kind: e.external ? 'ext' : 'ev', e })),
        ...dues.map(t => ({ kind: 'task', t })),
      ];
      items.slice(0, 3).forEach(x => {
        let ch;
        if (x.kind === 'task') {
          ch = btn('chip c-' + x.t.color + (x.t.done ? ' done' : ''), x.t.title, ev => { ev.stopPropagation(); openTask(x.t.id); });
          ch.title = `마감 · ${x.t.title}`;
        } else {
          const label = x.e.startTime && x.e.startDate === ds ? `${x.e.startTime} ${x.e.title}` : x.e.title;
          ch = btn('chip evchip c-' + x.e.color + (x.kind === 'ext' ? ' ext' : ''), label, ev => { ev.stopPropagation(); if (x.kind === 'ext') openDay(ds); else openEvent(x.e.id); });
          ch.title = `${eventTimeText(x.e, ds)} · ${x.e.title}`;
        }
        c.append(ch);
      });
      if (items.length > 3) c.append(el('span', 'more-n', `+${items.length - 3}개`));
      const windows = ts.filter(t => !t.done && t.due && t.lead && ds >= ymd(addDays(parse(t.due), -t.lead)) && ds < t.due);
      if (windows.length) {
        const bands = el('div', 'bands');
        windows.sort(byDue).slice(0, 3).forEach(t => { const b = el('div', 'band c-' + t.color); b.title = `${t.title} · 미리 챙기는 기간`; bands.append(b); });
        c.append(bands);
      }
      c.addEventListener('click', () => openDay(ds));
      cal.append(c);
    }
  }

  // ---- this month's list ----
  const prefix = `${y}-${pad(m + 1)}`;
  const monthEvs = evs.filter(e => e.startDate.slice(0, 7) === prefix || e.endDate.slice(0, 7) === prefix);
  const monthDues = ts.filter(t => t.due && t.due.slice(0, 7) === prefix);
  $('#mMeta').textContent = `일정 ${monthEvs.length}개 · 마감 ${monthDues.length}개 (남은 ${monthDues.filter(t => !t.done).length}개)`;
  const ag = $('#agenda'); ag.textContent = '';
  if (!state.loaded) return;
  if (!monthEvs.length && !monthDues.length) { ag.append(el('p', 'quiet', '이달에는 일정과 마감이 없습니다. 날짜를 눌러 추가하세요.')); return; }
  const dates = [...new Set([...monthEvs.map(e => e.startDate < `${prefix}-01` ? `${prefix}-01` : e.startDate), ...monthDues.map(t => t.due)])].sort();
  dates.forEach(ds => {
    const sec = el('div', 'agenda-day');
    sec.append(el('h3', ds === tStr ? 'is-today' : '', md(parse(ds))));
    const g = el('div', 'group');
    eventsOn(monthEvs, ds).filter(e => e.startDate === ds || ds === `${prefix}-01`).forEach(e => g.append(eventRow(e, ds)));
    monthDues.filter(t => t.due === ds).sort(byDue).forEach(t => g.append(taskRow(t, null)));
    sec.append(g); ag.append(sec);
  });
}

export function wireCalendar() {
  const go = n => { calState.month = new Date(calState.month.getFullYear(), calState.month.getMonth() + n, 1); window.dispatchEvent(new Event('planner:render')); };
  $('#mPrev').addEventListener('click', () => go(-1));
  $('#mNext').addEventListener('click', () => go(1));
  $('#mToday').addEventListener('click', () => { calState.month = new Date(today().getFullYear(), today().getMonth(), 1); window.dispatchEvent(new Event('planner:render')); });
}
