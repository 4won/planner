// "이번 주": this week's events day by day, then the weekly checklist.
import { $, el, btn, empty } from '../ui.js';
import { ymd, addDays, today, weekStart, isoWeek, pad, DOW } from '../dates.js';
import { weekRole, isCheckedIn, byDue, eventsOn, normTask } from '../model.js';
import { tasks, allEvents } from '../db.js';
import { state } from '../store.js';
import { openTask, openEvent, openDay } from '../editors.js';
import { taskRow, eventRow, groupEl } from './common.js';
import { newId } from '../dates.js';

export const weekState = { week: weekStart(today()), seenWeek: weekStart(today()) };

export function rollWeekIfNeeded() {
  const nowW = weekStart(today());
  if (+nowW !== +weekState.seenWeek) { if (+weekState.week === +weekState.seenWeek) weekState.week = nowW; weekState.seenWeek = nowW; }
}

export function renderWeek() {
  const W = weekState.week, We = addDays(W, 6), isThis = +W === +weekStart(today());
  const lbl = $('#wkLabel'); lbl.textContent = '';
  const range = `${W.getFullYear()}년 ${W.getMonth() + 1}월 ${W.getDate()}일 – ${We.getMonth() + 1}월 ${We.getDate()}일`;
  if (isThis) lbl.append(el('span', 'hl', range)); else lbl.textContent = range;
  lbl.append(' ', el('span', 'wkno', `W${pad(isoWeek(W))}`));

  const body = $('#weekBody'); body.textContent = '';
  if (!state.loaded) { body.append(el('div', 'empty', '불러오는 중…')); $('#wkMeta').textContent = ''; return; }

  // ---- events, day by day ----
  const evAll = allEvents();
  const days = [];
  for (let i = 0; i < 7; i++) { const d = addDays(W, i), ds = ymd(d); days.push({ d, ds, evs: eventsOn(evAll, ds) }); }
  const evCount = days.reduce((n, x) => n + x.evs.length, 0);
  const sched = el('section', 'sched');
  const sh = el('div', 'group-head'); sh.append(el('span', '', '일정'), el('span', 'count', String(evCount)));
  sh.append(el('span', 'spacer'), btn('linkbtn', '+ 일정', () => openEvent(null, isThis ? {} : { startDate: ymd(W), endDate: ymd(W) })));
  sched.append(sh);
  const tStr = ymd(today());
  const shown = days.filter(x => x.evs.length || x.ds === tStr);
  if (!shown.length) sched.append(el('p', 'quiet', '이 주에는 일정이 없습니다.'));
  shown.forEach(x => {
    const day = el('div', 'day' + (x.ds === tStr ? ' is-today' : ''));
    const dl = btn('day-label', '', () => openDay(x.ds));
    dl.append(el('span', 'dow' + (x.d.getDay() === 0 ? ' sun' : ''), DOW[x.d.getDay()]), el('span', 'dnum', String(x.d.getDate())));
    day.append(dl);
    const list = el('div', 'day-list');
    if (!x.evs.length) list.append(el('span', 'quiet', '오늘 일정 없음'));
    x.evs.forEach(e => list.append(eventRow(e, x.ds)));
    day.append(list);
    sched.append(day);
  });
  body.append(sched);

  // ---- weekly checklist ----
  const groups = { overdue: [], due: [], ahead: [], nodue: [], done: [] };
  for (const it of tasks.all()) { const r = weekRole(it, W); if (r) groups[r].push(it); }
  Object.values(groups).forEach(a => a.sort(byDue));
  const active = [...groups.overdue, ...groups.due, ...groups.ahead, ...groups.nodue];
  const checkedN = active.filter(it => isCheckedIn(it, W)).length;
  $('#wkMeta').textContent = `일정 ${evCount}개 · 챙길 업무 ${active.length}개 · 확인 ${checkedN}/${active.length}` + (groups.done.length ? ` · 완료 ${groups.done.length}` : '');

  const tasksBox = el('section', 'week-tasks');
  if (!tasks.all().length) {
    tasksBox.append(empty('아직 업무가 없습니다', '마감일과 “언제부터 챙길지”를 정하면, 그 주부터 매주 이 체크리스트에 올라옵니다. 체크해도 완료할 때까지 다음 주에 다시 나옵니다.', [
      btn('btn primary', '+ 업무', () => openTask(null)),
      btn('btn', '예시 넣어보기', addExamples),
    ]));
  } else if (!active.length && !groups.done.length) {
    tasksBox.append(el('p', 'quiet', '이 주에 챙길 업무가 없습니다.'));
  } else {
    if (groups.overdue.length) tasksBox.append(groupEl('기한 지남', groups.overdue, W, { late: true, note: '완료할 때까지 계속 표시' }));
    if (groups.due.length) tasksBox.append(groupEl(isThis ? '이번 주 마감' : '이 주 마감', groups.due, W));
    if (groups.ahead.length) tasksBox.append(groupEl('미리 챙길 일', groups.ahead, W, { note: '리마인드 기간' }));
    if (groups.nodue.length) tasksBox.append(groupEl('기한 없는 업무', groups.nodue, W));
    if (groups.done.length) tasksBox.append(groupEl(isThis ? '이번 주 완료' : '이 주 완료', groups.done, W));
  }
  body.append(tasksBox);
}

function addExamples() {
  const t = today();
  [
    { title: '예시 · 연말 프로모션 준비', due: ymd(addDays(t, 30)), lead: 30, repeat: true, color: 'rose', memo: '한 달 전부터 매주 진행 상황 확인' },
    { title: '예시 · 분기 재고 점검 보고', due: ymd(addDays(t, 10)), lead: 14, repeat: true, color: 'amber' },
    { title: '예시 · 거래처 견적서 회신', due: ymd(addDays(t, 2)), lead: 0, repeat: false, color: 'teal', memo: '체크하면 바로 완료되는 일반 업무' },
  ].forEach(o => tasks.put(normTask(newId(), { ...o, created: ymd(t), sort: Date.now() })));
}

export function wireWeek() {
  $('#wkPrev').addEventListener('click', () => { weekState.week = addDays(weekState.week, -7); window.dispatchEvent(new Event('planner:render')); });
  $('#wkNext').addEventListener('click', () => { weekState.week = addDays(weekState.week, 7); window.dispatchEvent(new Event('planner:render')); });
  $('#wkToday').addEventListener('click', () => { weekState.week = weekStart(today()); window.dispatchEvent(new Event('planner:render')); });
}
