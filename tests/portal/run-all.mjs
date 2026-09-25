// Runs every portal regression suite in this folder (each lifts functions out
// of portal/*.html and checks them in plain Node — no browser, no Firebase).
// Usage, from the repo root:  node tests/portal/run-all.mjs
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter(f => f.endsWith('.test.mjs')).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [join(here, f)], { encoding: 'utf8' });
  const last = (r.stdout || '').trim().split('\n').pop();
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${f}${ok ? '' : '  — ' + (last || r.stderr.trim().split('\n').pop())}`);
}
console.log(failed ? `\n${failed} of ${files.length} suites FAILED` : `\nAll ${files.length} suites passed`);
process.exit(failed ? 1 : 0);
