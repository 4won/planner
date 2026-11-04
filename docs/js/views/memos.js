// Memos: chat-style notes per meeting. Each line can become a task or event,
// and recaps written by Claude show up as review cards above the notes.
import { $, el, btn, option, empty, armedDelete, copyText, toast } from '../ui.js';
import { ymd, parse, md, today, hhmm, newId } from '../dates.js';
import { normMemo, normEntry, normTask, normEvent } from '../model.js';
import { memos, entries, recaps, tasks, events, projects, activeProjects } from '../db.js';
import { state } from '../store.js';
import { openTask, openEvent } from '../editors.js';

export const memoState = { id: null, pane: false };
const drafts = new Map(); // `${recapId}:${proposalId}` -> edited fields not yet registered
const rerender = () => window.dispatchEvent(new Event('planner:render'));
const sortedMemos = () => memos.all().filter(m => !m.archived).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
const entriesOf = id => entries.all().filter(e => e.memoId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
const timeOf = isoStr => hhmm(new Date(isoStr));
const dayOf = isoStr => ymd(new Date(isoStr));

export function newMemo() {
  const now = new Date().toISOString();
  const m = normMemo(newId('n'), { title: `${md(today())} 회의`, createdAt: now, updatedAt: now });
  memos.put(m);
  memoState.id = m.id; memoState.pane = true;
  rerender();
  setTimeout(() => { const t = $('#memoTitle'); if (t) { t.focus(); t.select(); } }, 60);
}

export function renderMemos() {
  const list = sortedMemos();
  if (memoState.id && !memos.get(memoState.id)) memoState.id = null;
  if (!memoState.id && list.length && !matchMedia('(max-width: 760px)').matches) memoState.id = list[0].id;
  $('#memoLayout').classList.toggle('show-pane', !!(memoState.pane && memoState.id));

  // ---- list ----
  const side = $('#memoItems'); side.textContent = '';
  if (!state.loaded) side.append(el('p', 'quiet', '불러오는 중…'));
  else if (!list.length) side.append(el('p', 'quiet', '아직 메모가 없습니다. ‘+ 새 메모’로 회의 메모를 시작하세요.'));
  list.forEach(m => {
    const es = entriesOf(m.id), last = es[es.length - 1];
    const pending = recaps.all().filter(r => r.memoId === m.id).reduce((n, r) => n + r.proposals.filter(p => p.status === 'pending').length, 0);
    const b = btn('memo-item' + (m.id === memoState.id ? ' on' : ''), '', () => { memoState.id = m.id; memoState.pane = true; rerender(); setTimeout(() => $('#memoInput')?.focus(), 30); });
    const top = el('span', 'mi-top'); top.append(el('span', 'mi-title', m.title));
    if (pending) top.append(el('span', 'pill recap-pill', `제안 ${pending}`));
    b.append(top);
    b.append(el('span', 'mi-meta', last ? `${md(new Date(last.createdAt))} ${timeOf(last.createdAt)} · ${last.body.split('\n')[0].slice(0, 40)}` : '비어 있음'));
    side.append(b);
  });

  // ---- pane ----
  const m = memoState.id ? memos.get(memoState.id) : null;
  $('#memoPane').hidden = !m;
  $('#memoEmpty').hidden = !!m;
  if (!m) return;

  const title = $('#memoTitle');
  if (document.activeElement !== title) title.value = m.title;
  const proj = $('#memoProject');
  if (document.activeElement !== proj) {
    proj.textContent = '';
    proj.append(option('', '프로젝트 없음', !m.projectId));
    activeProjects().forEach(p => proj.append(option(p.id, p.name, p.id === m.projectId)));
  }
  armedDelete($('#memoDelete'), () => {
    entriesOf(m.id).forEach(e => entries.remove(e.id));
    recaps.all().filter(r => r.memoId === m.id).forEach(r => recaps.remove(r.id));
    memos.remove(m.id); memoState.id = null; memoState.pane = false; rerender();
  }, '메모 삭제');

  // recap cards
  const rc = $('#memoRecaps'); rc.textContent = '';
  recaps.all().filter(r => r.memoId === m.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).forEach((r, i) => rc.append(recapCard(r, m, i === 0)));

  // stream
  const stream = $('#memoStream');
  const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 80;
  stream.textContent = '';
  const es = entriesOf(m.id);
  if (!es.length) stream.append(el('p', 'quiet center', '아래 칸에 적고 엔터를 누르면 한 줄씩 쌓입니다. 줄바꿈은 Shift+엔터.'));
  let lastDay = '';
  es.forEach(e => {
    const d = dayOf(e.createdAt);
    if (d !== lastDay) { stream.append(el('div', 'day-sep', md(parse(d)))); lastDay = d; }
    stream.append(entryEl(e, m));
  });
  if (nearBottom || stream.dataset.memo !== m.id) stream.scrollTop = stream.scrollHeight;
  stream.dataset.memo = m.id;

  const hint = $('#recapHint');
  hint.textContent = '';
  const phrase = `‘${m.title}’ 메모 리캡해줘`;
  hint.append(el('span', null, `리캡이 필요하면 Claude 데스크톱에서 “${phrase}”라고 말하세요.`), btn('linkbtn', '문구 복사', ev => copyText(phrase, ev.currentTarget)));
}

function entryEl(e, m) {
  const row = el('div', 'entry' + (e.sentTo ? ' sent' : ''));
  row.append(el('span', 'entry-time', timeOf(e.createdAt)));
  const body = el('div', 'entry-body');
  body.append(el('div', 'entry-text', e.body));
  const acts = el('div', 'entry-acts');
  if (e.sentTo) {
    const [kind, id] = e.sentTo.split(':');
    const target = kind === 'task' ? tasks.get(id) : events.get(id);
    acts.append(target
      ? btn('linkbtn', kind === 'task' ? '→ 업무 보기' : '→ 일정 보기', () => kind === 'task' ? openTask(id) : openEvent(id))
      : el('span', 'quiet', kind === 'task' ? '업무로 보냈음' : '일정으로 보냈음'));
  } else {
    const firstLine = e.body.split('\n')[0].slice(0, 120);
    const memoText = `${m.title}\n${e.body}`;
    acts.append(
      btn('linkbtn', '업무로', () => openTask(null, { title: firstLine, memo: memoText, projectId: m.projectId, repeat: false, lead: 0 }, t => entries.put({ ...e, sentTo: `task:${t.id}` }))),
      btn('linkbtn', '일정으로', () => openEvent(null, { title: firstLine, memo: memoText, projectId: m.projectId }, ev => entries.put({ ...e, sentTo: `event:${ev.id}` }))),
    );
  }
  const del = btn('linkbtn danger', '지우기'); armedDelete(del, () => entries.remove(e.id), '지우기');
  acts.append(del);
  body.append(acts);
  row.append(body);
  return row;
}

// ---------- recap ----------
function suggestProject(p) {
  if (p.projectId && projects.get(p.projectId)) return p.projectId;
  const n = (p.projectName || '').trim().toLowerCase();
  if (!n) return '';
  const hit = activeProjects().find(x => x.name.toLowerCase() === n) || activeProjects().find(x => x.name.toLowerCase().includes(n) || n.includes(x.name.toLowerCase()));
  return hit ? hit.id : '';
}

function recapCard(r, m, expanded) {
  const card = el('details', 'recap'); card.open = expanded || r.proposals.some(p => p.status === 'pending');
  const sum = el('summary');
  const pending = r.proposals.filter(p => p.status === 'pending').length;
  sum.append(el('span', 'recap-tag', '리캡'), el('span', null, `${md(new Date(r.createdAt))} ${timeOf(r.createdAt)}`));
  if (pending) sum.append(el('span', 'pill recap-pill', `검토할 제안 ${pending}`));
  card.append(sum);
  if (r.summary) card.append(el('div', 'recap-summary', r.summary));

  if (r.proposals.length) {
    const list = el('div', 'props');
    r.proposals.forEach(p => {
      const key = `${r.id}:${p.id}`;
      const d = drafts.get(key) || { checked: p.status === 'pending', title: p.title, due: p.due || p.startDate || '', startTime: p.startTime || '', projectId: suggestProject(p) };
      drafts.set(key, d);
      const row = el('div', 'prop' + (p.status !== 'pending' ? ' settled' : ''));
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = p.status === 'pending' && d.checked; cb.disabled = p.status !== 'pending';
      cb.setAttribute('aria-label', `${p.title} 등록할지 선택`);
      cb.addEventListener('change', () => { d.checked = cb.checked; updateCount(); });
      row.append(cb, el('span', 'pill kind-' + p.kind, p.kind === 'event' ? '일정' : '업무'));
      const fields = el('div', 'prop-fields');
      const ti = el('input', 'prop-title'); ti.type = 'text'; ti.value = d.title; ti.maxLength = 120; ti.disabled = p.status !== 'pending'; ti.setAttribute('aria-label', '제목');
      ti.addEventListener('input', () => { d.title = ti.value; });
      fields.append(ti);
      const line = el('div', 'prop-line');
      const di = el('input'); di.type = 'date'; di.value = d.due; di.disabled = p.status !== 'pending'; di.setAttribute('aria-label', p.kind === 'event' ? '날짜' : '마감일');
      di.addEventListener('input', () => { d.due = di.value; });
      line.append(di);
      if (p.kind === 'event') {
        const tm = el('input'); tm.type = 'time'; tm.value = d.startTime; tm.disabled = p.status !== 'pending'; tm.setAttribute('aria-label', '시작 시간');
        tm.addEventListener('input', () => { d.startTime = tm.value; });
        line.append(tm);
      }
      const ps = el('select'); ps.disabled = p.status !== 'pending'; ps.setAttribute('aria-label', '프로젝트');
      ps.append(option('', p.projectName && !d.projectId ? `프로젝트 없음 (제안: ${p.projectName})` : '프로젝트 없음', !d.projectId));
      activeProjects().forEach(x => ps.append(option(x.id, x.name, x.id === d.projectId)));
      ps.addEventListener('change', () => { d.projectId = ps.value; });
      line.append(ps);
      fields.append(line);
      if (p.note) fields.append(el('div', 'prop-note', p.note));
      if (p.status === 'added') fields.append(el('div', 'prop-note ok', '등록됨'));
      if (p.status === 'dismissed') fields.append(el('div', 'prop-note', '제외됨'));
      row.append(fields);
      list.append(row);
    });
    card.append(list);

    const acts = el('div', 'ed-actions');
    const reg = btn('btn primary', '');
    const updateCount = () => { const n = r.proposals.filter(p => p.status === 'pending' && drafts.get(`${r.id}:${p.id}`)?.checked).length; reg.textContent = `선택 항목 등록 (${n})`; reg.disabled = !n; };
    reg.addEventListener('click', () => register(r, m));
    const dis = btn('btn ghost', '선택 안 한 제안 제외', () => {
      recaps.put({ ...r, proposals: r.proposals.map(p => p.status === 'pending' && !drafts.get(`${r.id}:${p.id}`)?.checked ? { ...p, status: 'dismissed' } : p) });
    });
    if (pending) acts.append(dis, el('span', 'spacer'), reg);
    card.append(acts);
    updateCount();
  }
  const del = btn('linkbtn danger', '리캡 삭제'); armedDelete(del, () => recaps.remove(r.id), '리캡 삭제');
  card.append(del);
  return card;
}

function register(r, m) {
  let n = 0;
  const proposals = r.proposals.map(p => {
    const d = drafts.get(`${r.id}:${p.id}`);
    if (p.status !== 'pending' || !d || !d.checked || !d.title.trim()) return p;
    n++;
    if (p.kind === 'event') {
      const ev = normEvent(newId('e'), { title: d.title.trim(), startDate: d.due || ymd(today()), endDate: d.due || ymd(today()), startTime: d.startTime || null, endTime: p.endTime, location: p.location, memo: [p.note, `메모: ${m.title}`].filter(Boolean).join('\n'), projectId: d.projectId || null });
      events.put(ev);
      return { ...p, status: 'added', createdRef: `event:${ev.id}` };
    }
    const t = normTask(newId(), { title: d.title.trim(), due: d.due || null, lead: p.lead || 0, repeat: false, memo: [p.note, `메모: ${m.title}`].filter(Boolean).join('\n'), projectId: d.projectId || null, sort: Date.now() });
    tasks.put(t);
    return { ...p, status: 'added', createdRef: `task:${t.id}` };
  });
  recaps.put({ ...r, proposals });
  toast(`${n}개를 등록했습니다.`);
}

// ---------- static wiring ----------
export function wireMemos() {
  $('#memoNew').addEventListener('click', newMemo);
  $('#memoBack').addEventListener('click', () => { memoState.pane = false; rerender(); });
  $('#memoTitle').addEventListener('change', e => { const m = memos.get(memoState.id); const v = e.target.value.trim(); if (m && v && v !== m.title) memos.put({ ...m, title: v }); });
  $('#memoProject').addEventListener('change', e => { const m = memos.get(memoState.id); if (m) memos.put({ ...m, projectId: e.target.value || null }); });
  const input = $('#memoInput');
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px'; };
  input.addEventListener('input', grow);
  const send = () => {
    const m = memos.get(memoState.id); const body = input.value.trim();
    if (!m || !body) return;
    const now = new Date().toISOString();
    entries.put(normEntry(newId('m'), { memoId: m.id, body, createdAt: now }));
    memos.put({ ...m, updatedAt: now });
    input.value = ''; grow(); input.focus();
    const s = $('#memoStream'); requestAnimationFrame(() => { s.scrollTop = s.scrollHeight; });
  };
  input.addEventListener('keydown', e => {
    // Korean IME: Enter while composing only commits the syllable.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); }
  });
  $('#memoSend').addEventListener('click', send);
}
