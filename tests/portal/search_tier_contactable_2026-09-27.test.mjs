// T6: the Search CRM's tierOf() gives the same tier as the server's
// (functions/outreach/campaign_util.js — used by dynamic audiences), and the
// tier / contactable filters become the portable campaign filter spec.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const U = require('../../functions/outreach/campaign_util.js');
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
  tierRules: [], document: { getElementById: (id) => (id in inputs ? { value: inputs[id] } : null) },
  STAGES: {}, OWNER_LABELS: {}, SOURCE_LABELS: {},
};
vm.createContext(ctx);
vm.runInContext(['deburr', 'ownTier', 'tierOf', 'buildFilterSpec', 'parseTierRuleRows', 'mergeTierRules'].map(liftFn).join(';\n') + ';\n' + page.match(/const TIER_TYPE_ALIASES = .*;/)[0] + '; globalThis.api = { tierOf, buildFilterSpec, parseTierRuleRows, mergeTierRules };', ctx);
const { tierOf, buildFilterSpec, parseTierRuleRows, mergeTierRules } = ctx.api;

let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
const rules = [
  { field: 'sector', value: 'Logistics', tier: 'B' }, { field: 'caeCode', value: '49', tier: 'C' }, { field: 'caeCode', value: '4941', tier: 'A' },
  { field: 'naceCode', value: '52.1', tier: 'A' }, { field: 'subSector', value: 'Road freight', tier: 'B' }, { field: 'sector', value: 'bad', tier: 'Z' },
];
const cases = [
  { caeCode: '49410', sector: 'Logistics' }, { caeCode: '49320', sector: 'Logistics' }, { sector: 'logistics' }, { subSector: 'Road Freight', sector: 'Logistics' },
  { naceCode: '52.10' }, { naceCode: '5210' }, { caeCode: '62010' }, { caeCode: '49410', targetTierManual: 'C' }, { targetTierManual: 'X', sector: 'bad' }, {},
  // F1: the tier set on the company is the old Priority field (a/b/c) and wins over the rules and the older targetTierManual
  { caeCode: '49410', priority: 'b' }, { priority: 'c', targetTierManual: 'A' }, { priority: 'x', sector: 'Logistics' }, { priority: null, targetTierManual: 'B' },
];
ok('page and server give the same tier in every case', cases.every(c => tierOf(c, rules) === U.tierOf(c, rules)));
ok('spot checks: 4941 → A, 49 → C, sector → B, NACE with or without dots → A, own choice wins, bad tier ignored', tierOf(cases[0], rules) === 'A' && tierOf(cases[1], rules) === 'C' && tierOf(cases[2], rules) === 'B' && tierOf(cases[4], rules) === 'A' && tierOf(cases[5], rules) === 'A' && tierOf(cases[7], rules) === 'C' && tierOf(cases[8], rules) === null);
ok('F1: tier set on the company (priority a/b/c) wins; older targetTierManual still read; bad value ignored', tierOf(cases[10], rules) === 'B' && tierOf(cases[11], rules) === 'C' && tierOf(cases[12], rules) === 'B' && tierOf(cases[13], rules) === 'B');
ok('F1: the Priority filter is gone from the filter spec', !/priorityFilter/.test(page));

// F1: tier rules from a CSV / Excel file
let imp = parseTierRuleRows([['Type', 'Value', 'Tier'], ['CAE', '4941', 'A'], ['NACE code', '49.41', 'tier b'], ['Sub-sector', 'Road freight', 'C'], ['Setor', 'Logística', 'b'], ['Region', 'Norte', 'A'], ['CAE', '', 'A'], ['CAE', '62', 'D'], ['', '', '']]);
ok('import: types (CAE / NACE / Sub-sector / Setor), "tier b", bad rows skipped with their row numbers, blank rows ignored', imp.rules.length === 4 && imp.rules[1].field === 'naceCode' && imp.rules[1].tier === 'B' && imp.rules[3].field === 'sector' && imp.rules[3].value === 'Logística' && JSON.stringify(imp.skipped) === '[6,7,8]');
ok('import: missing column names → a clear message', /type, value, tier/.test(parseTierRuleRows([['CAE', '4941', 'A']]).error || ''));
const merged = mergeTierRules([{ field: 'caeCode', value: '4941', tier: 'C' }, { field: 'sector', value: 'Retail', tier: 'B' }], imp.rules);
ok('import: same type + value replaced, others kept', merged.length === 5 && merged.find(r => r.field === 'caeCode' && r.value === '4941').tier === 'A' && merged.some(r => r.value === 'Retail'));
ok('imported rules give the same tier on page and server', cases.every(c => tierOf(c, merged) === U.tierOf(c, merged)));

Object.assign(inputs, { tierFilter: 'AB', contactableFilter: 'yes' });
let s = buildFilterSpec().spec;
const tf = s.find(x => x.field === 'targetTier'), cf = s.find(x => x.field === 'contactable');
ok('filters → spec: tier A or B (in), contactable (bool)', tf?.op === 'in' && JSON.stringify(tf.value) === '["A","B"]' && cf?.op === 'bool' && cf.value === true);
ok('the server reads that spec the same way', U.matchesFilterSpec({ targetTier: 'B' }, s) && !U.matchesFilterSpec({ targetTier: 'C' }, s) && !U.matchesFilterSpec({ targetTier: 'A', contactable: false }, s));
Object.assign(inputs, { tierFilter: 'none', contactableFilter: 'no' });
s = buildFilterSpec().spec;
ok('"no tier" and "not contactable"', U.matchesFilterSpec({ contactable: false }, s) && !U.matchesFilterSpec({ targetTier: 'A', contactable: false }, s) && !U.matchesFilterSpec({}, s));
console.log(fail ? `\n${fail} FAILED` : '\nall tier / contactable tests passed'); process.exit(fail ? 1 : 0);
