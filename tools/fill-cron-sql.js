// Fills the Monday cron SQL with this project's URL and the local cron secret.
// Usage: node tools/fill-cron-sql.js https://<project-ref>.supabase.co
const fs = require('fs');
const path = require('path');

const url = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)) {
  console.error('Pass the Supabase project URL, e.g. https://abcd1234.supabase.co');
  process.exit(1);
}
const root = path.join(__dirname, '..');
const secret = fs.readFileSync(path.join(root, '.cron-secret.local.txt'), 'utf8').trim();
const tpl = fs.readFileSync(path.join(root, 'supabase', 'sql', '02_monday_cron.template.sql'), 'utf8');
const out = path.join(root, 'supabase', 'sql', '02_monday_cron.local.sql');
fs.writeFileSync(out, tpl.replaceAll('__PROJECT_URL__', url).replaceAll('__CRON_SECRET__', secret));
console.log('Wrote', out);
