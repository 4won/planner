// Projects: an overview of project cards, then per project a dashboard, a board, a main table
// (sections by status — dragging a row to another section changes its status) and a timeline.
// Hashtags replace groups: shown on rows and cards, clickable to filter.
import { $, el, btn, option, ddayEl, empty, enableDrag, CHECK_SVG } from '../ui.js';
import { ymd, parse, addDays, today, weekStart, daysBetween, md, newId } from '../dates.js';
import { STATUSES, PRIORITIES, normTask, withStatus, statusLabel } from '../model.js';
import { tasks, projects, activeProjects, projectName } from '../db.js';
import { state } from '../store.js';
import { openTask, openProject } from '../editors.js';

const lsGet = (k, f) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch (e) { return f; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const VIEWS = ['dash', 'board', 'table', 'timeline'];
export const projState = { pid: null, view: VIEWS.includes(lsGet('wcp:pview2', 'dash')) ? lsGet('wcp:pview2', 'dash') : 'dash', q: '', hideDone: true, showArchived: false, focus: null, collapsed: new Set(lsGet('wcp:collapsed', [])) };
const rerender = () => window.dispatchEvent(new Event('planner:render'));
const order = (a, b) => (a.sort || 0) - (b.sort || 0) || ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0);
const setView = v => { projState.view = v; lsSet('wcp:pview2', v); };

export function openProjectPage(pid) { projState.pid = pid; window.scrollTo(0, 0); }

function matches(t) {
  const q = projState.q.trim().toLowerCase();
  if (!q) return true;
  if (q.startsWith('#')) { const tag = q.slice(1); return t.tags.some(x => x.toLowerCase() === tag); }
  return (t.title + ' ' + t.memo + ' ' + t.tags.join(' ')).toLowerCase().includes(q);
}
const inProject = t => projState.pid === 'all' || t.projectId === projState.pid;
const filterTag = tag => { projState.q = '#' + tag; $('#projSearch').value = projState.q; if (projState.view === 'dash') setView('table'); rerender(); };
const tagChip = tag => { const b = btn('tag', '#' + tag, e => { e.stopPropagation(); filterTag(tag); }, `#${tag} 모아보기`); return b; };

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
  if ($('#projSearch').value !== projState.q && document.activeElement !== $('#projSearch')) $('#projSearch').value = projState.q;

  const body = $('#projBody'); body.textContent = '';
  if (!state.loaded) { body.append(el('div', 'empty', '불러오는 중…')); return; }
  const all = tasks.all().filter(inProject);
  const list = all.filter(t => matches(t) && (projState.view === 'board' || projState.view === 'dash' || !projState.hideDone || !t.done));
  if (projState.view === 'board') body.append(board(list, p));
  else if (projState.view === 'timeline') body.append(timeline(list, p));
  else if (projState.view === 'table') body.append(table(list, p));
  else body.append(dashboard(all, p));
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
  if (!activeProjects().length) box.append(empty(null, '프로젝트를 만들면 대시보드·보드·표·타임라인으로 업무를 볼 수 있습니다.'));
}

// ---------- sections: by status inside a project, by project across all ----------
function sections(p) {
  if (p) return STATUSES.map(s => ({ kind: 'status', key: s.key, title: s.label, cls: 'st-' + s.key, member: t => t.projectId === p.id && t.status === s.key }));
  const secs = activeProjects().map(pr => ({ kind: 'project', key: pr.id, title: pr.name, cls: 'c-' + pr.color, member: t => t.projectId === pr.id }));
  secs.push({ kind: 'project', key: '', title: '프로젝트 없음', cls: 'c-slate', member: t => !t.projectId || !projects.get(t.projectId) || projects.get(t.projectId).archived });
  return secs;
}

// ---------- main table ----------
function table(list, p) {
  const wrap = el('div', 'mtable');
  const visible = new Set(list.map(t => t.id));
  sections(p).forEach(s => {
    if (s.kind === 'status' && s.key === 'done' && projState.hideDone) return;
    const items = tasks.all().filter(t => s.member(t) && visible.has(t.id)).sort(order);
    if ((!p || projState.q) && !items.length) return;
    const ckey = `${projState.pid}:${s.kind}:${s.key}`;
    const collapsed = projState.collapsed.has(ckey);
    const sec = el('section', 'mgroup ' + s.cls + (collapsed ? ' collapsed' : ''));
    sec.dataset.kind = s.kind; sec.dataset.key = s.key;
    const h = el('div', 'mg-head');
    h.append(btn('mg-toggle', collapsed ? '▸' : '▾', () => { collapsed ? projState.collapsed.delete(ckey) : projState.collapsed.add(ckey); lsSet('wcp:collapsed', [...projState.collapsed]); rerender(); }, collapsed ? '펼치기' : '접기'));
    h.append(el('span', 'mg-name static', s.title), el('span', 'mg-count', `${items.length}개`));
    sec.append(h);
    if (!collapsed) {
      const t = el('div', 'mg-table');
      const head = el('div', 'mrow mhead');
      ['', '', '업무', '상태', '우선순위', '기간', '마감'].forEach(x => head.append(el('span', null, x)));
      t.append(head);
      items.forEach(it => t.append(tableRow(it, !p)));
      const add = el('form', 'mrow madd');
      add.append(el('span'), el('span'));
      const inp = el('input'); inp.type = 'text'; inp.placeholder = '+ 업무 추가'; inp.maxLength = 120; inp.setAttribute('aria-label', `${s.title}에 업무 추가`);
      add.append(inp);
      add.addEventListener('submit', e => {
        e.preventDefault();
        const title = inp.value.trim(); if (!title) return;
        const last = tasks.all().filter(s.member).sort(order).pop();
        let nt = normTask(newId(), { title, projectId: s.kind === 'project' ? (s.key || null) : p.id, repeat: false, sort: (last ? last.sort || 0 : 0) + 1000 });
        if (s.kind === 'status') nt = withStatus(nt, s.key);
        tasks.put(nt);
        inp.value = '';
        setTimeout(() => { const again = document.querySelector(`[aria-label="${s.title}에 업무 추가"]`); if (again) again.focus(); }, 60);
      });
      t.append(add);
      if (s.kind === 'project') { const sum = el('div', 'mrow msum'); sum.append(el('span'), el('span'), el('span')); sum.append(battery(items)); t.append(sum); }
      sec.append(t);
    }
    wrap.append(sec);
  });
  if (!wrap.children.length) wrap.append(el('p', 'quiet', projState.q ? '검색 결과가 없습니다.' : '업무가 없습니다.'));
  return wrap;
}

function tableRow(t, showProject) {
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
  title.append(btn('mtitle-btn', t.title, () => openTask(t.id), t.title));
  if (showProject && t.projectId) title.append(el('span', 'pill proj', projectName(t.projectId)));
  t.tags.forEach(tag => title.append(tagChip(tag)));
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
    const proj = t.projectId && projects.get(t.projectId);
    const chip = el('span', 'period-chip c-' + (proj ? proj.color : t.color));
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

// ---- drag between sections ----
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
  const moved = sec.kind === 'status' ? withStatus(t, sec.key) : { ...t, projectId: sec.key || null };
  list.splice(at, 0, moved);
  list.forEach((x, i) => {
    const next = { ...x, sort: (i + 1) * 1000 };
    const cur = tasks.get(x.id);
    if (!cur || cur.sort !== next.sort || cur.status !== next.status || cur.projectId !== next.projectId) tasks.put(next);
  });
}

// ---------- board ----------
function board(list, p) {
  const wrap = el('div', 'board');
  STATUSES.forEach(s => {
    const col = el('div', 'col st-' + s.key + (projState.focus === s.key ? ' focus' : '')); col.dataset.status = s.key;
    const items = list.filter(t => t.status === s.key).sort(order);
    const h = el('div', 'col-head'); h.append(el('span', 'col-title', s.label), el('span', 'count', String(items.length)));
    col.append(h);
    const cards = el('div', 'cards');
    items.forEach(t => cards.append(card(t, wrap)));
    col.append(cards);
    if (s.key !== 'done') col.append(btn('linkbtn', '+ 업무', () => openTask(null, { projectId: p ? p.id : null, status: s.key, repeat: false, lead: 0 })));
    wrap.append(col);
  });
  if (projState.focus) {
    const f = projState.focus; projState.focus = null;
    requestAnimationFrame(() => { const c = wrap.querySelector(`.col[data-status="${f}"]`); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' }); });
  }
  return wrap;
}
// Card order: project (colored) · title · D-day · date · priority · hashtags.
function card(t, boardEl) {
  const proj = t.projectId && projects.get(t.projectId);
  const c = el('div', 'card' + (t.done ? ' is-done' : '') + (proj ? ' c-' + proj.color : '')); c.tabIndex = 0;
  if (proj) { const pc = el('span', 'card-proj'); pc.append(el('span', 'dot'), el('span', null, proj.name)); c.append(pc); }
  c.append(el('div', 'card-title', t.title));
  const meta = el('div', 'row-meta');
  if (t.due) meta.append(ddayEl(t.due, t.done), el('span', null, md(parse(t.due))));
  if (t.priority) meta.append(el('span', 'pill pr-' + t.priority, PRIORITIES[t.priority]));
  t.tags.forEach(tag => meta.append(tagChip(tag)));
  if (meta.children.length) c.append(meta);
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
  sections(p).forEach(s => {
    const items = dated.filter(s.member).sort((a, b) => (a.startDate || a.due) < (b.startDate || b.due) ? -1 : 1);
    if (!items.length) return;
    const gh = el('div', 'tl-row tl-group ' + s.cls); gh.append(el('div', 'tl-label', s.title), el('div', 'tl-track')); scroller.append(gh);
    items.forEach(t => {
      const proj = t.projectId && projects.get(t.projectId);
      const row = el('div', 'tl-row');
      const lab = btn('tl-label', '', () => openTask(t.id)); lab.append(el('span', 't', t.title)); row.append(lab);
      const track = el('div', 'tl-track');
      if (todayIdx >= 0 && todayIdx < n) { const line = el('div', 'tl-now'); line.style.left = `calc(${todayIdx} * var(--dw) + var(--dw) / 2)`; track.append(line); }
      const a = parse(t.startDate || t.due), b = parse(t.due || t.startDate);
      const s0 = Math.max(0, daysBetween(lo, a)), e0 = Math.min(n - 1, daysBetween(lo, b < a ? a : b));
      const bar = btn('tl-bar c-' + (proj ? proj.color : t.color) + ' st-' + t.status + (t.startDate && t.due ? '' : ' point'), t.startDate && t.due ? t.title : '', () => openTask(t.id));
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
  const toBoard = status => { setView('board'); projState.focus = status; rerender(); };
  [['전체', all.length, '', null], ...STATUSES.filter(s => s.key !== 'todo').map(s => [s.label, c[s.key] || 0, 'st-' + s.key, s.key])].forEach(([l, v, cls, key]) => {
    const k = btn('kpi ' + cls, '', () => toBoard(key), `${l} 업무를 보드에서 보기`);
    k.append(el('span', 'kpi-label', l), el('span', 'kpi-num', String(v)), el('span', 'kpi-go', '보드에서 보기 ›'));
    kpis.append(k);
  });
  wrap.append(kpis);

  const row = el('div', 'dash-row');
  const w1 = el('div', 'widget'); w1.append(el('h3', null, '상태별 업무'));
  const dd = el('div', 'donut-wrap'); dd.append(donut(all));
  const lg = el('ul', 'legend-list');
  STATUSES.forEach(s => { const li = el('li'); li.append(el('i', 'sw st-' + s.key), el('span', null, s.label), el('b', null, String(c[s.key] || 0))); lg.append(li); });
  dd.append(lg); w1.append(dd); row.append(w1);

  const w2 = el('div', 'widget');
  const bars = el('div', 'hbars');
  if (p) {
    w2.append(el('h3', null, '해시태그별 진행률'));
    const tags = [...new Set(all.flatMap(t => t.tags))].sort((a, b) => all.filter(t => t.tags.includes(b)).length - all.filter(t => t.tags.includes(a)).length).slice(0, 10);
    tags.forEach(tag => {
      const items = all.filter(t => t.tags.includes(tag)), done = items.filter(t => t.done).length;
      const r = btn('hbar', '', () => filterTag(tag)); r.append(el('span', 'hbar-label', '#' + tag), battery(items), el('span', 'hbar-num', `${done}/${items.length}`));
      bars.append(r);
    });
    if (!tags.length) bars.append(el('p', 'quiet', '업무에 #해시태그를 달면 태그별 진행률이 여기에 보입니다.'));
  } else {
    w2.append(el('h3', null, '프로젝트별 진행률'));
    sections(null).forEach(s => {
      const items = all.filter(s.member); if (!items.length) return;
      const done = items.filter(t => t.done).length;
      const r = el('div', 'hbar'); r.append(el('span', 'hbar-label', s.title), battery(items), el('span', 'hbar-num', `${done}/${items.length}`));
      bars.append(r);
    });
  }
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
  document.querySelectorAll('[data-pview]').forEach(b => b.addEventListener('click', () => { setView(b.dataset.pview); rerender(); }));
  $('#projSearch').addEventListener('input', e => { projState.q = e.target.value; rerender(); });
  $('#hideDone').addEventListener('change', e => { projState.hideDone = e.target.checked; rerender(); });
  $('#projNewTask').addEventListener('click', () => {
    const p = projState.pid && projState.pid !== 'all' ? projects.get(projState.pid) : null;
    openTask(null, { projectId: p ? p.id : null, repeat: false, lead: 0 });
  });
}
