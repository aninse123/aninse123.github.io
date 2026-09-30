// Admin / Partner split (30 Sep): the Admin (André) has everything; partners
// everything but the Admin-only permissions — same list on the page and the
// server; Team & access, feature switches, usage, Outreach settings (except
// templates / suppression) and Search CRM import are Admin-only; the "Admin"
// tab is now "Investor portal".
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../../functions/access/perms.js');
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const access = read('portal/access.js'), team = read('portal/team.html'), outreach = read('portal/outreach.html'), search = read('portal/search.html'), nav = read('portal/nav.js'), investor = read('portal/investor.html'), rules = read('firestore.rules');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

const pageAdminOnly = JSON.parse(access.match(/export const ADMIN_ONLY = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
ok('page and server have the same Admin-only list', JSON.stringify(pageAdminOnly) === JSON.stringify(P.ADMIN_ONLY));
ok('page: André = admin by email (everything, can Preview); everyone else — partners included — by the permissions on their token (fresh token once if it has none)', /if \(email === ADMIN_EMAIL\) \{[\s\S]*?return make\(email, 'admin', ALL, PARTNER_KEYS\[email\]\);\s*\}/.test(access) && !/make\(email, 'partner', PARTNER_PERMS/.test(access) && /if \(!force && !Array\.isArray\(claims\.perms\)\)/.test(access) && /if \(!user \|\| a\.admin \|\| a\.preview\) return;/.test(access));
ok('page: the Team tab needs "Manage people, roles and access" (so it disappears for a partner)', /team: 'access\.manage'/.test(access));
ok('Team page: Features / Activity / Usage each need their own Admin permission', /data-view="features" data-perm="features\.manage"/.test(team) && /data-view="audit" data-perm="access\.manage"/.test(team) && /data-view="usage" data-perm="usage\.view"/.test(team));
ok('Team page: only Admin is fixed; Partner is an ordinary, editable role (its default stands in until stored); Admin-only ticks can\'t be given', /const cols = \[\{ id: 'admin', name: 'Admin', perms: ALL, locked: true \}, \.\.\.allRoles\(\)\];/.test(team) && /const allRoles = \(\) => \(roles\.some\(r => r\.id === 'partner'\) \? roles : \[\{ id: 'partner', name: 'Partner'/.test(team) && /r\.locked \|\| ADMIN_ONLY\.includes\(code\) \? ' disabled' : ''/.test(team));
ok('Team page: People — the Admin is fixed ("Admin — always full access", contact details only); partners get the staff actions (Edit, Suspend, End, end date, NDA)', team.includes('Admin — always full access') && /const ndaWait = !admin && live && !p\.ndaSigned;/.test(team) && /\$\{admin \? '—' : esc\(day\(p\.endsAt\)\)\}/.test(team) && !team.includes('Partner — everything except Admin-only'));
ok('Team page: "Refresh everyone\'s access" calls refreshAll', /id="refreshAllBtn"/.test(team) && /call\(\{ action: 'refreshAll' \}\)/.test(team));
ok('Outreach: Settings open for Outreach settings or templates; General / Addresses / Legal footer are Admin-only', /data-tab="settings" data-perm="out\.settings"/.test(outreach) && /data-sec="general" data-perm="out\.admin"/.test(outreach) && /data-sec="senders" data-perm="out\.admin"/.test(outreach) && /data-sec="footer" data-perm="out\.admin"/.test(outreach) && /id="sec-general" data-perm="out\.admin"/.test(outreach) && /'out\.settings': \['out\.admin', 'out\.templates'\]/.test(access));
ok('Outreach: a partner lands on Templates; removing from the suppression list is Admin-only', /!window\.pageAccess\?\.can\('out\.admin'\) && !\$\('sec-general'\)\.hidden\) showSec\('templates'\)/.test(outreach) && /data-unsup="\$\{esc\(s\.id\)\}" data-perm="out\.admin"/.test(outreach));
ok('Search CRM: the import buttons need the (Admin-only) import permission', ['bulkImportBtn', 'peopleImportBtn', 'companiesImportBtn'].every((id) => new RegExp(`id="${id}" data-perm="search\\.import"`).test(search)));
ok('"Admin" tab renamed "Investor portal"; the investor portal link says "Manage the investor portal"', /label: 'Investor portal'/.test(nav) && investor.includes('Manage the investor portal →'));
ok('rules: only the Admin (by email) has a catch-all; partners go by their role\'s permissions like any staff', /function isOwner\(\) \{\s*return request\.auth != null && request\.auth\.token\.email == 'andre\.rocha@douropartners\.pt';\s*\}\s*match \/\{document=\*\*\} \{\s*allow read, write: if isOwner\(\);/.test(rules) && !/isPartner\(\)/.test(rules) && !/antonio\.carvalho@douropartners\.pt/.test(rules));
ok('rules: no rule gives anyone but the Admin team, roles, access log, usage, feature switches, Outreach settings / addresses / footer writes', ['usageDaily', 'usageFirestore', 'usageMonthly', 'usageAlerts', 'accessAudit'].every((c) => !new RegExp(`match /${c}/`).test(rules)) && !/match \/outreachSettings\/\{id\} \{[^}]*allow write/.test(rules) && !/match \/outreachSenders\/\{id\} \{[^}]*allow write/.test(rules) && !/match \/outreachCompliance\/\{id\} \{[^}]*allow write/.test(rules) && !/match \/team\/\{email\} \{[^}]*allow write/.test(rules));
ok('storage rules: the Admin by email; partners by permission (no founder list)', (() => { const st = read('storage.rules'); return /return request\.auth != null && request\.auth\.token\.email == 'andre\.rocha@douropartners\.pt';/.test(st) && !/antonio\.carvalho/.test(st); })());
ok('sign-in: only the Admin is always allowed (partners sign in through their team record)', /const ADMIN_EMAILS = require\("\.\/access\/perms"\)\.ADMIN_EMAILS;/.test(read('functions/index.js')));

console.log(fail ? `\n${fail} FAILED` : '\nall Admin / Partner split tests passed'); process.exit(fail ? 1 : 0);
