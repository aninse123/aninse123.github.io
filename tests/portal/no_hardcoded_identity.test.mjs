// WP10: Douro's people and addresses live in instances/douro/ (and the generated
// portal/instance-config.js) only. This fails the build if an address of theirs
// reappears in the portal pages or the Cloud Functions - read it from the
// instance settings instead (functions/instance.js, portal/instance-config.js).
// The broader name ratchet (no_new_identity_literals) still counts the softer
// mentions ("Douro Partners" in wording) while those are being moved.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PATTERN = /@douropartners\.pt|@douropartners-team\.pt|andre\.rocha|antonio\.carvalho/i;
const SKIP = new Set(['node_modules', 'test', 'vendor', '.git']);
const ALLOWED = new Set(['portal/instance-config.js']); // generated from instances/douro/instance.json
const EXT = /\.(js|mjs|cjs|html|css)$/;
let fail = 0;
const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else if (EXT.test(name)) out.push(p);
  }
  return out;
}
const hits = [];
for (const area of ['portal', 'functions']) {
  for (const f of walk(join(root, area))) {
    const rel = relative(root, f).split(String.fromCharCode(92)).join('/');
    if (ALLOWED.has(rel)) continue;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (PATTERN.test(line)) hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`); });
  }
}
ok('no Douro address or founder name in the portal pages or Cloud Functions' + (hits.length ? '\n   ' + hits.join('\n   ') : ''), hits.length === 0);
ok('there is no built-in Douro fallback file', !existsSync(join(root, 'functions', 'legacy_douro.js')));
const perms = readFileSync(join(root, 'functions', 'access', 'perms.js'), 'utf8');
ok('perms.js has no fallback branch', !/legacy/i.test(perms));
console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
