(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const CFG = window.PLANNER_CONFIG || {};
  const CLOUD = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase);
  const sb = CLOUD ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

  const COLORS = ['teal', 'amber', 'rose', 'violet', 'slate'];
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const CHECK_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';

  // ---------- dates ----------
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const today = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); };
  const weekStart = d => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
  const daysBetween = (a, b) => Math.round((b - a) / 864e5);
  const isoWeek = d => {
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const jan4 = new Date(t.getFullYear(), 0, 4);
    return 1 + Math.round((daysBetween(jan4, t) - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  };
  const md = d => `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`;
  const mdLong = d => `${d.getMonth() + 1}월 ${d.getDate()}일(${DOW[d.getDay()]})`;
  const leadLabel = n => ({ 0: '마감 주에만', 7: '1주 전부터', 14: '2주 전부터', 30: '한 달 전부터', 60: '두 달 전부터', 90: '석 달 전부터' }[n] || `${n}일 전부터`);
  const newId = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- model ----------
  const okDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  function norm(id, d) {
    d = d || {};
    return {
      id,
      title: String(d.title || '(제목 없음)').slice(0, 120),
      due: okDate(d.due) ? d.due : null,
      lead: Math.max(0, Math.min(365, Math.round(Number(d.lead) || 0))),
      repeat: !!d.repeat,
      color: COLORS.includes(d.color) ? d.color : 'teal',
      memo: String(d.memo || '').slice(0, 2000),
      checks: Array.isArray(d.checks) ? d.checks.filter(okDate) : [],
      done: !!d.done,
      doneAt: okDate(d.doneAt) ? d.doneAt : null,
      created: okDate(d.created) ? d.created : ymd(today()),
    };
  }

  // Where an item sits in week W (a Monday), or null if it doesn't show that week.
  // supabase/functions/weekly-digest/index.ts repeats this rule for the Monday push.
  function weekRole(it, W) {
    const thisW = weekStart(today());
    if (it.done) return it.doneAt && +weekStart(parse(it.doneAt)) === +W ? 'done' : null;
    if (!it.due) return W >= weekStart(parse(it.created)) ? 'nodue' : null;
    const due = parse(it.due), dueW = weekStart(due), startW = weekStart(addDays(due, -it.lead));
    if (+W === +dueW) return 'due';
    if (W >= startW && W < dueW) return 'ahead';
    if (W > dueW && W <= thisW) return 'overdue';
    return null;
  }
  const isCheckedIn = (it, W) => it.repeat && !it.done ? it.checks.includes(ymd(W)) : it.done;
  const completionDate = W => { const t = today(); return +weekStart(t) === +W ? ymd(t) : ymd(W); };

  // ---------- store ----------
  // Every change lands in `items` and the local cache first, then goes to the server through
  // an outbox (one pending op per item, latest wins), so the app keeps working offline.
  const store = { uid: null, email: '', items: new Map(), outbox: new Map(), loaded: false, flushing: false, syncError: null, channel: null };
  const lsGet = (k, f) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch (e) { return f; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const cacheKey = () => `wcp:${store.uid || 'local'}:items`;
  const outKey = () => `wcp:${store.uid}:outbox`;

  const toRow = it => ({ id: it.id, user_id: store.uid, title: it.title, due: it.due, lead: it.lead, repeat: it.repeat, color: it.color, memo: it.memo, checks: it.checks, done: it.done, done_at: it.doneAt, created: it.created });
  const fromRow = r => norm(r.id, { ...r, doneAt: r.done_at });

  function persist() {
    lsSet(cacheKey(), [...store.items.values()]);
    if (store.uid) lsSet(outKey(), [...store.outbox.values()]);
  }
  function loadCache() {
    store.items = new Map(lsGet(cacheKey(), []).filter(o => o && o.id).map(o => [o.id, norm(o.id, o)]));
    store.outbox = store.uid ? new Map(lsGet(outKey(), []).filter(op => op && op.id).map(op => [op.id, op])) : new Map();
  }

  function put(it) {
    store.items.set(it.id, it);
    if (store.uid) store.outbox.set(it.id, { id: it.id, op: 'upsert', row: toRow(it) });
    persist(); render(); flush();
  }
  function remove(id) {
    store.items.delete(id);
    if (store.uid) store.outbox.set(id, { id, op: 'delete' });
    persist(); render(); flush();
  }

  async function flush() {
    if (!store.uid || store.flushing || !navigator.onLine || !store.outbox.size) { updateSync(); return; }
    store.flushing = true; updateSync();
    try {
      for (const op of [...store.outbox.values()]) {
        const res = op.op === 'delete'
          ? await sb.from('tasks').delete().eq('id', op.id)
          : await sb.from('tasks').upsert(op.row);
        if (res.error) throw res.error;
        if (store.outbox.get(op.id) === op) store.outbox.delete(op.id);
        persist();
      }
      store.syncError = null;
    } catch (e) {
      store.syncError = (e && e.message) || String(e);
    } finally {
      store.flushing = false; updateSync();
      if (!store.syncError && store.outbox.size) flush();
    }
  }

  async function refresh() {
    if (!store.uid || !navigator.onLine) { updateSync(); return; }
    const { data, error } = await sb.from('tasks').select('*');
    if (error) { store.syncError = error.message; updateSync(); return; }
    const m = new Map(data.map(r => [r.id, fromRow(r)]));
    for (const op of store.outbox.values()) { if (op.op === 'delete') m.delete(op.id); else m.set(op.id, fromRow(op.row)); }
    store.items = m; store.loaded = true; store.syncError = null;
    persist(); render(); updateSync();
  }

  function subscribeRealtime() {
    if (store.channel) sb.removeChannel(store.channel);
    store.channel = sb.channel('tasks-' + store.uid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, p => {
        const id = (p.new && p.new.id) || (p.old && p.old.id);
        if (!id || store.outbox.has(id)) return;
        if (p.eventType === 'DELETE') store.items.delete(id);
        else if (p.new.user_id === store.uid) store.items.set(id, fromRow(p.new));
        persist(); render();
      })
      .subscribe();
  }

  function updateSync() {
    const dot = $('#syncDot'), note = $('#syncNote');
    if (!CLOUD) { dot.className = 'sync-dot'; note.textContent = '이 기기에만 저장됩니다'; return; }
    if (!store.uid) return;
    const n = store.outbox.size;
    if (store.syncError) { dot.className = 'sync-dot err'; note.textContent = `동기화 오류 · 변경 ${n}건 대기`; }
    else if (!navigator.onLine) { dot.className = 'sync-dot wait'; note.textContent = n ? `오프라인 · 변경 ${n}건은 연결되면 저장` : '오프라인 · 저장된 내용 표시 중'; }
    else if (n || store.flushing) { dot.className = 'sync-dot wait'; note.textContent = '저장 중…'; }
    else { dot.className = 'sync-dot ok'; note.textContent = '동기화됨'; }
    if (store.syncError) showBanner(`서버에 저장하지 못했습니다: ${store.syncError}. 연결이 돌아오면 다시 시도합니다.`, true);
    else if ($('#banner').dataset.kind === 'sync') hideBanner();
  }

  function showBanner(msg, warn, kind = 'sync') { const b = $('#banner'); b.textContent = msg; b.classList.toggle('warn', !!warn); b.dataset.kind = kind; b.hidden = false; }
  function hideBanner() { const b = $('#banner'); b.hidden = true; b.dataset.kind = ''; }

  // ---------- session ----------
  function showAuth() { $('#main').hidden = true; $('#auth').hidden = false; }
  function showMain() { $('#auth').hidden = true; $('#main').hidden = false; }

  function startSession(user) {
    store.uid = user.id; store.email = user.email || '';
    loadCache(); store.loaded = store.items.size > 0;
    showMain(); render(); updateSync();
    subscribeRealtime();
    refresh().then(flush);
  }
  function stopSession() {
    if (store.channel) { sb.removeChannel(store.channel); store.channel = null; }
    store.uid = null; store.email = ''; store.items = new Map(); store.outbox = new Map(); store.loaded = false;
  }

  const AUTH_ERRORS = [
    [/invalid login credentials/i, '이메일 또는 비밀번호가 맞지 않습니다.'],
    [/email not confirmed/i, '메일 인증이 아직 안 됐습니다. 받은 메일의 링크를 누른 뒤 다시 로그인하세요.'],
    [/signups? not allowed|signup is disabled/i, '새 가입이 막혀 있습니다. 기존 계정으로 로그인하세요.'],
    [/already registered/i, '이미 가입된 이메일입니다. 로그인하세요.'],
    [/password should be at least/i, '비밀번호는 8자 이상이어야 합니다.'],
    [/rate limit/i, '시도가 너무 많습니다. 잠시 후 다시 해 주세요.'],
  ];
  const authErr = e => { const m = (e && e.message) || ''; const hit = AUTH_ERRORS.find(([re]) => re.test(m)); return hit ? hit[1] : `로그인하지 못했습니다: ${m}`; };

  async function onAuth(mode) {
    const email = $('#a-email').value.trim(), password = $('#a-pw').value, msg = $('#authMsg');
    msg.className = 'auth-msg err';
    if (!email || !email.includes('@')) { msg.textContent = '이메일을 입력하세요.'; return; }
    if (password.length < 8) { msg.textContent = '비밀번호는 8자 이상이어야 합니다.'; return; }
    msg.className = 'auth-msg'; msg.textContent = mode === 'signup' ? '가입하는 중…' : '로그인하는 중…';
    $('#authLogin').disabled = $('#authSignup').disabled = true;
    try {
      const res = mode === 'signup'
        ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } })
        : await sb.auth.signInWithPassword({ email, password });
      if (res.error) { msg.className = 'auth-msg err'; msg.textContent = authErr(res.error); }
      else if (mode === 'signup' && !res.data.session) { msg.textContent = '확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 여기서 로그인하세요.'; }
      else msg.textContent = '';
    } catch (e) { msg.className = 'auth-msg err'; msg.textContent = '서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.'; }
    finally { $('#authLogin').disabled = $('#authSignup').disabled = false; }
  }

  // ---------- state ----------
  const ui = { view: 'week', week: weekStart(today()), seenWeek: weekStart(today()), month: new Date(today().getFullYear(), today().getMonth(), 1), filter: 'open', q: '' };

  // ---------- rendering helpers ----------
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function ddayEl(it) {
    if (!it.due) return null;
    const diff = daysBetween(today(), parse(it.due));
    return el('span', 'dday' + (diff < 0 && !it.done ? ' late' : diff === 0 ? ' today' : ''), diff > 0 ? `D-${diff}` : diff === 0 ? 'D-DAY' : `D+${-diff}`);
  }

  function rowEl(it, W) {
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
    const dd = ddayEl(it); if (dd) meta.append(dd);
    if (it.due) meta.append(el('span', '', `${md(parse(it.due))} 마감`));
    if (it.repeat && !it.done) meta.append(el('span', 'pill weekly', '매주 확인'));
    if (it.due && it.lead && !it.done) meta.append(el('span', '', leadLabel(it.lead)));
    if (it.repeat && it.checks.length) meta.append(el('span', '', `확인 ${it.checks.length}회`));
    if (it.done && it.doneAt) meta.append(el('span', '', `${md(parse(it.doneAt))} 완료`));
    if (role === 'ahead' && checked) meta.append(el('span', '', '다음 주에 다시 표시'));
    main.append(meta);
    main.addEventListener('click', () => openEditor(it.id));
    r.append(main);

    if (it.repeat && !it.done) {
      const f = el('button', 'finish', '완료'); f.type = 'button';
      f.title = '프로젝트를 끝내고 체크리스트에서 내립니다';
      f.addEventListener('click', () => finish(it.id, W || weekStart(today())));
      r.append(f);
    }
    return r;
  }

  function groupEl(label, items, W, opts = {}) {
    const g = el('div', 'group');
    const h = el('div', 'group-head' + (opts.late ? ' late' : ''));
    h.append(el('span', '', label), el('span', 'count', String(items.length)));
    if (opts.note) h.append(el('span', 'group-note', '· ' + opts.note));
    g.append(h);
    items.forEach(it => g.append(rowEl(it, W)));
    return g;
  }

  const byDue = (a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : a.title.localeCompare(b.title, 'ko');

  function emptyEl(title, text, withExamples) {
    const e = el('div', 'empty');
    e.append(el('strong', '', title), el('p', '', text));
    const acts = el('div', 'acts');
    const add = el('button', 'btn primary', '+ 새 할 일'); add.type = 'button'; add.addEventListener('click', () => openEditor(null));
    acts.append(add);
    if (withExamples) { const ex = el('button', 'btn', '예시 3개 넣어보기'); ex.type = 'button'; ex.addEventListener('click', addExamples); acts.append(ex); }
    e.append(acts);
    return e;
  }

  // ---------- views ----------
  function renderWeek() {
    const W = ui.week, We = addDays(W, 6), isThis = +W === +weekStart(today());
    const lbl = $('#wkLabel'); lbl.textContent = '';
    const range = `${W.getFullYear()}년 ${W.getMonth() + 1}월 ${W.getDate()}일 – ${We.getMonth() + 1}월 ${We.getDate()}일`;
    if (isThis) lbl.append(el('span', 'hl', range)); else lbl.textContent = range;
    lbl.append(' ', el('span', 'wkno', `W${pad(isoWeek(W))}`));

    const body = $('#weekBody'); body.textContent = '';
    if (!store.loaded) { body.append(el('div', 'empty', '체크리스트를 불러오는 중…')); $('#wkMeta').textContent = ''; return; }

    const groups = { overdue: [], due: [], ahead: [], nodue: [], done: [] };
    for (const it of store.items.values()) { const r = weekRole(it, W); if (r) groups[r].push(it); }
    Object.values(groups).forEach(a => a.sort(byDue));
    const active = [...groups.overdue, ...groups.due, ...groups.ahead, ...groups.nodue];
    const checkedN = active.filter(it => isCheckedIn(it, W)).length;
    $('#wkMeta').textContent = active.length || groups.done.length
      ? `${isThis ? '이번 주' : '이 주'} 챙길 일 ${active.length}개 · 확인 ${checkedN}/${active.length}` + (groups.done.length ? ` · 완료 ${groups.done.length}` : '')
      : '';

    if (!store.items.size) { body.append(emptyEl('아직 할 일이 없습니다', '마감일과 “언제부터 챙길지”를 정하면, 그 날부터 매주 이 체크리스트에 올라옵니다. 체크해도 마감까지 다음 주에 다시 나옵니다.', true)); return; }
    if (!active.length && !groups.done.length) { body.append(emptyEl('이 주에 챙길 일이 없습니다', '다른 주를 보거나 새 할 일을 추가해 보세요.', false)); return; }

    if (groups.overdue.length) body.append(groupEl('기한 지남', groups.overdue, W, { late: true, note: '완료할 때까지 계속 표시' }));
    if (groups.due.length) body.append(groupEl(isThis ? '이번 주 마감' : '이 주 마감', groups.due, W));
    if (groups.ahead.length) body.append(groupEl('미리 챙길 일', groups.ahead, W, { note: '리마인드 기간' }));
    if (groups.nodue.length) body.append(groupEl('기한 없는 할 일', groups.nodue, W));
    if (groups.done.length) body.append(groupEl(isThis ? '이번 주 완료' : '이 주 완료', groups.done, W));
  }

  function renderCalendar() {
    const M = ui.month, y = M.getFullYear(), m = M.getMonth();
    $('#mLabel').textContent = `${y}년 ${m + 1}월`;
    const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
    const start = weekStart(first), weeks = Math.ceil((daysBetween(start, last) + 1) / 7);
    const items = [...store.items.values()];
    const tStr = ymd(today()), thisW = +weekStart(today());

    const cal = $('#cal'); cal.textContent = '';
    cal.append(el('div', 'dow wh', ''));
    ['월', '화', '수', '목', '금', '토', '일'].forEach((d, i) => cal.append(el('div', 'dow' + (i === 6 ? ' sun' : ''), d)));

    for (let w = 0; w < weeks; w++) {
      const ws = addDays(start, w * 7);
      cal.append(el('div', 'wcol' + (+ws === thisW ? ' cur' : ''), `W${pad(isoWeek(ws))}`));
      for (let i = 0; i < 7; i++) {
        const d = addDays(ws, i), ds = ymd(d);
        const c = el('div', 'cell' + (d.getMonth() !== m ? ' out' : '') + (ds === tStr ? ' today' : ''));
        c.append(el('span', 'dnum', String(d.getDate())));
        const dues = items.filter(it => it.due === ds).sort((a, b) => a.done - b.done);
        dues.slice(0, 3).forEach(it => {
          const ch = el('button', 'chip c-' + it.color + (it.done ? ' done' : ''), it.title); ch.type = 'button';
          ch.title = it.title;
          ch.addEventListener('click', e => { e.stopPropagation(); openEditor(it.id); });
          c.append(ch);
        });
        if (dues.length > 3) c.append(el('span', 'more-n', `+${dues.length - 3}개`));
        const windows = items.filter(it => !it.done && it.due && it.lead && ds >= ymd(addDays(parse(it.due), -it.lead)) && ds < it.due);
        if (windows.length) {
          const bands = el('div', 'bands');
          windows.sort(byDue).slice(0, 4).forEach(it => { const b = el('div', 'band c-' + it.color); b.title = `${it.title} · 미리 챙기는 기간`; bands.append(b); });
          c.append(bands);
        }
        c.addEventListener('click', () => openEditor(null, ds));
        cal.append(c);
      }
    }

    const monthItems = items.filter(it => it.due && it.due.slice(0, 7) === `${y}-${pad(m + 1)}`).sort(byDue);
    $('#mMeta').textContent = monthItems.length ? `이달 마감 ${monthItems.length}개 · 남은 ${monthItems.filter(it => !it.done).length}개` : '이달 마감 없음';
    const ag = $('#agenda'); ag.textContent = '';
    if (monthItems.length) {
      ag.append(el('h3', '', `${m + 1}월 마감 목록`));
      const g = el('div', 'group'); monthItems.forEach(it => g.append(rowEl(it, null))); ag.append(g);
    } else if (store.loaded && !store.items.size) {
      ag.append(emptyEl('캘린더가 비어 있습니다', '날짜를 눌러 그날 마감인 할 일을 추가하세요.', true));
    }
  }

  function renderAll() {
    document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.filter === ui.filter)));
    const body = $('#allBody'); body.textContent = '';
    if (!store.loaded) { body.append(el('div', 'empty', '불러오는 중…')); return; }
    if (!store.items.size) { body.append(emptyEl('아직 할 일이 없습니다', '추가한 할 일과 프로젝트가 모두 여기에 모입니다.', true)); return; }
    const q = ui.q.trim().toLowerCase();
    let list = [...store.items.values()].filter(it => ui.filter === 'done' ? it.done : !it.done);
    if (q) list = list.filter(it => (it.title + ' ' + it.memo).toLowerCase().includes(q));
    if (ui.filter === 'done') list.sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
    else list.sort(byDue);
    if (!list.length) { body.append(el('div', 'empty', q ? '검색 결과가 없습니다.' : ui.filter === 'done' ? '완료한 항목이 없습니다.' : '진행 중인 항목이 없습니다.')); return; }
    const g = el('div', 'group'); list.forEach(it => g.append(rowEl(it, null))); body.append(g);
  }

  function render() {
    if ($('#main').hidden) return;
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === ui.view)));
    ['week', 'calendar', 'all'].forEach(v => { $('#view-' + v).hidden = v !== ui.view; });
    if (ui.view === 'week') renderWeek();
    else if (ui.view === 'calendar') renderCalendar();
    else renderAll();
  }

  // ---------- actions ----------
  function toggleCheck(id, W) {
    const cur = store.items.get(id); if (!cur) return;
    const it = { ...cur, checks: [...cur.checks] };
    if (it.repeat && !it.done) {
      const k = ymd(W), i = it.checks.indexOf(k);
      if (i >= 0) it.checks.splice(i, 1); else it.checks.push(k);
    } else if (it.done) { it.done = false; it.doneAt = null; }
    else { it.done = true; it.doneAt = completionDate(W); }
    put(it);
  }
  function finish(id, W) {
    const cur = store.items.get(id); if (!cur) return;
    const k = ymd(W);
    put({ ...cur, done: true, doneAt: completionDate(W), checks: cur.checks.includes(k) ? cur.checks : [...cur.checks, k] });
  }
  function addExamples() {
    const t = today();
    [
      { title: '예시 · 연말 프로모션 준비', due: ymd(addDays(t, 30)), lead: 30, repeat: true, color: 'rose', memo: '한 달 전부터 매주 진행 상황 확인' },
      { title: '예시 · 분기 재고 점검 보고', due: ymd(addDays(t, 10)), lead: 14, repeat: true, color: 'amber', memo: '' },
      { title: '예시 · 거래처 견적서 회신', due: ymd(addDays(t, 2)), lead: 0, repeat: false, color: 'teal', memo: '체크하면 바로 완료되는 일반 할 일' },
    ].forEach(o => put(norm(newId(), { ...o, created: ymd(t) })));
  }

  // ---------- editor ----------
  const dlg = $('#editor');
  let editingId = null, deleteArmed = false;
  const leadValue = () => $('#f-lead').value === 'custom' ? Math.max(1, Math.min(365, Math.round(Number($('#f-leadCustom').value) || 1))) : Number($('#f-lead').value);

  function updateHint() {
    const due = $('#f-due').value, repeat = $('#f-repeat').checked;
    $('#f-lead').disabled = !due; $('#f-leadCustom').hidden = $('#f-lead').value !== 'custom'; $('#f-leadCustom').disabled = !due;
    let s;
    if (!due) s = repeat ? '마감일 없이 매주 체크리스트에 나옵니다. ‘완료’를 누르면 끝납니다.' : '마감일 없는 할 일입니다. 체크하면 바로 완료됩니다.';
    else {
      const d = parse(due), lead = leadValue(), startW = weekStart(addDays(d, -lead));
      const from = lead ? `${mdLong(startW)}이 있는 주부터` : '마감 주에';
      s = `${mdLong(d)} 마감 · ${from} 체크리스트에 표시` + (repeat ? '. 매주 체크해도 완료할 때까지 다음 주에 다시 나옵니다.' : '. 체크하면 완료됩니다.') + ' 마감이 지나면 ‘기한 지남’에 남습니다.';
    }
    $('#f-hint').textContent = s;
  }

  function openEditor(id, presetDue) {
    editingId = id; deleteArmed = false;
    const it = id ? store.items.get(id) : null;
    $('#edTitle').textContent = it ? '할 일 편집' : '새 할 일';
    $('#f-title').value = it ? it.title : '';
    $('#f-due').value = it ? (it.due || '') : (presetDue || '');
    const lead = it ? it.lead : 30;
    const preset = ['0', '7', '14', '30', '60', '90'].includes(String(lead));
    $('#f-lead').value = preset ? String(lead) : 'custom';
    $('#f-leadCustom').value = preset ? 45 : lead;
    $('#f-repeat').checked = it ? it.repeat : true;
    const color = it ? it.color : 'teal';
    document.querySelectorAll('#f-color input').forEach(r => { r.checked = r.value === color; });
    $('#f-memo').value = it ? it.memo : '';
    const del = $('#edDelete'); del.hidden = !it; del.textContent = '삭제'; del.classList.remove('armed');
    const td = $('#edToggleDone'); td.hidden = !it; td.textContent = it && it.done ? '다시 진행' : '완료 처리';
    updateHint();
    dlg.showModal();
    $('#f-title').focus();
  }

  // ---------- push ----------
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const b64ToBytes = s => { const p = '='.repeat((4 - s.length % 4) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, c => c.charCodeAt(0)); };

  async function currentSub() {
    if (!pushSupported()) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
  }
  function pushMsg(text, err) { const m = $('#pushMsg'); m.textContent = text; m.className = 'set-msg' + (err ? ' err' : ''); }

  async function renderPush() {
    const on = $('#pushOn'), off = $('#pushOff'), test = $('#pushTest');
    on.hidden = off.hidden = test.hidden = true;
    if (!CLOUD || !store.uid) { pushMsg('알림은 로그인해서 동기화를 쓸 때만 켤 수 있습니다.'); return; }
    if (isIOS && !standalone()) { pushMsg('iPhone은 먼저 홈 화면에 앱을 추가하고, 홈 화면 아이콘으로 연 다음 알림을 켤 수 있습니다.'); return; }
    if (!pushSupported()) { pushMsg('이 브라우저는 푸시 알림을 지원하지 않습니다.'); return; }
    if (Notification.permission === 'denied') { pushMsg('이 기기에서 알림이 차단되어 있습니다. 브라우저나 휴대폰 설정에서 이 앱의 알림을 허용해 주세요.', true); return; }
    const sub = await currentSub();
    if (sub) { off.hidden = test.hidden = false; pushMsg('이 기기에서 알림이 켜져 있습니다.'); }
    else { on.hidden = false; pushMsg(''); }
  }

  async function enablePush() {
    try {
      pushMsg('알림 권한을 요청하는 중…');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { pushMsg('알림 권한이 허용되지 않았습니다.', true); return renderPush(); }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(CFG.vapidPublicKey) });
      const j = sub.toJSON();
      const { error } = await sb.from('push_subscriptions').upsert({ endpoint: j.endpoint, user_id: store.uid, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200) });
      if (error) throw error;
      await renderPush();
      pushMsg('알림을 켰습니다. ‘지금 테스트 알림 받기’로 확인해 보세요.');
    } catch (e) { pushMsg(`알림을 켜지 못했습니다: ${(e && e.message) || e}`, true); }
  }
  async function disablePush() {
    try {
      const sub = await currentSub();
      if (sub) { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
      await renderPush(); pushMsg('이 기기의 알림을 껐습니다.');
    } catch (e) { pushMsg(`알림을 끄지 못했습니다: ${(e && e.message) || e}`, true); }
  }
  async function testPush() {
    pushMsg('테스트 알림을 보내는 중…');
    try {
      const { data, error } = await sb.functions.invoke('weekly-digest', { body: { test: true } });
      if (error) throw error;
      pushMsg(data && data.sent ? `보냈습니다 (${data.sent}대). 몇 초 안에 도착합니다.` : '보낼 기기를 찾지 못했습니다. 알림을 껐다가 다시 켜 보세요.', !(data && data.sent));
    } catch (e) { pushMsg(`테스트 알림을 보내지 못했습니다: ${(e && e.message) || e}`, true); }
  }

  // ---------- install ----------
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; renderInstall(); });
  window.addEventListener('appinstalled', () => { installPrompt = null; renderInstall(); });
  function renderInstall() {
    const t = $('#installText'), b = $('#installBtn');
    b.hidden = true;
    if (standalone()) t.textContent = '설치된 앱으로 실행 중입니다.';
    else if (installPrompt) { t.textContent = '이 기기에 앱으로 설치하면 아이콘으로 바로 열 수 있습니다.'; b.hidden = false; }
    else if (isIOS) t.textContent = 'Safari 아래쪽의 공유 버튼 → ‘홈 화면에 추가’를 누르면 앱 아이콘이 생깁니다.';
    else t.textContent = 'Chrome·Edge 주소창 오른쪽의 설치 아이콘이나 브라우저 메뉴의 ‘앱 설치 / 홈 화면에 추가’를 누르세요.';
  }

  // ---------- backup ----------
  function exportData() {
    const data = { app: 'weekly-check-planner', exported: new Date().toISOString(), items: [...store.items.values()] };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `체크플래너-백업-${ymd(today())}.json`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $('#backupMsg').textContent = `${store.items.size}개 항목을 내보냈습니다.`;
  }
  async function importData(file) {
    const msg = $('#backupMsg');
    try {
      const parsed = JSON.parse(await file.text());
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : null;
      if (!list) throw new Error('할 일 목록을 찾지 못했습니다');
      let n = 0;
      for (const o of list) {
        if (!o || typeof o !== 'object' || !o.title) continue;
        const src = o.data && typeof o.data === 'object' ? o.data : o; // ArtifactData rows wrap the body in `data`
        const id = typeof o.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(o.id) ? o.id : (typeof o.doc_id === 'string' ? o.doc_id : newId());
        put(norm(id, src)); n++;
      }
      msg.className = 'set-msg'; msg.textContent = `${n}개 항목을 불러왔습니다.`;
    } catch (e) { msg.className = 'set-msg err'; msg.textContent = `불러오지 못했습니다: ${e.message}`; }
  }

  // ---------- settings ----------
  const setDlg = $('#settings');
  function openSettings() {
    $('#secAccount').hidden = !CLOUD;
    $('#setAccount').textContent = store.email ? `${store.email} 로 로그인됨` : '';
    $('#secPush').hidden = !CLOUD;
    renderInstall(); renderPush();
    $('#backupMsg').textContent = '';
    setDlg.showModal();
  }

  // ---------- wiring ----------
  function wire() {
    $('#edForm').addEventListener('submit', e => {
      e.preventDefault();
      const title = $('#f-title').value.trim(); if (!title) { $('#f-title').focus(); return; }
      const base = editingId ? store.items.get(editingId) : null;
      const due = $('#f-due').value || null;
      const color = (document.querySelector('#f-color input:checked') || {}).value || 'teal';
      const { id: _drop, ...rest } = base || { created: ymd(today()), checks: [] };
      put(norm(editingId || newId(), { ...rest, title, due, lead: due ? leadValue() : 0, repeat: $('#f-repeat').checked, color, memo: $('#f-memo').value }));
      dlg.close();
    });
    $('#edCancel').addEventListener('click', () => dlg.close());
    $('#edDelete').addEventListener('click', () => {
      const b = $('#edDelete');
      if (!deleteArmed) { deleteArmed = true; b.textContent = '한 번 더 누르면 삭제'; b.classList.add('armed'); return; }
      remove(editingId); dlg.close();
    });
    $('#edToggleDone').addEventListener('click', () => {
      const it = store.items.get(editingId); if (!it) return;
      if (it.done) put({ ...it, done: false, doneAt: null }); else finish(it.id, weekStart(today()));
      dlg.close();
    });
    ['#f-due', '#f-lead', '#f-leadCustom', '#f-repeat'].forEach(s => $(s).addEventListener('input', updateHint));
    $('#f-lead').addEventListener('change', updateHint);

    document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { ui.view = b.dataset.view; history.replaceState(null, '', '#' + ui.view); render(); }));
    document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { ui.filter = b.dataset.filter; render(); }));
    $('#q').addEventListener('input', e => { ui.q = e.target.value; render(); });
    $('#addBtn').addEventListener('click', () => openEditor(null));
    $('#wkPrev').addEventListener('click', () => { ui.week = addDays(ui.week, -7); render(); });
    $('#wkNext').addEventListener('click', () => { ui.week = addDays(ui.week, 7); render(); });
    $('#wkToday').addEventListener('click', () => { ui.week = weekStart(today()); render(); });
    $('#mPrev').addEventListener('click', () => { ui.month = new Date(ui.month.getFullYear(), ui.month.getMonth() - 1, 1); render(); });
    $('#mNext').addEventListener('click', () => { ui.month = new Date(ui.month.getFullYear(), ui.month.getMonth() + 1, 1); render(); });
    $('#mToday').addEventListener('click', () => { ui.month = new Date(today().getFullYear(), today().getMonth(), 1); render(); });

    $('#setBtn').addEventListener('click', openSettings);
    $('#setClose').addEventListener('click', () => setDlg.close());
    $('#pushOn').addEventListener('click', enablePush);
    $('#pushOff').addEventListener('click', disablePush);
    $('#pushTest').addEventListener('click', testPush);
    $('#installBtn').addEventListener('click', async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; renderInstall(); });
    $('#exportBtn').addEventListener('click', exportData);
    $('#importBtn').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importData(f); e.target.value = ''; });
    $('#signOut').addEventListener('click', async () => {
      const sub = await currentSub().catch(() => null);
      if (sub) { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe().catch(() => {}); }
      setDlg.close(); await sb.auth.signOut();
    });

    $('#authForm').addEventListener('submit', e => { e.preventDefault(); onAuth('login'); });
    $('#authSignup').addEventListener('click', () => onAuth('signup'));

    window.addEventListener('online', () => { refresh().then(flush); });
    window.addEventListener('offline', updateSync);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      // A new week may have started while the app sat in the background.
      const nowW = weekStart(today());
      if (+nowW !== +ui.seenWeek) { if (+ui.week === +ui.seenWeek) ui.week = nowW; ui.seenWeek = nowW; }
      refresh().then(flush); render();
    });
    setInterval(() => { if (store.outbox.size) flush(); }, 60000);
  }

  function boot() {
    const h = (location.hash || '').slice(1); if (['week', 'calendar', 'all'].includes(h)) ui.view = h;
    wire();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    if (!CLOUD) {
      loadCache(); store.loaded = true; showMain(); updateSync(); render();
      return;
    }
    sb.auth.onAuthStateChange((event, session) => {
      // Defer: calling other supabase methods inside this callback can deadlock.
      setTimeout(() => {
        const user = session && session.user;
        if (user) { if (user.id !== store.uid) startSession(user); }
        else { stopSession(); showAuth(); }
      }, 0);
    });
  }

  boot();
})();
