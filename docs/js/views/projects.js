// Projects, Monday-style: an overview of project cards, then per project a main table
// (colored groups, filled status cells, drag to reorder or move between groups), a board,
// a timeline and a small dashboard.
import { $, el, btn, option, ddayEl, empty, armedDelete, enableDrag, CHECK_SVG } from '../ui.js';
import { ymd, parse, addDays, today, weekStart, daysBetween, md } from '../dates.js';
import { STATUSES, PRIORITIES, normTask, normGroup, nextGroupColor, withStatus, statusLabel, COLORS } from '../model.js';
import { tasks, projects, groups, activeProjects, projectName } from '../db.js';
import { state } from '../store.js';
import { openTask, openProject, groupsOf } from '../editors.js';
import { newId } from '../dates.js';

const lsGet = (k, f) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch (e) { return f; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
export const projState = { pid: null, view: lsGet('wcp:pview', 'table'), q: '', hideDone: true, showArchived: false, collapsed: new Set(lsGet('wcp:collapsed', [])) };
const rerender = () => window.dispatchEvent(new Event('planner:render'));
const order = (a, b) => (a.sort || 0) - (b.sort || 0) || ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0);

export function openProjectPage(pid) { projState.pid = pid; window.scrollTo(0, 0); }

function matches(t) {
  const q = projState.q.trim().toLowerCase();
  return !q || (t.title + ' ' + t.memo).toLowerCase().includes(q);
}
const inProject = t => projState.pid === 'all' || t.projectId === projState.pid;

export function renderProjects() {
  if (projState.pid && projState.pid !== 'all' && !projects.get(projState.pid)) projState.pid = null;
  const overview = !projState.pid;
  $('#projOverview').hidden = !overview;
  $('#projPage').hidden = overview;
  if (overview) return renderOverview();

  const p = projState.pid === 'all' ? null : projects.get(projState.pid);
  const head = $('#projHead'); head.textContent = '';
  head.append(btn('navbtn back-proj', '‹', () => { projState.pid = null; rerender(); }, '프로젝트 목록'));
  if (p) head.append(el('span', 'dot big c-' + p.color), el('h2', null, p.name), btn('linkbtn', '편집', () => openProject(p.id)));
  else head.append(el('h2', null, '전체 업무'));
  document.querySelectorAll('[data-pview]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.pview === projState.view)));
  $('#hideDone').checked = projState.hideDone;
  $('#hideDoneWrap').hidden = projState.view === 'board' || projState.view === 'dash';

  const body = $('#projBody'); body.textContent = '';
  if (!state.loaded) { body.append(el('div', 'empty', '불러오는 중…')); return; }
  const all = tasks.all().filter(inProject);
  const list = all.filter(t => matches(t) && (projState.view === 'board' || projState.view === 'dash' || !projState.hideDone || !t.done));
  if (projState.view === 'board') body.append(board(list, p));
  else if (projState.view === 'timeline') body.append(timeline(list, p));
  else if (projState.view === 'dash') body.append(dashboard(all, p));
  else body.append(table(list, p));
}

// ---------- overview ----------
export function statusCounts(list) {
  const c = { todo: 0, doing: 0, stuck: 0, done: 0 };
  list.forEach(t => { c[t.status] = (c[t.status] || 0) + 1; });
  return c;
}
export function battery(list, { labels = false } = {}) {
  const c = statusCounts(list), n = list.length || 1;
  const bar = el('div', 'battery');
  if (!list.length) bar.classList.add('empty');
  STATUSES.forEach(s => { if (!c[s.key]) return; const seg = el('span', 'seg st-' + s.key); seg.style.flexGrow = c[s.key]; seg.title = `${s.label} ${c[s.key]}개 (${Math.round(c[s.key] / n * 100)}%)`; if (labels) seg.textContent = c[s.key]; bar.append(seg); });
  return bar;
}

function renderOverview() {
  const box = $('#projOverview'); box.textContent = '';
  const top = el('div', 'page-head');
  top.append(el('h2', null, '프로젝트'), el('span', 'spacer'), btn('btn primary', '+ 새 프로젝트', () => openProject(null, p => { if (p) { openProjectPage(p.id); rerender(); } })));
  box.append(top);
  if (!state.loaded) { box.append(el('div', 'empty', '불러오는 중…')); return; }
  const grid = el('div', 'pcards');
  const card = (id, name, color, list, sub) => {
    const c = btn('pcard', '', () => { openProjectPage(id); rerender(); });
    const h = el('div', 'pcard-head'); if (color) h.append(el('span', 'dot big c-' + color)); h.append(el('span', 'pcard-name', name)); c.append(h);
    const open = list.filter(t => !t.done);
    const done = list.length - open.length;
    c.append(battery(list));
    const m = el('div', 'pcard-meta');
    m.append(el('span', null, list.length ? `완료 ${done}/${list.length} · ${Math.round(done / list.length * 100)}%` : '업무 없음'));
    const stuck = list.filter(t => t.status === 'stuck').length; if (stuck) m.append(el('span', 'pill st-stuck', `막힘 ${stuck}`));
    const late = open.filter(t => t.due && t.due < ymd(today())).length; if (late) m.append(el('span', 'pill late', `지연 ${late}`));
    c.append(m);
    const next = open.filter(t => t.due).sort((a, b) => a.due.localeCompare(b.due))[0];
    c.append(el('div', 'pcard-next', next ? `다음 마감 · ${md(parse(next.due))} ${next.title}` : sub || '예정된 마감 없음'));
    return c;
  };
  activeProjects().forEach(p => grid.append(card(p.id, p.name, p.color, tasks.all().filter(t => t.projectId === p.id))));
  grid.append(card('all', '전체 업무', null, tasks.all(), '모든 프로젝트와 프로젝트 없는 업무'));
  box.append(grid);
  const archived = projects.all().filter(p => p.archived);
  if (archived.length) {
    const d = el('details', 'archived'); d.append(el('summary', null, `보관한 프로젝트 ${archived.length}개`));
    const g = el('div', 'pcards'); archived.forEach(p => g.append(card(p.id, p.name, p.color, tasks.all().filter(t => t.projectId === p.id)))); d.append(g); box.append(d);
  }
  if (!activeProjects().length) box.append(empty(null, '프로젝트를 만들면 그룹별로 업무를 정리하고 표·보드·타임라인·대시보드로 볼 수 있습니다.'));
}

// ---------- main table ----------
function sections(p) {
  if (p) {
    const gs = groupsOf(p.id);
    const ids = new Set(gs.map(g => g.id));
    const secs = gs.map(g => ({ kind: 'group', key: g.id, title: g.name, color: g.color, group: g, member: t => t.projectId === p.id && t.groupId === g.id }));
    const looseMember = t => t.projectId === p.id && (!t.groupId || !ids.has(t.groupId));
    if (!gs.length || tasks.all().some(looseMember)) secs.push({ kind: 'group', key: '', title: '그룹 없음', color: 'slate', member: looseMember });
    return secs;
  }
  const secs = activeProjects().map(pr => ({ kind: 'project', key: pr.id, title: pr.name, color: pr.color, member: t => t.projectId === pr.id }));
  secs.push({ kind: 'project', key: '', title: '프로젝트 없음', color: 'slate', member: t => !t.projectId || !projects.get(t.projectId) || projects.get(t.projectId).archived });
  return secs;
}

function table(list, p) {
  const wrap = el('div', 'mtable');
  const secs = sections(p);
  const visible = new Set(list.map(t => t.id));
  secs.forEach(s => {
    const items = tasks.all().filter(t => s.member(t) && visible.has(t.id)).sort(order);
    if (!p && !items.length && projState.q) return;
    const ckey = `${projState.pid}:${s.key}`;
    const collapsed = projState.collapsed.has(ckey);
    const sec = el('section', 'mgroup c-' + s.color + (collapsed ? ' collapsed' : ''));
    sec.dataset.kind = s.kind; sec.dataset.key = s.key;

    const h = el('div', 'mg-head');
    const tog = btn('mg-toggle', collapsed ? '▸' : '▾', () => { collapsed ? projState.collapsed.delete(ckey) : projState.collapsed.add(ckey); lsSet('wcp:collapsed', [...projState.collapsed]); rerender(); }, collapsed ? '펼치기' : '접기');
    h.append(tog);
    if (s.group) {
      const name = el('input', 'mg-name'); name.value = s.group.name; name.maxLength = 60; name.setAttribute('aria-label', '그룹 이름');
      name.addEventListener('change', () => { const v = name.value.trim(); if (v && v !== s.group.name) groups.put({ ...s.group, name: v }); });
      name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });
      h.append(name);
    } else h.append(el('span', 'mg-name static', s.title));
    h.append(el('span', 'mg-count', `${items.length}개`));
    if (s.group) {
      h.append(el('span', 'spacer'));
      h.append(btn('linkbtn', '색', () => groups.put({ ...s.group, color: COLORS[(COLORS.indexOf(s.group.color) + 1) % COLORS.length] }), '그룹 색 바꾸기'));
      const del = btn('linkbtn danger', '삭제');
      armedDelete(del, () => { tasks.all().filter(t => t.groupId === s.group.id).forEach(t => tasks.put({ ...t, groupId: null })); groups.remove(s.group.id); }, '삭제');
      h.append(del);
    }
    sec.append(h);

    if (!collapsed) {
      const t = el('div', 'mg-table');
      const head = el('div', 'mrow mhead');
      ['', '', '업무', '상태', '우선순위', '기간', '마감'].forEach(x => head.append(el('span', null, x)));
      t.append(head);
      items.forEach(it => t.append(tableRow(it, !p, s)));
      const add = el('form', 'mrow madd');
      add.append(el('span'), el('span'));
      const inp = el('input'); inp.type = 'text'; inp.placeholder = '+ 업무 추가'; inp.maxLength = 120; inp.setAttribute('aria-label', `${s.title}에 업무 추가`);
      add.append(inp);
      add.addEventListener('submit', e => {
        e.preventDefault();
        const title = inp.value.trim(); if (!title) return;
        const last = tasks.all().filter(s.member).sort(order).pop();
        const projectId = s.kind === 'project' ? (s.key || null) : p.id;
        tasks.put(normTask(newId(), { title, projectId, groupId: s.kind === 'group' && s.key ? s.key : null, repeat: false, sort: (last ? last.sort || 0 : 0) + 1000 }));
        inp.value = '';
        setTimeout(() => { const again = document.querySelector(`[aria-label="${s.title}에 업무 추가"]`); if (again) again.focus(); }, 60);
      });
      t.append(add);
      const sum = el('div', 'mrow msum'); sum.append(el('span'), el('span'), el('span'));
      sum.append(battery(items)); t.append(sum);
      sec.append(t);
    }
    wrap.append(sec);
  });
  if (p) wrap.append(btn('btn ghost addgroup', '+ 새 그룹 추가', () => {
    const n = groupsOf(p.id).length;
    groups.put(normGroup(newId('g'), { projectId: p.id, name: '새 그룹', color: nextGroupColor(n), sort: Date.now() }));
    setTimeout(() => { const inputs = document.querySelectorAll('.mg-name'); const last = inputs[inputs.length - 1]; if (last && last.focus) { last.focus(); last.select(); } }, 80);
  }));
  return wrap;
}

function tableRow(t, showProject, sec) {
  const r = el('div', 'mrow' + (t.done ? ' is-done' : ''));
  r.dataset.id = t.id;
  const grip = el('span', 'grip'); grip.innerHTML = '<svg viewBox="0 0 10 16"><circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/><circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/><circle cx="3" cy="13" r="1.3"/><circle cx="7" cy="13" r="1.3"/></svg>';
  grip.title = '끌어서 옮기기 (휴대폰은 꾹 누른 뒤)';
  r.append(grip);
  const cb = el('button', 'check'); cb.type = 'button'; cb.innerHTML = CHECK_SVG;
  cb.setAttribute('aria-pressed', String(t.done)); cb.setAttribute('aria-label', `${t.title} 완료`);
  cb.addEventListener('click', () => tasks.put(withStatus(t, t.done ? 'todo' : 'done')));
  r.append(cb);

  const title = el('div', 'mtitle');
  const tb = btn('mtitle-btn', t.title, () => openTask(t.id)); title.append(tb);
  if (showProject && t.projectId && sec.kind !== 'project') title.append(el('span', 'pill proj', projectName(t.projectId)));
  if (t.repeat && !t.done) title.append(el('span', 'pill weekly', '매주'));
  if (t.memo) title.append(el('span', 'memo-mark', '메모'));
  r.append(title);

  const st = el('select', 'stcell st-' + t.status); st.setAttribute('aria-label', '상태');
  STATUSES.forEach(s => st.append(option(s.key, s.label, s.key === t.status)));
  st.addEventListener('change', () => tasks.put(withStatus(t, st.value)));
  r.append(st);

  const pr = el('select', 'prcell pr-' + t.priority); pr.setAttribute('aria-label', '우선순위');
  PRIORITIES.forEach((l, i) => pr.append(option(i, i ? l : '—', i === t.priority)));
  pr.addEventListener('change', () => tasks.put({ ...t, priority: Number(pr.value) }));
  r.append(pr);

  const per = el('span', 'mperiod');
  if (t.startDate || t.due) {
    const a = t.startDate || t.due, b = t.due || t.startDate;
    const chip = el('span', 'period-chip c-' + (sec.color || t.color));
    chip.textContent = a === b ? md(parse(a)) : `${md(parse(a))} – ${md(parse(b))}`;
    if (t.startDate && t.due) {
      const total = Math.max(1, daysBetween(parse(a), parse(b)) + 1), gone = Math.min(total, Math.max(0, daysBetween(parse(a), today()) + 1));
      chip.style.setProperty('--fill', `${Math.round(gone / total * 100)}%`);
    }
    per.append(chip);
  } else per.textContent = '—';
  r.append(per);

  const due = el('span', 'mdue');
  if (t.due) due.append(el('span', null, md(parse(t.due))), ddayEl(t.due, t.done)); else due.textContent = '—';
  r.append(due);

  enableDrag(r, {
    onMove: (x, y) => markDrop(x, y, r),
    onDrop: (x, y) => { const target = markDrop(x, y, r); clearMarks(); if (target) moveTask(t.id, target); },
    onCancel: clearMarks,
  });
  return r;
}

// ---- drag between groups ----
function clearMarks() { document.querySelectorAll('.drop-before, .drop-after, .drop-into').forEach(e => e.classList.remove('drop-before', 'drop-after', 'drop-into')); }
function markDrop(x, y, self) {
  clearMarks();
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  const sec = hit.closest('.mgroup');
  if (!sec) return null;
  const row = hit.closest('.mrow[data-id]');
  if (row && row !== self) {
    const b = row.getBoundingClientRect();
    const after = y > b.top + b.height / 2;
    row.classList.add(after ? 'drop-after' : 'drop-before');
    return { kind: sec.dataset.kind, key: sec.dataset.key, ref: row.dataset.id, after };
  }
  sec.classList.add('drop-into');
  return { kind: sec.dataset.kind, key: sec.dataset.key, ref: null };
}
function moveTask(id, target) {
  const t = tasks.get(id); if (!t) return;
  const p = projState.pid === 'all' ? null : projects.get(projState.pid);
  const sec = sections(p).find(s => s.kind === target.kind && s.key === target.key);
  if (!sec) return;
  const list = tasks.all().filter(x => sec.member(x) && x.id !== id).sort(order);
  let at = list.length;
  if (target.ref) { const i = list.findIndex(x => x.id === target.ref); if (i >= 0) at = target.after ? i + 1 : i; }
  const moved = sec.kind === 'group'
    ? { ...t, projectId: p ? p.id : t.projectId, groupId: sec.key || null }
    : { ...t, projectId: sec.key || null, groupId: sec.key === t.projectId ? t.groupId : null };
  list.splice(at, 0, moved);
  list.forEach((x, i) => {
    const next = { ...x, sort: (i + 1) * 1000 };
    const cur = tasks.get(x.id);
    if (!cur || cur.sort !== next.sort || cur.groupId !== next.groupId || cur.projectId !== next.projectId) tasks.put(next);
  });
}

// ---------- board ----------
function board(list, p) {
  const wrap = el('div', 'board');
  STATUSES.forEach(s => {
    const col = el('div', 'col st-' + s.key); col.dataset.status = s.key;
    const items = list.filter(t => t.status === s.key).sort(order);
    const h = el('div', 'col-head'); h.append(el('span', 'col-title', s.label), el('span', 'count', String(items.length)));
    col.append(h);
    const cards = el('div', 'cards');
    items.forEach(t => cards.append(card(t, !p, wrap)));
    col.append(cards);
    if (s.key !== 'done') col.append(btn('linkbtn', '+ 업무', () => openTask(null, { projectId: p ? p.id : null, status: s.key })));
    wrap.append(col);
  });
  return wrap;
}
function card(t, showProject, boardEl) {
  const c = el('div', 'card' + (t.done ? ' is-done' : '')); c.tabIndex = 0;
  const g = t.groupId && groups.get(t.groupId);
  if (g) c.classList.add('c-' + g.color);
  const top = el('div', 'card-title'); top.append(el('span', null, t.title)); c.append(top);
  const meta = el('div', 'row-meta');
  if (g) meta.append(el('span', 'pill grp', g.name));
  if (t.due) meta.append(ddayEl(t.due, t.done), el('span', null, md(parse(t.due))));
  if (t.priority) meta.append(el('span', 'pill pr-' + t.priority, PRIORITIES[t.priority]));
  if (showProject && t.projectId) meta.append(el('span', 'pill proj', projectName(t.projectId)));
  c.append(meta);
  c.addEventListener('click', () => openTask(t.id));
  c.addEventListener('keydown', e => { if (e.key === 'Enter') openTask(t.id); });
  let over = null;
  enableDrag(c, {
    scrollers: [boardEl],
    onMove: (x, y) => { const col = document.elementFromPoint(x, y)?.closest('.col'); if (over && over !== col) over.classList.remove('over'); over = col; if (over) over.classList.add('over'); },
    onDrop: () => { if (over) { over.classList.remove('over'); if (over.dataset.status !== t.status) tasks.put(withStatus(t, over.dataset.status)); over = null; } },
    onCancel: () => { if (over) over.classList.remove('over'); over = null; },
  });
  return c;
}

// ---------- timeline ----------
function timeline(list, p) {
  const dated = list.filter(t => t.startDate || t.due);
  const wrap = el('div', 'tl-wrap');
  if (!dated.length) { wrap.append(el('p', 'quiet', '시작일이나 마감일이 있는 업무가 타임라인에 표시됩니다.')); return wrap; }
  const t0 = today();
  let lo = addDays(weekStart(t0), -7), hi = addDays(t0, 28);
  dated.forEach(t => { const a = parse(t.startDate || t.due), b = parse(t.due || t.startDate); if (a < lo) lo = a; if (b > hi) hi = b; });
  lo = weekStart(addDays(lo, -1)); hi = addDays(hi, 6);
  if (daysBetween(lo, hi) > 270) hi = addDays(lo, 270);
  const n = daysBetween(lo, hi) + 1;
  const scroller = el('div', 'tl'); scroller.style.setProperty('--days', n);

  const head = el('div', 'tl-row tl-head'); head.append(el('div', 'tl-label', '업무'));
  const days = el('div', 'tl-track');
  for (let i = 0; i < n; i++) {
    const d = addDays(lo, i);
    const cell = el('div', 'tl-day' + (d.getDay() === 0 || d.getDay() === 6 ? ' wkend' : '') + (ymd(d) === ymd(t0) ? ' today' : ''));
    if (d.getDate() === 1 || i === 0) cell.append(el('b', null, `${d.getMonth() + 1}월`));
    cell.append(el('span', null, String(d.getDate())));
    days.append(cell);
  }
  head.append(days); scroller.append(head);
  const todayIdx = daysBetween(lo, t0);

  const secs = sections(p);
  secs.forEach(s => {
    const items = dated.filter(s.member).sort((a, b) => (a.startDate || a.due) < (b.startDate || b.due) ? -1 : 1);
    if (!items.length) return;
    const gh = el('div', 'tl-row tl-group c-' + s.color); gh.append(el('div', 'tl-label', s.title), el('div', 'tl-track')); scroller.append(gh);
    items.forEach(t => {
      const row = el('div', 'tl-row');
      const lab = btn('tl-label', '', () => openTask(t.id)); lab.append(el('span', 't', t.title)); row.append(lab);
      const track = el('div', 'tl-track');
      if (todayIdx >= 0 && todayIdx < n) { const line = el('div', 'tl-now'); line.style.left = `calc(${todayIdx} * var(--dw) + var(--dw) / 2)`; track.append(line); }
      const a = parse(t.startDate || t.due), b = parse(t.due || t.startDate);
      const s0 = Math.max(0, daysBetween(lo, a)), e0 = Math.min(n - 1, daysBetween(lo, b < a ? a : b));
      const bar = btn('tl-bar c-' + s.color + ' st-' + t.status + (t.startDate && t.due ? '' : ' point'), t.startDate && t.due ? t.title : '', () => openTask(t.id));
      bar.style.left = `calc(${s0} * var(--dw) + 2px)`; bar.style.width = `calc(${e0 - s0 + 1} * var(--dw) - 4px)`;
      bar.title = `${t.title} · ${t.startDate ? md(parse(t.startDate)) : ''}${t.startDate && t.due ? ' → ' : ''}${t.due ? md(parse(t.due)) + ' 마감' : ''} · ${statusLabel(t.status)}`;
      track.append(bar); row.append(track); scroller.append(row);
    });
  });
  wrap.append(scroller);
  const undated = list.length - dated.length;
  if (undated) wrap.append(el('p', 'quiet', `날짜가 없는 업무 ${undated}개는 메인 테이블에서 볼 수 있습니다.`));
  requestAnimationFrame(() => { const dw = scroller.querySelector('.tl-day')?.offsetWidth || 28; scroller.scrollLeft = Math.max(0, (todayIdx - 4) * dw); });
  return wrap;
}

// ---------- dashboard ----------
export function donut(list, size = 150) {
  const c = statusCounts(list), n = list.length;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('viewBox', '0 0 42 42'); svg.setAttribute('width', size); svg.setAttribute('height', size); svg.classList.add('donut');
  const ring = document.createElementNS(svgNS, 'circle'); ring.setAttribute('cx', 21); ring.setAttribute('cy', 21); ring.setAttribute('r', 15.9155); ring.setAttribute('class', 'donut-bg'); svg.append(ring);
  let off = 25;
  STATUSES.forEach(s => {
    if (!c[s.key]) return;
    const pct = c[s.key] / n * 100;
    const seg = document.createElementNS(svgNS, 'circle');
    seg.setAttribute('cx', 21); seg.setAttribute('cy', 21); seg.setAttribute('r', 15.9155);
    seg.setAttribute('class', 'donut-seg st-' + s.key);
    seg.setAttribute('stroke-dasharray', `${pct} ${100 - pct}`); seg.setAttribute('stroke-dashoffset', String(off));
    off -= pct; svg.append(seg);
  });
  const txt = document.createElementNS(svgNS, 'text'); txt.setAttribute('x', 21); txt.setAttribute('y', 23); txt.setAttribute('class', 'donut-num');
  txt.textContent = n ? `${Math.round((c.done || 0) / n * 100)}%` : '–'; svg.append(txt);
  return svg;
}

function dashboard(all, p) {
  const wrap = el('div', 'dash');
  const c = statusCounts(all);
  const kpis = el('div', 'kpis');
  [['전체', all.length, ''], ...STATUSES.filter(s => s.key !== 'todo').map(s => [s.label, c[s.key] || 0, 'st-' + s.key])].forEach(([l, v, cls]) => {
    const k = el('div', 'kpi ' + cls); k.append(el('span', 'kpi-label', l), el('span', 'kpi-num', String(v))); kpis.append(k);
  });
  wrap.append(kpis);

  const row = el('div', 'dash-row');
  const w1 = el('div', 'widget'); w1.append(el('h3', null, '상태별 업무'));
  const dd = el('div', 'donut-wrap'); dd.append(donut(all));
  const lg = el('ul', 'legend-list');
  STATUSES.forEach(s => { const li = el('li'); li.append(el('i', 'sw st-' + s.key), el('span', null, s.label), el('b', null, String(c[s.key] || 0))); lg.append(li); });
  dd.append(lg); w1.append(dd); row.append(w1);

  const w2 = el('div', 'widget'); w2.append(el('h3', null, p ? '그룹별 진행률' : '프로젝트별 진행률'));
  const bars = el('div', 'hbars');
  sections(p).forEach(s => {
    const items = all.filter(s.member); if (!items.length) return;
    const done = items.filter(t => t.done).length;
    const r = el('div', 'hbar'); r.append(el('span', 'hbar-label', s.title), battery(items), el('span', 'hbar-num', `${done}/${items.length}`));
    bars.append(r);
  });
  if (!bars.children.length) bars.append(el('p', 'quiet', '업무가 없습니다.'));
  w2.append(bars); row.append(w2);
  wrap.append(row);

  const w3 = el('div', 'widget'); w3.append(el('h3', null, '마감 현황 (진행 중인 업무)'));
  const open = all.filter(t => !t.done), tStr = ymd(today()), wEnd = ymd(addDays(weekStart(today()), 6)), nwEnd = ymd(addDays(weekStart(today()), 13));
  const buckets = [
    ['지연', open.filter(t => t.due && t.due < tStr), 'late'],
    ['이번 주', open.filter(t => t.due && t.due >= tStr && t.due <= wEnd), 'now'],
    ['다음 주', open.filter(t => t.due && t.due > wEnd && t.due <= nwEnd), ''],
    ['그 이후', open.filter(t => t.due && t.due > nwEnd), ''],
    ['날짜 없음', open.filter(t => !t.due), 'muted'],
  ];
  const max = Math.max(1, ...buckets.map(b => b[1].length));
  const vb = el('div', 'vbars');
  buckets.forEach(([l, items, cls]) => {
    const col = el('div', 'vbar ' + cls);
    const bar = el('span', 'vbar-fill'); bar.style.height = `${items.length / max * 100}%`; bar.title = items.map(t => t.title).join('\n');
    col.append(el('b', null, String(items.length)), el('span', 'vbar-track'), el('span', 'vbar-label', l));
    col.querySelector('.vbar-track').append(bar);
    vb.append(col);
  });
  w3.append(vb);
  const lateList = buckets[0][1];
  if (lateList.length) {
    const ul = el('div', 'dash-late'); ul.append(el('h4', null, '지연된 업무'));
    lateList.sort((a, b) => a.due.localeCompare(b.due)).slice(0, 6).forEach(t => { const r = btn('mini-row', '', () => openTask(t.id)); r.append(ddayEl(t.due, false), el('span', 'mini-title', t.title)); ul.append(r); });
    w3.append(ul);
  }
  wrap.append(w3);
  return wrap;
}

export function wireProjects() {
  document.querySelectorAll('[data-pview]').forEach(b => b.addEventListener('click', () => { projState.view = b.dataset.pview; lsSet('wcp:pview', projState.view); rerender(); }));
  $('#projSearch').addEventListener('input', e => { projState.q = e.target.value; rerender(); });
  $('#hideDone').addEventListener('change', e => { projState.hideDone = e.target.checked; rerender(); });
  $('#projNewTask').addEventListener('click', () => {
    const p = projState.pid && projState.pid !== 'all' ? projects.get(projState.pid) : null;
    const g = p ? groupsOf(p.id)[0] : null;
    openTask(null, { projectId: p ? p.id : null, groupId: g ? g.id : null, repeat: false, lead: 0 });
  });
}
