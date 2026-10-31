// Ratchet (distribution plan, Phase 0): Douro's own names, domains and people
// must not creep further into the portal or the Cloud Functions. They are being
// moved into instance settings (functions/instance.js), so the number of
// occurrences per file may only go DOWN, and no new file may contain any.
//
//   node tests/portal/no_new_identity_literals.test.mjs            check
//   node tests/portal/no_new_identity_literals.test.mjs --update   lower the baseline after removing some
//
// What to do instead of typing a name: read it from the instance settings
// (functions/instance.js on the server; the team directory / instance-config on
// the pages). Tests under functions/test and tests/ are not scanned.
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE = join(root, 'tests', 'identity_baseline.json');
const PATTERN = /douropartners|douro-partners|andre\.rocha|antonio\.carvalho|valesintemporais|Douro Partners/gi;
const SKIP = new Set(['node_modules', 'test', 'vendor', '.git']);
const EXT = /\.(js|mjs|cjs|html|css|json)$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.test(name)) out.push(p);
  }
  return out;
}

const counts = {};
for (const area of ['portal', 'functions']) {
  for (const f of walk(join(root, area))) {
    if (/package(-lock)?\.json$/.test(f)) continue;
    const n = (readFileSync(f, 'utf8').match(PATTERN) || []).length;
    if (n) counts[relative(root, f).split(String.fromCharCode(92)).join('/')] = n;
  }
}

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify(Object.fromEntries(Object.entries(counts).sort()), null, 2) + '\n');
  console.log(`Baseline written: ${Object.keys(counts).length} files, ${Object.values(counts).reduce((a, b) => a + b, 0)} occurrences`);
  process.exit(0);
}

if (!existsSync(BASELINE)) { console.log('FAIL  no baseline (run with --update)'); process.exit(1); }
const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
let fail = 0, lowered = 0;
for (const [f, n] of Object.entries(counts)) {
  const allowed = base[f] ?? 0;
  if (n > allowed) { fail++; console.log(`FAIL  ${f}: ${n} Douro-specific names (allowed ${allowed}) — read them from the instance settings instead`); }
}
for (const [f, allowed] of Object.entries(base)) if ((counts[f] ?? 0) < allowed) lowered++;
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`${fail ? 'FAIL' : 'PASS'}  no new Douro-specific names (${total} left across ${Object.keys(counts).length} files, to be moved to settings)`);
if (!fail && lowered) console.log(`NOTE  ${lowered} file(s) have fewer than the baseline: run with --update to lock the progress in`);
process.exit(fail ? 1 : 0);
