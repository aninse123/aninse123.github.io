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
ok('page: André = admin (everything, can Preview); António = partner (all but Admin-only)', /if \(email === ADMIN_EMAIL\) \{[\s\S]*?return make\(email, 'admin', ALL, PARTNER_KEYS\[email\]\);\s*\}/.test(access) && /if \(ADMIN_EMAILS\.includes\(email\)\) return make\(email, 'partner', PARTNER_PERMS, PARTNER_KEYS\[email\]\);/.test(access));
ok('page: the Team tab needs "Manage people, roles and access" (so it disappears for a partner)', /team: 'access\.manage'/.test(access));
ok('Team page: Features / Activity / Usage each need their own Admin permission', /data-view="features" data-perm="features\.manage"/.test(team) && /data-view="audit" data-perm="access\.manage"/.test(team) && /data-view="usage" data-perm="usage\.view"/.test(team));
ok('Team page: Admin and Partner columns are fixed; Admin-only ticks can\'t be given; Preview as Partner', /\{ id: 'admin', name: 'Admin', perms: ALL, locked: true \}, \{ id: 'partner', name: 'Partner', perms: PARTNER_PERMS, locked: true, preview: true \}/.test(team) && /r\.locked \|\| ADMIN_ONLY\.includes\(code\) \? ' disabled' : ''/.test(team) && /data-preview="partner"/.test(team));
ok('Team page: People says "Admin — always full access" / "Partner — everything except Admin-only"', team.includes('Admin — always full access') && team.includes('Partner — everything except Admin-only'));
ok('Team page: "Refresh everyone\'s access" calls refreshAll', /id="refreshAllBtn"/.test(team) && /call\(\{ action: 'refreshAll' \}\)/.test(team));
ok('Outreach: Settings open for Outreach settings or templates; General / Addresses / Legal footer are Admin-only', /data-tab="settings" data-perm="out\.settings"/.test(outreach) && /data-sec="general" data-perm="out\.admin"/.test(outreach) && /data-sec="senders" data-perm="out\.admin"/.test(outreach) && /data-sec="footer" data-perm="out\.admin"/.test(outreach) && /id="sec-general" data-perm="out\.admin"/.test(outreach) && /'out\.settings': \['out\.admin', 'out\.templates'\]/.test(access));
ok('Outreach: a partner lands on Templates; removing from the suppression list is Admin-only', /!window\.pageAccess\?\.can\('out\.admin'\) && !\$\('sec-general'\)\.hidden\) showSec\('templates'\)/.test(outreach) && /data-unsup="\$\{esc\(s\.id\)\}" data-perm="out\.admin"/.test(outreach));
ok('Search CRM: the import buttons need the (Admin-only) import permission', ['bulkImportBtn', 'peopleImportBtn', 'companiesImportBtn'].every((id) => new RegExp(`id="${id}" data-perm="search\\.import"`).test(search)));
ok('"Admin" tab renamed "Investor portal"; the investor portal link says "Manage the investor portal"', /label: 'Investor portal'/.test(nav) && investor.includes('Manage the investor portal →'));
ok('rules: Admin by email keeps everything; partners are excluded from the Admin-only records', /function isOwner\(\) \{\s*return request\.auth != null && request\.auth\.token\.email == 'andre\.rocha@douropartners\.pt';/.test(rules) && /allow read, create, update: if isOwner\(\) \|\| \(isPartner\(\) && !adminOnly\(coll, docId\)\);/.test(rules));
ok('rules: Admin-only records = team, roles, access log, usage, Outreach settings / addresses / legal footer, feature switches, team login list', ['team', 'roles', 'accessAudit', 'usageDaily', 'usageFirestore', 'usageMonthly', 'usageAlerts', 'outreachSettings', 'outreachSenders', 'outreachCompliance'].every((c) => rules.includes(`'${c}'`)) && /coll == 'config' && docId in \['features', 'teamEmailHashes'\]/.test(rules));
ok('rules: the sub-collection rule can\'t match a top-level record', /match \/\{coll\}\/\{docId\}\/\{sub\}\/\{rest=\*\*\} \{/.test(rules) && !/match \/\{coll\}\/\{docId\}\/\{rest=\*\*\}/.test(rules));

console.log(fail ? `\n${fail} FAILED` : '\nall Admin / Partner split tests passed'); process.exit(fail ? 1 : 0);
