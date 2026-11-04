// The app's tables, registered with the sync engine.
import { defineCollection } from './store.js';
import { normTask, normProject, normGroup, normEvent, normMemo, normEntry, normRecap, normExtCal, normExtEvent, normPromo, occurrences } from './model.js';
import { ymd, addDays, today } from './dates.js';

export const tasks = defineCollection('tasks', { norm: normTask, rename: { doneAt: 'done_at' }, legacyKey: 'items' });
export const projects = defineCollection('projects', { norm: normProject });
export const groups = defineCollection('project_groups', { norm: normGroup });
export const events = defineCollection('events', { norm: normEvent, rename: { remind: 'remind_minutes' } });
export const memos = defineCollection('memos', { norm: normMemo, rename: { updatedAt: 'touched_at' } });
export const entries = defineCollection('memo_entries', { norm: normEntry });
export const recaps = defineCollection('recaps', { norm: normRecap });
export const extCals = defineCollection('external_calendars', { norm: normExtCal, omit: ['lastSyncedAt', 'lastError'], realtime: false });
export const extEvents = defineCollection('external_events', { norm: normExtEvent, readOnly: true, realtime: false });
export const promos = defineCollection('promotions', { norm: normPromo, readOnly: true, realtime: false });

export const projectName = id => { const p = id && projects.get(id); return p ? p.name : ''; };
export const activeProjects = () => projects.all().filter(p => !p.archived).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'ko'));

// Own events (repeating ones expanded into occurrences) plus external calendar events.
// Without a range it covers roughly half a year back and a year ahead.
export function allEvents(from, to) {
  const lo = from || ymd(addDays(today(), -190)), hi = to || ymd(addDays(today(), 400));
  return [
    ...events.all().flatMap(e => occurrences(e, lo, hi)),
    ...extEvents.all().filter(e => e.endDate >= lo && e.startDate <= hi).map(e => ({ ...e, color: (extCals.get(e.calendarId) || {}).color || 'slate' })),
  ];
}
export const promosIn = (from, to) => promos.all().filter(p => p.endDate >= from && p.startDate <= to);
