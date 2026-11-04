// Expands repeating events — same rules as occurrences() in docs/js/model.js.
// Dates are 'YYYY-MM-DD' strings handled as UTC midnights.
import { DAY, parseDate, fmtDate, weekStart } from './push.ts';

export type Recur = { freq: 'weekly' | 'monthly' | 'yearly'; days?: number[]; monthMode?: 'date' | 'nth'; until?: string | null; exdates?: string[] };
type Ev = { start_date: string; end_date: string; recur?: Recur | null };

const nthOf = (t: number) => { const n = Math.ceil(new Date(t).getUTCDate() / 7); return n >= 5 ? -1 : n; };
function nthWeekday(y: number, m: number, wd: number, n: number): number | null {
  if (n === -1) { const last = Date.UTC(y, m + 1, 0); return last - ((new Date(last).getUTCDay() - wd + 7) % 7) * DAY; }
  const first = Date.UTC(y, m, 1);
  const d = first + (((wd - new Date(first).getUTCDay() + 7) % 7) + (n - 1) * 7) * DAY;
  return new Date(d).getUTCMonth() === m ? d : null;
}

/** Start dates of the occurrences of `ev` that overlap [from, to]. */
export function occurrenceStarts(ev: Ev, from: string, to: string): string[] {
  const r = ev.recur;
  if (!r) return ev.end_date < from || ev.start_date > to ? [] : [ev.start_date];
  const start = parseDate(ev.start_date);
  const dur = Math.round((parseDate(ev.end_date) - start) / DAY);
  const lo = fmtDate(parseDate(from) - dur * DAY);
  const hi = r.until && r.until < to ? r.until : to;
  if (hi < ev.start_date) return [];
  const ex = new Set(r.exdates ?? []);
  const out: string[] = [];
  const take = (t: number | null) => { if (t == null) return; const s = fmtDate(t); if (s >= ev.start_date && s >= lo && s <= hi && !ex.has(s)) out.push(s); };
  const begin = lo > ev.start_date ? parseDate(lo) : start;
  if (r.freq === 'weekly') {
    const days = r.days && r.days.length ? r.days : [new Date(start).getUTCDay()];
    for (let w = weekStart(begin), n = 0; fmtDate(w) <= hi && n < 600; w += 7 * DAY, n++) days.forEach(d => take(w + ((d + 6) % 7) * DAY));
  } else if (r.freq === 'monthly') {
    const s0 = new Date(start), n0 = nthOf(start);
    const b = new Date(begin);
    for (let y = b.getUTCFullYear(), m = b.getUTCMonth(), n = 0; n < 240; n++, m++) {
      if (m > 11) { m = 0; y++; }
      if (fmtDate(Date.UTC(y, m, 1)) > hi) break;
      if (r.monthMode === 'nth') take(nthWeekday(y, m, s0.getUTCDay(), n0));
      else { const t = Date.UTC(y, m, s0.getUTCDate()); if (new Date(t).getUTCMonth() === m) take(t); }
    }
  } else {
    const s0 = new Date(start);
    for (let y = new Date(begin).getUTCFullYear(); y <= +hi.slice(0, 4); y++) { const t = Date.UTC(y, s0.getUTCMonth(), s0.getUTCDate()); if (new Date(t).getUTCMonth() === s0.getUTCMonth()) take(t); }
  }
  return out.sort();
}

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
/** RRULE and EXDATE lines for the ICS feed. */
export function rruleLines(ev: Ev, dt: (date: string) => string): string[] {
  const r = ev.recur; if (!r) return [];
  const start = new Date(parseDate(ev.start_date));
  let rule = `FREQ=${r.freq.toUpperCase()}`;
  if (r.freq === 'weekly') rule += `;BYDAY=${(r.days && r.days.length ? r.days : [start.getUTCDay()]).map(d => BYDAY[d]).join(',')}`;
  if (r.freq === 'monthly') rule += r.monthMode === 'nth' ? `;BYDAY=${nthOf(start.getTime())}${BYDAY[start.getUTCDay()]}` : `;BYMONTHDAY=${start.getUTCDate()}`;
  if (r.until) rule += `;UNTIL=${r.until.replaceAll('-', '')}T235959Z`;
  const lines = [`RRULE:${rule}`];
  (r.exdates ?? []).forEach(d => lines.push(`EXDATE${dt(d)}`));
  return lines;
}
