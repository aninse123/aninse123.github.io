// Checks firestore.rules against sample requests with Google's rules test
// endpoint (projects.test): nothing is deployed or stored. Needs a firebase
// CLI login (uses its access token). Run: node tests/rules/check_rules.cjs
const fs = require('fs');
const os = require('os');
const tok = require(os.homedir() + '/.config/configstore/firebase-tools.json').tokens.access_token;
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8');
const P = require(path.join(__dirname, '../../functions/access/perms.js'));

const ANDRE = { email: 'andre.rocha@douropartners.pt', perms: P.ALL };
// António with an OLD token that still lists every permission (before "Refresh everyone's access").
const ANTONIO_OLD = { email: 'antonio.carvalho@douropartners.pt', perms: P.ALL };
const ANTONIO = { email: 'antonio.carvalho@douropartners.pt', perms: P.PARTNER_PERMS };
const INTERN = { email: 'maria@douropartners.pt', perms: ['search.view', 'search.edit', 'search.activity', 'out.view', 'out.draft', 'out.tasks', 'out.campaigns', 'net.view', 'net.edit'], key: 'maria' };
const doc = (p) => `/databases/(default)/documents/${p}`;
const C = (label, who, method, path, expect, data) => ({ label, tc: { expectation: expect, request: { auth: { uid: 'u_' + who.email, token: who }, path: doc(path), method }, ...(data ? { resource: { data } } : {}) } });

const cases = [
  C('Admin changes a team member', ANDRE, 'update', 'team/maria@douropartners.pt', 'ALLOW', { key: 'maria' }),
  C('Partner (old token) can\'t change a team member', ANTONIO_OLD, 'update', 'team/maria@douropartners.pt', 'DENY', { key: 'maria' }),
  C('Partner can\'t create a role', ANTONIO, 'create', 'roles/x', 'DENY'),
  C('Partner can\'t change feature switches', ANTONIO_OLD, 'update', 'config/features', 'DENY', { flags: {} }),
  C('Partner can\'t change the team login list', ANTONIO_OLD, 'update', 'config/teamEmailHashes', 'DENY', { hashes: [] }),
  C('Partner still changes the investor access list', ANTONIO, 'update', 'config/allowedEmailHashes', 'ALLOW', { hashes: [] }),
  C('Partner can\'t read the access log', ANTONIO_OLD, 'get', 'accessAudit/a1', 'DENY', { by: 'x' }),
  C('Admin reads the access log', ANDRE, 'get', 'accessAudit/a1', 'ALLOW', { by: 'x' }),
  C('Partner can\'t read usage', ANTONIO_OLD, 'get', 'usageDaily/2026-09-30', 'DENY', { a: 1 }),
  C('Admin reads usage', ANDRE, 'get', 'usageDaily/2026-09-30', 'ALLOW', { a: 1 }),
  C('Partner can\'t change Outreach settings', ANTONIO_OLD, 'update', 'outreachSettings/global', 'DENY', { testMode: true }),
  C('Partner still reads Outreach settings', ANTONIO, 'get', 'outreachSettings/global', 'ALLOW', { testMode: true }),
  C('Partner can\'t change a sending address', ANTONIO_OLD, 'update', 'outreachSenders/a@b.pt', 'DENY', { dailyCap: 10 }),
  C('Partner can\'t change the legal footer', ANTONIO_OLD, 'update', 'outreachCompliance/global', 'DENY', { footer: 'x' }),
  C('Partner edits templates', ANTONIO, 'update', 'outreachTemplates/t1', 'ALLOW', { name: 'x' }),
  C('Partner adds to the suppression list', ANTONIO, 'create', 'outreachSuppression/x', 'ALLOW'),
  C('Partner can\'t remove from the suppression list', ANTONIO_OLD, 'delete', 'outreachSuppression/x', 'DENY', { email: 'x' }),
  C('Admin removes from the suppression list', ANDRE, 'delete', 'outreachSuppression/x', 'ALLOW', { email: 'x' }),
  C('Partner still edits companies', ANTONIO, 'update', 'searchCompanies/c1', 'ALLOW', { name: 'x' }),
  C('Partner still deletes companies', ANTONIO, 'delete', 'searchCompanies/c1', 'ALLOW', { name: 'x' }),
  C('Partner still edits the budget', ANTONIO, 'update', 'budgetItems/b1', 'ALLOW', { amount: 1 }),
  C('Partner still manages investor documents', ANTONIO, 'update', 'documents/d1', 'ALLOW', { title: 'x' }),
  C('Partner writes a sub-collection record (lists)', ANTONIO, 'create', 'outreachLists/l1/members/m1', 'ALLOW'),
  C('Intern can\'t edit templates', INTERN, 'update', 'outreachTemplates/t1', 'DENY', { name: 'x' }),
  C('Intern can\'t read usage', INTERN, 'get', 'usageDaily/2026-09-30', 'DENY', { a: 1 }),
  C('Intern reads their own team record', INTERN, 'get', 'team/maria@douropartners.pt', 'ALLOW', { key: 'maria' }),
  C('Intern can\'t read someone else\'s team record', INTERN, 'get', 'team/rui@douropartners.pt', 'DENY', { key: 'rui' }),
];

(async () => {
  const res = await fetch('https://firebaserules.googleapis.com/v1/projects/douro-partners:test', {
    method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: src }] }, testSuite: { testCases: cases.map((c) => c.tc) } }),
  });
  const body = await res.json();
  if (!res.ok) { console.log('ERROR', res.status, JSON.stringify(body).slice(0, 800)); process.exit(1); }
  if (body.issues?.length) console.log('ISSUES', JSON.stringify(body.issues).slice(0, 800));
  let fail = 0;
  (body.testResults || []).forEach((r, i) => { const ok = r.state === 'SUCCESS'; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${cases[i].label}${ok ? '' : ' — ' + JSON.stringify(r.debugMessages || r.errorPosition || r).slice(0, 300)}`); });
  console.log(fail ? `\n${fail} FAILED` : `\nall ${cases.length} rule checks passed`);
  process.exit(fail ? 1 : 0);
})();
