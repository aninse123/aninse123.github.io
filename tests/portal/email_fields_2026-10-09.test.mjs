// Email fields for the formal templates (9 Oct 2026): the Outreach page's
// preview / letters use ownerContext(), joinOu(), the IN_CITY table and the
// {{?field|text}} syntax lifted from outreach.html — they must match the server
// (functions/outreach/render.js, places.js). Search CRM's "Owners in emails"
// box writes the list the server reads. Synthetic names only.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const R = require('../../functions/outreach/render.js');
const P = require('../../functions/outreach/places.js');
const page = readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8');
const search = readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8');
const teamPage = readFileSync(new URL('../../portal/team.html', import.meta.url), 'utf8');

function liftFn(src, name){
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(name + ' not found');
  let p = src.indexOf('(', start), pd = 0;
  do { if (src[p] === '(') pd++; else if (src[p] === ')') pd--; p++; } while (pd > 0);
  let j = src.indexOf('{', p), depth = 0;
  do { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; } while (depth > 0);
  return src.slice(start, j);
}
const liftConst = (src, name) => { const i = src.indexOf(`const ${name} = `); if (i < 0) throw new Error(name); let j = src.indexOf('{', i), d = 0; do { if (src[j] === '{') d++; else if (src[j] === '}') d--; j++; } while (d > 0); return src.slice(i, j) + ';'; };
const liftLine = (src, name) => { const i = src.indexOf(`const ${name} = `); if (i < 0) throw new Error(name); return src.slice(i, src.indexOf('\n', i)); };
// scanTemplate holds '{{' strings, so brace counting can't find its end: lift the block up to the next function.
const between = (src, from, to) => { const i = src.indexOf(from), j = src.indexOf(to, i); if (i < 0 || j < 0) throw new Error(from); return src.slice(i, j); };
let fail = 0;
const ok = (l, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${l}`); };

const s = {}; vm.createContext(s);
vm.runInContext([liftFn(page, 'joinOu'), liftFn(page, 'ownerContext'), liftConst(page, 'IN_CITY'), liftLine(page, 'inCityOf'), between(page, 'function scanTemplate(', 'function renderPreview('), 'const esc = (x) => String(x);',
  'this.__x = { joinOu, ownerContext, IN_CITY, inCityOf, renderVars };'].join('\n'), s);
const X = s.__x;

const owners = [
  [], [{ name: 'Ana Dias', gender: 'F' }], [{ name: 'Rui Costa', gender: 'M' }, { name: 'Eva Lima', gender: 'F' }],
  [{ name: 'Rui Costa', gender: 'M' }, { name: 'Kim Lee', gender: '' }, { name: 'Eva Lima', gender: 'F' }, { name: 'Quarto Nome', gender: 'M' }],
  [{ name: '  Spaced   Name ', gender: 'X' }, null, { name: '' }],
];
ok('page ownerContext = server for: none, one, two, four (max 3), messy input', owners.every((o) => JSON.stringify(X.ownerContext({ emailOwners: o })) === JSON.stringify(R.ownerContext({ emailOwners: o }))) && JSON.stringify(X.ownerContext({})) === JSON.stringify(R.ownerContext({})));
ok('page IN_CITY table = server places.js (same 39 municipalities, same wording)', JSON.stringify(Object.entries(X.IN_CITY).sort()) === JSON.stringify(Object.entries(P.IN_CITY).sort()));
ok('page inCityOf = server for accents / case / spaces / unknown', ['Cinfaes', 'PORTO', 'Setúbal', 'figueira da  foz', 'Caldas da Rainha', ''].every((c) => X.inCityOf(c) === P.inCityOf(c)));
const ctx = { sender: { bookingLink: 'https://cal.com/x' }, owner: { of: '' } };
const tpl = 'Ligue{{?sender.bookingLink| ou marque em {{sender.bookingLink}}}}. {{owner.of|da gerência}} {{?owner.of| (x)}}';
ok('preview {{?field|text}} = server (spaces kept, nothing when empty, never missing)', X.renderVars(tpl, ctx).html === R.renderTemplate(tpl, ctx).text && X.renderVars(tpl, ctx).html === 'Ligue ou marque em https://cal.com/x. da gerência ' && !X.renderVars(tpl, ctx).missing.length);
ok('field buttons offer the new fields', ["'owner.of|da gerência'", "'owner.with|a gerência'", "'company.inCity|nas vossas instalações'", "'campaign.sector'", "'sender.bookingLink'"].every((v) => page.includes(v)));
ok('template editor: "The template signs" saved as signs; campaign settings: Sector in the emails', /id="tSigns"/.test(page) && /signs: \$\('tSigns'\)\.checked/.test(page) && /id="csSector"/.test(page) && /sector: \$\('csSector'\)\.value/.test(page));

// Search CRM "Owners in emails" box.
const q = {}; vm.createContext(q);
vm.runInContext([liftFn(search, 'parseEmailOwners'), liftFn(search, 'emailOwnersText'), 'this.__x = { parseEmailOwners, emailOwnersText };'].join('\n'), q);
const parsed = q.__x.parseEmailOwners(' Senhor José Peres ;Senhora Maria  Lima; Sra. Ana Dias; Pemchhiri Sherpa ');
ok('parse: Senhor → M, Senhora / Sra. → F, no title → unknown, max 3, spaces tidied', JSON.stringify(parsed) === JSON.stringify([{ name: 'José Peres', gender: 'M' }, { name: 'Maria Lima', gender: 'F' }, { name: 'Ana Dias', gender: 'F' }]));
ok('parse: empty → null (field cleared); Sr. → M', q.__x.parseEmailOwners('  ') === null && q.__x.parseEmailOwners('Sr. Rui Costa')[0].gender === 'M');
ok('text ↔ list round trip; server renders what the box saved', q.__x.emailOwnersText(parsed) === 'Senhor José Peres; Senhora Maria Lima; Senhora Ana Dias' && R.ownerContext({ emailOwners: parsed }).of === 'do Senhor José Peres, da Senhora Maria Lima ou da Senhora Ana Dias');
ok('company editor + detail show the box; Team pages have the booking link', /id="cEmailOwners"/.test(search) && /emailOwners:parseEmailOwners\(v\('cEmailOwners'\)\)/.test(search) && /Owners in emails<\/span>/.test(search) && /id="cBooking"/.test(teamPage) && /id="fBooking"/.test(teamPage) && /bookingLink: \$\('fBooking'\)\.value/.test(teamPage));

if (fail){ console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nall email field tests passed');
