// New template fields (13 Oct 2026): {{owner.greeting}} ("Exma. Senhora A e
// Exmo. Senhor B") and {{company.toCity}} ("a Lisboa / ao Porto / à Maia").
// Server (render.js / places.js) and page (outreach.html) give the same text.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require('../../functions/outreach/render.js');
const P = require('../../functions/outreach/places.js');
const page = readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const lift = (name) => { const a = page.indexOf(`function ${name}(`); let d = 0, i = page.indexOf('{', page.indexOf(')', a)); for (; ; i++) { if (page[i] === '{') d++; else if (page[i] === '}' && --d === 0) break; } return page.slice(a, i + 1); };
const line = (start) => { const a = page.indexOf(start); let i = page.indexOf('{', a), d = 0; if (start.startsWith('const IN_CITY')) { for (; ; i++) { if (page[i] === '{') d++; else if (page[i] === '}' && --d === 0) break; } return page.slice(a, page.indexOf(';', i) + 1); } return page.slice(a, page.indexOf('\n', a)); };
const ctx = {}; vm.createContext(ctx);
vm.runInContext([lift('joinOu'), lift('joinPt'), lift('ownerContext'), line('const IN_CITY = {'), line('const toCityOf ='), line('const inCityOf ='), 'globalThis.C = { ownerContext, toCityOf };'].join('\n'), ctx);
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

const two = { emailOwners: [{ name: 'Ana Oliveira', gender: 'F' }, { name: 'Alfredo Cunha', gender: 'M' }] };
ok('greeting, two owners: all named with their gender', R.buildContext({ company: two }).owner.greeting === 'Exma. Senhora Ana Oliveira e Exmo. Senhor Alfredo Cunha');
ok('greeting, one owner / unknown gender', R.buildContext({ company: { emailOwners: [{ name: 'Rui Lopes', gender: 'M' }] } }).owner.greeting === 'Exmo. Senhor Rui Lopes'
  && R.buildContext({ company: { emailOwners: [{ name: 'Sam Reis' }] } }).owner.greeting === 'Exmo(a). Senhor(a) Sam Reis');
ok('greeting, no owners → empty (the template fallback "Exmos. Senhores" applies)', R.buildContext({ company: {} }).owner.greeting === ''
  && R.renderTemplate('{{owner.greeting|Exmos. Senhores}},', R.buildContext({ company: {} })).text === 'Exmos. Senhores,');
ok('toCity: a Lisboa · ao Porto · à Maia · à Figueira da Foz; unknown → empty', P.toCityOf('Lisboa') === 'a Lisboa' && P.toCityOf('Porto') === 'ao Porto' && P.toCityOf('Maia') === 'à Maia' && P.toCityOf('Figueira da Foz') === 'à Figueira da Foz' && P.toCityOf('Xpto') === '');
ok('toCity in a template with fallback', R.renderTemplate('Podemos deslocar-nos {{company.toCity|às vossas instalações}}.', R.buildContext({ company: { concelho: 'Xpto' } })).text === 'Podemos deslocar-nos às vossas instalações.');
ok('page = server (greeting, toCity)', ctx.C.ownerContext(two).greeting === R.buildContext({ company: two }).owner.greeting
  && ['Lisboa', 'Porto', 'Maia', 'Funchal', 'Barreiro', 'Xpto'].every((c) => ctx.C.toCityOf(c) === P.toCityOf(c)));
ok('both fields offered in the field buttons with help', page.includes("'owner.greeting|Exmos. Senhores'") && page.includes("'company.toCity|às vossas instalações'"));
if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
