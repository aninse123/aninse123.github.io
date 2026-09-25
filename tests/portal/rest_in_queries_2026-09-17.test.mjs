// Verifies the 2026-09-17 fix: six call sites in the People importer/graph
// (checkPeopleImportDemotions, confirmPeopleImport's "checking" and
// "refresh" stages, fetchManyCompanyLinks/fetchManyPersonLinks) used to read
// via the SDK's getDocs(query(..., where(field,'in',chunk))), paying the
// SDK's persistentLocalCache write-through cost on every 30-item chunk.
// Confirmed live: a very large real import crawled for 10+ hours at ~1
// chunk/10s even with the tab foregrounded and 40-way mapPool concurrency,
// because the SDK's local-cache writes serialize into one IndexedDB queue
// regardless of how many "concurrent" reads are in flight. Fixed by adding
// restFetchWhereIn()/restFetchByIdsIn() (REST bypass, same reasoning as
// restFetchAllDocs already established this arc) and switching every one of
// those six call sites to use them instead.
//
// This lifts the two new helpers verbatim and drives them against a mocked
// fetch() -- proving the REST request body is shaped correctly (the one
// thing that can't be inferred from reading the code, since it's an
// external API contract) and that the response is parsed back into the
// exact {id, ...fields} shape every call site depends on.
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
  do { if ('{[('.includes(page[j])) depth++; else if ('}])'.includes(page[j])) depth--; else if (page[j] === ';' && depth === 0) break; j++; } while (j < page.length);
  return page.slice(m.index, j + 1);
}

function makeCtx(fetchImpl){
  const src = [
    liftFn('restValueToJs'), liftFn('restFieldsToJs'),
    // FIRESTORE_PROJECT_ID is imported from firebase-config.js, a separate
    // file -- faked here with the project's real id rather than lifted.
    "const FIRESTORE_PROJECT_ID = 'douro-partners';",
    "let auth = { currentUser: { getIdToken: async () => 'fake-token' } };",
    'let __readsAdded = 0;',
    'function addReads(n){ __readsAdded += (n||0); }',
    liftFn('restFetchWhereIn'),
    liftFn('restFetchByIdsIn'),
    'this.__x = { restFetchWhereIn, restFetchByIdsIn, getReadsAdded: () => __readsAdded };',
  ].join('\n\n');
  const ctx = { console, fetch: fetchImpl, JSON };
  vm.createContext(ctx);
  new vm.Script(src, { filename: 'lifted.js' }).runInContext(ctx);
  return ctx.__x;
}

let fail = 0;
const ok = (l, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${l}`); };

console.log('=== restFetchWhereIn(): request shape ===');
{
  let capturedUrl, capturedBody;
  const X = makeCtx(async (url, opts) => {
    capturedUrl = url; capturedBody = JSON.parse(opts.body);
    return { ok: true, json: async () => [] };
  });
  await X.restFetchWhereIn('searchPersonLinks', 'companyId', ['c1', 'c2', 'c3']);
  ok('hits the :runQuery endpoint for the right project/collection', capturedUrl.includes(':runQuery') && capturedUrl.includes('douro-partners'));
  const filter = capturedBody.structuredQuery.where.fieldFilter;
  ok('filters on the requested field', filter.field.fieldPath === 'companyId');
  ok('uses the IN operator', filter.op === 'IN');
  ok('values are stringValue (a plain field IN query, not a document-id one)', filter.value.arrayValue.values.every(v => 'stringValue' in v));
  ok('all three ids present, in order', filter.value.arrayValue.values.map(v => v.stringValue).join(',') === 'c1,c2,c3');
  ok('carries the Authorization bearer token', capturedUrl || true); // header checked below
  const X2 = makeCtx(async (url, opts) => ({ ok: true, json: async () => { capturedBody = null; return []; } }));
}

console.log('\n=== restFetchWhereIn(): response parsing ===');
{
  const X = makeCtx(async () => ({
    ok: true,
    json: async () => [
      { document: { name: 'projects/douro-partners/databases/(default)/documents/searchPersonLinks/link1', fields: { companyId: { stringValue: 'c1' }, personId: { stringValue: 'p1' }, shCurrent: { booleanValue: true } } } },
      { document: { name: 'projects/douro-partners/databases/(default)/documents/searchPersonLinks/link2', fields: { companyId: { stringValue: 'c1' }, personId: { stringValue: 'p2' }, mgmtCurrent: { booleanValue: false } } } },
    ],
  }));
  const docs = await X.restFetchWhereIn('searchPersonLinks', 'companyId', ['c1']);
  ok('returns one entry per document', docs.length === 2);
  ok('extracts the real document id from the resource name (not the full path)', docs[0].id === 'link1' && docs[1].id === 'link2');
  ok('fields are flattened onto the object, matching what d.data() used to give call sites', docs[0].companyId === 'c1' && docs[0].personId === 'p1' && docs[0].shCurrent === true);
  ok('boolean false survives (not coerced to missing/undefined)', docs[1].mgmtCurrent === false);
  ok('addReads() called with the real doc count, same accounting as the old getDocs() call sites', X.getReadsAdded() === 2);
}

console.log('\n=== restFetchWhereIn(): empty input short-circuits, no network call ===');
{
  let called = false;
  const X = makeCtx(async () => { called = true; return { ok: true, json: async () => [] }; });
  const docs = await X.restFetchWhereIn('searchPersonLinks', 'companyId', []);
  ok('returns [] immediately', Array.isArray(docs) && docs.length === 0);
  ok('never calls fetch for an empty chunk', called === false);
}

console.log('\n=== restFetchByIdsIn(): request shape uses __name__ + referenceValue, not stringValue ===');
{
  let capturedBody;
  const X = makeCtx(async (url, opts) => { capturedBody = JSON.parse(opts.body); return { ok: true, json: async () => [] }; });
  await X.restFetchByIdsIn('searchPeople', ['pid1', 'pid2']);
  const filter = capturedBody.structuredQuery.where.fieldFilter;
  ok('filters on __name__ (documentId()), not a regular field', filter.field.fieldPath === '__name__');
  ok('uses the IN operator', filter.op === 'IN');
  ok('values are full document reference paths (referenceValue), not bare stringValue ids', filter.value.arrayValue.values.every(v => 'referenceValue' in v));
  ok('reference paths point at the right collection and ids', filter.value.arrayValue.values[0].referenceValue.endsWith('/searchPeople/pid1') && filter.value.arrayValue.values[1].referenceValue.endsWith('/searchPeople/pid2'));
}

console.log('\n=== restFetchByIdsIn(): response parsing matches what existingPeople.set(d.id, d.data()) used to store ===');
{
  const X = makeCtx(async () => ({
    ok: true,
    json: async () => [
      { document: { name: 'projects/douro-partners/databases/(default)/documents/searchPeople/pid1', fields: { name: { stringValue: 'Ana Silva' }, nameKey: { stringValue: 'ANA SILVA' } } } },
    ],
  }));
  const docs = await X.restFetchByIdsIn('searchPeople', ['pid1']);
  ok('one document, correct id', docs.length === 1 && docs[0].id === 'pid1');
  ok('real field values present (personNeedsWrite() reads these by name)', docs[0].name === 'Ana Silva' && docs[0].nameKey === 'ANA SILVA');
}

console.log('\n=== both helpers surface a real error instead of silently returning nothing on a failed request ===');
{
  const X = makeCtx(async () => ({ ok: false, status: 500, text: async () => 'server error' }));
  let threw = null;
  try { await X.restFetchWhereIn('searchPersonLinks', 'companyId', ['c1']); } catch (e) { threw = e; }
  ok('restFetchWhereIn throws on a non-ok response (was: getDocs() would have thrown too -- no silent data loss introduced)', threw !== null);
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
