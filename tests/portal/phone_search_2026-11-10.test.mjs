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
ok('server lookup over REST (the SDK is slow here): company keys, people keys, then their links and companies', page.includes('async function restFetchArrayContains(') && page.includes("op: 'ARRAY_CONTAINS'") && page.includes("restFetchArrayContains('searchCompanies', 'phoneKeys', key)") && page.includes("restFetchArrayContains('searchPeople', 'reachPhones', key)") && page.includes("restFetchWhereIn('searchPersonLinks', 'personId'") && page.includes("restFetchByIdsIn('searchCompanies', missing") && !page.slice(page.indexOf('async function searchPhoneSupplement'), page.indexOf("document.getElementById('searchInput').addEventListener('input', () => { phoneSeq")).includes('getDocs('));
ok('the database look-up runs on Enter / the magnifier, next to the NIF look-up, never while typing; own status line', page.includes("const pk = currentPhoneKey(); if (pk) searchPhoneSupplement(pk);") && page.includes('id="phoneSearchStatus"') && !page.includes('phoneTimer') && !page.includes('setTimeout(() => searchPhoneSupplement'));
ok('the time taken is shown next to the result (total and database), and in the console', page.includes('(database ${(lap.queries / 1000).toFixed(1)} s)') && page.includes("console.info('phone search timing (ms)', lap)"));
ok('the NIF / foreign tax ID and name look-ups go over REST too (restQueryDocs), same filters as before: a prefix range, name words, then the name key range', page.includes('async function restQueryDocs(') && page.includes("op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: digits } }") && page.includes("digits + '\\uf8ff'") && page.includes("fieldPath: 'namePrefixes' }, op: 'ARRAY_CONTAINS', value: { stringValue: nameTokens[0] }") && page.includes("fieldPath: 'nameKey' }, direction: 'ASCENDING'") && !page.slice(page.indexOf('async function searchIdFieldSupplement'), page.indexOf("document.getElementById('loadAllBtn')")).includes('getDocs('));
ok('each result says why it matched', page.includes("'Company phone'") && page.includes('`Phone of ${who.get(pid)') && page.includes('${phoneChip(c)}'));
ok('rebuild button writes only what differs, companies and people', page.includes('id="rebuildPhoneIndexBtn"') && page.includes('!sameKeys(c.phoneKeys, companyPhoneKeys(c))') && page.includes("!sameKeys(d.data().reachPhones, reachPhonesOf(d.data().reach, d.data()))") && page.includes("for (const field of ['reach', 'orbisPhones'])") && page.includes("where(field, '!=', [])") && !page.includes('orderBy(documentId()), ...(last'));
ok('release switch listed in the catalog and the portal', catalog.includes('"search.phoneSearch"') && feats.includes("'search.phoneSearch'"));
ok('rules let the reach permission write the two index fields', rules.includes("onlyFields(['primaryContact', 'emailKeys', 'phoneKeys']") && rules.includes("'reachEmails', 'reachPhones'"));
// The Outreach page writes phones too (a phone found in a reply, "add to the company"): same key, same fields.
const outreach = read('../../portal/outreach.html');
const octx = {}; vm.createContext(octx);
const ograb = (start, end = '\n    }\n') => { const i = outreach.indexOf(start); if (i < 0) throw new Error(start); const j = outreach.indexOf(end, i); return outreach.slice(i, j + end.length); };
vm.runInContext([ograb('function phoneKey('), ograb('function phoneKeysOfText(v)', '\n'), ograb('function reachPhonesOf(', '\n    }\n'), ograb('const withPhoneKey', '\n'), 'globalThis.O = { phoneKey, phoneKeysOfText, reachPhonesOf, withPhoneKey };'].join('\n'), octx);
const samples = ['917995784', '+351 91 799 57 84', '00351917995784', '351917995784', '+351 255536810', '253 123 456 / 253 123 457', '+34 912 345 678', '12345', '', null];
ok('Outreach and Search CRM agree on the key for every format', samples.every(v => P.phoneKey(v) === octx.O.phoneKey(v) && JSON.stringify(P.phoneKeysOfText(v)) === JSON.stringify(octx.O.phoneKeysOfText(v))));
ok('Outreach person keys = Search CRM person keys', JSON.stringify(octx.O.reachPhonesOf([{ type: 'phone', value: '914 519 294' }, { type: 'email', value: 'x@y.pt' }], { orbisPhones: ['+351 21 000 0000'], phone: '966751726' })) === JSON.stringify(P.reachPhonesOf([{ type: 'phone', value: '914 519 294' }, { type: 'email', value: 'x@y.pt' }], { orbisPhones: ['+351 21 000 0000'], phone: '966751726' })));
ok('Outreach company keys add to what is there, no repeats', JSON.stringify(octx.O.withPhoneKey(['255536810'], '+351 255 536 810')) === '["255536810"]' && JSON.stringify(octx.O.withPhoneKey(['255536810'], '914519294')) === '["255536810","914519294"]' && JSON.stringify(octx.O.withPhoneKey(undefined, '+34 912 345 678')) === '[]');
ok('Outreach: every place that adds a phone keeps the index (company details, person details, new person, from a reply)', outreach.includes("patch.phoneKeys = withPhoneKey(data.phoneKeys, dValue)") && outreach.includes("patch.phoneKeys = withPhoneKey(data.phoneKeys, value)") && outreach.includes("reachPhones: reachPhonesOf(next, snap.data()), updatedAt") && outreach.includes("reachPhones: reachPhonesOf(reach), hiddenOrbis: [], notes: null, matchedCompanyId: null, linkCount: 1, currentLinkCount: kind") && outreach.includes("reachPhones: reachPhonesOf(reach), hiddenOrbis: [], notes: null, matchedCompanyId: null, linkCount: 1, currentLinkCount: 0") && outreach.includes("...(type === 'phone' ? { reachPhones: reachPhonesOf(next, snap.data()) } : {})"));
ok('Search CRM: the person Contact card and the merge of a hand-added person keep the index', page.includes("patch.reachPhones = reachPhonesOf(p.reach, { ...p, phone: patch.phone });") && page.includes("patch.reachPhones = reachPhonesOf(op.reach, { ...op, ...patch });"));
if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); } else console.log('\nAll passed');
