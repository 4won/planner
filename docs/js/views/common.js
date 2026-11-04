// Rows shared by several screens.
import { el, btn, ddayEl, CHECK_SVG } from '../ui.js';
import { ymd, parse, md, today, weekStart, leadLabel } from '../dates.js';
import { weekRole, isCheckedIn, completionDate, withStatus, statusLabel, eventTimeText, recurText } from '../model.js';
import { tasks, projectName } from '../db.js';
import { openTask, openEvent } from '../editors.js';

export function toggleCheck(id, W) {
  const cur = tasks.get(id); if (!cur) return;
  if (cur.repeat && !cur.done) {
    const k = ymd(W), checks = cur.checks.includes(k) ? cur.checks.filter(x => x !== k) : [...cur.checks, k];
    tasks.put({ ...cur, checks });
  } else tasks.put(withStatus(cur, cur.done ? 'todo' : 'done', W));
}
export function finish(id, W) {
  const cur = tasks.get(id); if (!cur) return;
  const k = ymd(W);
  tasks.put({ ...withStatus(cur, 'done', W), doneAt: completionDate(W), checks: cur.checks.includes(k) ? cur.checks : [...cur.checks, k] });
}

// One task line. W = the week it is shown for (weekly check), or null outside the week view.
export function taskRow(it, W, { showProject = true } = {}) {
  const role = W ? weekRole(it, W) : null;
  const checked = W ? isCheckedIn(it, W) : it.done;
  const late = !it.done && it.due && parse(it.due) < today();
  const r = el('div', 'row' + (late ? ' late' : '') + (checked ? ' is-checked' : '') + (it.done ? ' is-done' : ''));

  const cb = el('button', 'check' + (it.repeat && !it.done ? ' weekly' : ''));
  cb.type = 'button'; cb.innerHTML = CHECK_SVG;
  cb.setAttribute('aria-pressed', String(checked));
  cb.setAttribute('aria-label', it.repeat && !it.done ? `${it.title} 이번 주 확인` : `${it.title} 완료`);
  cb.addEventListener('click', () => toggleCheck(it.id, W || weekStart(today())));
  r.append(cb);

  const main = el('div', 'row-main');
  const title = el('div', 'row-title');
  title.append(el('span', 'dot c-' + it.color), el('span', 't', it.title));
  main.append(title);
  const meta = el('div', 'row-meta');
  if (it.due) meta.append(ddayEl(it.due, it.done), el('span', '', `${md(parse(it.due))} 마감`));
  if (showProject && it.projectId) meta.append(el('span', 'pill proj', projectName(it.projectId)));
  if (it.status === 'doing' || it.status === 'stuck') meta.append(el('span', 'pill st-' + it.status, statusLabel(it.status)));
  if (it.repeat && !it.done) meta.append(el('span', 'pill weekly', '매주 확인'));
  if (it.due && it.lead && !it.done) meta.append(el('span', '', leadLabel(it.lead)));
  if (it.repeat && it.checks.length) meta.append(el('span', '', `확인 ${it.checks.length}회`));
  if (it.done && it.doneAt) meta.append(el('span', '', `${md(parse(it.doneAt))} 완료`));
  if (role === 'ahead' && checked) meta.append(el('span', '', '다음 주에 다시 표시'));
  main.append(meta);
  main.addEventListener('click', () => openTask(it.id));
  r.append(main);

  if (it.repeat && !it.done) {
    const f = btn('finish', '완료', () => finish(it.id, W || weekStart(today())), '끝내고 체크리스트에서 내립니다');
    r.append(f);
  }
  return r;
}

export function eventRow(e, dayStr) {
  const r = el('button', 'ev-row' + (e.external ? ' ext' : '')); r.type = 'button';
  r.append(el('span', 'ev-time', eventTimeText(e, dayStr)));
  const m = el('span', 'ev-main');
  const t = el('span', 'ev-title'); t.append(el('span', 'dot c-' + e.color), el('span', null, e.title));
  m.append(t);
  const meta = [e.location, e.projectId ? projectName(e.projectId) : '', e.recur ? recurText(e) : '', e.external ? '외부 캘린더' : ''].filter(Boolean).join(' · ');
  if (meta) m.append(el('span', 'ev-meta', meta));
  r.append(m);
  if (e.external) r.title = '외부 캘린더 일정은 원래 캘린더에서 고쳐 주세요';
  else r.addEventListener('click', () => openEvent(e.seriesId || e.id, { occDate: e.occDate }));
  return r;
}

export function groupEl(label, items, W, opts = {}) {
  const g = el('div', 'group');
  const h = el('div', 'group-head' + (opts.late ? ' late' : ''));
  h.append(el('span', '', label), el('span', 'count', String(items.length)));
  if (opts.note) h.append(el('span', 'group-note', '· ' + opts.note));
  g.append(h);
  items.forEach(it => g.append(taskRow(it, W)));
  return g;
}
