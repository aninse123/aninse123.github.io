// Outreach Round 2 fixes, batch 1 (8 Oct 2026), lifted verbatim from the pages:
//  B3 — the company name index also carries the email name and Orbis "Also
//       known as" words (search.html companySearchFields / companyIndexFields),
//       while nameKey stays the legal name;
//  B2 — Compose normalises a search the same way (outreach.html searchKeyOf).
// Synthetic names only.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const search = readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8');
const outreach = readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8');

function liftFn(page, name){
  const start = page.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(name + ' not found');
  let p = page.indexOf('(', start), pd = 0;
  do { if (page[p] === '(') pd++; else if (page[p] === ')') pd--; p++; } while (pd > 0);
  let depth = 0, j = page.indexOf('{', p);
  do { if (page[j] === '{') depth++; else if (page[j] === '}') depth--; j++; } while (depth > 0);
  return page.slice(start, j);
}
const liftLine = (page, name) => { const i = page.indexOf(`const ${name} =`); return page.slice(i, page.indexOf('\n', i)); };

let fail = 0;
const ok = (l, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${l}`); };

const s = { console };
vm.createContext(s);
vm.runInContext([liftFn(search, 'deburr'), liftLine(search, 'LEGAL_FORM_RE'), liftFn(search, 'companySearchFields'), liftFn(search, 'companyAltNames'), liftFn(search, 'companyIndexFields'),
  'this.__x = { companySearchFields, companyAltNames, companyIndexFields };'].join('\n'), s);
const { companySearchFields, companyAltNames, companyIndexFields } = s.__x;

console.log('=== B3: email name and "also known as" in the name index ===');
const c = { name: 'ALFA SERVICOS DE SAUDE, LDA', emailName: 'ASF', akaName: 'Clínica Alfa; n.a.\nALFASAUDE' };
const f = companyIndexFields(c);
ok('nameKey stays the legal name', f.nameKey === companySearchFields(c.name).nameKey && !f.nameKey.includes('ASF'));
ok('email name is searchable (token + prefixes)', f.nameTokens.includes('ASF') && f.namePrefixes.includes('AS'));
ok('every "also known as" name is searchable, accents removed', f.nameTokens.includes('CLINICA') && f.nameTokens.includes('ALFASAUDE') && f.namePrefixes.includes('CLIN'));
ok('placeholders ("n.a.", "-") are ignored', JSON.stringify(companyAltNames({ akaName: 'n.a.; -' })) === '[]');
ok('without other names, exactly the old fields (mobile search parity)', JSON.stringify(companyIndexFields({ name: c.name })) === JSON.stringify(companySearchFields(c.name)));

console.log('=== B2: Compose search uses the same normalisation ===');
const o = { console };
vm.createContext(o);
vm.runInContext([liftLine(outreach, 'LEGAL_FORM_RE'), liftLine(outreach, 'deburr'), liftFn(outreach, 'searchKeyOf'), 'this.__x = { searchKeyOf };'].join('\n'), o);
const samples = ['Metalúrgica Silva, Lda.', 'CORTICAS PEREIRA - S.A.', 'José & Filhos Unipessoal', 'asf'];
ok('Compose search keys = Search CRM index keys', samples.every(x => { const a = o.__x.searchKeyOf(x), b = companySearchFields(x); return a.nameKey === b.nameKey && JSON.stringify(a.tokens) === JSON.stringify(b.nameTokens); }));
// The refine step in findCompanies(): every typed word must be a prefix of some indexed word.
const refine = (doc, q) => o.__x.searchKeyOf(q).tokens.every(tk => (doc.namePrefixes || []).includes(tk) || String(doc.nameKey || '').includes(tk));
ok('"asf" finds the company by its email name', refine(f, 'asf'));
ok('"clinica alf" finds it by "also known as" + partial word', refine(f, 'clinica alf'));
ok('"alfa porto" does not match (porto is nowhere)', !refine(f, 'alfa porto'));

if (fail){ console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nall outreach batch 1 tests passed');
