// Search CRM → "Add to campaign" (Phase 2a step 3b): buildFilterSpec() turns
// the list filters into the portable spec saved on the campaign. Lifted from
// search.html and run against stubbed filter inputs.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8');
function liftFn(name) {
  const start = page.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(name + ' not found');
  let p = page.indexOf('(', start), pd = 0;
  do { if (page[p] === '(') pd++; else if (page[p] === ')') pd--; p++; } while (pd > 0);
  const b = page.indexOf('{', p); let d = 0, j = b;
  do { if (page[j] === '{') d++; else if (page[j] === '}') d--; j++; } while (d > 0);
  return page.slice(start, j);
}
const inputs = {};
const ctx = {
  document: { getElementById: (id) => (id in inputs ? { value: inputs[id] } : null) },
  STAGES: { universe: { label: 'Universe' }, screened: { label: 'Screened' } },
  OWNER_LABELS: { andre: 'André' }, SOURCE_LABELS: { orbis: 'Orbis' },
};
vm.createContext(ctx);
vm.runInContext(liftFn('buildFilterSpec') + '; globalThis.b = buildFilterSpec;', ctx);
let fail = 0;
const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

ok('no filters → empty spec', ctx.b().spec.length === 0);
Object.assign(inputs, { stageFilter: 'universe', ownerFilter: 'andre', caeFilter: '25', nuts2Filter: 'Norte', revMin: '1000000', revMax: '', ebitdaMin: '', ebitdaMax: '500000', lastTouchFilter: 'never', websiteFilter: 'yes', searchInput: ' metal ' });
const r = ctx.b();
const f = Object.fromEntries(r.spec.map(x => [x.field, x]));
ok('stage / owner / region as eq', f.stage.op === 'eq' && f.stage.value === 'universe' && f.owner.value === 'andre' && f.nuts2.value === 'Norte');
ok('CAE as prefix', f.caeCode.op === 'prefix' && f.caeCode.value === '25');
ok('one-sided ranges as gte / lte (numbers)', f.computedRevenue.op === 'gte' && f.computedRevenue.value === 1000000 && f.computedEBITDA.op === 'lte' && f.computedEBITDA.value === 500000);
ok('never touched / has website as exists', f.lastTouchAt.op === 'exists' && f.lastTouchAt.value === false && f.website.value === true);
ok('search text trimmed', f.search.value === 'metal');
ok('readable label', /stage Universe/.test(r.label) && /owner André/.test(r.label) && /CAE 25\*/.test(r.label) && /revenue ≥ 1000000 €/.test(r.label));
Object.assign(inputs, { fitMin: '60', fitMax: '90', lastTouchFilter: '30' });
const r2 = Object.fromEntries(ctx.b().spec.map(x => [x.field, x]));
ok('two-sided range as between; touched within N days', JSON.stringify(r2.fitScore.value) === '[60,90]' && r2.fitScore.op === 'between' && r2.lastTouchAt.op === 'within_days' && r2.lastTouchAt.value === 30);
console.log(fail ? `\n${fail} FAILED` : '\nall filter-spec tests passed');
process.exit(fail ? 1 : 0);
