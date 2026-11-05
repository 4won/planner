// Edit dialogs for tasks, events and projects, plus the "+ 추가" chooser and the one-day sheet.
// All of them render into the single <dialog id="sheet">.
import { $, el, btn, option, armedDelete, ddayEl } from './ui.js';
import { ymd, today, parse, addDays, weekStart, mdLong, newId, leadLabel, okDate, remindLabel } from './dates.js';
import { holidayOf } from './holidays.js';
import { COLORS, COLOR_NAMES, STATUSES, PRIORITIES, REMIND_OPTIONS, normTask, normEvent, normProject, normTags, tagsText, withStatus, eventsOn, eventTimeText, normRecur, recurText, channelLabel } from './model.js';
import { tasks, events, projects, activeProjects, allEvents, promosIn, projectName } from './db.js';

const sheet = () => $('#sheet');
let nav = () => {};
export const setNavigator = fn => { nav = fn; };

// The X button takes the initial focus, so no text box is focused and no keyboard pops up.
export function closeX(onClose = close) {
  const x = btn('sheet-x', '', onClose, '닫기');
  x.setAttribute('aria-label', '닫기'); x.autofocus = true;
  x.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  return x;
}
function open(title, build) {
  const d = sheet();
  d.textContent = '';
  const form = el('form', 'ed');
  form.noValidate = true;
  form.append(el('h2', null, title));
  build(form);
  d.append(closeX(), form);
  if (!d.open) d.showModal();
  d.querySelector('.sheet-x').focus({ preventScroll: true });
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
    const l = el('label', 'c-' + c); l.title = COLOR_NAMES[c];
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
export const projectOptions = () => [['', '프로젝트 없음'], ...activeProjects().map(p => [p.id, p.name])];
// Hashtag box: "#VMD #촬영" (spaces or commas also work).
export function tagInput(tags, id = 't-tags') {
  const i = input(id, 'text', tagsText(tags), { maxlength: 200, placeholder: '#VMD #촬영', autocomplete: 'off', autocapitalize: 'off' });
  return { el: i, get value() { return normTags(i.value); } };
}

// ---------- task ----------
export function openTask(id, preset = {}, onSaved) {
  const it = id ? tasks.get(id) : null;
  const base = it || normTask(newId(), { repeat: !preset.projectId, lead: preset.projectId ? 0 : 30, ...preset });
  open(it ? '업무 편집' : '새 업무', form => {
    form.append(field('제목', input('t-title', 'text', base.title === '(제목 없음)' ? '' : base.title, { maxlength: 120, placeholder: '예: 겨울 시즌 매장 VMD 교체' }), 't-title'));

    const pSel = select('t-project', projectOptions(), base.projectId || '');
    const tagBox = tagInput(base.tags);
    const row1 = el('div', 'two'); row1.append(field('프로젝트', pSel, 't-project'), field('해시태그', tagBox.el, 't-tags'));
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
        tags: tagBox.value,
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
// preset.occDate: the occurrence that was clicked, when the event repeats.
export function openEvent(id, preset = {}, onSaved) {
  const it = id ? events.get(id) : null;
  const occDate = preset.occDate || (it ? it.startDate : null);
  const base = it || normEvent(newId('e'), { startTime: preset.allDay ? null : (preset.startTime || nextHalfHour()), ...preset });
  open(it ? '일정 편집' : '새 일정', form => {
    form.append(field('제목', input('e-title', 'text', base.title === '(제목 없음)' ? '' : base.title, { maxlength: 120, placeholder: '예: 주간 MD 회의' }), 'e-title'));
    const allDay = input('e-allday', 'checkbox'); allDay.checked = !base.startTime;
    const ad = el('label', 'inline-check'); ad.htmlFor = 'e-allday'; ad.append(allDay, el('span', null, '종일'));

    const r1 = el('div', 'two');
    r1.append(field('날짜', input('e-date', 'date', base.startDate), 'e-date'), field('종료 날짜', input('e-enddate', 'date', base.endDate), 'e-enddate'));
    form.append(r1);
    const r2 = el('div', 'two'); r2.id = 'e-times';
    r2.append(field('시작', input('e-start', 'time', base.startTime || '09:00', { step: 300 }), 'e-start'), field('종료', input('e-end', 'time', base.endTime || '', { step: 300 }), 'e-end'));
    form.append(r2);

    // repeat: hidden until the box is ticked
    const rep = input('e-repeat', 'checkbox'); rep.checked = !!base.recur;
    const checks = el('div', 'checks-row'); checks.append(ad);
    const rl = el('label', 'inline-check'); rl.htmlFor = 'e-repeat'; rl.append(rep, el('span', null, '반복'));
    checks.append(rl); form.append(checks);
    const rb = el('div', 'recur-box');
    const freq = select('e-freq', [['weekly', '매주'], ['monthly', '매월'], ['yearly', '매년']], base.recur ? base.recur.freq : 'weekly');
    rb.append(field('반복 주기', freq, 'e-freq'));
    const wd = el('div', 'chips weekdays'); wd.setAttribute('role', 'group'); wd.setAttribute('aria-label', '반복 요일');
    [1, 2, 3, 4, 5, 6, 0].forEach(d => {
      const l = el('label', 'chip-check'); const c = el('input'); c.type = 'checkbox'; c.value = d;
      c.checked = base.recur && base.recur.days.length ? base.recur.days.includes(d) : parse(base.startDate).getDay() === d;
      l.append(c, el('span', null, '일월화수목금토'[d])); wd.append(l);
    });
    const wdf = el('div', 'field'); wdf.append(el('span', 'lbl', '요일'), wd); rb.append(wdf);
    const mm = el('div', 'chips monthmode'); mm.setAttribute('role', 'radiogroup'); mm.setAttribute('aria-label', '매월 반복 방식');
    const mmf = el('div', 'field'); mmf.append(el('span', 'lbl', '매월'), mm); rb.append(mmf);
    const yl = el('p', 'set-small'); rb.append(yl);
    const until = input('e-until', 'date', base.recur && base.recur.until || '');
    rb.append(field('언제까지 (비우면 계속)', until, 'e-until'));
    const rsum = el('div', 'hint'); rb.append(rsum);
    form.append(rb);

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

    const recurValue = () => {
      if (!rep.checked) return null;
      return normRecur({
        freq: freq.value,
        days: freq.value === 'weekly' ? [...wd.querySelectorAll('input:checked')].map(c => Number(c.value)) : [],
        monthMode: (mm.querySelector('input:checked') || {}).value || 'date',
        until: until.value || null,
        exdates: base.recur ? base.recur.exdates : [],
      });
    };
    const sync = () => {
      r2.hidden = allDay.checked;
      const ed = form.querySelector('#e-enddate'), sd = form.querySelector('#e-date');
      if (!ed.value || ed.value < sd.value) ed.value = sd.value;
      rb.hidden = !rep.checked;
      wdf.hidden = freq.value !== 'weekly'; mmf.hidden = freq.value !== 'monthly'; yl.hidden = freq.value !== 'yearly';
      const s = parse(sd.value || ymd(today()));
      const keep = (mm.querySelector('input:checked') || {}).value || (base.recur && base.recur.monthMode) || 'date';
      mm.textContent = '';
      const nthTxt = recurText({ startDate: ymd(s), recur: { freq: 'monthly', monthMode: 'nth', days: [], exdates: [] } });
      [['date', `${s.getDate()}일`], ['nth', nthTxt.replace('매월 ', '')]].forEach(([v, l]) => {
        const lab = el('label', 'chip-check'); const r = el('input'); r.type = 'radio'; r.name = 'e-mm'; r.value = v; r.checked = v === keep;
        lab.append(r, el('span', null, l)); mm.append(lab);
      });
      yl.textContent = `매년 ${s.getMonth() + 1}월 ${s.getDate()}일에 반복합니다.`;
      until.min = sd.value;
      const rv = recurValue();
      rsum.textContent = rv ? `${recurText({ startDate: sd.value, recur: rv })} · ${sd.value.slice(5).replace('-', '/')}부터 반복합니다.` : '';
    };
    form.addEventListener('change', sync); form.addEventListener('input', e => { if (e.target === until || e.target.id === 'e-date') sync(); });
    sync();

    // Delete: repeating events ask which occurrences go.
    const a = el('div', 'ed-actions');
    if (it && it.recur) {
      const del = btn('btn danger', '삭제…');
      const choices = el('div', 'del-choices'); choices.hidden = true;
      const occ = occDate && occDate >= it.startDate ? occDate : it.startDate;
      choices.append(el('span', 'set-small', `${occ.slice(5).replace('-', '/')} 회차 기준`),
        btn('btn danger', '이 일정만', () => { events.put({ ...it, recur: { ...it.recur, exdates: [...it.recur.exdates, occ] } }); close(); }),
        btn('btn danger', '이 일정과 이후 전부', () => {
          if (occ <= it.startDate) events.remove(it.id);
          else events.put({ ...it, recur: { ...it.recur, until: ymd(addDays(parse(occ), -1)) } });
          close();
        }),
        btn('btn danger', '전체 삭제', () => { events.remove(it.id); close(); }));
      del.addEventListener('click', () => { choices.hidden = !choices.hidden; });
      a.append(del);
      form.append(choices);
    } else if (it) { const d = btn('btn danger', '삭제'); armedDelete(d, () => { events.remove(it.id); close(); }); a.append(d); }
    a.append(el('span', 'spacer'), btn('btn', '취소', close));
    const s = el('button', 'btn primary', '저장'); s.type = 'submit'; a.append(s);
    form.append(a);
    if (it && it.recur) form.insertBefore(el('p', 'set-small', '반복 일정을 고치면 모든 회차에 적용됩니다.'), a);

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
        recur: recurValue(),
      });
      events.put(next); close();
      if (onSaved) onSaved(next);
    });
  });
}

// Read-only card for a promotion copied from the work hub.
export function openPromo(p) {
  open(p.title, form => {
    const box = el('div', 'promo-info');
    const row = (k, v) => { if (!v) return; const r = el('div', 'promo-row'); r.append(el('span', 'lbl', k), el('span', null, v)); box.append(r); };
    row('기간', `${mdLong(parse(p.startDate))} – ${mdLong(parse(p.endDate))}`);
    row('채널', channelLabel(p.channel));
    row('상태', p.status === 'confirm' ? '확정' : p.status === 'discuss' ? '논의 중' : p.status);
    if (p.memo) { const m = el('div', 'promo-memo', p.memo); box.append(m); }
    box.append(el('p', 'set-small', '허브의 프로모션 플랜에서 자동으로 가져온 항목입니다. 내용은 허브(구글 시트)에서 고쳐 주세요.'));
    form.append(box);
    const a = el('div', 'ed-actions'); a.append(el('span', 'spacer'), btn('btn', '닫기', close)); form.append(a);
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
    const extra = [];
    if (p) extra.push(btn('btn ghost', p.archived ? '보관 해제' : '보관', () => { projects.put({ ...p, archived: !p.archived }); close(); if (onSaved) onSaved(null); }));
    actions(form, {
      onDelete: p ? () => {
        // Tasks, events and memos stay; they just lose the project link.
        tasks.all().filter(t => t.projectId === p.id).forEach(t => tasks.put({ ...t, projectId: null }));
        events.all().filter(e => e.projectId === p.id).forEach(e => events.put({ ...e, projectId: null }));
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
      close(); if (onSaved) onSaved(next);
    });
  });
}

export const promoColor = p => ({ online: 'blue', offline: 'orange', both: 'violet' }[p.channel] || 'slate');

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
  open(`${d.getFullYear()}년 ${mdLong(d)}${holidayOf(dateStr) ? ` · ${holidayOf(dateStr)}` : ''}`, form => {
    const list = el('div', 'group');
    const evs = eventsOn(allEvents(dateStr, dateStr), dateStr);
    const due = tasks.all().filter(t => t.due === dateStr);
    if (!evs.length && !due.length) list.append(el('p', 'set-msg', '이 날짜에 일정이나 마감 업무가 없습니다.'));
    evs.forEach(e => {
      const r = el('button', 'mini-row' + (e.external ? ' ext' : '')); r.type = 'button';
      r.append(el('span', 'dot c-' + e.color), el('span', 'mini-time', eventTimeText(e, dateStr)), el('span', 'mini-title', e.title));
      if (e.external) r.append(el('span', 'pill', '외부'));
      else r.addEventListener('click', () => openEvent(e.seriesId || e.id, { occDate: e.occDate }));
      list.append(r);
    });
    due.forEach(t => {
      const r = el('button', 'mini-row task' + (t.done ? ' done' : '')); r.type = 'button';
      r.append(el('span', 'dot c-' + t.color), el('span', 'mini-time', '마감'), el('span', 'mini-title', t.title));
      if (t.projectId) r.append(el('span', 'pill', projectName(t.projectId)));
      r.addEventListener('click', () => openTask(t.id));
      list.append(r);
    });
    promosIn(dateStr, dateStr).forEach(p => {
      const r = el('button', 'mini-row promo'); r.type = 'button';
      r.append(el('span', 'dot c-' + promoColor(p)), el('span', 'mini-time', '프로모션'), el('span', 'mini-title', p.title));
      r.addEventListener('click', () => openPromo(p));
      list.append(r);
    });
    form.append(list);
    const a = el('div', 'ed-actions');
    a.append(btn('btn', '+ 일정', () => openEvent(null, { startDate: dateStr, endDate: dateStr })), btn('btn', '+ 업무', () => openTask(null, { due: dateStr })), el('span', 'spacer'), btn('btn', '닫기', close));
    form.append(a);
  });
}
