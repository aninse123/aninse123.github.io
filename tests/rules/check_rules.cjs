// Checks firestore.rules against sample requests with Google's rules test
// endpoint (projects.test): nothing is deployed or stored. Needs a firebase
// CLI login (uses its access token). Run: node tests/rules/check_rules.cjs
//
// Model (30 Sep): the Admin (André, by email) can do everything; everyone
// else — partners included — only what their role's permissions allow
// (Partner is an ordinary role). Every collection the pages write is tried
// as a partner with the default Partner permissions.
const fs = require('fs');
const os = require('os');
const path = require('path');
const tok = require(os.homedir() + '/.config/configstore/firebase-tools.json').tokens.access_token;
const src = fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8');
const P = require(path.join(__dirname, '../../functions/access/perms.js'));

const ANDRE = { email: 'andre.rocha@douropartners.pt', perms: P.ALL };
const ANT = 'antonio.carvalho@douropartners.pt';
const PARTNER = { email: ANT, perms: P.PARTNER_PERMS, key: 'antonio' };
const PARTNER_NO_DELETE = { email: ANT, perms: P.PARTNER_PERMS.filter((p) => p !== 'search.delete'), key: 'antonio' };
const NO_CLAIMS = { email: ANT }; // an old token from before team access
const INTERN = { email: 'maria@douropartners.pt', perms: ['search.view', 'search.edit', 'search.activity', 'out.view', 'out.draft', 'out.tasks', 'out.campaigns', 'net.view', 'net.edit'], key: 'maria' };
const docPath = (p) => `/databases/(default)/documents/${p}`;
// method: get | create | update | delete. data = incoming (create/update); old = stored (update/delete/get).
const C = (label, who, method, p, expect, data, old) => ({ label, tc: { expectation: expect, request: { auth: { uid: 'u_' + who.email, token: who }, path: docPath(p), method, ...(data ? { resource: { data } } : {}) }, ...(old ? { resource: { data: old } } : {}) } });
const me = PARTNER.email;

const cases = [
  // ── The Admin: everything ──
  C('Admin: team member', ANDRE, 'update', 'team/maria@douropartners.pt', 'ALLOW', { key: 'maria', x: 1 }, { key: 'maria' }),
  C('Admin: Outreach settings', ANDRE, 'update', 'outreachSettings/global', 'ALLOW', { testMode: false }, { testMode: true }),
  C('Admin: usage', ANDRE, 'get', 'usageDaily/2026-09-30', 'ALLOW', null, { a: 1 }),
  C('Admin: remove from suppression', ANDRE, 'delete', 'outreachSuppression/x', 'ALLOW', null, { email: 'x' }),

  // ── Partner (default Partner role): the everyday work ──
  C('Partner: edit a company', PARTNER, 'update', 'searchCompanies/c1', 'ALLOW', { name: 'B', owner: 'andre', updatedBy: me }, { name: 'A', owner: 'andre' }),
  C('Partner: change a company\'s stage (deal)', PARTNER, 'update', 'searchCompanies/c1', 'ALLOW', { name: 'A', stage: 'nda', updatedBy: me }, { name: 'A', stage: 'universe' }),
  C('Partner: add a company', PARTNER, 'create', 'searchCompanies/c2', 'ALLOW', { name: 'New', updatedBy: me }),
  C('Partner: delete a company', PARTNER, 'delete', 'searchCompanies/c1', 'ALLOW', null, { name: 'A' }),
  C('Partner: log a Search CRM activity', PARTNER, 'create', 'searchActivities/a1', 'ALLOW', { companyId: 'c1', type: 'note', createdBy: me }),
  C('Partner: add a person', PARTNER, 'create', 'searchPeople/p1', 'ALLOW', { name: 'X' }),
  C('Partner: link a person to a company', PARTNER, 'create', 'searchPersonLinks/l1', 'ALLOW', { companyId: 'c1', personId: 'p1' }),
  C('Partner: brokers', PARTNER, 'create', 'searchBrokers/b1', 'ALLOW', { name: 'X' }),
  C('Partner: Search CRM settings (fit criteria)', PARTNER, 'update', 'searchConfig/fitCriteria', 'ALLOW', { a: 2 }, { a: 1 }),
  C('Partner: map lists', PARTNER, 'create', 'searchMapLists/m1', 'ALLOW', { name: 'X' }),
  C('Partner: add an investor (CRM)', PARTNER, 'create', 'crmInvestors/i1', 'ALLOW', { name: 'X', updatedBy: me }),
  C('Partner: edit an investor (CRM)', PARTNER, 'update', 'crmInvestors/i1', 'ALLOW', { name: 'Y', updatedBy: me }, { name: 'X' }),
  C('Partner: delete an investor (CRM)', PARTNER, 'delete', 'crmInvestors/i1', 'ALLOW', null, { name: 'X' }),
  C('Partner: log an Investor CRM activity', PARTNER, 'create', 'crmActivities/a1', 'ALLOW', { investorId: 'i1', createdBy: me }),
  C('Partner: Investor CRM settings', PARTNER, 'update', 'crmConfig/settings', 'ALLOW', { a: 2 }, { a: 1 }),
  C('Partner: add a Network contact', PARTNER, 'create', 'networkContacts/n1', 'ALLOW', { name: 'X', updatedBy: me }),
  C('Partner: delete a Network contact', PARTNER, 'delete', 'networkContacts/n1', 'ALLOW', null, { name: 'X' }),
  C('Partner: Network firm', PARTNER, 'create', 'networkFirms/f1', 'ALLOW', { name: 'X', updatedBy: me }),
  C('Partner: log a Network activity', PARTNER, 'create', 'networkActivities/a1', 'ALLOW', { contactId: 'n1', createdBy: me }),
  C('Partner: Network categories', PARTNER, 'update', 'networkConfig/categories', 'ALLOW', { a: 2 }, { a: 1 }),
  C('Partner: mark a conversation read', PARTNER, 'update', 'outreachThreads/t1', 'ALLOW', { unread: false }, { unread: true }),
  C('Partner: create a list', PARTNER, 'create', 'outreachLists/l1', 'ALLOW', { name: 'X' }),
  C('Partner: add a list member', PARTNER, 'create', 'outreachLists/l1/members/m1', 'ALLOW', { email: 'x@y.pt' }),
  C('Partner: delete a list', PARTNER, 'delete', 'outreachLists/l1', 'ALLOW', null, { name: 'X' }),
  C('Partner: edit a template', PARTNER, 'update', 'outreachTemplates/t1', 'ALLOW', { name: 'Y' }, { name: 'X' }),
  C('Partner: add to the suppression list', PARTNER, 'create', 'outreachSuppression/x', 'ALLOW', { email: 'x' }),
  C('Partner: add an investor to the portal', PARTNER, 'create', 'investors/v1', 'ALLOW', { name: 'X' }),
  C('Partner: delete a portal investor', PARTNER, 'delete', 'investors/v1', 'ALLOW', null, { name: 'X' }),
  C('Partner: access groups', PARTNER, 'update', 'accessGroups/g1', 'ALLOW', { name: 'Y' }, { name: 'X' }),
  C('Partner: add a document', PARTNER, 'create', 'documents/d1', 'ALLOW', { title: 'X', allowedEmails: [] }),
  C('Partner: delete a document', PARTNER, 'delete', 'documents/d1', 'ALLOW', null, { title: 'X', allowedEmails: [] }),
  C('Partner: read any document', PARTNER, 'get', 'documents/d1', 'ALLOW', null, { title: 'X', allowedEmails: [] }),
  C('Partner: portal messages', PARTNER, 'create', 'portalMessages/m1', 'ALLOW', { text: 'X' }),
  C('Partner: fund stage (config/portal)', PARTNER, 'update', 'config/portal', 'ALLOW', { stage: 2 }, { stage: 1 }),
  C('Partner: investor access list', PARTNER, 'update', 'config/allowedEmailHashes', 'ALLOW', { hashes: ['a'] }, { hashes: [] }),
  C('Partner: add a budget item', PARTNER, 'create', 'budgetItems/b1', 'ALLOW', { amount: 1 }),
  C('Partner: delete a budget item', PARTNER, 'delete', 'budgetItems/b1', 'ALLOW', null, { amount: 1 }),
  C('Partner: read the Activity Log', PARTNER, 'get', 'activityLog/e1', 'ALLOW', null, { email: 'x', type: 'login' }),
  C('Partner: record an export in the Activity Log', PARTNER, 'create', 'activityLog/e2', 'ALLOW', { email: me, type: 'data_export' }),
  C('Partner: shared read counter', PARTNER, 'update', 'dailyReadCounters/2026-09-30', 'ALLOW', { count: 2 }, { count: 1 }),
  C('Partner: read Outreach settings', PARTNER, 'get', 'outreachSettings/global', 'ALLOW', null, { testMode: true }),
  C('Partner: read his own team record', PARTNER, 'get', `team/${ANT}`, 'ALLOW', null, { key: 'antonio' }),

  // ── Partner: Admin-only stays closed ──
  C('Partner: can\'t change a team member', PARTNER, 'update', 'team/maria@douropartners.pt', 'DENY', { key: 'm2' }, { key: 'maria' }),
  C('Partner: can\'t read someone else\'s team record', PARTNER, 'get', 'team/maria@douropartners.pt', 'DENY', null, { key: 'maria' }),
  C('Partner: can\'t change feature switches', PARTNER, 'update', 'config/features', 'DENY', { flags: { a: 1 } }, { flags: {} }),
  C('Partner: can\'t read the access log', PARTNER, 'get', 'accessAudit/a1', 'DENY', null, { by: 'x' }),
  C('Partner: can\'t read usage', PARTNER, 'get', 'usageDaily/2026-09-30', 'DENY', null, { a: 1 }),
  C('Partner: can\'t change Outreach settings', PARTNER, 'update', 'outreachSettings/global', 'DENY', { testMode: false }, { testMode: true }),
  C('Partner: can\'t change a sending address', PARTNER, 'update', 'outreachSenders/a@b.pt', 'DENY', { dailyCap: 9 }, { dailyCap: 10 }),
  C('Partner: can\'t change the legal footer', PARTNER, 'update', 'outreachCompliance/default', 'DENY', { footer: 'y' }, { footer: 'x' }),
  C('Partner: can\'t remove from the suppression list', PARTNER, 'delete', 'outreachSuppression/x', 'DENY', null, { email: 'x' }),
  C('Partner: can\'t change the Search CRM tier rules without the settings permission', PARTNER_NO_DELETE, 'update', 'searchConfig/targetTiers', 'ALLOW', { rules: [1] }, { rules: [] }),

  // ── The role decides: untick a permission on Partner and the database follows ──
  C('Partner without "Delete companies": can\'t delete a company', PARTNER_NO_DELETE, 'delete', 'searchCompanies/c1', 'DENY', null, { name: 'A' }),
  // Contactable rules (8 Oct): the verdict fields are flag fields.
  C('Flags only: apply a contactable-rules verdict', { email: 'flags@douropartners.pt', perms: ['search.view', 'search.flags'], key: 'flags' }, 'update', 'searchCompanies/c1', 'ALLOW', { name: 'A', owner: 'andre', contactable: false, contactableNote: 'Rule 4', contactableSource: 'rules', contactableRules: { failed: ['r4'] } }, { name: 'A', owner: 'andre' }),
  C('Intern: can\'t set a contactable verdict on own company (needs flags)', INTERN, 'update', 'searchCompanies/c1', 'DENY', { name: 'A', owner: 'maria', contactableSource: 'manual' }, { name: 'A', owner: 'maria' }),
  C('Old token without permissions: nothing (until he signs in again / access is refreshed)', NO_CLAIMS, 'update', 'searchCompanies/c1', 'DENY', { name: 'B', updatedBy: me }, { name: 'A' }),

  // ── Other staff unchanged ──
  C('Intern: can\'t edit templates', INTERN, 'update', 'outreachTemplates/t1', 'DENY', { name: 'Y' }, { name: 'X' }),
  C('Intern: can\'t read usage', INTERN, 'get', 'usageDaily/2026-09-30', 'DENY', null, { a: 1 }),
  C('Intern: can\'t touch the investor portal', INTERN, 'create', 'documents/d9', 'DENY', { title: 'X', allowedEmails: [] }),
];

(async () => {
  const res = await fetch('https://firebaserules.googleapis.com/v1/projects/douro-partners:test', {
    method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: src }] }, testSuite: { testCases: cases.map((c) => c.tc) } }),
  });
  const body = await res.json();
  if (!res.ok) { console.log('ERROR', res.status, JSON.stringify(body).slice(0, 800)); process.exitCode = 1; return; }
  const issues = (body.issues || []).filter((i) => i.severity !== 'WARNING');
  if (issues.length) console.log('ISSUES', JSON.stringify(issues).slice(0, 800));
  let fail = 0;
  (body.testResults || []).forEach((r, i) => { const ok = r.state === 'SUCCESS'; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${cases[i].label}${ok ? '' : ' — ' + JSON.stringify(r.debugMessages?.length ? r.debugMessages : r.errorPosition || '').slice(0, 300)}`); });
  console.log(fail ? `\n${fail} FAILED` : `\nall ${cases.length} rule checks passed`);
  process.exitCode = fail ? 1 : 0;
})();

// ── Storage rules (investor documents, budget files, Outreach attachments) ──
(async () => {
  const st = fs.readFileSync(path.join(__dirname, '../../storage.rules'), 'utf8');
  const B = '/b/douro-partners.firebasestorage.app/o/';
  const S = (label, who, method, p, expect) => ({ label, tc: { expectation: expect, request: { auth: { uid: 'u', token: who }, path: B + p, method } } });
  const sc = [
    S('Storage: Admin uploads a document', ANDRE, 'create', 'documents/a.pdf', 'ALLOW'),
    S('Storage: partner uploads a document (portal admin permission)', PARTNER, 'create', 'documents/a.pdf', 'ALLOW'),
    S('Storage: partner reads a budget file', PARTNER, 'get', 'budget/r.pdf', 'ALLOW'),
    S('Storage: partner reads an Outreach attachment', PARTNER, 'get', 'outreach/t/a.png', 'ALLOW'),
    S('Storage: old token without permissions — no upload', NO_CLAIMS, 'create', 'documents/a.pdf', 'DENY'),
    S('Storage: intern — no documents', INTERN, 'get', 'documents/a.pdf', 'DENY'),
    S('Storage: nobody writes Outreach attachments from the browser', PARTNER, 'create', 'outreach/t/a.png', 'DENY'),
  ];
  const res = await fetch('https://firebaserules.googleapis.com/v1/projects/douro-partners:test', {
    method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: { files: [{ name: 'storage.rules', content: st }] }, testSuite: { testCases: sc.map((c) => c.tc) } }),
  });
  const body = await res.json();
  if (!res.ok) { console.log('STORAGE ERROR', res.status, JSON.stringify(body).slice(0, 500)); process.exitCode = 1; return; }
  let fail = 0;
  (body.testResults || []).forEach((r, i) => { const ok = r.state === 'SUCCESS'; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${sc[i].label}`); });
  console.log(fail ? `\n${fail} STORAGE FAILED` : `all ${sc.length} storage checks passed`);
  if (fail) process.exitCode = 1;
})();
