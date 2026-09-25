// Verifies the 2026-09-16 "Scan for corrupted NIF values" admin tool
// (Settings), lifted verbatim from search.html: isGenuineNif() and the
// build-payload logic inside fixBadNif()'s commitInChunks callback (lifted
// as a standalone slice via its unique anchor text, same technique used
// elsewhere this session for an inline callback).
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
  return page.slice(start, j);
}

// Slice the literal (batch, c) => {...} callback passed to commitInChunks()
// inside fixBadNif(), by its unique anchor text -- same brace-matching
// technique as liftFn(), just anchored on a substring instead of a
// `function name(` declaration.
function liftFixBadNifBuild(){
  const anchor = 'const written = await commitInChunks(badNifScanResults, 450, (batch, c) => {';
  const start = page.indexOf(anchor);
  if (start < 0) throw new Error('fixBadNif() callback anchor not found -- may have been refactored');
  const fnStart = start + anchor.indexOf('(batch');
  const braceStart = page.indexOf('{', start + anchor.indexOf('=> {'));
  let depth = 0, j = braceStart;
  do { if (page[j] === '{') depth++; else if (page[j] === '}') depth--; j++; } while (depth > 0);
  return 'function fixBadNifBuild' + page.slice(fnStart, j).replace(/^\(batch, c\) =>/, '(batch, c)');
}

const src = [
  liftFn('isGenuineNif'),
  "function serverTimestamp(){ return '__SERVER_TS__'; }",
  'function doc(db, col, id){ return { col, id }; }',
  'let db = {};',
  liftFixBadNifBuild(),
  'this.__x = { isGenuineNif, fixBadNifBuild };',
].join('\n\n');
const ctx = { console };
vm.createContext(ctx);
new vm.Script(src, { filename: 'lifted.js' }).runInContext(ctx);
const { isGenuineNif, fixBadNifBuild } = ctx.__x;

let fail = 0;
const ok = (l, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${l}`); };

console.log('=== isGenuineNif(): exactly 9 digits, nothing else ===');
ok('a clean 9-digit value is genuine', isGenuineNif('500000026') === true);
ok('a 14-digit CNPJ-shaped value is not genuine', isGenuineNif('05715373000162') === false);
ok('a too-short value is not genuine', isGenuineNif('12345') === false);
ok('empty/null is not genuine (callers guard on c.nif truthy separately)', isGenuineNif('') === false && isGenuineNif(null) === false);
ok('non-digit characters are not genuine', isGenuineNif('50000002A') === false);

function fakeBatch(){ const calls = []; return { calls, update: (ref, payload) => calls.push({ ref, payload }) }; }

console.log('\n=== fixBadNif() build callback: the real 151-company case (14-digit CNPJ, no existing foreignTaxId) ===');
{
  const c = { id: 'co1', name: 'BRISA AUTOESTRADAS DE PORTUGAL, SA', nif: '05715373000162' };
  const batch = fakeBatch();
  fixBadNifBuild(batch, c);
  ok('exactly one update staged', batch.calls.length === 1);
  const payload = batch.calls[0].payload;
  ok('nif cleared to null', payload.nif === null);
  ok('the bad value moved to foreignTaxId, not discarded', payload.foreignTaxId === '05715373000162');
  ok('tagged as a Brazilian CNPJ (matches the branch-code shape)', payload.foreignTaxIdType === 'BR-CNPJ' && payload.foreignTaxIdCountry === 'Brazil');
  ok('the in-memory company object is updated too (Object.assign), so the UI reflects it without a reload', c.nif === null && c.foreignTaxId === '05715373000162');
}

console.log('\n=== a company that already has its own Foreign tax ID is never clobbered ===');
{
  const c = { id: 'co2', name: 'Some Group PT Subsidiary', nif: '12345678000199', foreignTaxId: 'DE123456789', foreignTaxIdType: 'DE-VAT' };
  const batch = fakeBatch();
  fixBadNifBuild(batch, c);
  const payload = batch.calls[0].payload;
  ok('nif still cleared', payload.nif === null);
  ok('foreignTaxId is NOT touched by the payload at all -- the existing value survives untouched', !('foreignTaxId' in payload) && !('foreignTaxIdType' in payload));
}

console.log('\n=== a non-14-digit malformed value moves to foreignTaxId WITHOUT asserting BR-CNPJ (unknown shape, not assumed) ===');
{
  const c = { id: 'co3', name: 'Some Odd Case', nif: '1234567' }; // 7 digits, not the CNPJ shape
  const batch = fakeBatch();
  fixBadNifBuild(batch, c);
  const payload = batch.calls[0].payload;
  ok('nif cleared', payload.nif === null);
  ok('value moved to foreignTaxId', payload.foreignTaxId === '1234567');
  ok('type/country NOT asserted -- honest about not knowing what this is', !('foreignTaxIdType' in payload) && !('foreignTaxIdCountry' in payload));
}

console.log('\n=== every write carries updatedAt ===');
{
  const c = { id: 'co4', name: 'X', nif: '11111111111111' };
  const batch = fakeBatch();
  fixBadNifBuild(batch, c);
  ok('updatedAt present', batch.calls[0].payload.updatedAt === '__SERVER_TS__');
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
