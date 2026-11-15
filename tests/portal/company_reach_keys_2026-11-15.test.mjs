// Company contact details keep the people's email keys (15 Nov 2026, MCP gaps item 10): saving the company's
// own addresses (Contact details, the ★ primary swap) adds keys to emailKeys and never drops the ones
// savePersonReach added for the company's people. Runs the page's own helpers. Synthetic addresses.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const grab = (start, end = '\n}\n') => { const i = page.indexOf(start); if (i < 0) throw new Error(start); const j = page.indexOf(end, i); return page.slice(i, j + end.length); };
const ctx = {};
vm.createContext(ctx);
vm.runInContext([grab('function companyEmailKeys('), grab('function mergeEmailKeys('), 'globalThis.P = { companyEmailKeys, mergeEmailKeys };'].join('\n'), ctx);
const { P } = ctx;
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

// A company whose person's address was added by savePersonReach.
const company = { companyEmail: 'geral@empresa-x.pt' };
const personKeys = P.companyEmailKeys({ companyEmail: 'pedro.l@empresa-x.pt' });
const existing = [...new Set([...P.companyEmailKeys(company), ...personKeys])];
const saved = P.mergeEmailKeys(existing, P.companyEmailKeys({ ...company, contacts: [{ email: 'vendas@empresa-x.pt' }] }));
ok("adding a company address keeps the person's full address and its prefixes", saved.includes('pedro.l@empresa-x.pt') && personKeys.every((k) => saved.includes(k)));
ok('and adds the new address', saved.includes('vendas@empresa-x.pt') && saved.includes('ven'));
ok('no repeated keys', saved.length === new Set(saved).size);
ok('a company with no keys yet: just the new ones', JSON.stringify(P.mergeEmailKeys(undefined, ['abc'])) === '["abc"]' && JSON.stringify(P.mergeEmailKeys(null, null)) === '[]');

// Wiring: both company contact-detail saves merge instead of replacing.
const save = grab('async function saveCompanyReach(');
ok('saveCompanyReach merges with the existing keys', /mergeEmailKeys\(c\.emailKeys, companyEmailKeys\(/.test(save));
const swap = page.slice(page.indexOf('if (t.dataset.reachprimary)'), page.indexOf('if (t.dataset.reachedit)'));
ok('the ★ primary swap merges with the existing keys', /mergeEmailKeys\(c\.emailKeys, companyEmailKeys\(\{ \.\.\.c, \.\.\.r\.patch/.test(swap));

console.log(fail ? `\n${fail} FAILED` : '\nall company reach key tests passed');
process.exitCode = fail ? 1 : 0;
