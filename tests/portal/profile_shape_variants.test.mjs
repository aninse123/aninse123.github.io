// Verifies the 2026-09-14 fix: a real Orbis Company Profile export configured
// with only industry/description columns (no address/contact block, so no
// Country column either) was rejected outright as "doesn't look like an
// Orbis company export". Two things needed fixing, both covered here:
//  1. detectCompanyExportShapes() only recognized the Profile shape via its
//     address column -- widened to also accept "Trade description in
//     original language" / "Products & services", which the narrower export
//     does carry.
//  2. parseCompanyProfileRow() hardcoded hasCountryColumn=true when calling
//     parseVatNumber() -- with no Country column at all, that read as
//     "Country column present but blank on every row", which silently
//     dropped every valid 9-digit NIF with no warning. Fixed to check
//     idx.country for real column presence.
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

const src = [
  liftFn('onlyDigits'),
  liftFn('splitOrbisMultiValue'),
  liftFn('detectCompanyExportShapes'),
  liftConst('COMPANY_ALIAS'),
  liftFn('companiesColIndex'),
  liftFn('parseVatNumber'),
  liftFn('parseDmsOrDecimal'), // parseCompanyProfileRow's lat/lng parsing depends on this since the 2026-09-16 DMS-coordinate fix
  liftFn('parseCompanyProfileRow'),
  'this.__x = { detectCompanyExportShapes, companiesColIndex, COMPANY_ALIAS, parseCompanyProfileRow };',
].join('\n\n');
const ctx = { console, String, Number, parseFloat };
vm.createContext(ctx);
new vm.Script(src, { filename: 'lifted.js' }).runInContext(ctx);
const { detectCompanyExportShapes, companiesColIndex, COMPANY_ALIAS, parseCompanyProfileRow } = ctx.__x;

let fail = 0;
const ok = (l, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${l}`); };

function buildIdx(headers){
  const idx = {};
  for (const k of Object.keys(COMPANY_ALIAS.profile)) idx[k] = companiesColIndex(headers, COMPANY_ALIAS.profile, k);
  return idx;
}

console.log('=== detectCompanyExportShapes: the narrower industry-info export ===');
{
  // The real file's actual header row (Search-summary-less "Results" sheet),
  // normalized lowercase the same way the real function does internally.
  const header = [
    'company name latin alphabet', 'bvd id number', 'vat/tax number',
    'trade description in original language', 'products & services', 'bvd sectors',
    'national industry classification', 'primary code(s) in national industry classification',
    'primary code in national industry classification - description',
    'secondary code(s) in national industry classification',
    'secondary code in national industry classification - description',
    'nace rev. 2 main section', 'nace rev. 2.1, core code (4 digits)',
    'nace rev. 2.1, core code - description', 'nace rev. 2.1, primary code(s)',
    'nace rev. 2.1, primary code(s) - description', 'nace rev. 2.1, secondary code(s)',
    'nace rev. 2.1, secondary code(s) - description', 'full overview', 'main activity',
    'main foreign countries or regions', 'main production sites', 'main distribution sites',
    'main customers',
  ];
  const shapes = detectCompanyExportShapes(header);
  ok('recognized as the profile shape (previously: rejected entirely)', shapes.includes('profile'));
  ok('not misdetected as any other shape', shapes.length === 1);
}

console.log('\n=== a file with the OLD anchor (address column) still works -- no regression ===');
{
  const header = ['company name latin alphabet', 'bvd id number', 'vat/tax number', 'address line 1 latin alphabet', 'country'];
  ok('still detected via the original address-column anchor', detectCompanyExportShapes(header).includes('profile'));
}

console.log('\n=== a genuinely unrelated file is still rejected ===');
{
  ok('a random header with none of the anchors detects no shapes', detectCompanyExportShapes(['name', 'email', 'phone']).length === 0);
}

console.log('\n=== parseCompanyProfileRow: NIF extraction with NO Country column at all ===');
{
  const headers = [
    'company name latin alphabet', 'bvd id number', 'vat/tax number',
    'trade description in original language', 'products & services',
  ];
  const idx = buildIdx(headers);
  ok('idx.country is -1 -- genuinely absent, not just blank', idx.country === -1);
  const vals = ['KOPKE GROUP FINE WINES, S.A.', 'PT500000026', '500000026', 'Producao e comercializacao de vinhos', 'Wines'];
  const { payload, nifDigits, warnings } = parseCompanyProfileRow(idx, vals);
  ok('a clean 9-digit VAT number is trusted as a NIF when there is no Country column to contradict it (previously silently dropped)', nifDigits === '500000026' && payload.nif === '500000026');
  ok('no spurious warning generated', warnings.length === 0);
  ok('the rest of the row still parses normally', payload.name === 'KOPKE GROUP FINE WINES, S.A.' && payload.bvdId === 'PT500000026' && payload.productsServices === 'Wines');
}

console.log('\n=== regression: WITH a Country column, the existing Portugal-gating behavior is unchanged ===');
{
  const headers = ['company name latin alphabet', 'bvd id number', 'vat/tax number', 'country', 'address line 1 latin alphabet'];
  const idx = buildIdx(headers);
  ok('idx.country found this time', idx.country !== -1);
  const ptRow = parseCompanyProfileRow(idx, ['Foo, Lda', 'PT500000026', '500000026', 'Portugal', 'Rua X']);
  ok('Portugal + 9 digits -> trusted as NIF, same as before', ptRow.nifDigits === '500000026');
  const foreignRow = parseCompanyProfileRow(idx, ['Bar SA', 'ES123456789', '123456789', 'Spain', 'Calle Y']);
  ok('same 9-digit shape but Country says Spain -> NOT trusted as a PT NIF (unchanged gating)', foreignRow.nifDigits === '' && foreignRow.warnings.length > 0);
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
