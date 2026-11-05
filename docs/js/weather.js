// Weather rules shared by the home screen and the desktop widget (Open-Meteo, no key).
import { ymd, addDays, today } from './dates.js';

export const HOME_PLACE = { lat: 37.4979, lon: 127.0276, label: '서울 강남구' };
export const WMO = c => c === 0 ? ['맑음', 'sun'] : c <= 2 ? ['구름 조금', 'partly'] : c === 3 ? ['흐림', 'cloud'] : c <= 48 ? ['안개', 'fog'] : c <= 57 ? ['이슬비', 'rain'] : c <= 67 ? ['비', 'rain'] : c <= 77 ? ['눈', 'snow'] : c <= 82 ? ['소나기', 'rain'] : c <= 86 ? ['눈', 'snow'] : ['뇌우', 'storm'];
export const isSnow = c => (c >= 71 && c <= 77) || c === 85 || c === 86;
export const ICONS = {
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  partly: '<circle cx="9" cy="9" r="3.5"/><path d="M9 2.5v1.5M2.5 9H4M4.4 4.4l1 1M13.6 4.4l-1 1"/><path d="M8 19h9a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.5 1.5A2.8 2.8 0 0 0 8 19z"/>',
  cloud: '<path d="M7 18.5h10a4 4 0 0 0 .3-8 6 6 0 0 0-11.6 1.6A3.3 3.3 0 0 0 7 18.5z"/>',
  fog: '<path d="M4 9h16M3 13h18M5 17h14"/>',
  rain: '<path d="M7 14.5h10a3.8 3.8 0 0 0 .3-7.6 5.6 5.6 0 0 0-10.9 1.5A3.1 3.1 0 0 0 7 14.5z"/><path d="M8 17.5l-1 3M12 17.5l-1 3M16 17.5l-1 3"/>',
  snow: '<path d="M7 14h10a3.8 3.8 0 0 0 .3-7.6 5.6 5.6 0 0 0-10.9 1.5A3.1 3.1 0 0 0 7 14z"/><path d="M8 18h.01M12 20h.01M16 18h.01M10 21.5h.01M14 21.5h.01"/>',
  storm: '<path d="M7 14h10a3.8 3.8 0 0 0 .3-7.6 5.6 5.6 0 0 0-10.9 1.5A3.1 3.1 0 0 0 7 14z"/><path d="M12.5 15l-2.5 4h3l-2 3.5"/>',
  umbrella: '<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v6.5a2 2 0 0 1-4 0"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
};

export const weatherUrl = p => `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}`
  + '&current=temperature_2m,apparent_temperature,weather_code'
  + '&hourly=temperature_2m,precipitation_probability,weather_code'
  + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
  + '&timezone=Asia%2FSeoul&past_days=1&forecast_days=8';

// Hourly values for a local date string, keyed by hour.
export const hoursOf = (w, dateStr) => w.hourly.time.map((t, i) => [t, i]).filter(([t]) => t.startsWith(dateStr)).map(([t, i]) => ({ h: +t.slice(11, 13), temp: w.hourly.temperature_2m[i], pop: w.hourly.precipitation_probability[i] ?? 0, code: w.hourly.weather_code[i] }));

// "어제보다 2.5° 높아요"
export function compareYesterday(w) {
  const now = new Date(), y = ymd(addDays(today(), -1));
  const yh = hoursOf(w, y).find(x => x.h === now.getHours());
  if (!yh) return null;
  const diff = Math.round((w.cur.temperature_2m - yh.temp) * 10) / 10;
  if (Math.abs(diff) < 0.5) return { text: '어제와 비슷해요', cls: '' };
  return { text: `어제보다 ${Math.abs(diff).toFixed(1)}° ${diff > 0 ? '높아요' : '낮아요'}`, cls: diff > 0 ? 'up' : 'down' };
}

// One short line of advice for the rest of today.
export function todayTip(w) {
  const tStr = ymd(today()), nowH = new Date().getHours();
  const rest = hoursOf(w, tStr).filter(x => x.h >= nowH);
  const wet = rest.filter(x => x.pop >= 50 || (x.code >= 51 && x.code <= 99 && x.code !== 45 && x.code !== 48));
  const di = w.daily.time.indexOf(tStr);
  const hi = w.daily.temperature_2m_max[di], lo = w.daily.temperature_2m_min[di];
  if (wet.length) {
    const h = wet[0].h, when = h < 12 ? '오전' : h < 18 ? '오후' : '저녁';
    const snow = wet.some(x => isSnow(x.code));
    return { key: 'umbrella', text: h <= nowH + 1 ? `지금 ${snow ? '눈' : '비'} 소식이 있어요. 우산 챙기세요!` : `오늘은 ${when}에 ${snow ? '눈' : '비'}가 올 예정이에요. 우산 챙기세요!` };
  }
  if (lo <= 0) return { key: 'info', text: `최저 ${Math.round(lo)}°로 영하권이에요. 따뜻하게 입으세요.` };
  if (hi - lo >= 10) return { key: 'info', text: `일교차가 ${Math.round(hi - lo)}°나 돼요. 겉옷을 챙기세요.` };
  if (hi >= 30) return { key: 'sun', text: '무더운 하루예요. 물 자주 드세요.' };
  const tomorrow = ymd(addDays(today(), 1)), ti = w.daily.time.indexOf(tomorrow);
  if (ti >= 0 && (w.daily.precipitation_probability_max[ti] ?? 0) >= 60) return { key: 'umbrella', text: '내일은 비 소식이 있어요. 미리 우산을 챙겨 두세요.' };
  return { key: WMO(w.cur.weather_code)[1], text: '비 소식 없는 하루예요.' };
}
