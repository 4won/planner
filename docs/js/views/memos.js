// Memos: chat-style notes per meeting. Each line can become a task or event,
// and recaps written by Claude show up as review cards above the notes.
import { $, el, btn, option, empty, armedDelete, copyText, toast } from '../ui.js';
import { ymd, parse, md, today, hhmm, newId } from '../dates.js';
import { normMemo, normEntry, normTask, normEvent, normTags, tagsText } from '../model.js';
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
  hint.append(el('span', null, `리캡이 필요하면 Claude 데스크톱에서 “${phrase}”라고 말하세요.`));
  $('#memoRecapCopy').onclick = ev => copyText(phrase, ev.currentTarget.querySelector('span'));
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

// Recap text is light markdown: "## 섹션", "### 소제목", "- 항목", "  - 하위 항목", "**강조**".
function recapBody(text) {
  const box = el('div', 'recap-body');
  let list = null, sub = null;
  const inline = (parent, s) => {
    s.split(/(\*\*[^*]+\*\*)/).forEach(part => {
      if (/^\*\*[^*]+\*\*$/.test(part)) parent.append(el('b', null, part.slice(2, -2)));
      else if (part) parent.append(document.createTextNode(part));
    });
    return parent;
  };
  text.split('\n').forEach(raw => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { list = sub = null; return; }
    let m;
    if ((m = /^#{1,2}\s+(.*)$/.exec(line))) { list = sub = null; box.append(inline(el('h4', 'rb-h'), m[1])); return; }
    if ((m = /^#{3,}\s+(.*)$/.exec(line))) { list = sub = null; box.append(inline(el('h5', 'rb-sh'), m[1])); return; }
    if ((m = /^(\s{2,}|\t+)[-*·]\s+(.*)$/.exec(line))) {
      if (!list) { list = el('ul', 'rb-list'); box.append(list); }
      if (!sub) { sub = el('ul', 'rb-sub'); (list.lastElementChild || list).append(sub); }
      sub.append(inline(el('li'), m[2])); return;
    }
    if ((m = /^[-*·]\s+(.*)$/.exec(line))) {
      if (!list) { list = el('ul', 'rb-list'); box.append(list); }
      sub = null; list.append(inline(el('li'), m[1])); return;
    }
    list = sub = null;
    box.append(inline(el('p', 'rb-p'), line));
  });
  return box;
}
// Plain text for pasting into a messenger or mail to the people at the meeting.
function recapShareText(r, m) {
  const body = r.summary.split('\n').map(l => l
    .replace(/^#{1,2}\s+/, '■ ')
    .replace(/^#{3,}\s+/, '  ▶ ')
    .replace(/^(\s{2,}|\t+)[-*·]\s+/, '      · ')
    .replace(/^[-*·]\s+/, '  - ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')).join('\n').replace(/\n■/g, '\n\n■').replace(/\n{3,}/g, '\n\n');
  return `[${m.title}] 회의 리캡\n\n${body.trim()}\n`;
}

function propMeta(p, d) {
  const bits = [];
  if (p.kind === 'event') {
    if (d.due) bits.push(md(parse(d.due)) + (d.endDate && d.endDate !== d.due ? `~${md(parse(d.endDate))}` : ''));
    if (d.startTime) bits.push(d.startTime + (d.endTime ? `–${d.endTime}` : ''));
    else if (d.due) bits.push('종일');
    if (p.location) bits.push(p.location);
  } else {
    bits.push(d.due ? `마감 ${md(parse(d.due))}` : '마감 없음');
    if (d.tags) bits.push(d.tags);
  }
  const pn = d.projectId ? (projects.get(d.projectId) || {}).name : p.projectName;
  if (pn) bits.push(pn);
  return bits.join(' · ') || '날짜 없음';
}

function recapCard(r, m, expanded) {
  const card = el('details', 'recap'); card.open = expanded || r.proposals.some(p => p.status === 'pending');
  const sum = el('summary');
  const pending = r.proposals.filter(p => p.status === 'pending').length;
  sum.append(el('span', 'recap-tag', '리캡'), el('span', null, `${md(new Date(r.createdAt))} ${timeOf(r.createdAt)}`));
  if (pending) sum.append(el('span', 'pill recap-pill', `검토할 제안 ${pending}`));
  card.append(sum);
  if (r.summary) {
    card.append(recapBody(r.summary));
    const share = el('div', 'recap-share');
    const cp = btn('chip', '참석자 전달용 복사', ev => copyText(recapShareText(r, m), ev.currentTarget));
    cp.title = '메신저·메일에 바로 붙여 넣을 수 있는 글로 복사합니다';
    share.append(cp);
    card.append(share);
  }

  if (r.proposals.length) {
    card.append(el('h4', 'rb-h props-h', `등록 제안 ${r.proposals.length}건`));
    const list = el('div', 'props');
    let updateCount = () => {};
    r.proposals.forEach(p => {
      const key = `${r.id}:${p.id}`;
      let d = drafts.get(key);
      if (!d) {
        const projectId = suggestProject(p);
        d = { checked: p.status === 'pending', open: false, title: p.title, due: p.kind === 'event' ? (p.startDate || p.due || '') : (p.due || ''), endDate: p.endDate || '', startTime: p.startTime || '', endTime: p.endTime || '', projectId, tags: tagsText(p.tags) };
        drafts.set(key, d);
      }
      const settled = p.status !== 'pending';
      const row = el('div', 'prop' + (settled ? ' settled' : ''));
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = !settled && d.checked; cb.disabled = settled;
      cb.setAttribute('aria-label', `${p.title} 등록할지 선택`);
      cb.addEventListener('change', () => { d.checked = cb.checked; updateCount(); });
      const head = el('div', 'prop-head');
      const titleEl = el('div', 'prop-name', d.title); titleEl.title = d.title;
      const meta = el('div', 'prop-meta', propMeta(p, d));
      const txt = el('div', 'prop-text'); txt.append(titleEl, meta);
      head.append(el('span', 'pill kind-' + p.kind, p.kind === 'event' ? '일정' : '업무'), txt);
      if (settled) head.append(el('span', 'prop-state' + (p.status === 'added' ? ' ok' : ''), p.status === 'added' ? '등록됨' : '제외됨'));
      else {
        const tog = btn('chip prop-toggle', '');
        const paintTog = () => { tog.textContent = d.open ? '접기' : (p.kind === 'event' ? '캘린더 등록' : '업무 등록'); tog.setAttribute('aria-expanded', d.open); };
        tog.addEventListener('click', () => { d.open = !d.open; fields.hidden = !d.open; paintTog(); });
        paintTog();
        head.append(tog);
      }
      row.append(cb, head);

      const fields = el('div', 'prop-fields'); fields.hidden = settled || !d.open;
      const refresh = () => { titleEl.textContent = d.title; titleEl.title = d.title; meta.textContent = propMeta(p, d); };
      const ti = el('input', 'prop-title'); ti.type = 'text'; ti.value = d.title; ti.maxLength = 120; ti.setAttribute('aria-label', '제목');
      ti.addEventListener('input', () => { d.title = ti.value; refresh(); });
      fields.append(ti);

      const line = el('div', 'prop-line');
      const labeled = (text, input) => { const l = el('label', 'prop-field'); l.append(el('span', null, text), input); return l; };
      const dateIn = (val, aria, onIn) => { const i = el('input'); i.type = 'date'; i.value = val; i.setAttribute('aria-label', aria); i.addEventListener('input', () => { onIn(i.value); refresh(); }); return i; };
      const timeIn = (val, aria, onIn) => { const i = el('input'); i.type = 'time'; i.step = 300; i.value = val; i.setAttribute('aria-label', aria); i.addEventListener('input', () => { onIn(i.value); refresh(); }); return i; };
      if (p.kind === 'event') {
        const endIn = dateIn(d.endDate, '종료일', v => { d.endDate = v; });
        line.append(
          labeled('시작일', dateIn(d.due, '시작일', v => { d.due = v; if (d.endDate && d.endDate < v) { d.endDate = ''; endIn.value = ''; } endIn.min = v; })),
          labeled('종료일', endIn),
          labeled('시작', timeIn(d.startTime, '시작 시간', v => { d.startTime = v; })),
          labeled('종료', timeIn(d.endTime, '종료 시간', v => { d.endTime = v; })),
        );
        if (d.due) endIn.min = d.due;
      } else {
        line.append(labeled('마감', dateIn(d.due, '마감일', v => { d.due = v; })));
      }
      const ps = el('select'); ps.setAttribute('aria-label', '프로젝트');
      ps.append(option('', p.projectName && !d.projectId ? `없음 (제안: ${p.projectName})` : '프로젝트 없음', !d.projectId));
      activeProjects().forEach(x => ps.append(option(x.id, x.name, x.id === d.projectId)));
      ps.addEventListener('change', () => { d.projectId = ps.value; refresh(); });
      line.append(labeled('프로젝트', ps));
      if (p.kind === 'task') {
        const tg = el('input'); tg.type = 'text'; tg.value = d.tags; tg.placeholder = '#VMD #촬영'; tg.setAttribute('aria-label', '해시태그');
        tg.addEventListener('input', () => { d.tags = tg.value; refresh(); });
        const tf = labeled('해시태그', tg); tf.classList.add('wide');
        line.append(tf);
      }
      fields.append(line);
      if (p.kind === 'event') fields.append(el('div', 'prop-hint', '종료일을 비워 두면 시작일 하루 일정으로 등록됩니다.'));
      if (p.note) fields.append(el('div', 'prop-note', p.note));
      const one = el('div', 'prop-acts');
      one.append(btn('chip primary', p.kind === 'event' ? '이 일정 등록' : '이 업무 등록', () => register(r, m, p.id)));
      fields.append(one);
      row.append(fields);
      list.append(row);
    });
    card.append(list);

    const acts = el('div', 'ed-actions');
    const reg = btn('btn primary', '');
    updateCount = () => { const n = r.proposals.filter(p => p.status === 'pending' && drafts.get(`${r.id}:${p.id}`)?.checked).length; reg.textContent = `선택 항목 등록 (${n})`; reg.disabled = !n; };
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

function register(r, m, onlyId) {
  let n = 0;
  const proposals = r.proposals.map(p => {
    const d = drafts.get(`${r.id}:${p.id}`);
    if (p.status !== 'pending' || !d || !d.title.trim() || (onlyId ? p.id !== onlyId : !d.checked)) return p;
    n++;
    const memo = [p.note, `메모: ${m.title}`].filter(Boolean).join('\n');
    if (p.kind === 'event') {
      const start = d.due || ymd(today());
      const ev = normEvent(newId('e'), { title: d.title.trim(), startDate: start, endDate: d.endDate && d.endDate >= start ? d.endDate : start, startTime: d.startTime || null, endTime: d.endTime || null, location: p.location, memo, projectId: d.projectId || null });
      events.put(ev);
      return { ...p, status: 'added', createdRef: `event:${ev.id}` };
    }
    // Resolving the picker creates a typed-in new group once; later proposals naming it reuse it.
    const t = normTask(newId(), { title: d.title.trim(), due: d.due || null, lead: p.lead || 0, repeat: false, memo, projectId: d.projectId || null, tags: normTags(d.tags), sort: Date.now() + n });
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
  const sendBtn = $('#memoSend');
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 220) + 'px'; sendBtn.disabled = !input.value.trim(); };
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
