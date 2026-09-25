// Verifies the 2026-09-16 fix to parseCompanyProfileRow()'s latitude/
// longitude parsing: a bare parseFloat() used to stop at the "°" in Orbis's
// DMS-format coordinates (38° 44' 4.5" N) and silently keep only the
// whole-degree part -- confirmed live against a real 37,938-row export
// where 86.5% of coordinates were in this format, an error up to ~110km.
// Lifted verbatim from search.html: parseDmsOrDecimal() (the new converter)
// and parseCompanyProfileRow() itself, to prove the real row parser now
// calls it and populates payload.latitude/longitude correctly.
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
function liftConst(name){
  const m = page.match(new RegExp(`const ${name}\\s*=\\s*`));
  if (!m) throw new Error(name + ' not found');
  let depth = 0, j = m.index;
  do { if ('{[('.includes(page[j])) depth++; else if ('}])'.includes(page[j])) depth--; else if (page[j] === ';' && depth === 0) break; j++; } while (j < page.length);
  return page.slice(m.index, j + 1);
}

const src = [
  liftFn('onlyDigits'), liftFn('splitOrbisMultiValue'), liftFn('deburr'),
  liftConst('LEGAL_FORM_RE'), liftFn('normName'),
  liftFn('parseDmsOrDecimal'), liftFn('parseVatNumber'), liftFn('companiesColIndex'),
  liftFn('parseCompanyProfileRow'),
  'this.__x = { parseDmsOrDecimal, companiesColIndex, parseCompanyProfileRow };',
].join('\n\n');
const ctx = { console, String, Number, parseFloat };
vm.createContext(ctx);
new vm.Script(src, { filename: 'lifted.js' }).runInContext(ctx);
const { parseDmsOrDecimal } = ctx.__x;

let fail = 0;
const ok = (l, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${l}`); };
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

console.log('=== plain decimal, unaffected by the fix ===');
ok('positive decimal', parseDmsOrDecimal('38.7346') === 38.7346);
ok('negative decimal', parseDmsOrDecimal('-9.1393') === -9.1393);
ok('integer-looking decimal', parseDmsOrDecimal('38') === 38);

console.log('\n=== DMS with hemisphere letter -- the real bug case ===');
{
  const v = parseDmsOrDecimal('38° 44\' 4.5" N');
  ok('38° 44\' 4.5" N -> 38.7346° (was silently truncated to 38 before this fix)', close(v, 38 + 44/60 + 4.5/3600));
  ok('specifically NOT the old truncated-to-38 behavior', Math.abs(v - 38) > 0.5);
}
{
  const v = parseDmsOrDecimal('9° 8\' 24.3" W');
  ok('9° 8\' 24.3" W -> negative (West), ~-9.1401°', close(v, -(9 + 8/60 + 24.3/3600)));
}
{
  const v = parseDmsOrDecimal('40° 12\' 30" S');
  ok('South hemisphere also negates', v < 0 && close(v, -(40 + 12/60 + 30/3600)));
}
{
  const v = parseDmsOrDecimal('9° 8\' 24.3" E');
  ok('East stays positive', v > 0 && close(v, 9 + 8/60 + 24.3/3600));
}

console.log('\n=== DMS edge shapes ===');
ok('degrees + minutes, no seconds', close(parseDmsOrDecimal('38° 44\' N'), 38 + 44/60));
ok('degrees only, with ° and hemisphere', close(parseDmsOrDecimal('38° N'), 38));
ok('no hemisphere letter, negative degrees carry the sign', close(parseDmsOrDecimal('-9° 8\' 24.3"'), -(9 + 8/60 + 24.3/3600)));
ok('º (ordinal masculine) as the degree symbol also matches (seen in some real exports)', close(parseDmsOrDecimal('38º 44\' 4.5" N'), 38 + 44/60 + 4.5/3600));
ok('curly prime/double-prime marks also match', close(parseDmsOrDecimal('38° 44′ 4.5″ N'), 38 + 44/60 + 4.5/3600));

console.log('\n=== garbage / empty ===');
ok('empty string -> null', parseDmsOrDecimal('') === null);
ok('null input -> null', parseDmsOrDecimal(null) === null);
ok('unparseable garbage -> null', parseDmsOrDecimal('not a coordinate') === null);

console.log('\n=== the real row parser now uses this, end to end ===');
{
  const { companiesColIndex, parseCompanyProfileRow } = ctx.__x;
  const headers = ['company name latin alphabet', 'latitude', 'longitude'];
  const COMPANY_ALIAS_PROFILE_STUB = { companyName: ['company name latin alphabet'], latitude: ['latitude'], longitude: ['longitude'] };
  const idx = {};
  for (const k of Object.keys(COMPANY_ALIAS_PROFILE_STUB)) idx[k] = companiesColIndex(headers, COMPANY_ALIAS_PROFILE_STUB, k);
  const { payload } = parseCompanyProfileRow(idx, ['Kopke Group Fine Wines, S.A.', '38° 44\' 4.5" N', '9° 8\' 24.3" W']);
  ok('payload.latitude is the real converted decimal, not the old truncated "38"', close(payload.latitude, 38 + 44/60 + 4.5/3600));
  ok('payload.longitude is negative (West) and fully converted', close(payload.longitude, -(9 + 8/60 + 24.3/3600)));
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
