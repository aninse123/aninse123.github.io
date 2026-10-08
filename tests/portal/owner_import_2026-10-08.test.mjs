// Tier & Contactable plan, Phase 1 (8 Oct 2026), lifted verbatim from
// search.html:
//  1. An owner-only Orbis file (GUO columns, no SH / DM columns) is accepted
//     as mode 'ownership' and fills ownershipMeta with the owner's country,
//     ticker, employees and revenue — the revenue unit read from the header.
//  2. A shareholders file keeps Orbis's full "SH - Type" on each row
//     (shTypeOrbis) and writes the company's distinct shareholder types
//     (shTypes) plus the countries of its family shareholders.
//  3. ownershipMetaPatch() never lets an empty value overwrite a stored one.
// Synthetic rows only — no real company data.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8');

function liftFn(name){
  const start = page.indexOf(`\nfunction ${name}(`) + 1;
  if (start < 1) throw new Error(name + ' not found');
  let p = page.indexOf('(', start), pd = 0;
  do { if (page[p] === '(') pd++; else if (page[p] === ')') pd--; p++; } while (pd > 0);
  const braceStart = page.indexOf('{', p);
  let depth = 0, j = braceStart, str = null, esc = false;
  do {
    const ch = page[j];
    if (str){ if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === str) str = null; }
    else if (ch === '"' || ch === "'" || ch === '`') str = ch;
    else if (ch === '/' && page[j + 1] === '/') { j = page.indexOf('\n', j); continue; }
    else if (ch === '{') depth++; else if (ch === '}') depth--;
    j++;
  } while (depth > 0);
  return page.slice(start, j);
}
function liftConst(name){
  const m = page.match(new RegExp(`\\nconst ${name}\\s*=\\s*`));
  if (!m) throw new Error(name + ' not found');
  const st = m.index + 1;
  if (page[st + m[0].length - 1] === '/') return page.slice(st, page.indexOf('\n', st));
  let depth = 0, j = page.indexOf(m[0].trim().endsWith('=') ? '' : '', st) + m[0].length - 1, str = null, esc = false;
  do {
    const ch = page[j];
    if (str){ if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === str) str = null; }
    else if (ch === '"' || ch === "'" || ch === '`') str = ch;
    else if (ch === '/' && page[j + 1] === '/') { j = page.indexOf('\n', j); continue; }
    else if ('{[('.includes(ch)) depth++;
    else if ('}])'.includes(ch)) depth--;
    j++;
  } while (depth > 0 && j < page.length);
  return page.slice(st, j) + ';';
}

let fail = 0;
const ok = (l, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${l}`); };

const src = [
  liftConst('PEOPLE_ALIAS'), liftConst('IMPORT_FIELD_GROUPS'), liftConst('FIELD_LABELS'),
  liftConst('PLACEHOLDER_HOLDERS'), liftConst('LEGAL_FORM_RE'), liftConst('PERSON_SALUT'),
  ...['deburr', 'onlyDigits', 'normName', 'pnum', 'ownPct', 'ownClean', 'ownNum', 'nifFromAny', 'personIdFrom',
      'personDocId', 'personNameKey', 'personDisplayName', 'packedLines', 'peopleColIndex', 'buildFieldReport',
      'orbisDate', 'orbisText', 'orbisAddress', 'parsePeopleRows', 'ownershipMetaPatch'].map(liftFn),
  'this.__x = { parsePeopleRows, ownershipMetaPatch, ownNum };',
].join('\n\n');
const ctx = { console, companies: [] };
vm.createContext(ctx);
new vm.Script(src, { filename: 'lifted.js' }).runInContext(ctx);
const { parsePeopleRows, ownershipMetaPatch, ownNum } = ctx.__x;

console.log('=== ownNum(): Orbis numbers and placeholders ===');
ok('plain integer', ownNum('161688') === 161688);
ok('decimal', ownNum('54617.0') === 54617);
ok('thousands separator', ownNum('1,234') === 1234);
ok('"-" is null', ownNum('-') === null);
ok('"n.a." is null', ownNum('n.a.') === null);
ok('text is null', ownNum('abc') === null);

console.log('=== Owner-only file (GUO columns, no people) ===');
ctx.companies = [
  { id: 'A', nif: '500000001', name: 'ALFA, LDA' },
  { id: 'B', nif: '500000002', name: 'BETA, S.A.' },
  { id: 'C', nif: '500000003', name: 'GAMA, LDA' },
];
const guoRows = [
  ['', 'Company name Latin alphabet', 'BvD ID number', 'VAT/Tax number', 'GUO - Name', 'GUO - BvD ID number', 'GUO - Type',
   'GUO - Country ISO code', 'GUO - Ticker symbol', 'GUO - Number of employees', 'GUO - Operating revenue (Turnover)\nm USD', 'GUO - Total assets\nm USD', 'GUO - Information date'],
  ['1.', 'ALFA, LDA', 'PT500000001', '500000001', 'BIG GROUP SE', 'FR111111111', 'Corporate', 'FR', 'BGS', '160000', '54617.0', '71482', '08/2026'],
  ['2.', 'BETA, S.A.', 'PT500000002', '500000002', 'MR JOAO EXEMPLO', 'WWCJP0001', 'One or more named individuals or families', 'PT', '-', '-', '-', '-', 'n.a.'],
  ['3.', 'GAMA, LDA', 'PT500000003', '500000003', '', '', '', '', '', 'n.a.', 'n.a.', 'n.a.', ''],
  ['4.', 'NOT IN CRM, LDA', 'PT500000099', '500000099', 'X HOLDING', 'PT500000098', 'Corporate', 'PT', '-', '12', '3.5', '2', '07/2026'],
];
const s1 = parsePeopleRows(guoRows);
const mA = s1.ownershipMeta.get('A'), mB = s1.ownershipMeta.get('B');
ok('mode is "ownership" (was: "No shareholder or director column" error)', s1.mode === 'ownership');
ok('no people rows are produced', s1.links === 0);
ok('revenue unit read from the header as million USD', s1.revUnit?.cur === 'Usd' && s1.revUnit?.div === 1);
ok('corporate owner: country, ticker, employees, revenue', mA && mA.guoCountry === 'FR' && mA.guoTicker === 'BGS' && mA.guoEmployees === 160000 && mA.guoRevenueMUsd === 54617);
ok('owner total assets, info date and own BvD ID (foreign owners too)', mA.guoAssetsMUsd === 71482 && mA.guoInfoDate === '08/2026' && mA.guoBvdId === 'FR111111111' && !mA.guoNif);
ok('person owner: type kept, no size figures', mB && /families/.test(mB.guoType) && mB.guoEmployees === null && mB.guoRevenueMUsd === null && mB.guoTicker === null);
ok('company with no owner gets no ownershipMeta', !s1.ownershipMeta.has('C'));
ok('company not in the CRM is reported, not created', s1.ownersUnmatched.length === 1 && s1.ownersUnmatched[0].nif === '500000099');
ok('listed count = 1', s1.withOwnerListed === 1);
ok('"Ultimate owner size" section is present', s1.fieldReport.find(g => g.title === 'Ultimate owner size')?.absent === false);

console.log('=== Revenue in thousand EUR is converted to million EUR ===');
{
  const rows = guoRows.map((r, i) => i === 0 ? r.map(h => h.replace('m USD', 'th EUR')) : r);
  rows[1] = [...rows[1]]; rows[1][10] = '250000';
  const s = parsePeopleRows(rows);
  ok('th EUR → guoRevenueMEur', s.ownershipMeta.get('A').guoRevenueMEur === 250 && s.ownershipMeta.get('A').guoRevenueMUsd === undefined);
}
{
  const rows = guoRows.map((r, i) => i === 0 ? r.map(h => h.replace('\nm USD', ' (odd unit)')) : r);
  const s = parsePeopleRows(rows);
  const f = s.fieldReport.find(g => g.title === 'Ultimate owner size').fields.find(x => x.key === 'guoRevenue');
  ok('unknown unit: revenue not stored, and the field map shows the column as missing', s.revUnit === null && !('guoRevenueMUsd' in s.ownershipMeta.get('A')) && f.found === false);
}

console.log('=== Shareholders file keeps the full Orbis type ===');
ctx.companies = [{ id: 'A', nif: '500000001', name: 'ALFA, LDA' }];
const shRows = [
  ['', 'Company name Latin alphabet', 'BvD ID number', 'VAT/Tax number', 'SH - Name', 'SH - BvD ID number', 'SH - Country ISO code', 'SH - Type', 'SH - Direct %'],
  ['1.', 'ALFA, LDA', 'PT500000001', '500000001',
   'MR ANA EXEMPLO\nMR HANS BEISPIEL\nFUNDO CAPITAL FCR\nSELF OWNED',
   'WWX1\nWWX2\nPT500000077\n',
   'PT\nDE\nPT\n',
   'One or more named individuals or families\nOne or more named individuals or families\nPrivate equity firm\nSelf ownership',
   '40\n30\n25\n5'],
];
const s2 = parsePeopleRows(shRows);
const m2 = s2.ownershipMeta.get('A');
const rows2 = ctx.peopleImportRows;
ok('each shareholder row carries shTypeOrbis', rows2.find(r => /FUNDO/.test(r.personName))?.shTypeOrbis === 'Private equity firm');
ok('a person shareholder keeps its family type', rows2.find(r => /ANA/i.test(r.personName))?.shTypeOrbis === 'One or more named individuals or families');
ok('company shTypes lists every distinct type, incl. aggregate lines', JSON.stringify(m2.shTypes) === JSON.stringify(['One or more named individuals or families', 'Private equity firm', 'Self ownership']));
ok('family shareholder countries collected (D9 fallback)', JSON.stringify(m2.familyShCountries) === JSON.stringify(['DE', 'PT']));
ok('treasury still read from the aggregate line', m2.treasuryPct === 5);

console.log('=== ownershipMetaPatch(): empty values never overwrite ===');
const p = ownershipMetaPatch({ guoName: 'X', guoCountry: null, cshKeys: [], shTypes: ['Corporate'], guoEmployees: 0 });
ok('null and empty arrays dropped; 0 and values kept', JSON.stringify(p) === JSON.stringify({ guoName: 'X', shTypes: ['Corporate'], guoEmployees: 0 }));

if (fail){ console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nall owner import tests passed');
