// Verifies the 2026-09-12 changes in portal/search.html:
//  A. computeFields() is Orbis-first with the old Y1-Y5 grid as fallback.
//  B. foundedYear()/fitAge()/legalFormOf() prefer Orbis, fall back to old fields.
//  C. classifyCompaniesImportRows(): a shared name is no longer a duplicate when
//     both sides carry different Portuguese NIFs; everything else still is.
// Functions are lifted verbatim from search.html (brace-matched), not re-typed.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8');

function liftFn(name){
  const start = page.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(name + ' not found');
  const braceStart = page.indexOf('{', page.indexOf(')', start));
  let depth = 0, j = braceStart;
  do { if (page[j] === '{') depth++; else if (page[j] === '}') depth--; j++; } while (depth > 0);
  return page.slice(start, j);
}
function liftConst(name){
  const m = page.match(new RegExp(`const ${name}\\s*=\\s*`));
  if (!m) throw new Error(name + ' not found');
  let depth = 0, j = m.index;
  do {
    if ('{[('.includes(page[j])) depth++;
    else if ('}])'.includes(page[j])) depth--;
    else if (page[j] === ';' && depth === 0) break;
    j++;
  } while (j < page.length);
  return page.slice(m.index, j + 1);
}
const lineOf = prefix => { const s = page.indexOf(prefix); if (s < 0) throw new Error(prefix + ' not found'); return page.slice(s, page.indexOf('\n', s)); };

const src = [
  'function num(v){ const n = Number(v); return isFinite(n) ? n : 0; }',
  liftConst('DEFAULT_FIT'), // now carries .weights/.recencyWeights/.startingYears itself (2026-09-13)
  'let fitCriteria = { ...DEFAULT_FIT };',
  liftFn('ramp'), liftFn('trapezoid'), liftFn('foundedYear'), liftFn('fitAge'), liftFn('legalFormOf'),
  liftFn('hasOrbisFinData'), liftFn('computeOrbisFit'), liftFn('calcFit'),
  liftFn('legacyFinMetrics'), liftFn('orbisFinMetrics'),
  // computeFields minus its postcode geocoding tail (needs window lookup tables)
  liftFn('computeFields').replace(/\/\/ Geocode via[\s\S]*?return co;/, 'return co;'),
  // dup rule
  liftFn('onlyDigits'), lineOf('const bvdIdKey = v =>'), lineOf("const foreignTaxIdKey = v =>"),
  liftFn('ptIdentity'), lineOf('const provablyDistinct ='),
  liftFn('deburr'), liftConst('LEGAL_FORM_RE'), liftFn('normName'),
  'let companies = [];',
  liftFn('classifyCompaniesImportRows'),
  'this.__x = { computeFields, legacyFinMetrics, foundedYear, fitAge, legalFormOf, calcFit, computeOrbisFit, classifyCompaniesImportRows, ptIdentity, setCompanies: a => { companies = a; } };',
].join('\n\n');
const ctx = { console };
vm.createContext(ctx);
new vm.Script(src, { filename: 'lifted.js' }).runInContext(ctx);
const X = ctx.__x;

let fail = 0;
const ok = (l, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${l}`); };
const near = (a, b, eps = 1e-9) => a != null && b != null && Math.abs(a - b) < eps;

console.log('=== A. computeFields: Orbis first, old grid as fallback ===');
const orbisFin = {
  '2021': { operatingRevenue: 800,  ebitda: 80,  numberOfEmployees: 20 },
  '2022': { operatingRevenue: 900,  ebitda: 90,  numberOfEmployees: 22 },
  '2023': { operatingRevenue: 1000, ebitda: 100, numberOfEmployees: 24 },
  '2024': { operatingRevenue: 1100, ebitda: 110, numberOfEmployees: 25 },
  '2025': { operatingRevenue: 1210, ebitda: 121, numberOfEmployees: 26 },
};
const legacyFin = { Y1: { revenue: 5000000, ebitda: 500000, employees: 99 }, Y2: { revenue: 4500000, ebitda: 450000 }, Y3: { revenue: 4000000, ebitda: 400000 } };
{
  const c = X.computeFields({ orbisFinancials: orbisFin, financials: legacyFin, dateOfIncorporation: '1990-05-01' });
  ok('both present: revenue comes from Orbis latest year (1,210 th EUR -> 1,210,000)', c.computedRevenue === 1210000);
  ok('EBITDA from Orbis latest year', c.computedEBITDA === 121000);
  ok('employees from Orbis latest year', c.computedEmployees === 26);
  ok('margin = Orbis EBITDA / revenue', near(c.computedEBITDAMargin, 0.1));
  ok('source/year tagged orbis / 2025', c.computedFinSource === 'orbis' && c.computedFinYear === '2025');
  const orbis = X.computeOrbisFit(c);
  ok('growth (recent) equals the fit score window value (list and breakdown agree)', near(c.computedGrowthRecent, orbis.dims.growthRecent.value));
  ok('fitScore equals the Orbis fit score', c.fitScore === orbis.fitScore);
}
{
  const c = X.computeFields({ financials: legacyFin });
  ok('no Orbis data: revenue falls back to old Y1', c.computedRevenue === 5000000);
  ok('fallback tagged legacy, no year', c.computedFinSource === 'legacy' && c.computedFinYear === null);
  ok('fallback growth is the old Y1-vs-Y3 CAGR', near(c.computedGrowthRecent, Math.pow(5000000 / 4000000, 1 / 2) - 1));
}
{
  const c = X.computeFields({ financials: legacyFin });
  c.orbisFinancials = orbisFin;
  X.computeFields(c);
  ok('recomputing after Orbis arrives replaces every old value (none linger)', c.computedRevenue === 1210000 && c.computedEmployees === 26 && c.computedFinSource === 'orbis');
}
{
  const c = X.computeFields({ orbisFinancials: { '2025': { originalCurrency: 'EUR' } }, financials: legacyFin });
  ok('Orbis placeholder-only year (no revenue/EBITDA) does not count: old Y1 still used', c.computedRevenue === 5000000 && c.computedFinSource === 'legacy');
}
{
  const c = X.computeFields({ orbisFinancials: { '2022': { operatingRevenue: 500, ebitda: -20 } } });
  ok('stale Orbis-only company still shows its latest year (2022) and a negative EBITDA', c.computedRevenue === 500000 && c.computedEBITDA === -20000 && c.computedFinYear === '2022');
}
{
  const c = X.computeFields({});
  ok('no financials at all: everything null, source null', c.computedRevenue === null && c.computedEBITDA === null && c.computedFinSource === null);
  const lg = X.legacyFinMetrics(legacyFin);
  ok('legacyFinMetrics() alone still reports the old figures (Financials tab summary)', lg.computedRevenue === 5000000 && lg.computedEBITDA === 500000);
}

console.log('\n=== B. Founded / Company Age / Legal form ===');
ok('foundedYear prefers Orbis dateOfIncorporation', X.foundedYear({ dateOfIncorporation: '1987-03-12', yearFounded: 1990 }) === 1987);
ok('foundedYear falls back to old yearFounded (string or number)', X.foundedYear({ yearFounded: '2012' }) === 2012);
ok('foundedYear null when neither', X.foundedYear({}) === null);
ok('fitAge uses the Orbis date for an import-created company (yearFounded never set)', X.fitAge({ dateOfIncorporation: '2000-01-01' }) === new Date().getFullYear() - 2000);
{
  const withDoi = X.computeFields({ orbisFinancials: orbisFin, dateOfIncorporation: '1980-01-01' });
  const without = X.computeFields({ orbisFinancials: orbisFin });
  ok('an old incorporation date now raises the fit score (Age dimension no longer 0)', withDoi.fitScore > without.fitScore);
}
ok('legalFormOf prefers Orbis nationalLegalForm', X.legalFormOf({ nationalLegalForm: 'Public limited company - SA', legalForm: 'x' }) === 'Public limited company - SA');
ok('legalFormOf falls back to old legalForm', X.legalFormOf({ legalForm: 'Limited liability company - LDA' }) === 'Limited liability company - LDA');
ok('legalFormOf empty string when neither', X.legalFormOf({}) === '');

console.log('\n=== C. Duplicate rule ===');
const row = (name, nif, bvd, extra = {}) => ({ payload: { name }, nifDigits: nif || '', bvdId: bvd || '', foreignTaxId: extra.ftid || '', warnings: [] });
const bucketOf = (res, r) => res.matched.some(x => x.r === r) ? 'matched' : res.creatable.some(x => x.r === r) ? 'creatable' : res.dup.some(x => x.r === r) ? 'dup' : 'noId';
ok('ptIdentity: 9-digit NIF', X.ptIdentity('500123456', '') === '500123456');
ok('ptIdentity: NIF inside a PT BvD ID', X.ptIdentity('', 'pt500123456') === '500123456');
ok('ptIdentity: a 14-digit CNPJ in the NIF field proves nothing', X.ptIdentity('05558076000150', '') === '');
{
  X.setCompanies([{ id: 'e1', name: 'PIZARRO, S.A.', nif: '501874291' }]);
  const r = row('PIZARRO - SGPS, S.A.', '510027482', 'PT510027482');
  const res = X.classifyCompaniesImportRows([r]);
  ok('holding vs operating company: same normalized name, different PT NIFs -> created', bucketOf(res, r) === 'creatable');
}
{
  X.setCompanies([{ id: 'e1', name: 'ROPRE, LDA' }]);
  const r = row('ROPRE S.A', '502314710', 'PT502314710');
  ok('existing same-name company with no identifier -> still a possible duplicate', bucketOf(X.classifyCompaniesImportRows([r]), r) === 'dup');
}
{
  X.setCompanies([{ id: 'e1', name: 'ENDUTEX SGPS SA', nif: '05558076000150' }]);
  const r = row('ENDUTEX - SGPS, S.A.', '500098115', 'PT500098115');
  ok('existing same-name company carrying a Brazilian CNPJ -> still a possible duplicate', bucketOf(X.classifyCompaniesImportRows([r]), r) === 'dup');
}
{
  X.setCompanies([{ id: 'e1', name: 'MARQUES, LDA', nif: '500809240' }]);
  const r = row('MARQUES, UNIPESSOAL, LDA', '', 'PT500381992');
  ok('row with only a PT BvD ID vs different existing NIF -> created (BvD carries the NIF)', bucketOf(X.classifyCompaniesImportRows([r]), r) === 'creatable');
}
{
  X.setCompanies([{ id: 'e1', name: 'ACME LDA', nif: '500000001' }, { id: 'e2', name: 'ACME, S.A.' }]);
  const r = row('ACME UNIPESSOAL LDA', '500000002', 'PT500000002');
  const res = X.classifyCompaniesImportRows([r]);
  ok('name shared by one distinct company and one without identifier -> ambiguous, still a duplicate', bucketOf(res, r) === 'dup');
  ok('the duplicate points at the ambiguous (no-identifier) company', res.dup[0].existingNameHit && res.dup[0].existingNameHit.id === 'e2');
}
{
  X.setCompanies([]);
  const a = row('BETA LDA', '500000011', 'PT500000011'), b = row('BETA, S.A.', '500000029', 'PT500000029');
  const res = X.classifyCompaniesImportRows([a, b]);
  ok('two rows in one file, same name, different PT NIFs -> both created', bucketOf(res, a) === 'creatable' && bucketOf(res, b) === 'creatable');
}
{
  X.setCompanies([]);
  const a = row('GAMMA LDA', '500000037', 'PT500000037'), b = row('GAMMA SA', '', '', { ftid: '12345678000199' });
  const res = X.classifyCompaniesImportRows([a, b]);
  ok('same name in one file, one side only a foreign tax ID -> both held back', bucketOf(res, a) === 'dup' && bucketOf(res, b) === 'dup');
}
{
  X.setCompanies([]);
  const a = row('DELTA LDA', '500000045', 'PT500000045'), b = row('DELTA TWO LDA', '500000045', 'PT500000045');
  const res = X.classifyCompaniesImportRows([a, b]);
  ok('same NIF twice in one file -> still a collision (unchanged)', bucketOf(res, a) === 'dup' && bucketOf(res, b) === 'dup');
}
{
  X.setCompanies([{ id: 'e9', name: 'OMEGA LDA', nif: '500000053' }]);
  const r = row('OMEGA LDA', '500000053', 'PT500000053');
  ok('same NIF as an existing company -> matched (unchanged)', bucketOf(X.classifyCompaniesImportRows([r]), r) === 'matched');
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
