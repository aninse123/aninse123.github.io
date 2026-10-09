// Team fields (9 Oct 2026): the Outreach page's preview / letters / scripts use
// teamContext() lifted verbatim from outreach.html; it must match the server's
// (functions/outreach/render.js) in every case. Synthetic names only.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const R = require('../../functions/outreach/render.js');
const page = readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8');
const search = readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8');

function liftFn(src, name){
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(name + ' not found');
  let p = src.indexOf('(', start), pd = 0;
  do { if (src[p] === '(') pd++; else if (src[p] === ')') pd--; p++; } while (pd > 0);
  let j = src.indexOf('{', p), depth = 0;
  do { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; } while (depth > 0);
  return src.slice(start, j);
}
let fail = 0;
const ok = (l, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${l}`); };
const s = {}; vm.createContext(s);
vm.runInContext([liftFn(page, 'joinPt'), liftFn(page, 'teamContext'), 'this.__x = { teamContext };'].join('\n'), s);

const two = [{ key: 'andre', name: 'Ana Rocha', partner: true, active: true }, { key: 'antonio', name: 'Bruno Carvalho', partner: true, active: true }, { key: 'ines', name: 'Clara Silva', partner: false, active: true }, { key: 'old', name: 'Dora Left', partner: true, active: false }];
const three = [...two, { key: 'maria', name: 'Eva Costa', partner: true, active: true }];
const cases = [[two, 'andre'], [two, 'antonio'], [two, 'ines'], [two, null], [three, 'andre'], [three, 'ines'], [[], 'andre']];
ok('page preview = server for: each partner, the intern, no sender, three partners, empty Team', cases.every(([m, k]) => JSON.stringify(s.__x.teamContext(m, k)) === JSON.stringify(R.teamContext(m, k))));
const i = s.__x.teamContext(two, 'ines');
ok('intern: partners = both partners, partner empty, people who left are not listed', i.partners.fullNames === 'Ana Rocha e Bruno Carvalho' && i.partner.fullName === '' && !i.team.old);
ok('field buttons: sender.fullName replaces sender.name; partner / partners fields offered', /'sender\.fullName'/.test(page) && !/'sender\.name', 'sender\.phone'/.test(page) && /'partners\.fullNames'/.test(page) && /'partner\.fullName'/.test(page));
ok('Search CRM company email offers the same fields (team.<key> from Team)', /'sender\.fullName'/.test(search) && /'partners\.fullNames'/.test(search) && /team\.\$\{m\.key\}\.fullName/.test(search));

if (fail){ console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nall team field tests passed');
