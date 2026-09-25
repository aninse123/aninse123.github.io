// Verifies the 2026-09-17 "Legal form" filter added to the main Search CRM
// list. Lifts legalFormOf() verbatim from search.html, and the filter
// predicate line added to getFiltered(), by anchor text.
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

// Confirm the new filter line is really in getFiltered(), not just added
// somewhere unrelated in the file.
const filterLine = "if (legalFormF && legalFormOf(c) !== legalFormF) return false;";
if (!page.includes(filterLine)) throw new Error('filter predicate not found in search.html -- getFiltered() may have been refactored');
const getFilteredIdx = page.indexOf('function getFiltered(');
const filterLineIdx = page.indexOf(filterLine);
if (!(getFilteredIdx > 0 && filterLineIdx > getFilteredIdx && filterLineIdx < getFilteredIdx + 4000)){
  throw new Error('filter predicate is not actually inside getFiltered() -- check placement');
}

// Confirm FILTER_INPUT_IDS and the dropdown population both reference the new field.
if (!page.includes("'legalFormFilter'")) throw new Error('legalFormFilter missing from FILTER_INPUT_IDS');
if (!page.includes('document.getElementById(\'legalFormFilter\').innerHTML')) throw new Error('dropdown population code not found');
if (!page.includes('<select class="filter-sel" id="legalFormFilter">')) throw new Error('the <select> element itself is missing from the HTML');

const src = [liftFn('legalFormOf'), 'this.__x = { legalFormOf };'].join('\n\n');
const ctx = { console };
vm.createContext(ctx);
new vm.Script(src, { filename: 'lifted.js' }).runInContext(ctx);
const { legalFormOf } = ctx.__x;

let fail = 0;
const ok = (l, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${l}`); };

console.log('=== legalFormOf(): Orbis-first, legacy fallback (unchanged, but the filter depends on it) ===');
ok('prefers nationalLegalForm when present', legalFormOf({ nationalLegalForm: 'Limited liability company - LDA', legalForm: 'Old Value' }) === 'Limited liability company - LDA');
ok('falls back to legacy legalForm when nationalLegalForm is absent', legalFormOf({ legalForm: 'Public limited company - SA' }) === 'Public limited company - SA');
ok('empty string when neither is present', legalFormOf({}) === '');

console.log('\n=== the actual filter predicate, replicated against real distinct values pulled live 2026-09-17 ===');
{
  // Real company objects shaped like what getFiltered() actually receives --
  // just enough fields for legalFormOf() plus a name, one per real distinct
  // value confirmed live against the production database earlier today.
  const REAL_LEGAL_FORMS = [
    'Limited liability company - LDA', 'Public limited company - SA',
    'One-person company with limited liability - LDA', 'Foreign company',
    'Association', 'Foundation', 'Cooperative company',
    'Sports public limited company - SAD', 'Partnership',
    'Body of public administration', 'Company with foreign rights',
    'County/region', 'State owned company', 'Foreign foundation/association',
  ];
  const companies = REAL_LEGAL_FORMS.map((f, i) => ({ id: 'c'+i, name: 'Co '+i, nationalLegalForm: f }));
  companies.push({ id: 'none', name: 'No legal form on file' }); // the 251 real companies with neither field set

  function applyFilter(companies, legalFormF){
    return companies.filter(c => {
      if (legalFormF && legalFormOf(c) !== legalFormF) return false;
      return true;
    });
  }

  ok('no filter selected -> everyone passes, including the one with no legal form', applyFilter(companies, '').length === companies.length);
  for (const form of REAL_LEGAL_FORMS){
    const result = applyFilter(companies, form);
    ok(`filtering on "${form}" returns exactly the one matching company`, result.length === 1 && result[0].name === companies.find(c => c.nationalLegalForm === form).name);
  }
  ok('a company with no legal form at all is excluded by any specific filter (never matches, never crashes)', applyFilter(companies, 'Association').every(c => c.id !== 'none'));
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
