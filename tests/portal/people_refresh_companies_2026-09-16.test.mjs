// Verifies the 2026-09-16 fix to Import People's "Refreshing company list"
// stage: it used to call loadCompaniesWithProgress() after creating missing
// companies, which is a no-op for that specific purpose whenever the
// 25-minute full-dataset cache is still fresh -- that path merges CACHED
// (necessarily pre-import) docs into `companies`, so a company created
// moments ago could never appear via it. Fixed to push the newly-created
// companies into the in-memory `companies` array directly, using the exact
// same fields just staged to Firestore -- no read needed at all.
//
// Lifts the literal `if (toCreate.length){ ... }` block from inside
// confirmPeopleImport() by anchor text + brace-matching (same technique as
// test_import_noop_write_skip.mjs's inline-callback lift, scaled to a
// multi-statement block instead of one arrow function), and runs it against
// fakes for everything it touches.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8');

function liftBlock(anchor){
  const start = page.indexOf(anchor);
  if (start < 0) throw new Error('anchor not found: ' + anchor + ' -- confirmPeopleImport() may have been refactored');
  const braceStart = page.indexOf('{', start);
  let depth = 0, j = braceStart;
  do { if (page[j] === '{') depth++; else if (page[j] === '}') depth--; j++; } while (depth > 0);
  return page.slice(start, j);
}
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
function liftConst(name){
  const m = page.match(new RegExp(`const ${name}\\s*=\\s*`));
  if (!m) throw new Error(name + ' not found');
  let depth = 0, j = m.index;
  do { if ('{[('.includes(page[j])) depth++; else if ('}])'.includes(page[j])) depth--; else if (page[j] === ';' && depth === 0) break; j++; } while (j < page.length);
  return page.slice(m.index, j + 1);
}

const liftedIf = liftBlock('if (toCreate.length){');
const src = [
  // Minimal fakes for everything the lifted block references, EXCEPT
  // normName -- lifted for real (with its deburr/LEGAL_FORM_RE dependencies)
  // since the dedup `key` in computePeopleCreationCandidates() (and hence
  // what this test must match rows against) is normName(fileCompanyName)
  // for any row with no NIF; a hand-rolled stand-in risks silently testing
  // against different normalization than what ships.
  'let companies = [];',
  "function companySearchFields(name){ return { nameKey: (name||'').toUpperCase() }; }",
  liftFn('deburr'), liftConst('LEGAL_FORM_RE'), liftFn('normName'),
  'function computeFields(co){ return { ...co }; }', // identity: computed-field derivation isn't the subject of this test
  "let currentUser = 'test@example.com';",
  "function serverTimestamp(){ return '__SERVER_TS__'; }",
  'function doc(col){ return { id: "id_" + (doc.n = (doc.n||0) + 1) }; }',
  'function collection(db, name){ return name; }',
  'let db = {};',
  'function cacheCompanies(){ this.__cacheCalls = (this.__cacheCalls||0) + 1; }',
  "function stoppedSummary(stageLabel){ return 'Stopped during \"' + stageLabel + '\"'; }",
  // commitInChunks: real shape (build(batch,item) staging, returns count written),
  // but without real Firestore -- batch.set just records what was staged.
  `async function commitInChunks(items, chunkSize, build, opts){
     const batch = { calls: [], set(ref, payload){ this.calls.push({ ref, payload }); } };
     let written = 0;
     for (const item of items) if (build(batch, item)) written++;
     return written;
   }`,
  // ImportProgress: record stage transitions so the test can assert on them
  // without caring about the real progress-bar UI.
  `const ImportProgress = { stages: [], beginStage(id){ this.stages.push({ id, event: 'begin' }); }, tick(){}, finishStage(id, msg){ this.stages.push({ id, event: 'finish', msg }); }, stopped(){ this.stages.push({ event: 'stopped' }); } };`,
  // The lifted block references toCreate/rows/skippedNote/tally/cancelToken
  // as free variables (exactly as it does inside confirmPeopleImport(),
  // where they're locals of the enclosing function) -- declared here so
  // run()'s IIFE can assign and close over them.
  'let toCreate, rows, skippedNote, tally, cancelToken;',
  `this.__x = { run: async (ctx) => {
     companies = []; // fresh per call -- each scenario starts from an empty in-memory list, not whatever a previous scenario left behind
     ImportProgress.stages = [];
     toCreate = ctx.toCreate; rows = ctx.rows; skippedNote = ctx.skippedNote; tally = ctx.tally; cancelToken = ctx.cancelToken;
     await (async () => { ${liftedIf} })();
     return { companies, ImportProgressStages: ImportProgress.stages, tally };
   } };`,
].join('\n\n');
const ctx = { console, Date };
vm.createContext(ctx);
new vm.Script(src, { filename: 'lifted.js' }).runInContext(ctx);
const { run } = ctx.__x;

let fail = 0;
const ok = (l, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${l}`); };

console.log('=== newly-created companies land in `companies` directly, no reload/cache dependency ===');
{
  const row1 = { unmatched: true, companyNif: '', fileCompanyName: 'Nova Empresa, Lda' };
  const row2 = { unmatched: true, companyNif: '500000026', fileCompanyName: 'Outra Nova SA' };
  // Keys must match what the real normName()/companyNif logic in
  // computePeopleCreationCandidates() would actually produce -- row1 has no
  // NIF, so its key is normName(fileCompanyName) (strips punctuation/legal
  // forms), not a hand-typed guess at it.
  const toCreate = [
    { key: 'nova empresa', r: row1, attachTo: null }, // normName('Nova Empresa, Lda') -- "lda" stripped as a legal form
    { key: '500000026', r: row2, attachTo: null },
  ];
  const rows = [row1, row2];
  const tally = { companiesAdded: 0 };
  const cancelToken = { cancelled: false };
  const result = await run({ toCreate, rows, skippedNote: '', flagged: [], tally, cancelToken });

  ok('exactly 2 companies pushed into the in-memory list', result.companies.length === 2);
  ok('pushed companies carry the right names', result.companies.some(c => c.name === 'Nova Empresa, Lda') && result.companies.some(c => c.name === 'Outra Nova SA'));
  ok('pushed companies carry sourceType ownership_import', result.companies.every(c => c.sourceType === 'ownership_import'));
  ok('the NIF-carrying row\'s new company got its NIF', result.companies.find(c => c.name === 'Outra Nova SA').nif === '500000026');
  ok('the no-NIF row\'s new company has nif:null (not undefined/omitted)', result.companies.find(c => c.name === 'Nova Empresa, Lda').nif === null);
  ok('each pushed company has a real id (from the same ref used for the Firestore write)', result.companies.every(c => typeof c.id === 'string' && c.id.startsWith('id_')));
  ok('the file rows themselves got companyId assigned and unmatched cleared', row1.companyId && row1.unmatched === false && row2.companyId && row2.unmatched === false);
  ok('the row\'s companyId matches the pushed company\'s id (same ref)', result.companies.find(c => c.name === 'Nova Empresa, Lda').id === row1.companyId);
  ok('tally.companiesAdded reflects the real write count', result.tally.companiesAdded === 2);

  console.log('\n-- the fix removed the reload dependency entirely (no stage message claims a "reload") --');
  const refreshFinish = result.ImportProgressStages.find(s => s.id === 'refreshCompanies' && s.event === 'finish');
  ok('refreshCompanies stage finished with a message describing the direct add (not "done" -- the old, uninformative message that a stale-cache no-op would also have printed)', refreshFinish && /added directly/.test(refreshFinish.msg));
}

console.log('\n=== cancellation short-circuits BEFORE the in-memory push (already-correct behavior, confirmed unchanged) ===');
{
  const row1 = { unmatched: true, companyNif: '', fileCompanyName: 'Cancelled Co' };
  const toCreate = [{ key: 'cancelled co', r: row1, attachTo: null }];
  const rows = [row1];
  const tally = { companiesAdded: 0 };
  const cancelToken = { cancelled: true }; // already cancelled before this runs
  const result = await run({ toCreate, rows, skippedNote: '', flagged: [], tally, cancelToken });
  ok('companies list untouched when cancelled', result.companies.length === 0);
  ok('a "stopped" event was recorded, not a normal finish', result.ImportProgressStages.some(s => s.event === 'stopped'));
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
