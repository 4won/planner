// The app's tables, registered with the sync engine.
import { defineCollection } from './store.js';
import { normTask, normProject, normGroup, normEvent, normMemo, normEntry, normRecap, normExtCal, normExtEvent } from './model.js';

export const tasks = defineCollection('tasks', { norm: normTask, rename: { doneAt: 'done_at' }, legacyKey: 'items' });
export const projects = defineCollection('projects', { norm: normProject });
export const groups = defineCollection('project_groups', { norm: normGroup });
export const events = defineCollection('events', { norm: normEvent, rename: { remind: 'remind_minutes' } });
export const memos = defineCollection('memos', { norm: normMemo, rename: { updatedAt: 'touched_at' } });
export const entries = defineCollection('memo_entries', { norm: normEntry });
export const recaps = defineCollection('recaps', { norm: normRecap });
export const extCals = defineCollection('external_calendars', { norm: normExtCal, omit: ['lastSyncedAt', 'lastError'], realtime: false });
export const extEvents = defineCollection('external_events', { norm: normExtEvent, readOnly: true, realtime: false });

export const projectName = id => { const p = id && projects.get(id); return p ? p.name : ''; };
export const activeProjects = () => projects.all().filter(p => !p.archived).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'ko'));
export const allEvents = () => [...events.all(), ...extEvents.all().map(e => ({ ...e, color: (extCals.get(e.calendarId) || {}).color || 'slate' }))];
