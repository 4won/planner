// One sync engine for every table. Each change lands in memory and the local cache first,
// then reaches Supabase through a persisted outbox (one pending op per record, latest wins),
// so the app keeps working offline. Without a Supabase config everything stays on this device.
const CFG = window.PLANNER_CONFIG || {};
// Development aid: http://localhost:…/?local runs on this device only, without signing in.
const FORCE_LOCAL = location.hostname === 'localhost' && new URLSearchParams(location.search).has('local');
export const CLOUD = !FORCE_LOCAL && !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase);
export const sb = CLOUD ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
export const config = CFG;

const camel = s => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const snake = s => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase());

export const state = { uid: null, email: '', loaded: false, flushing: false, syncError: null };
const collections = new Map();
let outbox = new Map();
let channel = null;
const listeners = new Set();
let notifyQueued = false;

export function onChange(fn) { listeners.add(fn); }
function notify() {
  if (notifyQueued) return;
  notifyQueued = true;
  requestAnimationFrame(() => { notifyQueued = false; listeners.forEach(fn => fn()); });
}

const lsGet = (k, f) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch (e) { return f; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

/**
 * table: Supabase table name. norm(id, plain) builds a clean record.
 * rename: { recordKey: column } for fields whose column isn't the plain snake_case name.
 * omit: record keys never written by the app (the server owns them).
 */
export function defineCollection(table, { norm, rename = {}, omit = [], readOnly = false, realtime = true, legacyKey = null }) {
  const back = Object.fromEntries(Object.entries(rename).map(([k, v]) => [v, k]));
  const c = {
    table, norm, readOnly, realtime, legacyKey,
    items: new Map(),
    toRow(rec) {
      const row = { user_id: state.uid };
      for (const [k, v] of Object.entries(rec)) {
        if (k === 'external' || omit.includes(k)) continue;
        row[rename[k] || snake(k)] = v;
      }
      return row;
    },
    fromRow(row) {
      const o = {};
      for (const [k, v] of Object.entries(row)) { if (k !== 'user_id' && k !== 'updated_at') o[back[k] || camel(k)] = v; }
      return norm(row.id, o);
    },
    all() { return [...c.items.values()]; },
    get(id) { return c.items.get(id); },
    put(rec) {
      c.items.set(rec.id, rec);
      if (state.uid && !readOnly) outbox.set(`${table}:${rec.id}`, { table, id: rec.id, op: 'upsert', row: c.toRow(rec) });
      persist(); notify(); flush();
    },
    remove(id) {
      if (!c.items.has(id)) return;
      c.items.delete(id);
      if (state.uid && !readOnly) outbox.set(`${table}:${id}`, { table, id, op: 'delete' });
      persist(); notify(); flush();
    },
  };
  collections.set(table, c);
  return c;
}

const cacheKey = c => state.uid ? (c.legacyKey ? `wcp:${state.uid}:${c.legacyKey}` : `wcp:${state.uid}:${c.table}`) : (c.legacyKey ? `wcp:local:${c.legacyKey}` : `wcp:local:${c.table}`);
const outKey = () => `wcp:${state.uid}:outbox`;

function persist() {
  for (const c of collections.values()) lsSet(cacheKey(c), c.all());
  if (state.uid) lsSet(outKey(), [...outbox.values()]);
}
function loadCache() {
  for (const c of collections.values()) {
    c.items = new Map(lsGet(cacheKey(c), []).filter(o => o && o.id).map(o => [o.id, c.norm(o.id, o)]));
  }
  // Outbox entries written before tables were tracked belong to tasks.
  outbox = state.uid ? new Map(lsGet(outKey(), []).filter(op => op && op.id).map(op => { op.table = op.table || 'tasks'; return [`${op.table}:${op.id}`, op]; })) : new Map();
}

export const pendingCount = () => outbox.size;

export async function flush() {
  if (!state.uid || state.flushing || !navigator.onLine || !outbox.size) { notify(); return; }
  state.flushing = true; notify();
  try {
    for (const [key, op] of [...outbox.entries()]) {
      const res = op.op === 'delete'
        ? await sb.from(op.table).delete().eq('id', op.id)
        : await sb.from(op.table).upsert(op.row);
      if (res.error) throw res.error;
      if (outbox.get(key) === op) outbox.delete(key);
      persist();
    }
    state.syncError = null;
  } catch (e) {
    state.syncError = (e && e.message) || String(e);
  } finally {
    state.flushing = false; notify();
    if (!state.syncError && outbox.size) flush();
  }
}

async function fetchAll(table) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select('*').range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

export async function refresh() {
  if (!state.uid || !navigator.onLine) { notify(); return; }
  try {
    const results = await Promise.all([...collections.values()].map(async c => [c, await fetchAll(c.table)]));
    for (const [c, rows] of results) {
      const m = new Map(rows.map(r => [r.id, c.fromRow(r)]));
      for (const op of outbox.values()) {
        if (op.table !== c.table) continue;
        if (op.op === 'delete') m.delete(op.id); else m.set(op.id, c.fromRow(op.row));
      }
      c.items = m;
    }
    state.loaded = true; state.syncError = null;
    persist();
  } catch (e) {
    state.syncError = (e && e.message) || String(e);
  }
  notify();
}

function subscribeRealtime() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel('planner-' + state.uid);
  for (const c of collections.values()) {
    if (!c.realtime) continue;
    channel.on('postgres_changes', { event: '*', schema: 'public', table: c.table }, p => {
      const id = (p.new && p.new.id) || (p.old && p.old.id);
      if (!id || outbox.has(`${c.table}:${id}`)) return;
      if (p.eventType === 'DELETE') c.items.delete(id);
      else if (p.new.user_id === state.uid) c.items.set(id, c.fromRow(p.new));
      persist(); notify();
    });
  }
  channel.subscribe();
}

export function startLocal() {
  state.uid = null; loadCache(); state.loaded = true; notify();
}
export function startSession(user) {
  state.uid = user.id; state.email = user.email || '';
  loadCache();
  state.loaded = [...collections.values()].some(c => c.items.size);
  notify();
  subscribeRealtime();
  refresh().then(flush);
}
export function stopSession() {
  if (channel) { sb.removeChannel(channel); channel = null; }
  state.uid = null; state.email = ''; state.loaded = false; outbox = new Map();
  for (const c of collections.values()) c.items = new Map();
  notify();
}

window.addEventListener('online', () => { refresh().then(flush); });
window.addEventListener('offline', notify);
setInterval(() => { if (outbox.size) flush(); }, 60000);
