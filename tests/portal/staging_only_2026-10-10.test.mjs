// Staging restricted to partners and testers (10 Oct 2026): stagingAllowed() lifted
// from portal/access.js; guardPage and the investor page send everyone else to
// /portal/staging-only.html. Synthetic emails only.
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
const access = readFileSync(new URL('../../portal/access.js', import.meta.url), 'utf8');
const investor = readFileSync(new URL('../../portal/investor.html', import.meta.url), 'utf8');
let fail = 0;
const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
const i = access.indexOf('export function stagingAllowed('), j = access.indexOf('export async function guardPage(');
const src = access.slice(i, j).replace('export function', 'function').replace('flags = currentFlags()', 'flags = {}');
const s = {}; vm.createContext(s); vm.runInContext(src + '\nthis.f = stagingAllowed;', s);
const f = s.f;
const flags = { outreach: { staging: 'on', testers: ['tester@x.pt'] }, mobile: { testers: [] } };
ok('Admin, partner and the Admin previewing a role are allowed', f({ email: 'a@x.pt', role: 'admin', partner: true }, flags) && f({ email: 'p@x.pt', role: 'partner', partner: true }, flags) && f({ email: 'a@x.pt', role: 'preview', partner: false }, flags));
ok('someone named as a tester on any switch is allowed', f({ email: 'tester@x.pt', role: 'intern', partner: false }, flags));
ok('an intern / analyst not named, an investor, nobody: not allowed', !f({ email: 'intern@x.pt', role: 'intern', partner: false }, flags) && !f({ email: 'inv@fund.com', role: null, partner: false }, flags) && !f(null, flags));
ok('guardPage checks staging right after the feature switches load', /await startFeatures\(a\);[^\n]*\n\s*if \(SITE === 'staging' && !stagingAllowed\(a\)\) \{ window\.location\.href = '\/portal\/staging-only\.html'; return null; \}/.test(access));
ok('investor page checks it too', /if \(SITE === 'staging' && !stagingAllowed\(access\)\)/.test(investor) && existsSync(new URL('../../portal/staging-only.html', import.meta.url)));
if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nall staging-only tests passed');
