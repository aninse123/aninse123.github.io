// Verifies the 2026-09-16 fix for a real crash: importing a large real
// Orbis management/ownership export ("Export 16_09_2026 21_40 ppl mgr 1")
// threw "Maximum call stack size exceeded" the moment the file was chosen.
// Root cause: `out.push(...merged.values())` inside parsePeopleRows()'s
// duplicate-role-row merge step spreads a Map's values into a function
// call's arguments -- V8 caps how many arguments a single call can carry
// (in the tens of thousands), and a large file's merged map of unique
// person+company pairs blew straight past it. Fixed to a plain loop, which
// has no such ceiling.
//
// Lifts the literal merge block from parsePeopleRows() by anchor text +
// brace-matching (same technique used elsewhere this session for inline
// blocks that aren't their own named function), and drives it with a
// synthetic `out` array large enough to have actually crashed the old code
// -- not just "some" duplicates, but past V8's real argument-count ceiling.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8');

function liftBlock(anchor, endAnchor){
  const start = page.indexOf(anchor);
  if (start < 0) throw new Error('start anchor not found: ' + anchor);
  const end = page.indexOf(endAnchor, start);
  if (end < 0) throw new Error('end anchor not found: ' + endAnchor);
  return page.slice(start, end + endAnchor.length);
}

const mergeBlock = liftBlock(
  'const merged = new Map();',
  'for (const v of merged.values()) out.push(v);',
);
if (!mergeBlock.includes('for (const v of merged.values()) out.push(v);')){
  throw new Error('merge block did not capture the fixed loop -- confirmCompaniesImport()/parsePeopleRows() may have been refactored');
}
// Confirm the OLD crashing pattern is genuinely gone as a live statement
// (the fix's own comment mentions the old text for explanation, so this
// checks for it as an actual executable statement, not just anywhere in
// the file).
if (/[^/]\s*out\.push\(\.\.\.merged\.values\(\)\)/.test(mergeBlock.replace(/\/\/.*$/gm, ''))){
  throw new Error('the old spread-call pattern is still present as live code -- fix was not fully applied');
}

const src = [
  'let out;',
  // mergeBlock itself declares `let mergedDupes = 0;` (its own first line,
  // right after `const merged = new Map();`), so it's left to initialize
  // that binding on its own rather than pre-declaring it here too.
  `this.__x = { run: (rows) => { out = rows; ${mergeBlock} return { out, mergedDupes }; } };`,
].join('\n\n');
const ctx = { console, Map, Set };
vm.createContext(ctx);
new vm.Script(src, { filename: 'lifted.js' }).runInContext(ctx);
const { run } = ctx.__x;

let fail = 0;
const ok = (l, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${l}`); };

function makeRow(personId, companyId, extra = {}){
  return {
    personId, companyId, fileCompanyName: 'Co ' + companyId,
    isSh: false, isMgmt: true, mgmtRoles: ['Director'], alsoManager: false, alsoShareholder: false,
    mgmtCurrentFromFile: null, shDirectPct: null, shTotalPct: null, shDate: null,
    orbisRoleCount: null, mgmtLevel: null, uci: null, country: null, holderNif: null,
    entityType: 'person', birthDate: null, orbisAge: null,
    street: null, postcode: null, city: null, phone: null, website: null, email: null, fax: null,
    nationalId: null, nationality: null, mgmtBoard: null,
    ...extra,
  };
}

console.log('=== small case: correctness unchanged (a real duplicate-role merge still merges) ===');
{
  const rowA = makeRow('p1', 'c1', { isSh: true, isMgmt: false, mgmtRoles: [] });
  const rowB = makeRow('p1', 'c1', { isSh: false, isMgmt: true, mgmtRoles: ['Gerente'] });
  const { out, mergedDupes } = run([rowA, rowB]);
  ok('two role-rows for the same person+company merge into one', out.length === 1);
  ok('both facets present on the merged row', out[0].isSh === true && out[0].isMgmt === true);
  ok('roles unioned', out[0].mgmtRoles.includes('Gerente'));
  ok('mergedDupes counted the one collision', mergedDupes === 1);
}

console.log('\n=== large case: past V8\'s real argument-count ceiling -- this is exactly what crashed live ===');
{
  // 200,000 distinct person+company pairs -- comfortably past V8's spread-call
  // argument ceiling (tens of thousands), reproducing the real file's scale.
  const N = 200000;
  const rows = [];
  for (let i = 0; i < N; i++) rows.push(makeRow('p' + i, 'c' + i));
  let threw = null;
  let result;
  try { result = run(rows); } catch (e) { threw = e; }
  ok('does NOT throw "Maximum call stack size exceeded" (the real live crash)', threw === null);
  if (threw) console.log('   threw:', threw.message);
  ok('every one of the 200,000 unique rows survives the merge (none dropped)', result && result.out.length === N);
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
