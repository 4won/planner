// Calendar-date helpers. Dates are local calendar days held as Date at local midnight;
// stored values are 'YYYY-MM-DD' strings and times are 'HH:MM'.
export const DOW = ['일', '월', '화', '수', '목', '금', '토'];
export const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const today = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); };
export const todayStr = () => ymd(today());
export const weekStart = d => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
export const daysBetween = (a, b) => Math.round((b - a) / 864e5);
export const isoWeek = d => {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const jan4 = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round((daysBetween(jan4, t) - 3 + ((jan4.getDay() + 6) % 7)) / 7);
};
export const md = d => `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`;
export const mdLong = d => `${d.getMonth() + 1}월 ${d.getDate()}일(${DOW[d.getDay()]})`;
export const okDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const okTime = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export const leadLabel = n => ({ 0: '마감 주에만', 7: '1주 전부터', 14: '2주 전부터', 30: '한 달 전부터', 60: '두 달 전부터', 90: '석 달 전부터' }[n] || `${n}일 전부터`);
export const newId = (p = 't') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const nowTime = () => { const t = new Date(); return `${pad(t.getHours())}:${pad(t.getMinutes())}`; };
export const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export function ddayText(dateStr) {
  const diff = daysBetween(today(), parse(dateStr));
  return { diff, text: diff > 0 ? `D-${diff}` : diff === 0 ? 'D-DAY' : `D+${-diff}` };
}
export function remindLabel(m) {
  if (m === 0) return '정각';
  if (m % 1440 === 0) return `${m / 1440}일 전`;
  if (m % 60 === 0) return `${m / 60}시간 전`;
  return `${m}분 전`;
}
