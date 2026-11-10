// Phone search (10 Nov 2026, switch search.phoneSearch): a full Portuguese number, with or without +351 / 00351 / spaces,
// finds the company or person that has it. Runs the page's own key helpers and checks the wiring. Synthetic numbers.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const page = read('../../portal/search.html'), catalog = read('../../functions/features/catalog.js'), feats = read('../../portal/features.js'), rules = read('../../firestore.rules');
const grab = (start, end = '\n}\n') => { const i = page.indexOf(start); if (i < 0) throw new Error(start); const j = page.indexOf(end, i); return page.slice(i, j + end.length); };
const line = (start) => { const i = page.indexOf(start); if (i < 0) throw new Error(start); return page.slice(i, page.indexOf('\n', i)); };
const ctx = {};
vm.createContext(ctx);
vm.runInContext([grab('function phoneKey('), grab('function phoneKeysOfText('), grab('function reachPhonesOf('), grab('function companyPhoneKeys('),
  'globalThis.P = { phoneKey, phoneKeysOfText, reachPhonesOf, companyPhoneKeys };'].join('\n'), ctx);
const { P } = ctx;

let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
ok('the same number in every format gives one key', ['917995784', '+351 91 799 57 84', '00351917995784', '351917995784', '+351917995784', ' 91 799 57 84 '].every(v => P.phoneKey(v) === '917995784'));
ok('a landline with the country code', P.phoneKey('+351 255536810') === '255536810' && P.phoneKey('255 536 810') === '255536810');
ok('foreign numbers and odd lengths give no key (for now)', P.phoneKey('+34 912 345 678') === null && P.phoneKey('0034912345678') === null && P.phoneKey('+55 11 91234 5678') === null && P.phoneKey('12345') === null && P.phoneKey('') === null && P.phoneKey(null) === null);
ok('a NIF-looking 9 digits is just 9 digits (the search also looks at NIF)', P.phoneKey('501234567') === '501234567');
ok('two numbers in one field: one key each', JSON.stringify(P.phoneKeysOfText('253 123 456 / 253 123 457')) === '["253123456","253123457"]' && JSON.stringify(P.phoneKeysOfText('+351 253 123 456; 912 000 111')) === '["253123456","912000111"]');
ok('company keys: own phone, contact details, contacts; no repeats', JSON.stringify(P.companyPhoneKeys({ companyPhone: '+351 232448531', reach: [{ type: 'phone', value: '232 448 531' }, { type: 'phone', value: '912 345 678' }, { type: 'email', value: 'a@b.pt' }], contacts: [{ phone: '966751726' }] })) === '["232448531","912345678","966751726"]');
ok('company with no phone: no keys', P.companyPhoneKeys({ name: 'X' }).length === 0 && P.companyPhoneKeys(null).length === 0);
ok('person keys: reach phones, Orbis phones, old phone field; emails ignored', JSON.stringify(P.reachPhonesOf([{ type: 'phone', value: '914 519 294' }, { type: 'email', value: 'x@y.pt' }], { orbisPhones: ['+351 21 000 0000'], phone: '966751726' })) === '["914519294","210000000","966751726"]');
ok('person keys without a person record', JSON.stringify(P.reachPhonesOf([{ type: 'phone', value: '+351 91 799 57 84' }])) === '["917995784"]' && P.reachPhonesOf(undefined).length === 0);

// Wiring
ok('index kept with the company search fields (import, create, edit, rebuild)', page.includes('emailKeys: companyEmailKeys(c), phoneKeys: companyPhoneKeys(c) }; }'));
ok('company edit and Orbis import write phoneKeys', page.includes("emailKeys: merged.emailKeys || [], phoneKeys: merged.phoneKeys || [],") && page.includes('{ phoneKeys: merged.phoneKeys || [] }'));
ok('company contact details and contacts update phoneKeys', page.includes("{ reach: list, emailKeys, phoneKeys, updatedAt") && (page.match(/phoneKeys: companyPhoneKeys\(\{ \.\.\.c, contacts \}\)/g) || []).length === 3);
ok('person writes keep reachPhones (new, manual, bulk, edit)', ['reachPhones: reachPhonesOf(reach), hiddenOrbis: [], ...(f.country', 'reachPhones: reachPhonesOf(list, existing)', 'reachPhones: reachPhonesOf(reach), hiddenOrbis: [], notes: null', 'reachPhones: reachPhonesOf(reach, p), updatedAt'].every(s => page.includes(s)));
ok('Orbis people import adds the key with arrayUnion', page.includes('{ reachPhones: arrayUnion(...phoneKeysOfText(r.phone)) }'));
ok('the list filter matches the key or the people hits, only with the switch on', page.includes("const phoneK = currentPhoneKey();") && page.includes("(c.phoneKeys || []).includes(phoneK) || !!phoneIds?.has(c.id)") && /function currentPhoneKey\(\)\{\n  if \(!isOn\('search.phoneSearch'\)\) return null;/.test(page));
ok('server lookup: company keys, people keys, then their links', page.includes("where('phoneKeys','array-contains', key)") && page.includes("where('reachPhones','array-contains', key)") && page.includes("collection(db,'searchPersonLinks'), where('personId','in'"));
ok('each result says why it matched', page.includes("'Company phone'") && page.includes('`Phone of ${who.get(pid)') && page.includes('${phoneChip(c)}'));
ok('rebuild button writes only what differs, companies and people', page.includes('id="rebuildPhoneIndexBtn"') && page.includes('!sameKeys(c.phoneKeys, companyPhoneKeys(c))') && page.includes("!sameKeys(d.data().reachPhones, reachPhonesOf(d.data().reach, d.data()))") && page.includes("for (const field of ['reach', 'orbisPhones'])") && page.includes("where(field, '!=', [])") && !page.includes('orderBy(documentId()), ...(last'));
ok('release switch listed in the catalog and the portal', catalog.includes('"search.phoneSearch"') && feats.includes("'search.phoneSearch'"));
ok('rules let the reach permission write the two index fields', rules.includes("onlyFields(['primaryContact', 'emailKeys', 'phoneKeys']") && rules.includes("'reachEmails', 'reachPhones'"));
if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); } else console.log('\nAll passed');
