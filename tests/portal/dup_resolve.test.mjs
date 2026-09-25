// Verifies the 2026-09-14 "Attach as match" feature -- lifted verbatim from
// search.html: classifyCompaniesImportRowsResolved() layers per-row human
// confirmations (companiesResolvedDups) on top of the untouched, pure
// classifyCompaniesImportRows(), moving a confirmed dup into `matched` in the
// exact shape the write path already expects. The algorithm's own strictness
// (never auto-resolving) is unchanged -- this only tests the new opt-in layer.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8');

function liftFn(name){
  const start = page.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(name + ' not found');
  let p = page.indexOf('(', start), pd = 0;
  do { if (page[p] === '(') pd++; else if (page[p] === ')') pd--; p++; } while (pd > 0);
  const braceStart = page.indexOf('{', p);
  let depth = 0, j = braceStart;
  do { if (page[j] === '{') depth++; else if (page[j] === '}') depth--; j++; } while (depth > 0);
  return (page.slice(start - 6, start) === 'async ' ? 'async ' : '') + page.slice(start, j);
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

function makeCtx(){
  const src = [
    liftFn('onlyDigits'), lineOf('const bvdIdKey = v =>'), lineOf("const foreignTaxIdKey = v =>"),
    liftFn('ptIdentity'), lineOf('const provablyDistinct ='),
    liftFn('deburr'), liftConst('LEGAL_FORM_RE'), liftFn('normName'),
    'let companies = [];',
    liftFn('classifyCompaniesImportRows'),
    'let companiesResolvedDups = new Map();',
    liftFn('classifyCompaniesImportRowsResolved'),
    'this.__x = { classifyCompaniesImportRowsResolved, setCompanies: a => { companies = a; }, resolve: (r, target) => companiesResolvedDups.set(r, target), clearResolved: () => { companiesResolvedDups = new Map(); } };',
  ].join('\n\n');
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script(src, { filename: 'lifted.js' }).runInContext(ctx);
  return ctx.__x;
}

let fail = 0;
const ok = (l, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${l}`); };

console.log('=== unresolved: behaves exactly like the plain classifier (no regression) ===');
{
  const X = makeCtx();
  X.setCompanies([{ id: 'existing1', name: 'Gallo World SA', foreignTaxId: 'IT01234567890' }]);
  const rows = [{ name: 'Gallo World SA', nifDigits: '508966442', bvdId: '', foreignTaxId: '', payload: { name: 'Gallo World SA' }, warnings: [] }];
  const { matched, dup, creatable } = X.classifyCompaniesImportRowsResolved(rows);
  ok('no existing PT identity to compare against -> still flagged as a possible duplicate, not auto-matched', dup.length === 1 && matched.length === 0);
  ok('the dup correctly names the existing company as the name hit', dup[0].existingNameHit?.id === 'existing1');
  ok('never silently created either', creatable.length === 0);
}

console.log('\n=== resolved: a confirmed dup moves into matched, in the write path\'s expected shape ===');
{
  const X = makeCtx();
  const existing = { id: 'existing1', name: 'Gallo World SA', foreignTaxId: 'IT01234567890' };
  X.setCompanies([existing]);
  const row = { name: 'Gallo World SA', nifDigits: '508966442', bvdId: '', foreignTaxId: '', payload: { name: 'Gallo World SA', nif: '508966442' }, warnings: [] };
  let { dup } = X.classifyCompaniesImportRowsResolved([row]);
  ok('starts unresolved, in dup', dup.length === 1);
  X.resolve(dup[0].r, dup[0].existingNameHit); // simulate clicking "Same company"
  const after = X.classifyCompaniesImportRowsResolved([row]);
  ok('moved out of dup', after.dup.length === 0);
  ok('moved into matched, same {r, match} shape a clean NIF match would have', after.matched.length === 1 && after.matched[0].r === row && after.matched[0].match === existing);
}

console.log('\n=== resolving one dup among several only resolves that one (select-all is per-row, not all-or-nothing by accident) ===');
{
  const X = makeCtx();
  const gallo = { id: 'e1', name: 'Gallo World SA', foreignTaxId: 'IT0001' };
  const inetum = { id: 'e2', name: 'Inetum Holding Business Solutions Portugal, S.A.', foreignTaxId: 'FR0002' };
  X.setCompanies([gallo, inetum]);
  const rowGallo = { name: 'Gallo World SA', nifDigits: '508966442', bvdId: '', foreignTaxId: '', payload: { name: 'Gallo World SA' }, warnings: [] };
  const rowInetum = { name: 'Inetum Holding Business Solutions Portugal, S.A.', nifDigits: '503882887', bvdId: '', foreignTaxId: '', payload: { name: 'Inetum Holding Business Solutions Portugal, S.A.' }, warnings: [] };
  const before = X.classifyCompaniesImportRowsResolved([rowGallo, rowInetum]);
  ok('both start as unresolved dups', before.dup.length === 2);
  X.resolve(rowGallo, gallo); // only resolve Gallo, leave Inetum untouched
  const after = X.classifyCompaniesImportRowsResolved([rowGallo, rowInetum]);
  ok('only Gallo moved to matched', after.matched.length === 1 && after.matched[0].match === gallo);
  ok('Inetum is still sitting in dup, untouched', after.dup.length === 1 && after.dup[0].r === rowInetum);
}

console.log('\n=== a within-file collision (no existingNameHit) can never be "resolved" -- nothing to attach to ===');
{
  const X = makeCtx();
  X.setCompanies([]);
  // Each needs SOME identifier to even be a "candidate" (an identifier-less
  // row goes to noId, not dup) -- but neither's identifier resolves to a
  // comparable PT identity, so they collide on name alone, same as two rows
  // sharing a foreign parent's name with no Portuguese registration yet.
  const rowA = { name: 'Ambiguous Co', nifDigits: '', bvdId: 'US1234567', foreignTaxId: '', payload: { name: 'Ambiguous Co' }, warnings: [] };
  const rowB = { name: 'Ambiguous Co', nifDigits: '', bvdId: '', foreignTaxId: 'FR7654321', payload: { name: 'Ambiguous Co' }, warnings: [] };
  const { dup } = X.classifyCompaniesImportRowsResolved([rowA, rowB]);
  ok('both flagged as a batch collision with no existingNameHit', dup.length === 2 && dup.every(d => !d.existingNameHit));
  // The UI never renders a checkbox/button for these (existingNameHit is falsy),
  // so this just confirms resolve() would be a no-op even if somehow called.
  X.resolve(rowA, null);
  const after = X.classifyCompaniesImportRowsResolved([rowA, rowB]);
  ok('resolving with no real target does not fabricate a match', after.matched.length === 0 && after.dup.length === 2);
}

console.log('\n=== resolutions don\'t leak across a fresh review (companiesResolvedDups reset) ===');
{
  const X = makeCtx();
  const existing = { id: 'e1', name: 'Gallo World SA', foreignTaxId: 'IT0001' };
  X.setCompanies([existing]);
  const row = { name: 'Gallo World SA', nifDigits: '508966442', bvdId: '', foreignTaxId: '', payload: { name: 'Gallo World SA' }, warnings: [] };
  X.resolve(row, existing);
  ok('resolved before reset', X.classifyCompaniesImportRowsResolved([row]).matched.length === 1);
  X.clearResolved(); // what handleCompaniesFile() / the "open import" click handler do on a fresh file
  ok('back to unresolved after a fresh file load', X.classifyCompaniesImportRowsResolved([row]).dup.length === 1);
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
