// Outreach Phase 5a (people campaigns): parsePeopleRows(), whereIs(),
// mergePeople(), validEmail and projectionHtml(), lifted from outreach.html.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8');
function liftFn(name) {
  const start = page.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(name + ' not found');
  let p = page.indexOf('(', start), pd = 0;
  do { if (page[p] === '(') pd++; else if (page[p] === ')') pd--; p++; } while (pd > 0);
  const b = page.indexOf('{', p); let d = 0, j = b;
  do { if (page[j] === '{') d++; else if (page[j] === '}') d--; j++; } while (d > 0);
  return page.slice(start, j);
}
// Functions holding template literals with ${…} can't be brace-counted — cut at the closing line.
const liftToClose = (name) => { const i = page.indexOf(`function ${name}(`); if (i < 0) throw new Error(name); const m = /\r?\n    \}\r?\n/.exec(page.slice(i)); return page.slice(i, i + m.index + m[0].length); };
const line = (a) => { const i = page.indexOf(a); if (i < 0) throw new Error(a); return page.slice(i, page.indexOf('\n', i)); };
const ctx = {}; vm.createContext(ctx);
vm.runInContext([
  liftFn('esc'), line('const dayFmt ='), line('const num ='), line('const norm ='), line('const LIVE_ENROL ='), line('const validEmail ='),
  liftFn('parseCsv'), liftFn('parsePeopleRows'), liftFn('whereIs'), liftFn('mergePeople'), liftToClose('projectionHtml'),
  'var curEnrols = [], settings = null, senders = [];',
  'globalThis.api = { parsePeopleRows, whereIs, mergePeople, validEmail, projectionHtml, set: (k, v) => { if (k === "curEnrols") curEnrols = v; if (k === "settings") settings = v; if (k === "senders") senders = v; } };',
].join('\n'), ctx);
const { parsePeopleRows, whereIs, mergePeople, validEmail, projectionHtml, set } = ctx.api;
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

// Parsing
const withHeader = parsePeopleRows('Nome;Email;Empresa;Categoria\nAna Silva;ANA@Jornal.pt ;Jornal de Negócios;journalist');
ok('header in any order/language (PT), email lower-cased and trimmed', withHeader.length === 1 && withHeader[0].email === 'ana@jornal.pt' && withHeader[0].name === 'Ana Silva' && withHeader[0].org === 'Jornal de Negócios' && withHeader[0].category === 'journalist');
const noHeader = parsePeopleRows('rui@x.pt,Rui,Fundo X\nbad,Y,Z');
ok('no header → email, name, organisation columns', noHeader.length === 2 && noHeader[0].email === 'rui@x.pt' && noHeader[0].org === 'Fundo X');
ok('email validity', validEmail('a@b.pt') && !validEmail('bad') && !validEmail('a@b') && !validEmail('a b@c.pt'));

// Where an address already exists
const src = {
  crm: [{ email: 'ana@alfa.pt', name: 'Ana Pinto', org: 'Fundo Alfa', refs: [{ source: 'crm', id: 'inv1' }] }],
  portal: [{ email: 'ana@alfa.pt', name: 'Fundo Alfa', org: 'Fundo Alfa', refs: [{ source: 'portal', id: 'p1' }] }],
  network: [{ email: 'rui@jornal.pt', name: 'Rui', org: '', refs: [{ source: 'network', id: 'n1' }] }],
  brokers: [],
};
const w = whereIs(' ANA@alfa.pt', src);
ok('found in Investor CRM and portal', w.length === 2 && w.map(h => h.label).join('|') === 'Investor CRM|Portal investors');
ok('not found → empty', whereIs('new@x.pt', src).length === 0);

// Merge: one person per email, all records kept, first name/org win
const m = mergePeople([...src.crm, ...src.portal, ...src.network, { email: 'rui@jornal.pt', name: 'Rui J', org: 'Jornal', refs: [{ source: 'network', id: 'n1' }] }]);
const ana = m.find(p => p.email === 'ana@alfa.pt'), rui = m.find(p => p.email === 'rui@jornal.pt');
ok('merged by email, refs from both records', m.length === 2 && ana.refs.length === 2 && ana.name === 'Ana Pinto');
ok('same record twice → one ref; empty org filled from the other source', rui.refs.length === 1 && rui.org === 'Jornal');

// Projection (P4): effective pace = lowest of campaign limit, automations limit, address caps
set('settings', { automationBudget: 80, sendWindow: { days: [1, 2, 3, 4, 5] } });
set('senders', [{ id: 'andre.rocha@douropartners.pt', status: 'active', kind: 'relationship', dailyCap: 200 }, { id: 'x@mail.d.pt', status: 'active', dailyCap: 25 }]);
set('curEnrols', Array.from({ length: 150 }, (_, i) => ({ status: i < 100 ? 'pending' : 'active', currentStep: i < 140 ? 0 : 1 })));
const people = { audienceType: 'people', pacing: { maxPerDay: 40 }, senderPolicy: { mode: 'fixed', senderIds: ['andre.rocha@douropartners.pt'] }, steps: [{ name: 'Update', channel: 'email' }, { name: 'Follow-up', channel: 'email', wait: { days: 3 } }] };
const h = projectionHtml(people);
ok('people: pace 40 (own limit < 80 < 200); 140 still at step 1 (10 past it) → 4 sending days', /Effective pace: <b>40<\/b>/.test(h) && /1\. Update<\/td><td class="num">140<\/td><td class="num">4<\/td>/.test(h));
ok('step 2: all 150 still to go → 4 days, wait shown', /starts 3 working day\(s\)[^<]*<\/div><\/td><td class="num">150<\/td><td class="num">4<\/td>/.test(h));
const comp = { audienceType: 'companies', pacing: { newPerDay: 20 }, senderPolicy: { mode: 'owner_rotation' }, steps: [{ name: 'Email 1', channel: 'email' }, { name: 'Call', channel: 'call' }] };
const hc = projectionHtml(comp);
ok('companies: rotation ignores relationship senders (cap 25) and step 1 uses new-per-day (20): 140/20 = 7 days', /Effective pace: <b>25<\/b>/.test(hc) && /addresses' daily caps \(25\)/.test(hc) && /1\. Email 1<\/td><td class="num">140<\/td><td class="num">7<\/td>/.test(hc));
ok('task steps: no day estimate', /task — as fast as you do them/.test(hc));
ok('no steps yet → prompt', /Write the sequence first/.test(projectionHtml({ steps: [] })));

console.log(fail ? `\n${fail} FAILED` : '\nall people helper tests passed'); process.exit(fail ? 1 : 0);
