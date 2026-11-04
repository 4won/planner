// Small DOM helpers shared by every screen.
import { ddayText } from './dates.js';

export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
export function btn(cls, text, onClick, title) {
  const b = el('button', cls, text); b.type = 'button';
  if (title) b.title = title;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
export function option(value, label, selected) {
  const o = el('option', null, label); o.value = value; if (selected) o.selected = true; return o;
}
export function ddayEl(dateStr, done) {
  const { diff, text } = ddayText(dateStr);
  return el('span', 'dday' + (diff < 0 && !done ? ' late' : diff === 0 ? ' today' : ''), text);
}
export const CHECK_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';

export function showBanner(msg, warn, kind = 'sync') {
  const b = $('#banner'); b.textContent = msg; b.classList.toggle('warn', !!warn); b.dataset.kind = kind; b.hidden = false;
}
export function hideBanner(kind) {
  const b = $('#banner'); if (kind && b.dataset.kind !== kind) return; b.hidden = true; b.dataset.kind = '';
}
let toastTimer = 0;
export function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// A delete button that asks for a second press instead of a dialog.
export function armedDelete(button, onConfirm, label = '삭제') {
  let armed = false;
  button.textContent = label; button.classList.remove('armed');
  button.onclick = () => {
    if (!armed) { armed = true; button.textContent = '한 번 더 누르면 삭제'; button.classList.add('armed'); return; }
    onConfirm();
  };
}

export function empty(title, text, actions = []) {
  const e = el('div', 'empty');
  if (title) e.append(el('strong', '', title));
  if (text) e.append(el('p', '', text));
  if (actions.length) { const a = el('div', 'acts'); actions.forEach(x => a.append(x)); e.append(a); }
  return e;
}

/**
 * Makes `el` draggable: mouse drags after a few pixels, touch after a long press (so a plain
 * swipe still scrolls). opts.onMove(x, y) and opts.onDrop(x, y) get viewport coordinates.
 * opts.scrollers: extra elements to auto-scroll sideways near their edges (e.g. the board).
 */
const INTERACTIVE = 'select, input, textarea, a, button:not(.drag-handle), [contenteditable]';
let swallowClick = false;
document.addEventListener('click', e => { if (swallowClick) { e.stopPropagation(); e.preventDefault(); swallowClick = false; } }, true);
export function enableDrag(el, opts) {
  let st = null, ghost = null;
  const begin = (x, y) => {
    st.active = true;
    const r = el.getBoundingClientRect();
    st.dx = x - r.left; st.dy = y - r.top;
    ghost = el.cloneNode(true); ghost.classList.add('drag-ghost'); ghost.style.width = r.width + 'px';
    document.body.append(ghost); el.classList.add('dragging'); document.body.classList.add('is-dragging');
    if (navigator.vibrate) navigator.vibrate(12);
    move(x, y);
  };
  const move = (x, y) => {
    ghost.style.transform = `translate(${x - st.dx}px, ${y - st.dy}px)`;
    if (y < 70) window.scrollBy(0, -14); else if (y > innerHeight - 90) window.scrollBy(0, 14);
    (opts.scrollers || []).forEach(s => { const b = s.getBoundingClientRect(); if (x < b.left + 40) s.scrollLeft -= 16; else if (x > b.right - 40) s.scrollLeft += 16; });
    opts.onMove(x, y);
  };
  const end = (x, y, drop) => {
    clearTimeout(st && st.timer);
    const was = st && st.active;
    st = null;
    if (!was) return;
    ghost.remove(); ghost = null; el.classList.remove('dragging'); document.body.classList.remove('is-dragging');
    swallowClick = true; setTimeout(() => { swallowClick = false; }, 0);
    if (drop) opts.onDrop(x, y); else if (opts.onCancel) opts.onCancel();
  };
  // mouse / pen
  el.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' || e.button !== 0 || e.target.closest(INTERACTIVE)) return;
    st = { x: e.clientX, y: e.clientY };
    const pm = ev => {
      if (!st) return;
      if (!st.active && Math.hypot(ev.clientX - st.x, ev.clientY - st.y) > 6) begin(ev.clientX, ev.clientY);
      else if (st.active) move(ev.clientX, ev.clientY);
    };
    const pu = ev => { window.removeEventListener('pointermove', pm); window.removeEventListener('pointerup', pu); if (st) end(ev.clientX, ev.clientY, true); };
    window.addEventListener('pointermove', pm); window.addEventListener('pointerup', pu);
  });
  // touch: long press, then drag
  el.addEventListener('touchstart', e => {
    if (e.touches.length > 1 || e.target.closest(INTERACTIVE)) return;
    const t = e.touches[0];
    st = { x: t.clientX, y: t.clientY, touch: true };
    st.timer = setTimeout(() => { if (st) begin(st.x, st.y); }, 380);
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (!st || !st.touch) return;
    const t = e.touches[0];
    if (!st.active) { if (Math.hypot(t.clientX - st.x, t.clientY - st.y) > 8) { clearTimeout(st.timer); st = null; } return; }
    e.preventDefault();
    st.lx = t.clientX; st.ly = t.clientY;
    move(t.clientX, t.clientY);
  }, { passive: false });
  el.addEventListener('touchend', e => {
    if (!st) return;
    if (st.active) { e.preventDefault(); const t = e.changedTouches[0]; end(t.clientX, t.clientY, true); }
    else { clearTimeout(st.timer); st = null; }
  });
  el.addEventListener('touchcancel', () => { if (st) end(0, 0, false); });
  el.addEventListener('contextmenu', e => { if (st && st.touch) e.preventDefault(); });
}

export async function copyText(text, button) {
  try { await navigator.clipboard.writeText(text); if (button) { const t = button.textContent; button.textContent = '복사됨'; setTimeout(() => { button.textContent = t; }, 1500); } }
  catch (e) { toast('복사하지 못했습니다. 주소를 길게 눌러 직접 복사하세요.'); }
}
