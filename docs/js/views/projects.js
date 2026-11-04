// Projects: a chip row to pick a project (or every task), then table / board / timeline.
import { $, el, btn, option, ddayEl, empty, armedDelete, CHECK_SVG } from '../ui.js';
import { ymd, parse, addDays, today, daysBetween, md, newId, DOW } from '../dates.js';
import { STATUSES, PRIORITIES, normTask, normGroup, withStatus, statusLabel } from '../model.js';
import { tasks, projects, groups, activeProjects, projectName } from '../db.js';
import { state } from '../store.js';
import { openTask, openProject } from '../editors.js';

export const projState = { pid: 'all', view: 'table', q: '', hideDone: true, showArchived: false };
const rerender = () => window.dispatchEvent(new Event('planner:render'));
const coarse = () => matchMedia('(pointer: coarse)').matches;

// The board always shows its 완료 column; table and timeline follow "완료 숨기기".
function visibleTasks(keepDone) {
  const q = projState.q.trim().toLowerCase();
  return tasks.all().filter(t =>
    (projState.pid === 'all' || t.projectId === projState.pid) &&
    (keepDone || !projState.hideDone || !t.done) &&
    (!q || (t.title + ' ' + t.memo).toLowerCase().includes(q)));
}
const order = (a, b) => (a.sort || 0) - (b.sort || 0) || ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0);

export function renderProjects() {
  if (projState.pid !== 'all' && !projects.get(projState.pid)) projState.pid = 'all';
  // ---- project chips ----
  const bar = $('#projChips'); bar.textContent = '';
  const chip = (id, label, color) => {
    const b = btn('pchip' + (projState.pid === id ? ' on' : ''), '', () => { projState.pid = id; rerender(); });
    if (color) b.append(el('span', 'dot c-' + color));
    b.append(el('span', null, label));
    b.setAttribute('aria-pressed', String(projState.pid === id));
    return b;
  };
  bar.append(chip('all', '전체 업무'));
  activeProjects().forEach(p => bar.append(chip(p.id, p.name, p.color)));
  const archived = projects.all().filter(p => p.archived);
  if (projState.showArchived) archived.forEach(p => bar.append(chip(p.id, `${p.name} (보관)`, p.color)));
  bar.append(btn('pchip add', '+ 프로젝트', () => openProject(null, p => { if (p) { projState.pid = p.id; rerender(); } })));
  if (archived.length) bar.append(btn('pchip ghost', projState.showArchived ? '보관함 닫기' : `보관함 ${archived.length}`, () => { projState.showArchived = !projState.showArchived; rerender(); }));

  // ---- header ----
  const p = projState.pid === 'all' ? null : projects.get(projState.pid);
  const head = $('#projHead'); head.textContent = '';
  const ttl = el('div', 'proj-title');
  if (p) { ttl.append(el('span', 'dot big c-' + p.color), el('h2', null, p.name), btn('linkbtn', '편집', () => openProject(p.id))); }
  else ttl.append(el('h2', null, '전체 업무'));
  head.append(ttl);
  document.querySelectorAll('[data-pview]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.pview === projState.view)));
  $('#hideDone').checked = projState.hideDone;

  const body = $('#projBody'); body.textContent = '';
  if (!state.loaded) { body.append(el('div', 'empty', '불러오는 중…')); return; }
  if (!projects.all().length && !tasks.all().length) {
    body.append(empty('프로젝트를 만들어 업무를 묶어 보세요', '프로젝트 → 그룹 → 업무 순서로 정리하고, 표·보드·타임라인으로 볼 수 있습니다.', [btn('btn primary', '+ 프로젝트', () => openProject(null, np => { if (np) { projState.pid = np.id; rerender(); } }))]));
    return;
  }
  const list = visibleTasks(projState.view === 'board');
  $('#hideDone').closest('label').hidden = projState.view === 'board';
  if (projState.view === 'board') body.append(board(list, p));
  else if (projState.view === 'timeline') body.append(timeline(list));
  else body.append(table(list, p));
}

// ---------- table ----------
function sectionsFor(list, p) {
  if (p) {
    const gs = groups.all().filter(g => g.projectId === p.id).sort((a, b) => a.sort - b.sort);
    const ids = new Set(gs.map(g => g.id));
    const secs = gs.map(g => ({ key: g.id, title: g.name, group: g, items: list.filter(t => t.groupId === g.id) }));
    const loose = list.filter(t => !t.groupId || !ids.has(t.groupId));
    if (loose.length || !gs.length) secs.push({ key: 'none', title: '그룹 없음', items: loose });
    return secs;
  }
  const secs = activeProjects().map(pr => ({ key: pr.id, title: pr.name, color: pr.color, project: pr, items: list.filter(t => t.projectId === pr.id) })).filter(s => s.items.length);
  const loose = list.filter(t => !t.projectId || !projects.get(t.projectId) || projects.get(t.projectId).archived);
  if (loose.length) secs.push({ key: 'none', title: '프로젝트 없음', items: loose });
  return secs;
}

function table(list, p) {
  const wrap = el('div', 'ptable');
  const secs = sectionsFor(list, p);
  if (!secs.length) wrap.append(el('p', 'quiet', projState.q ? '검색 결과가 없습니다.' : '표시할 업무가 없습니다.'));
  secs.forEach(s => {
    const sec = el('section', 'psec');
    const h = el('div', 'psec-head');
    if (s.color) h.append(el('span', 'dot c-' + s.color));
    if (s.group) {
      const name = el('input', 'group-name'); name.value = s.group.name; name.maxLength = 60; name.setAttribute('aria-label', '그룹 이름');
      name.addEventListener('change', () => { const v = name.value.trim(); if (v && v !== s.group.name) groups.put({ ...s.group, name: v }); });
      h.append(name);
    } else h.append(el('span', 'psec-title', s.title));
    h.append(el('span', 'count', String(s.items.length)));
    if (s.group) {
      const del = btn('linkbtn danger', '그룹 삭제');
      armedDelete(del, () => {
        tasks.all().filter(t => t.groupId === s.group.id).forEach(t => tasks.put({ ...t, groupId: null }));
        groups.remove(s.group.id);
      }, '그룹 삭제');
      h.append(el('span', 'spacer'), del);
    }
    sec.append(h);

    const head = el('div', 'prow phead');
    ['', '업무', '상태', '우선순위', '시작', '마감'].forEach(t => head.append(el('span', null, t)));
    sec.append(head);
    s.items.sort(order).forEach(t => sec.append(tableRow(t, !p)));

    // quick add
    const add = el('form', 'quickadd');
    const inp = el('input'); inp.type = 'text'; inp.placeholder = '+ 업무 추가 (엔터)'; inp.maxLength = 120; inp.setAttribute('aria-label', `${s.title}에 업무 추가`);
    add.append(inp);
    add.addEventListener('submit', e => {
      e.preventDefault();
      const title = inp.value.trim(); if (!title) return;
      const projectId = p ? p.id : (s.project ? s.project.id : null);
      tasks.put(normTask(newId(), { title, projectId, groupId: s.group ? s.group.id : null, repeat: false, sort: Date.now() }));
      inp.value = '';
      setTimeout(() => { const again = document.querySelector(`[aria-label="${s.title}에 업무 추가"]`); if (again) again.focus(); }, 50);
    });
    sec.append(add);
    wrap.append(sec);
  });
  if (p) wrap.append(btn('btn ghost addgroup', '+ 그룹 추가', () => {
    const n = groups.all().filter(g => g.projectId === p.id).length;
    groups.put(normGroup(newId('g'), { projectId: p.id, name: `새 그룹 ${n + 1}`, sort: Date.now() }));
  }));
  return wrap;
}

function tableRow(t, showProject) {
  const r = el('div', 'prow' + (t.done ? ' is-done' : ''));
  const cb = el('button', 'check'); cb.type = 'button'; cb.innerHTML = CHECK_SVG;
  cb.setAttribute('aria-pressed', String(t.done)); cb.setAttribute('aria-label', `${t.title} 완료`);
  cb.addEventListener('click', () => tasks.put(withStatus(t, t.done ? 'todo' : 'done')));
  r.append(cb);

  const title = btn('ptitle', '', () => openTask(t.id));
  title.append(el('span', 'dot c-' + t.color), el('span', 't', t.title));
  if (showProject && t.projectId) title.append(el('span', 'pill proj', projectName(t.projectId)));
  if (t.repeat && !t.done) title.append(el('span', 'pill weekly', '매주'));
  r.append(title);

  const st = el('select', 'stsel st-' + t.status); st.setAttribute('aria-label', '상태');
  STATUSES.forEach(s => st.append(option(s.key, s.label, s.key === t.status)));
  st.addEventListener('change', () => tasks.put(withStatus(t, st.value)));
  r.append(st);

  const pr = el('select', 'prsel pr-' + t.priority); pr.setAttribute('aria-label', '우선순위');
  PRIORITIES.forEach((l, i) => pr.append(option(i, l, i === t.priority)));
  pr.addEventListener('change', () => tasks.put({ ...t, priority: Number(pr.value) }));
  r.append(pr);

  r.append(el('span', 'pdate', t.startDate ? md(parse(t.startDate)) : '—'));
  const due = el('span', 'pdate');
  if (t.due) due.append(el('span', null, md(parse(t.due))), ' ', ddayEl(t.due, t.done)); else due.textContent = '—';
  r.append(due);
  return r;
}

// ---------- board ----------
function board(list, p) {
  const wrap = el('div', 'board');
  STATUSES.forEach(s => {
    const col = el('div', 'col'); col.dataset.status = s.key;
    const h = el('div', 'col-head'); h.append(el('span', 'pill st-' + s.key, s.label), el('span', 'count', String(list.filter(t => t.status === s.key).length)));
    col.append(h);
    const cards = el('div', 'cards');
    list.filter(t => t.status === s.key).sort(order).forEach(t => cards.append(card(t, !p)));
    col.append(cards);
    if (s.key !== 'done') col.append(btn('linkbtn', '+ 업무', () => openTask(null, { projectId: p ? p.id : null, status: s.key })));
    wrap.append(col);
  });
  return wrap;
}

function card(t, showProject) {
  const c = el('div', 'card' + (t.done ? ' is-done' : '')); c.tabIndex = 0;
  const top = el('div', 'card-title'); top.append(el('span', 'dot c-' + t.color), el('span', null, t.title)); c.append(top);
  const meta = el('div', 'row-meta');
  if (t.due) meta.append(ddayEl(t.due, t.done), el('span', null, md(parse(t.due))));
  if (t.priority) meta.append(el('span', 'pill pr-' + t.priority, PRIORITIES[t.priority]));
  if (showProject && t.projectId) meta.append(el('span', 'pill proj', projectName(t.projectId)));
  c.append(meta);
  c.addEventListener('keydown', e => { if (e.key === 'Enter') openTask(t.id); });

  if (coarse()) {
    // Phones: a status menu instead of dragging, so scrolling the board still works.
    const st = el('select', 'stsel st-' + t.status); st.setAttribute('aria-label', '상태 바꾸기');
    STATUSES.forEach(s => st.append(option(s.key, s.label, s.key === t.status)));
    st.addEventListener('click', e => e.stopPropagation());
    st.addEventListener('change', () => tasks.put(withStatus(t, st.value)));
    c.append(st);
    c.addEventListener('click', () => openTask(t.id));
    return c;
  }

  let start = null, ghost = null, over = null;
  c.addEventListener('pointerdown', e => { if (e.button !== 0) return; start = { x: e.clientX, y: e.clientY }; try { c.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety */ } });
  c.addEventListener('pointermove', e => {
    if (!start) return;
    if (!ghost && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) {
      ghost = c.cloneNode(true); ghost.classList.add('ghost'); ghost.style.width = c.offsetWidth + 'px'; document.body.append(ghost); c.classList.add('dragging');
    }
    if (!ghost) return;
    ghost.style.transform = `translate(${e.clientX - 20}px, ${e.clientY - 16}px)`;
    const col = document.elementFromPoint(e.clientX, e.clientY)?.closest('.col');
    if (over && over !== col) over.classList.remove('over');
    over = col; if (over) over.classList.add('over');
  });
  const end = e => {
    if (!start) return;
    start = null;
    if (!ghost) { if (e.type === 'pointerup') openTask(t.id); return; }
    ghost.remove(); ghost = null; c.classList.remove('dragging');
    if (over) { over.classList.remove('over'); if (over.dataset.status !== t.status) tasks.put(withStatus(t, over.dataset.status)); over = null; }
  };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
  return c;
}

// ---------- timeline ----------
function timeline(list) {
  const dated = list.filter(t => t.startDate || t.due);
  const wrap = el('div', 'tl-wrap');
  if (!dated.length) { wrap.append(el('p', 'quiet', '시작일이나 마감일이 있는 업무가 타임라인에 표시됩니다.')); return wrap; }
  const t0 = today();
  let lo = addDays(t0, -7), hi = addDays(t0, 21);
  dated.forEach(t => { const a = parse(t.startDate || t.due), b = parse(t.due || t.startDate); if (a < lo) lo = a; if (b > hi) hi = b; });
  lo = addDays(lo, -2); hi = addDays(hi, 3);
  if (daysBetween(lo, hi) > 240) hi = addDays(lo, 240);
  const n = daysBetween(lo, hi) + 1;

  const scroller = el('div', 'tl'); scroller.style.setProperty('--days', n);
  const head = el('div', 'tl-row tl-head');
  head.append(el('div', 'tl-label', '업무'));
  const days = el('div', 'tl-track');
  for (let i = 0; i < n; i++) {
    const d = addDays(lo, i);
    const cell = el('div', 'tl-day' + (d.getDay() === 0 || d.getDay() === 6 ? ' wkend' : '') + (ymd(d) === ymd(t0) ? ' today' : ''));
    if (d.getDate() === 1 || i === 0) cell.append(el('b', null, `${d.getMonth() + 1}월`));
    cell.append(el('span', null, String(d.getDate())));
    cell.title = md(d);
    days.append(cell);
  }
  head.append(days);
  scroller.append(head);

  const todayIdx = daysBetween(lo, t0);
  dated.sort((a, b) => (a.startDate || a.due) < (b.startDate || b.due) ? -1 : 1).forEach(t => {
    const row = el('div', 'tl-row');
    const lab = btn('tl-label', '', () => openTask(t.id)); lab.append(el('span', 'dot c-' + t.color), el('span', 't', t.title));
    row.append(lab);
    const track = el('div', 'tl-track');
    if (todayIdx >= 0 && todayIdx < n) { const line = el('div', 'tl-now'); line.style.left = `calc(${todayIdx} * var(--dw) + var(--dw) / 2)`; track.append(line); }
    const a = parse(t.startDate || t.due), b = parse(t.due || t.startDate);
    const s = Math.max(0, daysBetween(lo, a)), e = Math.min(n - 1, daysBetween(lo, b < a ? a : b));
    const bar = btn('tl-bar c-' + t.color + ' st-' + t.status + (t.startDate && t.due ? '' : ' point'), '', () => openTask(t.id));
    bar.style.left = `calc(${s} * var(--dw))`; bar.style.width = `calc(${e - s + 1} * var(--dw))`;
    bar.title = `${t.title} · ${t.startDate ? md(parse(t.startDate)) : ''}${t.startDate && t.due ? ' → ' : ''}${t.due ? md(parse(t.due)) + ' 마감' : ''} · ${statusLabel(t.status)}`;
    track.append(bar);
    row.append(track);
    scroller.append(row);
  });
  wrap.append(scroller);
  const undated = list.length - dated.length;
  if (undated) wrap.append(el('p', 'quiet', `날짜가 없는 업무 ${undated}개는 표에서 볼 수 있습니다.`));
  requestAnimationFrame(() => { const dw = scroller.querySelector('.tl-day')?.offsetWidth || 28; scroller.scrollLeft = Math.max(0, (todayIdx - 5) * dw); });
  return wrap;
}

export function wireProjects() {
  document.querySelectorAll('[data-pview]').forEach(b => b.addEventListener('click', () => { projState.view = b.dataset.pview; rerender(); }));
  $('#projSearch').addEventListener('input', e => { projState.q = e.target.value; rerender(); });
  $('#hideDone').addEventListener('change', e => { projState.hideDone = e.target.checked; rerender(); });
}
