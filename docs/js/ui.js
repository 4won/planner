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

export async function copyText(text, button) {
  try { await navigator.clipboard.writeText(text); if (button) { const t = button.textContent; button.textContent = '복사됨'; setTimeout(() => { button.textContent = t; }, 1500); } }
  catch (e) { toast('복사하지 못했습니다. 주소를 길게 눌러 직접 복사하세요.'); }
}
