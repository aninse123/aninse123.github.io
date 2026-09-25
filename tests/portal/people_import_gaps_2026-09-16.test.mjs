// Verifies the 2026-09-16 People-import fixes, lifted verbatim from
// search.html:
//  1. nifFromAny() now requires an exact 9-digit NIF and a strict `PT`+9
//     BvD-ID shape -- previously it trusted ANY digit string (a 14-digit
//     Brazilian CNPJ included) as a NIF, and matched any 2-letter country
//     prefix + 6-12 digits as if it were a Portuguese one.
//  2. A new structural safety net: computePeopleCreationCandidates() flags
//     a "create missing company" candidate whose name looks like an
//     existing company under a reordered/extended name, instead of silently
//     creating a duplicate -- mirroring Import Companies' own
//     "possible duplicates" panel. A candidate with a real (9-digit) NIF
//     that matched nothing is always safe to create regardless of name
//     similarity.
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

let fail = 0;
const ok = (l, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${l}`); };

console.log('=== nifFromAny(): exact 9-digit NIF, strict PT+9 BvD-ID shape ===');
{
  const src = [liftFn('onlyDigits'), liftFn('nifFromAny'), 'this.__x = { nifFromAny };'].join('\n\n');
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script(src, { filename: 'lifted.js' }).runInContext(ctx);
  const { nifFromAny } = ctx.__x;

  ok('a clean 9-digit NIF is trusted', nifFromAny('500000026', '') === '500000026');
  ok('a 14-digit Brazilian CNPJ in the nif column is REJECTED, not truncated/trusted (was: trusted outright)',
    nifFromAny('12345678000199', '') === '');
  ok('a too-short digit string in the nif column is rejected (was: trusted outright)',
    nifFromAny('12345', '') === '');
  ok('a too-long non-CNPJ digit string is rejected', nifFromAny('123456789012', '') === '');
  ok('PT + 9 digits in the BvD ID is trusted when the nif column is empty', nifFromAny('', 'PT500000026') === '500000026');
  ok('a NON-Portuguese BvD ID with a 9-digit-shaped body is REJECTED (was: trusted for any 2-letter prefix)',
    nifFromAny('', 'US500000026') === '');
  ok('a BvD ID with the wrong digit count after PT is rejected (was: 6-12 digits accepted)',
    nifFromAny('', 'PT12345') === '' && nifFromAny('', 'PT1234567890') === '');
  ok('lowercase PT BvD ID still matches (case-insensitive per the existing .toUpperCase())', nifFromAny('', 'pt500000026') === '500000026');
}

console.log('\n=== computePeopleCreationCandidates(): possible-duplicate safety net ===');
{
  const src = [
    liftFn('deburr'), liftConst('LEGAL_FORM_RE'), liftFn('normName'),
    'let companies = [];',
    'let peopleResolvedCreationDups = new Map();',
    liftConst('GENERIC_BUSINESS_WORDS'),
    liftFn('buildCompanyNameTokenIndex'),
    liftFn('findPossibleDuplicateCompany'),
    liftFn('computePeopleCreationCandidates'),
    'this.__x = { computePeopleCreationCandidates, setCompanies: a => { companies = a; }, resolve: (key, co) => peopleResolvedCreationDups.set(key, co), clearResolved: () => { peopleResolvedCreationDups = new Map(); } };',
  ].join('\n\n');
  const ctx = { console };
  vm.createContext(ctx);
  new vm.Script(src, { filename: 'lifted.js' }).runInContext(ctx);
  const X = ctx.__x;

  const row = (fileCompanyName, companyNif = '') => ({ fileCompanyName, companyNif, unmatched: true });

  console.log('-- a genuinely new company (no name overlap with anything existing) is creatable --');
  {
    X.setCompanies([{ id: 'e1', name: 'Gallo World SA' }]);
    const { creatable, flagged } = X.computePeopleCreationCandidates([row('Totally Unrelated Firm, Lda')]);
    ok('goes to creatable, not flagged', creatable.length === 1 && flagged.length === 0);
    ok('attachTo is null (a real create, not an attach)', creatable[0].attachTo === null);
  }

  console.log('-- reordered-word name against an existing company is flagged, not auto-created --');
  {
    X.setCompanies([{ id: 'e2', name: 'Douro Partners Capital, SA' }]);
    const { creatable, flagged } = X.computePeopleCreationCandidates([row('Capital Douro Partners')]);
    ok('flagged as a possible duplicate', flagged.length === 1 && creatable.length === 0);
    ok('names the right existing company', flagged[0].dup.id === 'e2');
  }

  console.log('-- one name fully contained in another (extended variant) is flagged --');
  {
    X.setCompanies([{ id: 'e3', name: 'ABC Distribuição, Lda' }]);
    const { flagged } = X.computePeopleCreationCandidates([row('ABC Distribuição Norte')]);
    ok('flagged (>=2 shared words, smaller name fully contained)', flagged.length === 1 && flagged[0].dup.id === 'e3');
  }

  console.log('-- a single shared word never flags (avoids "Grupo"/"Sociedade" false positives) --');
  {
    X.setCompanies([{ id: 'e4', name: 'Grupo Alfa, SA' }]);
    const { creatable, flagged } = X.computePeopleCreationCandidates([row('Grupo Beta, Lda')]);
    ok('not flagged -- only "Grupo" overlaps, and it is a single word', flagged.length === 0 && creatable.length === 1);
  }

  console.log('-- generic PT business-descriptor words never flag two unrelated real companies (2026-09-16 tuning against a real 1,164-company export) --');
  {
    // Real pair from orbis-gap-companies-2026-09-14.csv that DID false-positive
    // before GENERIC_BUSINESS_WORDS was added -- shares only "sociedade" +
    // "construcoes" ("construction company", generically), nothing brand-specific.
    X.setCompanies([{ id: 'e8', name: 'M.J.D.I. - SOCIEDADE DE CONSTRUCOES, LDA' }]);
    const { creatable, flagged } = X.computePeopleCreationCandidates([row('FARROBO - SOCIEDADE DE CONSTRUCOES, S.A.')]);
    ok('not flagged -- "sociedade"/"construcoes" are generic, not distinguishing', flagged.length === 0 && creatable.length === 1);
  }

  console.log('-- a real NIF that matched nothing is ALWAYS creatable, even with a similar name (this session\'s own "different NIFs = different companies" rule) --');
  {
    X.setCompanies([{ id: 'e5', name: 'Douro Partners Capital, SA' }]);
    const { creatable, flagged } = X.computePeopleCreationCandidates([row('Capital Douro Partners', '500000026')]);
    ok('creatable despite the name-similarity hit, because it carries its own distinct NIF', creatable.length === 1 && flagged.length === 0);
  }

  console.log('-- resolving a flagged candidate ("Same company") turns it into an attach, not a create --');
  {
    X.clearResolved();
    X.setCompanies([{ id: 'e6', name: 'Douro Partners Capital, SA' }]);
    const rows = [row('Capital Douro Partners')];
    const before = X.computePeopleCreationCandidates(rows);
    ok('starts flagged', before.flagged.length === 1);
    X.resolve(before.flagged[0].key, before.flagged[0].dup); // simulate clicking "Same company"
    const after = X.computePeopleCreationCandidates(rows);
    ok('moved out of flagged', after.flagged.length === 0);
    ok('moved into creatable as an attach (attachTo set, not a real create)', after.creatable.length === 1 && after.creatable[0].attachTo?.id === 'e6');
  }

  console.log('-- resolutions do not leak across a fresh file (peopleResolvedCreationDups reset) --');
  {
    X.clearResolved(); // isolate from the previous block's resolution of the same candidate name
    X.setCompanies([{ id: 'e7', name: 'Douro Partners Capital, SA' }]);
    const rows = [row('Capital Douro Partners')];
    X.resolve(X.computePeopleCreationCandidates(rows).flagged[0].key, { id: 'e7' });
    ok('resolved before reset', X.computePeopleCreationCandidates(rows).creatable.length === 1);
    X.clearResolved(); // what openPeopleImport() does on a fresh file
    ok('back to flagged after a fresh file load', X.computePeopleCreationCandidates(rows).flagged.length === 1);
  }
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
