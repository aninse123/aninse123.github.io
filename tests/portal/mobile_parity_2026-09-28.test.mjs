// Mobile app (portal/m/): the helpers copied from the desktop Search CRM are
// still identical to search.html's, and the server search normalises names
// exactly like the page that builds the search index.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const page = readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const helpers = readFileSync(new URL('../../portal/m/crm-helpers.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const server = require('../../functions/mobile/search.js')._internal;

function liftFn(src, name) {
  const m = new RegExp('^(async )?function ' + name + '\\(', 'm').exec(src); if (!m) return null;
  let p = src.indexOf('(', m.index), pd = 0;
  do { if (src[p] === '(') pd++; else if (src[p] === ')') pd--; p++; } while (pd > 0);
  const b = src.indexOf('{', p); let d = 0, j = b;
  do { if (src[j] === '{') d++; else if (src[j] === '}') d--; j++; } while (d > 0);
  return src.slice(m.index, j);
}
const liftLine = (src, name) => { const m = new RegExp('^const ' + name + '\\s*=.*$', 'm').exec(src); return m ? m[0] : null; };

let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
const fns = ['deburr', 'onlyDigits', 'personNameKey', 'nifFromAny', 'foundedYear', 'legalFormOf', 'personAge', 'controlTier', 'linkIsCurrent', 'resolveOwnership', 'orbisValues', 'tierOf'];
const drift = fns.filter((f) => liftFn(page, f) == null || liftFn(page, f) !== liftFn(helpers, f));
ok(`copied functions identical to search.html (${fns.length})${drift.length ? ' — changed: ' + drift.join(', ') + ' (regenerate crm-helpers.js)' : ''}`, !drift.length);
const lines = ['PERSON_SALUT', 'linkIsShareholder', 'linkIsManager', 'fmtPctOwn', 'FINANCIALS_YEARS'];
const lineDrift = lines.filter((n) => liftLine(page, n) !== liftLine(helpers, n));
ok(`copied constants identical${lineDrift.length ? ' — changed: ' + lineDrift.join(', ') : ''}`, !lineDrift.length);
ok('stage labels identical', helpers.includes(page.slice(page.indexOf('const STAGES ='), page.indexOf('};', page.indexOf('const STAGES =')) + 2)));

// Server normalisation vs the page's (companySearchFields / personNameKey / personNameTokens).
const vm = await import('node:vm');
const ctx = {};
vm.createContext(ctx);
vm.runInContext([liftFn(page, 'deburr'), liftLine(page, 'LEGAL_FORM_RE'), liftFn(page, 'companySearchFields'), liftLine(page, 'PERSON_SALUT'), liftFn(page, 'personNameKey'), liftLine(page, 'PERSON_STOPWORDS'), liftFn(page, 'personNameTokens'),
  'globalThis.P = { companySearchFields, personNameKey, personNameTokens };'].join('\n'), ctx);
const samples = ['Metalúrgica do Norte, Lda.', 'NORTE TRANSPORTES SA', 'A & B - Construções, S.A.', 'transp sul', 'Sociedade Unipessoal Lda', 'ÉVORA — Têxteis/Moda'];
ok('company search keys: server = page', samples.every((s) => { const a = ctx.P.companySearchFields(s), b = server.companySearchFields(s); return a.nameKey === b.nameKey && JSON.stringify(a.nameTokens) === JSON.stringify(b.nameTokens); }));
const people = ['Dr. Luís Carlos da Silva', 'Mr Mrs John O\'Neil', 'Eng. Ana-Maria Sá (Jr.)', 'maria dos santos e silva'];
ok('person search keys: server = page', people.every((s) => ctx.P.personNameKey(s) === server.personNameKey(s) && JSON.stringify(ctx.P.personNameTokens(ctx.P.personNameKey(s))) === JSON.stringify(server.personNameTokens(server.personNameKey(s)))));
console.log(fail ? `\n${fail} FAILED` : '\nall mobile parity tests passed'); process.exit(fail ? 1 : 0);
