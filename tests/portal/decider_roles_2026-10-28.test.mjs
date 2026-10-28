// Who counts as a decision-maker (28 Oct 2026): the approval box / add panel
// (owner-panel.js) and the Search CRM use the same list and ranks as the server
// (functions/outreach/roles.js, related.deciderRank).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const page = readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8');
const P = await import(new URL('../../portal/owner-panel.js', import.meta.url));
const require = createRequire(import.meta.url);
const { NOT_DECIDER_RE } = require('../../functions/outreach/roles.js');
const { deciderRank } = require('../../functions/outreach/related.js');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
ok('the page list is the server list (owner panel and Search CRM)', P.EXCLUDED_ROLE.source === NOT_DECIDER_RE.source && page.includes('const OWN_AUDITOR_RE = /' + NOT_DECIDER_RE.source + '/i;'));
const L = (roles, extra = {}) => ({ personEntityType: 'person', mgmtCurrent: true, mgmtRoles: roles, ...extra });
const cases = [L(['Insolvency Administrator']), L(['Voter of the General and Supervisory Board']), L(['Presidente do Conselho Fiscal']), L(['Representante']), L(['Sócio']), L(['Sócio'], { shCurrent: false }), L(['Gerente']), L(['Voter of the Board of Directors']), L(['Sócio', 'Financial Director']), L([], { shCurrent: true, shDirectPct: 60 }), L(['Gerente'], { shCurrent: true, shDirectPct: 30 })];
ok('the page ranks every case like the server (insolvency, supervisory, fiscal, representative, sócio with / without a stake record, gerente, board, owners)', cases.every((l) => Math.floor(P.relatedRank(l)) === Math.floor(deciderRank(l))));
if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
