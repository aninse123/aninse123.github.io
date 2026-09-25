// Outreach → Campaigns → "Add companies" CSV path (Phase 2a step 3a):
// parseCsv(), nifKey(), nameKey() and matchCsvRows(), lifted from
// outreach.html and run against a small in-memory company list.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8');

function liftBlock(anchor) {
  const start = page.indexOf(anchor);
  if (start < 0) throw new Error(anchor + ' not found');
  let p = page.indexOf('(', start), pd = 0;
  do { if (page[p] === '(') pd++; else if (page[p] === ')') pd--; p++; } while (pd > 0);
  const braceStart = page.indexOf('{', p);
  let depth = 0, j = braceStart;
  do { if (page[j] === '{') depth++; else if (page[j] === '}') depth--; j++; } while (depth > 0);
  return page.slice(start, j);
}
function liftLine(anchor) {
  const start = page.indexOf(anchor);
  if (start < 0) throw new Error(anchor + ' not found');
  return page.slice(start, page.indexOf('\n', start));
}

const src = [
  liftLine('const norm = (s) =>'),
  liftBlock('function parseCsv('),
  liftLine('const nifKey = (v) =>'),
  liftLine('const nameKey = (v) =>'),
  liftBlock('async function matchCsvRows('),
  'let companies = null; async function ensureCompanies(){}; function addReads(){}; function refreshReads(){};',
  'function getDocs(){ throw new Error("no firestore in test"); } function query(){} function collection(){} function where(){} const db = {};',
  'globalThis.api = { parseCsv, nifKey, nameKey, matchCsvRows, setCompanies: (c) => { companies = c; } };',
].join('\n');
const ctx = {}; vm.createContext(ctx); vm.runInContext(src, ctx);
const { parseCsv, nifKey, nameKey, matchCsvRows, setCompanies } = ctx.api;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); };

ok('semicolon CSV with quotes and BOM', JSON.stringify(parseCsv('﻿NIF;Nome\n500000001;"Silva; Filhos, Lda"\n')) === JSON.stringify([['NIF', 'Nome'], ['500000001', 'Silva; Filhos, Lda']]));
ok('comma CSV, escaped quotes, blank lines skipped', JSON.stringify(parseCsv('Name,Email\n\n"A ""B"" Lda",geral@ab.pt\r\n')) === JSON.stringify([['Name', 'Email'], ['A "B" Lda', 'geral@ab.pt']]));
ok('tab-separated (pasted from Excel)', parseCsv('NIF\tNome\n501\tX')[1][1] === 'X');
ok('NIF: PT prefix, spaces, dots → 9 digits; wrong length → empty', nifKey('PT 500.000.001') === '500000001' && nifKey('12345') === '');
ok('name key drops legal suffix, accents and punctuation', nameKey('Metalúrgica Silva, Lda.') === nameKey('METALURGICA SILVA LDA') && nameKey('Têxteis Norte S.A.') === 'texteis norte');

setCompanies([
  { id: 'c1', name: 'METALURGICA SILVA, LDA', nif: '500000001', companyEmail: 'geral@silva.pt' },
  { id: 'c2', name: 'TEXTEIS NORTE, S.A.', nif: '500000002', bvdId: 'PT500000002' },
  { id: 'c3', name: 'DUPLICADO, LDA', nif: '500000003' },
  { id: 'c4', name: 'DUPLICADO LDA', nif: '500000004' },
]);
const r = await matchCsvRows(parseCsv([
  'NIF;BvD ID;Email;Empresa',
  'PT500000001;;;',             // NIF
  ';pt500000002;;',             // BvD ID (case-insensitive)
  ';;GERAL@SILVA.PT;',          // email → same company as row 1 (deduped)
  ';;;Duplicado',               // two companies with this name → ambiguous
  ';;;Não Existe Lda',          // unmatched
  '999999999;;;Texteis Norte SA', // unknown NIF falls through to the name
].join('\n')));
ok('matched by NIF, BvD ID, email and name; duplicates collapse', r.matched.map(c => c.id).sort().join() === 'c1,c2' && r.rows === 6);
ok('unmatched and ambiguous rows reported by label', r.unmatched.join() === 'Não Existe Lda' && r.ambiguous.join() === 'Duplicado');
let headerErr = null;
try { await matchCsvRows(parseCsv('foo;bar\n1;2')); } catch (e) { headerErr = e.message; }
ok('no recognisable column → clear error', /column names/.test(headerErr || ''));

console.log(fail ? `\n${fail} FAILED` : '\nall campaign CSV tests passed');
process.exit(fail ? 1 : 0);
