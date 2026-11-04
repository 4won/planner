// Shapes of every record and the rules shared by several screens.
import { okDate, okTime, ymd, today, parse, addDays, weekStart } from './dates.js';

export const COLORS = ['teal', 'amber', 'rose', 'violet', 'slate'];
export const STATUSES = [
  { key: 'todo', label: '할 일' },
  { key: 'doing', label: '진행 중' },
  { key: 'stuck', label: '막힘' },
  { key: 'done', label: '완료' },
];
export const statusLabel = k => (STATUSES.find(s => s.key === k) || STATUSES[0]).label;
export const PRIORITIES = ['없음', '낮음', '보통', '높음'];
export const REMIND_OPTIONS = [0, 5, 10, 30, 60, 1440];

const str = (v, max, def = '') => String(v == null ? def : v).slice(0, max);
const color = (v, def = 'teal') => COLORS.includes(v) ? v : def;
const optId = v => typeof v === 'string' && v ? v : null;
const iso = v => typeof v === 'string' && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : new Date().toISOString();
const timeOf = v => typeof v === 'string' && okTime(v.slice(0, 5)) ? v.slice(0, 5) : null;

export function normTask(id, d = {}) {
  const done = !!d.done || d.status === 'done';
  return {
    id,
    title: str(d.title || '(제목 없음)', 120),
    due: okDate(d.due) ? d.due : null,
    lead: Math.max(0, Math.min(365, Math.round(Number(d.lead) || 0))),
    repeat: !!d.repeat,
    color: color(d.color),
    memo: str(d.memo, 2000),
    checks: Array.isArray(d.checks) ? d.checks.filter(okDate) : [],
    done,
    doneAt: done && okDate(d.doneAt) ? d.doneAt : (done ? ymd(today()) : null),
    created: okDate(d.created) ? d.created : ymd(today()),
    projectId: optId(d.projectId),
    groupId: optId(d.groupId),
    status: done ? 'done' : (['todo', 'doing', 'stuck'].includes(d.status) ? d.status : 'todo'),
    priority: Math.max(0, Math.min(3, Math.round(Number(d.priority) || 0))),
    startDate: okDate(d.startDate) ? d.startDate : null,
    sort: Number(d.sort) || 0,
  };
}
export const normProject = (id, d = {}) => ({ id, name: str(d.name || '새 프로젝트', 80), color: color(d.color), archived: !!d.archived, sort: Number(d.sort) || 0 });
export const normGroup = (id, d = {}) => ({ id, projectId: optId(d.projectId), name: str(d.name || '새 그룹', 60), sort: Number(d.sort) || 0 });
export function normEvent(id, d = {}) {
  const startDate = okDate(d.startDate) ? d.startDate : ymd(today());
  const startTime = timeOf(d.startTime);
  let endDate = okDate(d.endDate) && d.endDate >= startDate ? d.endDate : startDate;
  let endTime = startTime ? timeOf(d.endTime) : null;
  if (endTime && endDate === startDate && endTime < startTime) endTime = null;
  return {
    id,
    title: str(d.title || '(제목 없음)', 120),
    startDate, startTime, endDate, endTime,
    location: str(d.location, 200),
    memo: str(d.memo, 2000),
    color: color(d.color, 'violet'),
    projectId: optId(d.projectId),
    remind: Array.isArray(d.remind) ? [...new Set(d.remind.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 10080))].sort((a, b) => a - b) : [10],
  };
}
export const normMemo = (id, d = {}) => ({ id, title: str(d.title || '메모', 80), projectId: optId(d.projectId), archived: !!d.archived, createdAt: iso(d.createdAt), updatedAt: iso(d.updatedAt || d.createdAt) });
export const normEntry = (id, d = {}) => ({ id, memoId: optId(d.memoId), body: str(d.body, 4000), createdAt: iso(d.createdAt), sentTo: optId(d.sentTo) });
export function normRecap(id, d = {}) {
  const proposals = Array.isArray(d.proposals) ? d.proposals.filter(p => p && typeof p === 'object').slice(0, 50).map((p, i) => ({
    id: String(p.id || `p${i}`),
    kind: p.kind === 'event' ? 'event' : 'task',
    title: str(p.title, 120),
    due: okDate(p.due) ? p.due : null,
    lead: Math.max(0, Math.min(365, Math.round(Number(p.lead) || 0))),
    startDate: okDate(p.startDate || p.start_date) ? (p.startDate || p.start_date) : null,
    startTime: timeOf(p.startTime || p.start_time),
    endTime: timeOf(p.endTime || p.end_time),
    location: str(p.location, 200),
    projectId: optId(p.projectId || p.project_id),
    projectName: str(p.projectName || p.project_name, 80),
    note: str(p.note, 1000),
    status: ['pending', 'added', 'dismissed'].includes(p.status) ? p.status : 'pending',
    createdRef: optId(p.createdRef),
  })) : [];
  return { id, memoId: optId(d.memoId), summary: str(d.summary, 8000), proposals, createdAt: iso(d.createdAt) };
}
export const normExtCal = (id, d = {}) => ({ id, name: str(d.name || '외부 캘린더', 60), url: str(d.url, 2000), color: color(d.color, 'slate'), lastSyncedAt: d.lastSyncedAt || null, lastError: d.lastError ? str(d.lastError, 300) : null });
export const normExtEvent = (id, d = {}) => ({ id, calendarId: optId(d.calendarId), title: str(d.title || '(제목 없음)', 200), startDate: okDate(d.startDate) ? d.startDate : ymd(today()), startTime: timeOf(d.startTime), endDate: okDate(d.endDate) ? d.endDate : (okDate(d.startDate) ? d.startDate : ymd(today())), endTime: timeOf(d.endTime), location: str(d.location, 200), external: true });

// ---- weekly checklist rule ----
// Where a task sits in week W (a Monday), or null if it doesn't show that week.
// supabase/functions/weekly-digest/index.ts repeats this rule for the Monday push.
export function weekRole(it, W) {
  const thisW = weekStart(today());
  if (it.done) return it.doneAt && +weekStart(parse(it.doneAt)) === +W ? 'done' : null;
  if (!it.due) return W >= weekStart(parse(it.created)) ? 'nodue' : null;
  const due = parse(it.due), dueW = weekStart(due), startW = weekStart(addDays(due, -it.lead));
  if (+W === +dueW) return 'due';
  if (W >= startW && W < dueW) return 'ahead';
  if (W > dueW && W <= thisW) return 'overdue';
  return null;
}
export const isCheckedIn = (it, W) => it.repeat && !it.done ? it.checks.includes(ymd(W)) : it.done;
export const completionDate = W => { const t = today(); return +weekStart(t) === +W ? ymd(t) : ymd(W); };

// Done flag and status move together.
export function withStatus(task, status, W = weekStart(today())) {
  if (status === 'done') return { ...task, status, done: true, doneAt: task.done ? task.doneAt : completionDate(W) };
  return { ...task, status, done: false, doneAt: null };
}

// Events (own and external) touching a given day, ordered: all-day first, then by start time.
export function eventsOn(list, dayStr) {
  return list.filter(e => e.startDate <= dayStr && e.endDate >= dayStr)
    .sort((a, b) => (a.startTime || '') < (b.startTime || '') ? -1 : (a.startTime || '') > (b.startTime || '') ? 1 : a.title.localeCompare(b.title, 'ko'));
}
export function eventTimeText(e, dayStr) {
  if (!e.startTime) return '종일';
  if (dayStr && e.startDate !== dayStr) return e.endDate === dayStr && e.endTime ? `~${e.endTime}` : '계속';
  return e.endTime && e.endDate === e.startDate ? `${e.startTime}–${e.endTime}` : e.startTime;
}
export const byDue = (a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : a.title.localeCompare(b.title, 'ko');
