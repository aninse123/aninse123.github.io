// Verifies the 2026-09-14 fix: confirmCompaniesImport()'s "updating" stage
// used to write every matched row unconditionally, even when the diffed
// payload held nothing but updatedAt (i.e. the row changed literally
// nothing) -- a full re-import of an unchanged file cost one write per
// matched company regardless. This lifts the literal build() callback
// passed to commitInChunks() for that stage (an inline arrow function, not a
// named one -- sliced out by matching braces from its exact source text,
// same idea as liftFn() elsewhere but for an anonymous callback) and runs it
// against fakes for its few dependencies (doc/serverTimestamp/fieldsEqual/
// computeFields/companySearchFields/naceDerive).
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

// Slice the literal (batch, { r, match }) => { ... } callback passed to
// commitInChunks() in the "updating" stage -- found by its unique anchor
// text, brace-matched from the arrow's own opening brace.
function liftUpdatingCallback(){
  const anchor = "const written = await commitInChunks(matched, COMPANY_IMPORT_CHUNK, (batch, { r, match }) => {";
  const start = page.indexOf(anchor);
  if (start < 0) throw new Error('updating-stage callback anchor not found -- confirmCompaniesImport() may have been refactored');
  const paramsEnd = page.indexOf('=> {', start) + '=> ('.length; // position right before the opening brace's own text
  const braceStart = page.indexOf('{', page.indexOf('=> {', start));
  let depth = 0, j = braceStart;
  do { if (page[j] === '{') depth++; else if (page[j] === '}') depth--; j++; } while (depth > 0);
  const fnStart = start + anchor.indexOf('(batch');
  return 'function updatingBuild' + page.slice(fnStart, j).replace(/^\(batch, \{ r, match \}\) =>/, '(batch, { r, match })');
}

function makeCtx(){
  const src = [
    liftFn('fieldsEqual'),
    liftFn('naceDerive'),
    // Minimal fakes for everything else this callback touches -- not the
    // subject of this test (computeFields/companySearchFields are already
    // covered by their own dedicated tests elsewhere).
    'function computeFields(co){ return { ...co }; }', // identity: no computed-field drift to worry about here
    "function companySearchFields(name){ return { nameKey: (name||'').toUpperCase() }; }",
    "function serverTimestamp(){ return '__SERVER_TS__'; }",
    "function doc(db, col, id){ return { col, id }; }",
    'let db = {};',
    liftUpdatingCallback(),
    'this.__x = { updatingBuild };',
  ].join('\n\n');
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script(src, { filename: 'lifted.js' }).runInContext(ctx);
  return ctx.__x.updatingBuild;
}

let fail = 0;
const ok = (l, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${l}`); };

function fakeBatch(){
  const sets = [];
  return { calls: sets, set: (ref, payload, opts) => sets.push({ ref, payload, opts }) };
}

console.log('=== nothing changed: skipped entirely, no write staged ===');
{
  const build = makeCtx();
  // nameKey must already match what companySearchFields() would (re)compute
  // from this same name -- otherwise the diff sees a "change" that's really
  // just this test fixture never having set it, not a real difference.
  const match = { id: 'co1', name: 'Foo, Lda', nif: '123456789', sector: 'Manufacturing', nameKey: 'FOO, LDA' };
  const r = { payload: { name: 'Foo, Lda', nif: '123456789' } }; // identical to what's already stored
  const batch = fakeBatch();
  const result = build(batch, { r, match });
  ok('build() returns false (commitInChunks treats this as "nothing to write", not counted in `written`)', result === false);
  ok('batch.set was never called -- no write staged at all', batch.calls.length === 0);
}

console.log('\n=== one field actually changed: writes ONLY that field (plus updatedAt), not the whole row ===');
{
  const build = makeCtx();
  const match = { id: 'co2', name: 'Bar SA', nif: '987654321', sector: 'Construction', hqAddress: 'Rua Antiga' };
  const r = { payload: { name: 'Bar SA', nif: '987654321', hqAddress: 'Rua Nova' } }; // only hqAddress differs
  const batch = fakeBatch();
  const result = build(batch, { r, match });
  ok('build() returns true -- a real change exists', result === true);
  ok('exactly one batch.set call staged', batch.calls.length === 1);
  const payload = batch.calls[0].payload;
  ok('payload carries the changed field', payload.hqAddress === 'Rua Nova');
  ok('payload carries updatedAt', payload.updatedAt === '__SERVER_TS__');
  ok('payload does NOT resend unchanged fields (name, nif) -- diff only, not the whole row', !('name' in payload) && !('nif' in payload));
}

console.log('\n=== a real change lands with merge:true, tolerating a since-deleted doc ===');
{
  const build = makeCtx();
  const match = { id: 'co3', name: 'Baz', nif: '111111111' };
  const r = { payload: { name: 'Baz Renamed', nif: '111111111' } };
  const batch = fakeBatch();
  build(batch, { r, match });
  ok('set() called with merge:true (not a plain update())', batch.calls[0].opts?.merge === true);
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
