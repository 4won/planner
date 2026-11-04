// Edit dialogs for tasks, events and projects, plus the "+ 추가" chooser and the one-day sheet.
// All of them render into the single <dialog id="sheet">.
import { $, el, btn, option, armedDelete, ddayEl } from './ui.js';
import { ymd, today, parse, addDays, weekStart, mdLong, newId, leadLabel, okDate, remindLabel } from './dates.js';
import { COLORS, STATUSES, PRIORITIES, REMIND_OPTIONS, normTask, normEvent, normProject, normGroup, withStatus, eventsOn, eventTimeText } from './model.js';
import { tasks, events, projects, groups, activeProjects, allEvents, projectName } from './db.js';

const sheet = () => $('#sheet');
let nav = () => {};
export const setNavigator = fn => { nav = fn; };

function open(title, build) {
  const d = sheet();
  d.textContent = '';
  const form = el('form', 'ed');
  form.noValidate = true;
  form.append(el('h2', null, title));
  build(form);
  d.append(form);
  if (!d.open) d.showModal();
  const first = form.querySelector('input[type=text]');
  if (first && !('ontouchstart' in window)) first.focus();
  return form;
}
export const close = () => { if (sheet().open) sheet().close(); };

function field(label, control, id) {
  const f = el('div', 'field');
  const l = el('label', null, label); if (id) l.htmlFor = id;
  f.append(l, control);
  return f;
}
function input(id, type, value, attrs = {}) {
  const i = el('input'); i.id = id; i.type = type; if (value != null) i.value = value;
  Object.entries(attrs).forEach(([k, v]) => i.setAttribute(k, v));
  return i;
}
function select(id, opts, value) {
  const s = el('select'); s.id = id;
  opts.forEach(([v, l]) => s.append(option(v, l, String(v) === String(value))));
  return s;
}
function swatches(name, value) {
  const w = el('div', 'swatches');
  COLORS.forEach(c => {
    const l = el('label', 'c-' + c); l.title = c;
    const r = el('input'); r.type = 'radio'; r.name = name; r.value = c; r.checked = c === value;
    l.append(r); w.append(l);
  });
  return w;
}
const pickedColor = (form, name) => (form.querySelector(`input[name=${name}]:checked`) || {}).value;
function actions(form, { onDelete, extra = [], saveLabel = '저장' }) {
  const a = el('div', 'ed-actions');
  if (onDelete) { const d = btn('btn danger', '삭제'); armedDelete(d, onDelete); a.append(d); }
  extra.forEach(x => a.append(x));
  a.append(el('span', 'spacer'), btn('btn', '취소', close));
  const s = el('button', 'btn primary', saveLabel); s.type = 'submit';
  a.append(s);
  form.append(a);
}
const projectOptions = () => [['', '프로젝트 없음'], ...activeProjects().map(p => [p.id, p.name])];
const groupOptions = pid => [['', '그룹 없음'], ...groups.all().filter(g => g.projectId === pid).sort((a, b) => a.sort - b.sort).map(g => [g.id, g.name])];

// ---------- task ----------
export function openTask(id, preset = {}, onSaved) {
  const it = id ? tasks.get(id) : null;
  const base = it || normTask(newId(), { repeat: !preset.projectId, lead: preset.projectId ? 0 : 30, ...preset });
  open(it ? '업무 편집' : '새 업무', form => {
    form.append(field('제목', input('t-title', 'text', base.title === '(제목 없음)' ? '' : base.title, { maxlength: 120, placeholder: '예: 겨울 시즌 매장 VMD 교체' }), 't-title'));

    const pSel = select('t-project', projectOptions(), base.projectId || '');
    const gSel = select('t-group', groupOptions(base.projectId), base.groupId || '');
    pSel.addEventListener('change', () => { gSel.textContent = ''; groupOptions(pSel.value || null).forEach(([v, l]) => gSel.append(option(v, l))); });
    const row1 = el('div', 'two'); row1.append(field('프로젝트', pSel, 't-project'), field('그룹', gSel, 't-group'));
    form.append(row1);

    const row2 = el('div', 'two');
    row2.append(field('상태', select('t-status', STATUSES.map(s => [s.key, s.label]), base.status), 't-status'),
      field('우선순위', select('t-priority', PRIORITIES.map((p, i) => [i, p]), base.priority), 't-priority'));
    form.append(row2);

    const row3 = el('div', 'two');
    row3.append(field('시작일', input('t-start', 'date', base.startDate || ''), 't-start'), field('마감일', input('t-due', 'date', base.due || ''), 't-due'));
    form.append(row3);

    const leadPreset = ['0', '7', '14', '30', '60', '90'].includes(String(base.lead));
    const lead = select('t-lead', [['0', '마감 주에만'], ['7', '1주 전부터'], ['14', '2주 전부터'], ['30', '한 달 전부터'], ['60', '두 달 전부터'], ['90', '석 달 전부터'], ['custom', '직접 입력']], leadPreset ? String(base.lead) : 'custom');
    const leadCustom = input('t-leadCustom', 'number', leadPreset ? 45 : base.lead, { min: 1, max: 365, 'aria-label': '며칠 전부터' });
    const lr = el('div', 'leadrow'); lr.append(lead, leadCustom);
    form.append(field('이번 주 체크리스트에 언제부터 올릴까요', lr, 't-lead'));

    const tg = el('label', 'toggle'); tg.htmlFor = 't-repeat';
    const rep = input('t-repeat', 'checkbox'); rep.checked = base.repeat;
    const tx = el('span'); tx.append(el('b', null, '완료할 때까지 매주 다시 확인'), el('small', null, '이번 주에 체크해도 다음 주 체크리스트에 다시 나옵니다. ‘완료’를 눌러야 끝납니다.'));
    tg.append(rep, tx); form.append(tg);

    const sw = el('div', 'field'); sw.append(el('span', 'lbl', '색상'), swatches('t-color', base.color)); form.append(sw);
    const memo = el('textarea'); memo.id = 't-memo'; memo.maxLength = 2000; memo.value = base.memo; memo.placeholder = '체크할 내용, 담당자, 링크 등';
    form.append(field('메모', memo, 't-memo'));
    const hint = el('div', 'hint'); form.append(hint);

    const leadValue = () => lead.value === 'custom' ? Math.max(1, Math.min(365, Math.round(Number(leadCustom.value) || 1))) : Number(lead.value);
    const update = () => {
      const due = form.querySelector('#t-due').value;
      lead.disabled = !due; leadCustom.hidden = lead.value !== 'custom'; leadCustom.disabled = !due;
      if (!due) hint.textContent = rep.checked ? '마감일 없이 매주 체크리스트에 나옵니다. ‘완료’를 누르면 끝납니다.' : '마감일 없는 업무입니다. 체크하면 바로 완료됩니다.';
      else {
        const d = parse(due), l = leadValue(), sw2 = weekStart(addDays(d, -l));
        hint.textContent = `${mdLong(d)} 마감 · ${l ? `${mdLong(sw2)}이 있는 주부터` : '마감 주에'} 이번 주 체크리스트에 표시` + (rep.checked ? '. 매주 체크해도 완료할 때까지 다음 주에 다시 나옵니다.' : '. 체크하면 완료됩니다.');
      }
    };
    form.addEventListener('input', update); form.addEventListener('change', update); update();

    const extra = [];
    if (it) extra.push(btn('btn ghost', it.done ? '다시 진행' : '완료 처리', () => { tasks.put(withStatus(it, it.done ? 'todo' : 'done')); close(); }));
    actions(form, { onDelete: it ? () => { tasks.remove(it.id); close(); } : null, extra });

    form.addEventListener('submit', e => {
      e.preventDefault();
      const title = form.querySelector('#t-title').value.trim();
      if (!title) { form.querySelector('#t-title').focus(); return; }
      const due = form.querySelector('#t-due').value || null;
      let next = normTask(base.id, {
        ...base, title, due,
        lead: due ? leadValue() : 0,
        repeat: rep.checked,
        color: pickedColor(form, 't-color') || base.color,
        memo: memo.value,
        projectId: pSel.value || null,
        groupId: gSel.value || null,
        priority: Number(form.querySelector('#t-priority').value),
        startDate: form.querySelector('#t-start').value || null,
        sort: base.sort || Date.now(),
      });
      const status = form.querySelector('#t-status').value;
      if (status !== next.status) next = withStatus(next, status);
      tasks.put(next); close();
      if (onSaved) onSaved(next);
    });
  });
}

// ---------- event ----------
export function openEvent(id, preset = {}, onSaved) {
  const it = id ? events.get(id) : null;
  const base = it || normEvent(newId('e'), { startTime: preset.allDay ? null : (preset.startTime || nextHalfHour()), ...preset });
  open(it ? '일정 편집' : '새 일정', form => {
    form.append(field('제목', input('e-title', 'text', base.title === '(제목 없음)' ? '' : base.title, { maxlength: 120, placeholder: '예: 주간 MD 회의' }), 'e-title'));
    const allDay = input('e-allday', 'checkbox'); allDay.checked = !base.startTime;
    const ad = el('label', 'inline-check'); ad.htmlFor = 'e-allday'; ad.append(allDay, el('span', null, '종일'));

    const r1 = el('div', 'two');
    r1.append(field('날짜', input('e-date', 'date', base.startDate), 'e-date'), field('종료 날짜', input('e-enddate', 'date', base.endDate), 'e-enddate'));
    form.append(r1, ad);
    const r2 = el('div', 'two'); r2.id = 'e-times';
    r2.append(field('시작', input('e-start', 'time', base.startTime || '09:00', { step: 300 }), 'e-start'), field('종료', input('e-end', 'time', base.endTime || '', { step: 300 }), 'e-end'));
    form.append(r2);
    form.append(field('장소', input('e-loc', 'text', base.location, { maxlength: 200, placeholder: '예: 본사 3층 회의실' }), 'e-loc'));

    const rem = el('div', 'chips'); rem.id = 'e-remind';
    REMIND_OPTIONS.forEach(m => {
      const l = el('label', 'chip-check');
      const c = el('input'); c.type = 'checkbox'; c.value = m; c.checked = base.remind.includes(m);
      l.append(c, el('span', null, remindLabel(m)));
      rem.append(l);
    });
    const rf = el('div', 'field'); rf.append(el('span', 'lbl', '알림 (휴대폰 푸시)'), rem); form.append(rf);

    form.append(field('프로젝트', select('e-project', projectOptions(), base.projectId || ''), 'e-project'));
    const sw = el('div', 'field'); sw.append(el('span', 'lbl', '색상'), swatches('e-color', base.color)); form.append(sw);
    const memo = el('textarea'); memo.id = 'e-memo'; memo.maxLength = 2000; memo.value = base.memo; memo.placeholder = '안건, 참석자, 링크 등';
    form.append(field('메모', memo, 'e-memo'));

    const sync = () => { r2.hidden = allDay.checked; const ed = form.querySelector('#e-enddate'), sd = form.querySelector('#e-date'); if (!ed.value || ed.value < sd.value) ed.value = sd.value; };
    allDay.addEventListener('change', sync); form.querySelector('#e-date').addEventListener('change', sync); sync();

    actions(form, { onDelete: it ? () => { events.remove(it.id); close(); } : null });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const title = form.querySelector('#e-title').value.trim();
      if (!title) { form.querySelector('#e-title').focus(); return; }
      const next = normEvent(base.id, {
        title,
        startDate: form.querySelector('#e-date').value || ymd(today()),
        endDate: form.querySelector('#e-enddate').value,
        startTime: allDay.checked ? null : form.querySelector('#e-start').value,
        endTime: allDay.checked ? null : form.querySelector('#e-end').value,
        location: form.querySelector('#e-loc').value,
        remind: [...rem.querySelectorAll('input:checked')].map(c => Number(c.value)),
        projectId: form.querySelector('#e-project').value || null,
        color: pickedColor(form, 'e-color') || base.color,
        memo: memo.value,
      });
      events.put(next); close();
      if (onSaved) onSaved(next);
    });
  });
}
function nextHalfHour() {
  const t = new Date(); t.setMinutes(t.getMinutes() < 30 ? 30 : 60, 0, 0);
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

// ---------- project ----------
export function openProject(id, onSaved) {
  const p = id ? projects.get(id) : null;
  const base = p || normProject(newId('p'), { sort: Date.now() });
  open(p ? '프로젝트 편집' : '새 프로젝트', form => {
    form.append(field('이름', input('p-name', 'text', p ? p.name : '', { maxlength: 80, placeholder: '예: 26 FW 시즌 런칭' }), 'p-name'));
    const sw = el('div', 'field'); sw.append(el('span', 'lbl', '색상'), swatches('p-color', base.color)); form.append(sw);
    if (!p) form.append(el('p', 'set-msg', '‘할 일’, ‘진행 중’ 두 그룹이 기본으로 만들어집니다. 나중에 이름을 바꾸거나 추가할 수 있어요.'));
    const extra = [];
    if (p) extra.push(btn('btn ghost', p.archived ? '보관 해제' : '보관', () => { projects.put({ ...p, archived: !p.archived }); close(); if (onSaved) onSaved(null); }));
    actions(form, {
      onDelete: p ? () => {
        // Tasks, events and memos stay; they just lose the project link.
        tasks.all().filter(t => t.projectId === p.id).forEach(t => tasks.put({ ...t, projectId: null, groupId: null }));
        events.all().filter(e => e.projectId === p.id).forEach(e => events.put({ ...e, projectId: null }));
        groups.all().filter(g => g.projectId === p.id).forEach(g => groups.remove(g.id));
        projects.remove(p.id); close(); if (onSaved) onSaved(null);
      } : null,
      extra,
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const name = form.querySelector('#p-name').value.trim();
      if (!name) { form.querySelector('#p-name').focus(); return; }
      const next = normProject(base.id, { ...base, name, color: pickedColor(form, 'p-color') || base.color });
      projects.put(next);
      if (!p) ['할 일', '진행 중'].forEach((n, i) => groups.put(normGroup(newId('g'), { projectId: next.id, name: n, sort: i + 1 })));
      close(); if (onSaved) onSaved(next);
    });
  });
}

// ---------- chooser and day sheet ----------
export function openAdd(date) {
  open('무엇을 추가할까요?', form => {
    const g = el('div', 'choose');
    g.append(
      btn('choose-btn', '업무', () => openTask(null, date ? { due: date } : {})),
      btn('choose-btn', '일정', () => openEvent(null, date ? { startDate: date, endDate: date } : {})),
      btn('choose-btn', '메모', () => { close(); nav('memos', { newMemo: true }); }),
    );
    form.append(g);
    const a = el('div', 'ed-actions'); a.append(el('span', 'spacer'), btn('btn', '닫기', close)); form.append(a);
  });
}

export function openDay(dateStr) {
  const d = parse(dateStr);
  open(`${d.getFullYear()}년 ${mdLong(d)}`, form => {
    const list = el('div', 'group');
    const evs = eventsOn(allEvents(), dateStr);
    const due = tasks.all().filter(t => t.due === dateStr);
    if (!evs.length && !due.length) list.append(el('p', 'set-msg', '이 날짜에 일정이나 마감 업무가 없습니다.'));
    evs.forEach(e => {
      const r = el('button', 'mini-row' + (e.external ? ' ext' : '')); r.type = 'button';
      r.append(el('span', 'dot c-' + e.color), el('span', 'mini-time', eventTimeText(e, dateStr)), el('span', 'mini-title', e.title));
      if (e.external) r.append(el('span', 'pill', '외부'));
      else r.addEventListener('click', () => openEvent(e.id));
      list.append(r);
    });
    due.forEach(t => {
      const r = el('button', 'mini-row task' + (t.done ? ' done' : '')); r.type = 'button';
      r.append(el('span', 'dot c-' + t.color), el('span', 'mini-time', '마감'), el('span', 'mini-title', t.title));
      if (t.projectId) r.append(el('span', 'pill', projectName(t.projectId)));
      r.addEventListener('click', () => openTask(t.id));
      list.append(r);
    });
    form.append(list);
    const a = el('div', 'ed-actions');
    a.append(btn('btn', '+ 일정', () => openEvent(null, { startDate: dateStr, endDate: dateStr })), btn('btn', '+ 업무', () => openTask(null, { due: dateStr })), el('span', 'spacer'), btn('btn', '닫기', close));
    form.append(a);
  });
}
