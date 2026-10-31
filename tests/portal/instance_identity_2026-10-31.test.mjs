// Phase 0 / WP3: the pages take their identity from the sign-in token and the
// per-team instance config, never from an email typed into the page.
//  - getAccess (portal/access.js): Admin = role 'admin' on the token
//  - portal/instance-config.js says the same as instances/douro/instance.json
//  - every changed page script still parses
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

const { INSTANCE, founderByEmail, isAdminEmail } = await import(new URL('portal/instance-config.js', root));
const seed = JSON.parse(read('instances/douro/instance.json'));

// ── instance-config.js = instances/douro/instance.json ──
const emails = (l) => l.map((x) => x.email);
ok('page config: same admins as the settings file', JSON.stringify(INSTANCE.adminEmails) === JSON.stringify(seed.settings.adminEmails));
ok('page config: same founders (email, key, name) as the settings file', JSON.stringify(INSTANCE.founders.map(({ email, key, name }) => ({ email, key, name }))) === JSON.stringify(seed.settings.founders));
ok('page config: same production hosts, organisation name and contacts', JSON.stringify(INSTANCE.productionHosts) === JSON.stringify(seed.settings.productionHosts)
  && INSTANCE.orgName === seed.public.orgName && JSON.stringify(INSTANCE.contacts) === JSON.stringify(seed.public.contacts));
ok('page config: every founder has a first name for badges', INSTANCE.founders.every((f) => f.shortName && f.name.startsWith(f.shortName)));
ok('helpers: founderByEmail / isAdminEmail are case-insensitive', founderByEmail(' ANDRE.rocha@douropartners.pt ')?.key === 'andre' && isAdminEmail('Andre.Rocha@douropartners.pt') && !isAdminEmail('antonio.carvalho@douropartners.pt') && founderByEmail('x@y.pt') === null);

// ── getAccess, lifted from the page ──
const access = read('portal/access.js');
const start = access.indexOf('export async function getAccess(');
const end = access.indexOf('\n}\n', start) + 3;
const fn = access.slice(start, end).replace('export ', '');
const stored = new Map();
const ctx = {
  founderByEmail: (e) => (e === 'ana@example.test' ? { key: 'ana', shortName: 'Ana' } : null),
  ALL: ['a', 'b', 'c'], readPreview: () => stored.get('pv') || null,
  make: (email, role, perms, key) => ({ email, role, perms, key, admin: role === 'admin' }),
};
vm.createContext(ctx);
vm.runInContext(fn + '\nglobalThis.getAccess = getAccess;', ctx);
const user = (email, tokens) => { let n = 0; return { email, calls: () => n, getIdTokenResult: async () => ({ claims: tokens[Math.min(n++, tokens.length - 1)] }) }; };

const admin = await ctx.getAccess(user('ana@example.test', [{ role: 'admin', perms: ['a', 'b', 'c'], key: 'ana' }]));
ok('the token says admin: Admin with every permission and her key', admin.role === 'admin' && admin.perms.length === 3 && admin.key === 'ana');
const noKey = await ctx.getAccess(user('ana@example.test', [{ role: 'admin', perms: ['a'] }]));
ok('an admin token without a key falls back to the founder key from the config', noKey.role === 'admin' && noKey.key === 'ana');
const douroNoRole = user('andre.rocha@douropartners.pt', [{}, {}]);
const notAdmin = await ctx.getAccess(douroNoRole);
ok('the old admin email with no admin role on the token is not the Admin (a fresh token is tried once, then nothing)', notAdmin.role === null && notAdmin.perms.length === 0 && douroNoRole.calls() === 2);
const refreshed = await ctx.getAccess(user('andre.rocha@douropartners.pt', [{}, { role: 'admin', perms: ['a', 'b', 'c'], key: 'andre' }]));
ok('an old token without claims is refreshed once and then recognised as the Admin', refreshed.role === 'admin' && refreshed.key === 'andre');
const partner = await ctx.getAccess(user('bo@example.test', [{ role: 'partner', perms: ['a'], key: 'bo' }]));
ok('a partner goes by the permissions on the token', partner.role === 'partner' && partner.perms.join() === 'a' && !partner.admin);
stored.set('pv', { name: 'Intern', perms: ['a', 'zzz'] });
const preview = await ctx.getAccess(user('ana@example.test', [{ role: 'admin', perms: ['a', 'b', 'c'], key: 'ana' }]));
ok('the Admin can preview as a role (only the Admin; unknown permissions dropped)', preview.role === 'preview' && preview.perms.join() === 'a' && preview.preview === 'Intern');
const partnerPreview = await ctx.getAccess(user('bo@example.test', [{ role: 'partner', perms: ['a', 'b'], key: 'bo' }]));
ok('a stored preview does not turn a partner into anything else', partnerPreview.role === 'partner' && partnerPreview.perms.join() === 'a,b');

// ── No identity left in the page logic ──
const pages = ['portal/access.js', 'portal/nav.js', 'portal/team.html', 'portal/login.html', 'portal/investor.html', 'portal/features.js', 'portal/firebase-config.js', 'portal/team-dir.js'];
const hardcoded = pages.filter((p) => /andre\.rocha@|antonio\.carvalho@/.test(read(p)));
ok('these pages no longer contain the founders\' emails: ' + pages.length + ' files', hardcoded.length === 0);
ok('outreach.html builds owners from the config', /OWNER_BY_EMAIL = Object\.fromEntries\(INSTANCE\.founders/.test(read('portal/outreach.html')) && !/'andre\.rocha@douropartners\.pt': 'andre'/.test(read('portal/outreach.html')));

// ── Every changed script still parses ──
const parses = (label, code) => {
  const f = join(tmpdir(), 'chk_' + Math.random().toString(36).slice(2) + '.mjs');
  writeFileSync(f, code);
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  ok('parses: ' + label, r.status === 0 || (console.log((r.stderr || '').split('\n').slice(0, 4).join('\n')), false));
};
for (const p of ['portal/access.js', 'portal/nav.js', 'portal/features.js', 'portal/firebase-config.js', 'portal/team-dir.js', 'portal/instance-config.js']) parses(p, read(p));
for (const p of ['portal/login.html', 'portal/investor.html', 'portal/team.html', 'portal/outreach.html']) {
  const blocks = [...read(p).matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  ok(p + ' has a module script', blocks.length > 0);
  blocks.forEach((b, i) => parses(`${p} module script ${i + 1}`, b));
}

console.log(fail ? `\n${fail} FAILED` : '\nall page identity tests passed');
process.exit(fail ? 1 : 0);
