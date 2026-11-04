// Shapes of every record and the rules shared by several screens.
import { okDate, okTime, ymd, today, parse, addDays, weekStart } from './dates.js';

export const COLORS = ['teal', 'blue', 'violet', 'rose', 'orange', 'amber', 'green', 'brown', 'slate'];
export const COLOR_NAMES = { teal: '청록', blue: '파랑', violet: '보라', rose: '장미', orange: '주황', amber: '호박', green: '초록', brown: '갈색', slate: '회청' };
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
export const normGroup = (id, d = {}) => ({ id, projectId: optId(d.projectId), name: str(d.name || '새 그룹', 60), color: color(d.color), sort: Number(d.sort) || 0 });
// Next color for a new group in a project, so neighbouring groups differ.
export const nextGroupColor = n => ['teal', 'violet', 'orange', 'blue', 'rose', 'green', 'amber', 'brown', 'slate'][n % 9];
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
    recur: normRecur(d.recur),
    remind: Array.isArray(d.remind) ? [...new Set(d.remind.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 10080))].sort((a, b) => a - b) : [10],
  };
}
// ---- repeating events ----
// recur: { freq: 'weekly'|'monthly'|'yearly', days: [0..6] (weekly, 0 = 일), monthMode: 'date'|'nth',
//          until: 'YYYY-MM-DD'|null, exdates: ['YYYY-MM-DD', …] }  — null means a one-off event.
// supabase/functions/_shared/recur.ts repeats this expansion for alerts and the calendar feed.
export function normRecur(r) {
  if (!r || typeof r !== 'object' || !['weekly', 'monthly', 'yearly'].includes(r.freq)) return null;
  return {
    freq: r.freq,
    days: Array.isArray(r.days) ? [...new Set(r.days.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : [],
    monthMode: r.monthMode === 'nth' ? 'nth' : 'date',
    until: okDate(r.until) ? r.until : null,
    exdates: Array.isArray(r.exdates) ? [...new Set(r.exdates.filter(okDate))].sort() : [],
  };
}
const NTH = ['첫째', '둘째', '셋째', '넷째', '마지막'];
// Which "Nth weekday" a date is; the 5th one counts as "last" so it exists every month.
const nthOf = d => { const n = Math.ceil(d.getDate() / 7); return n >= 5 ? -1 : n; };
function nthWeekday(y, m, wd, n) {
  if (n === -1) { const last = new Date(y, m + 1, 0); return addDays(last, -((last.getDay() - wd + 7) % 7)); }
  const first = new Date(y, m, 1);
  const d = addDays(first, ((wd - first.getDay() + 7) % 7) + (n - 1) * 7);
  return d.getMonth() === m ? d : null;
}
export function recurText(ev) {
  const r = ev.recur; if (!r) return '';
  const s = parse(ev.startDate);
  const W = ['일', '월', '화', '수', '목', '금', '토'];
  let t;
  if (r.freq === 'weekly') t = `매주 ${(r.days.length ? r.days : [s.getDay()]).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => W[d]).join('·')}요일`;
  else if (r.freq === 'monthly') { const n = nthOf(s); t = r.monthMode === 'nth' ? `매월 ${NTH[n === -1 ? 4 : n - 1]} 주 ${W[s.getDay()]}요일` : `매월 ${s.getDate()}일`; }
  else t = `매년 ${s.getMonth() + 1}월 ${s.getDate()}일`;
  return t + (r.until ? ` · ${r.until.slice(2).replaceAll('-', '.')}까지` : '');
}
// Every occurrence of `ev` that overlaps [from, to] (date strings). One-off events pass through.
export function occurrences(ev, from, to) {
  if (!ev.recur) return ev.endDate < from || ev.startDate > to ? [] : [ev];
  const r = ev.recur, start = parse(ev.startDate);
  const dur = Math.round((parse(ev.endDate) - start) / 864e5);
  const lo = ymd(addDays(parse(from), -dur)), hi = r.until && r.until < to ? r.until : to;
  if (hi < ev.startDate) return [];
  const out = [];
  const take = d => {
    if (!d) return;
    const s = ymd(d);
    if (s < ev.startDate || s < lo || s > hi || r.exdates.includes(s)) return;
    out.push({ ...ev, id: `${ev.id}@${s}`, seriesId: ev.id, occDate: s, startDate: s, endDate: ymd(addDays(d, dur)) });
  };
  const begin = lo > ev.startDate ? parse(lo) : start;
  if (r.freq === 'weekly') {
    const days = r.days.length ? r.days : [start.getDay()];
    for (let w = weekStart(begin), n = 0; ymd(w) <= hi && n < 600; w = addDays(w, 7), n++) days.forEach(d => take(addDays(w, (d + 6) % 7)));
  } else if (r.freq === 'monthly') {
    const n0 = nthOf(start);
    for (let y = begin.getFullYear(), m = begin.getMonth(), n = 0; n < 240; n++, m++) {
      if (m > 11) { m = 0; y++; }
      if (ymd(new Date(y, m, 1)) > hi) break;
      if (r.monthMode === 'nth') take(nthWeekday(y, m, start.getDay(), n0));
      else { const d = new Date(y, m, start.getDate()); if (d.getMonth() === m) take(d); }
    }
  } else {
    for (let y = begin.getFullYear(); y <= +hi.slice(0, 4); y++) { const d = new Date(y, start.getMonth(), start.getDate()); if (d.getMonth() === start.getMonth()) take(d); }
  }
  return out.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

// Promotions copied from the work hub (read-only here).
export const normPromo = (id, d = {}) => ({
  id, title: str(d.title || '프로모션', 160),
  startDate: okDate(d.startDate) ? d.startDate : ymd(today()),
  endDate: okDate(d.endDate) ? d.endDate : (okDate(d.startDate) ? d.startDate : ymd(today())),
  channel: ['online', 'offline', 'both'].includes(d.channel) ? d.channel : 'both',
  status: str(d.status, 20), memo: str(d.memo, 2000), promo: true,
});
export const channelLabel = c => ({ online: '온라인', offline: '오프라인', both: '온·오프' }[c] || '');

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
    endDate: okDate(p.endDate || p.end_date) ? (p.endDate || p.end_date) : null,
    groupId: optId(p.groupId || p.group_id),
    groupName: str(p.groupName || p.group_name, 60),
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
