// Copies the work hub's promotion plan into the planner's `promotions` table so the
// calendar can show it (프로모션 filter). Runs from the hub's auto_update.bat after
// build_summary, and can be run by hand:
//   node D:\claude\weekly-planner\tools\sync-promotions.mjs [path\to\promotion.json]
// Uses the Supabase CLI login on this PC (`npx -y supabase login`); no keys are stored here.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROJECT_REF = 'ljltbagrjoowcseedwnw';
const here = path.dirname(fileURLToPath(import.meta.url));
const plannerRoot = path.join(here, '..');
const src = process.argv[2] || path.join(plannerRoot, '..', 'kangol-work-hub', 'data', 'summary', 'promotion.json');
const okDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const statusOf = s => s === 'confirm' ? 'confirm' : s === 'discuss' ? 'discuss' : (s || '');

const data = JSON.parse(fs.readFileSync(src, 'utf8'));
const rows = [];
const add = (id, title, s, e, channel, status, memo) => {
  if (!okDate(s)) return;
  if (!okDate(e) || e < s) e = s;
  rows.push({ id, title, s, e, channel, status: statusOf(status), memo });
};
for (const p of data.promos || []) {
  const memo = [p.dateLabel, p.benefit].filter(Boolean).join('\n');
  const d = p.dual;
  if (d && (d.onS || d.offS)) {
    if (d.onS === d.offS && d.onE === d.offE) {
      // Same dates on both channels: one line; "논의" only if neither side is confirmed.
      add(`hub:${p.id}`, p.t, d.onS, d.onE, 'both', p.offSt === 'confirm' || p.onSt === 'confirm' ? 'confirm' : (p.onSt || p.offSt), memo);
    } else {
      const t = p.t.replace(/\s*\(ON\/OFF[^)]*\)/i, '');
      add(`hub:${p.id}:off`, `${t} · 오프라인`, d.offS, d.offE, 'offline', p.offSt, memo);
      add(`hub:${p.id}:on`, `${t} · 온라인`, d.onS, d.onE, 'online', p.onSt, memo);
    }
  } else add(`hub:${p.id}`, p.t, p.s, p.e, p.laneGroup === 'online' || p.laneGroup === 'offline' ? p.laneGroup : 'both', p.st, memo);
}
for (const [i, p] of (data.noPageEvents || []).entries()) {
  add(`hub:np:${i}:${p.s}`, p.t, p.s, p.e, p.g === 'online' || p.g === 'offline' ? p.g : 'both', p.st, '');
}

const q = s => `$q$${String(s).replaceAll('$q$', '')}$q$`;
const values = rows.map(r => `(${q(r.id)}, (select id from auth.users order by created_at limit 1), ${q(r.title)}, '${r.s}', '${r.e}', '${r.channel}', ${q(r.status)}, ${q(r.memo)}, 'hub', now())`);
const sql = `begin;
delete from public.promotions where source = 'hub';
${values.length ? `insert into public.promotions (id, user_id, title, start_date, end_date, channel, status, memo, source, synced_at) values\n${values.join(',\n')};` : ''}
commit;
select count(*) as promotions from public.promotions;`;

const tmp = path.join(os.tmpdir(), `planner-promos-${process.pid}.sql`);
fs.writeFileSync(tmp, sql);
try {
  // tmp is our own file in the OS temp folder, so quoting it is enough.
  const out = execSync(`npx -y supabase db query --remote=${PROJECT_REF} -f "${tmp}" --yes`, { cwd: plannerRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const n = (out.match(/"promotions":\s*(\d+)/) || [])[1];
  console.log(`[planner] 프로모션 ${rows.length}건 동기화 완료 (서버 ${n ?? '?'}건) · ${data.meta && data.meta.sync ? '시트 기준 ' + data.meta.sync : ''}`);
} catch (e) {
  console.error('[planner] 프로모션 동기화 실패:', (e.stderr || e.message || '').toString().slice(0, 500));
  process.exitCode = 1;
} finally {
  fs.rmSync(tmp, { force: true });
}
