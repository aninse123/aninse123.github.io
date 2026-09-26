// Team access: the browser's permission list (portal/access.js) matches the
// server's (functions/access/perms.js), the nav shows each tab with the same
// permission the page guard checks, and every data-perm="…" used in the pages
// names a real permission (a typo would hide a button from everyone but partners).
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

// Server catalog (CommonJS; stub the one firebase import it needs).
const Module = require('module');
const orig = Module._load;
Module._load = function (req, ...rest) { if (req === 'firebase-functions/v2/https') return { HttpsError: class extends Error {} }; return orig.call(this, req, ...rest); };
const server = require(new URL('functions/access/perms.js', root).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
Module._load = orig;

// Browser catalog: evaluate the PERMS / TAB_PERM literals from access.js.
const acc = read('portal/access.js');
const lit = (name) => { const m = new RegExp(`export const ${name} = (\\[[\\s\\S]*?\\]|\\{[\\s\\S]*?\\});`).exec(acc); if (!m) throw new Error(name); return Function(`return ${m[1]}`)(); };
const PERMS = lit('PERMS'), TAB_PERM = lit('TAB_PERM');
const derived = Object.keys(Function(`return ${/const DERIVED = (\{[\s\S]*?\});/.exec(acc)[1]}`)());

ok('same permission codes, labels and order on both sides', JSON.stringify(PERMS) === JSON.stringify(server.PERMS));
ok('default roles only use known permissions', Object.values(server.DEFAULT_ROLES).every(r => r.perms.every(p => server.ALL.includes(p))));
ok('Intern: no delete / import / export / send / admin', !['search.delete', 'search.import', 'search.export', 'out.send', 'out.admin', 'portal.admin', 'budget.view', 'icrm.view', 'access.manage'].some(p => server.DEFAULT_ROLES.intern.perms.includes(p)));

const nav = read('portal/nav.js');
const PAGE_PERM = Function(`return ${/const PAGE_PERM = (\{[\s\S]*?\});/.exec(nav)[1]}`)();
ok('nav links and page guards use the same permission per tab', JSON.stringify(PAGE_PERM) === JSON.stringify(TAB_PERM));

const known = new Set([...server.ALL, ...derived]);
const pages = readdirSync(new URL('portal/', root)).filter(f => f.endsWith('.html'));
const bad = [];
for (const f of pages) {
  const html = read('portal/' + f);
  for (const m of html.matchAll(/data-perm="([^"$]+)"/g)) for (const p of m[1].split(/\s+/)) if (!known.has(p)) bad.push(`${f}: ${p}`);
  for (const m of html.matchAll(/guardPage\(user, '([a-z]+)'\)/g)) if (!TAB_PERM[m[1]]) bad.push(`${f}: guard tab ${m[1]}`);
}
ok(`every data-perm and page guard names a real permission${bad.length ? ' — ' + bad.join(', ') : ''}`, bad.length === 0);
const guarded = pages.filter(f => /guardPage\(user, '/.test(read('portal/' + f)));
ok('every staff page is guarded (admin, budget, crm, log, network, outreach, search, team)', ['admin', 'budget', 'crm', 'log', 'network', 'outreach', 'search', 'team'].every(p => guarded.includes(p + '.html')));
const stillEmail = pages.filter(f => /!ADMIN_EMAILS\.includes\(user\.email\)\) \{/.test(read('portal/' + f)));
ok('no page still gates on the two partner emails', stillEmail.length === 0);

console.log(fail ? `\n${fail} FAILED` : '\nall access parity tests passed'); process.exit(fail ? 1 : 0);
