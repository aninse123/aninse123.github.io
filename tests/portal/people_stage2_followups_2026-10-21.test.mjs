// People merge, Stage 2 follow-ups (21 Oct 2026, from André's test answers;
// switch search.people): F1 the old "Copy to Contacts" goes, F2 contact
// controls follow the permission, F4 address and fax as types, F5 the type
// follows what you type, F6 rename a contact, F7 a possible duplicate is asked
// about instead of blocked. Runs the page's own helpers; wiring checks.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const page = read('../../portal/search.html'), rules = read('../../firestore.rules');
const grab = (start, end = '\n}\n') => { const i = page.indexOf(start); if (i < 0) throw new Error(start); const j = page.indexOf(end, i); return page.slice(i, j + end.length); };
const line = (start) => { const i = page.indexOf(start); if (i < 0) throw new Error(start); return page.slice(i, page.indexOf('\n', i)); };
const ctx = {};
vm.createContext(ctx);
vm.runInContext([
  'const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", \'"\': "&quot;" }[c]));',
  line('const REACH_TYPES'), grab('function reachNorm('), grab('function reachValid('), grab('function reachGuessType('), line('const REACH_LOOKS'), line('const REACH_INVALID'),
  grab('function followReachType('), grab('function reachLinkHtml('), line('const reachNewId'), grab('function reachAdd('),
  line('const PERSON_SALUT'), grab('function deburr('), grab('function personNameKey('), line('const PERSON_STOPWORDS'), line('function personNameTokens('), grab('function personNameMatch('),
  'globalThis.R = { reachGuessType, reachAdd, reachValid, reachNorm, followReachType, reachLinkHtml, personNameMatch };',
].join('\n'), ctx);
const { R } = ctx;
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

// F5 — the type a value looks like
const g = (v) => R.reachGuessType(v);
ok('F5: email, LinkedIn, phone', g('joao@empresa.pt') === 'email' && g('https://www.linkedin.com/in/joao') === 'linkedin' && g('+351 938 714 640') === 'phone' && g('(22) 123-4567 89') === 'phone');
ok('F5: an address by its postcode or a street word with a number', g('Rua de Cedofeita 123, 4050-180 Porto') === 'address' && g('Av. da Liberdade 10') === 'address' && g('Zona Industrial da Maia, lote 5') === 'address');
ok('F5: nothing recognisable → no guess (the list stays)', g('joao') === '' && g('12345') === '' && g('') === '');
const sel = { value: 'email', dataset: {}, disabled: false };
R.followReachType(sel, '+351 938 714 640');
ok('F5: the Type list follows what you type…', sel.value === 'phone');
sel.dataset.touched = '1'; R.followReachType(sel, 'joao@empresa.pt');
ok('…until you pick a type yourself', sel.value === 'phone');
const wrong = R.reachAdd([], { type: 'email', value: '+351 938 714 640' });
ok('F5: a phone typed with Email selected: the message names the right type', wrong.error === 'This looks like a phone number. Switch the type to Phone.' && wrong.guess === 'phone');
ok('F5: a value that fits nothing keeps the plain message', R.reachAdd([], { type: 'email', value: 'nope' }).error === 'That isn\'t a valid email address.');

// F4 — address and fax
let r = R.reachAdd([], { type: 'address', value: 'Rua de Cedofeita 123, 4050-180 Porto' });
ok('F4: an address is added, primary for addresses', !r.error && r.list[0].type === 'address' && r.list[0].primary);
ok('F4: the same address with other spacing / case is a duplicate', R.reachAdd(r.list, { type: 'address', value: 'rua de cedofeita  123, 4050-180 porto' }).error === 'Already in the list.');
ok('F4: too short to be an address', R.reachAdd([], { type: 'address', value: '12' }).error === 'Write the street, postcode and city.');
r = R.reachAdd(r.list, { type: 'fax', value: '+351 22 000 0000' });
ok('F4: a fax (chosen by hand) is added; fewer than 9 digits refused', !r.error && r.entry.type === 'fax' && R.reachAdd([], { type: 'fax', value: '1234' }).error === 'A fax number needs at least 9 digits.');
ok('F4: links — the address opens the map in a new tab, a fax stays text', /google\.com\/maps\/search\/\?api=1&amp;query=Rua%20de%20Cedofeita/.test(R.reachLinkHtml('address', 'Rua de Cedofeita 123')) && /target="_blank"/.test(R.reachLinkHtml('address', 'Rua X 1')) && R.reachLinkHtml('fax', '+351 22 000 0000') === '<span>+351 22 000 0000</span>');
ok('F4: Orbis addresses and faxes are listed (and hideable) like emails and phones', page.includes("const REACH_ORBIS = { email: 'orbisEmails', phone: 'orbisPhones', address: 'orbisAddresses', fax: 'orbisFaxes' };"));

// F7 — possible duplicate
ok('F7: "Paulo Pinto" is a possible match for "Paulo Jorge Dias Gomes Pinto"; another name is not', R.personNameMatch('Paulo Pinto', 'PAULO JORGE DIAS GOMES PINTO') === 'similar' && !R.personNameMatch('Rita Sousa', 'PAULO JORGE DIAS GOMES PINTO'));
ok('F7: a match asks — Yes opens their page, No adds and is logged — never a hard block', page.includes('const similar = (companyLinksCache.get(c.id) || []).filter(l => l.personEntityType !== \'entity\' && personNameMatch(name, l.personName || \'\'));')
  && page.includes('data-cpmatchopen=') && page.includes('No, add a new contact') && page.includes('added although the name is similar to') && !page.includes('is already on this company — add the email or phone on their person page.'));

// F1, F2 — Ownership and People tabs
ok('F1: no "Copy to Contacts" with the People merge on', page.includes('${!peopleOn && !allPrev && !l.isContact ? contactBtn(l, roleForContact) : \'\'}'));
ok('F2: Ownership tab — Add contact, ☆, Mark previous (contacts), ✎ and ✕ only with the permission', page.includes('${canReach ? `<button class="btn btn--ghost btn--sm" id="addContactPersonBtn"') && page.includes('const mainBtn = l => !peopleOn || !canReach ||') && page.includes('(l.isContact && !canReach) ?') && page.includes("${l.isContact ? (canReach ? `<button class=\"btn btn--icon btn--ghost\" data-ctedit="));
ok('F2: Mark previous on an owner or manager added by hand needs company edit rights', (page.match(/\$\{l\.isContact \? '' : ' data-perm="search\.edit" data-coedit'\}/g) || []).length === 2);
ok('F2: People tab — ☆, ✎ and ✕ only with the permission', page.includes('${canEdit && cur ? (l.personId === mainId') && page.includes('${canEdit && l.isContact ? `<button class="btn btn--icon btn--ghost" data-ctedit=') && page.includes('${l.isContact && canEdit ? `<button class="btn btn--icon btn--danger" data-rmlink='));

// F6 — rename a contact
ok('F6: ✎ opens the contact in the same window (name and role; email / phone hidden)', page.includes("document.getElementById('cpTitle').textContent = link ? 'Edit contact' : 'Add contact';") && page.includes("document.getElementById('cpReachRow').style.display = link ? 'none' : '';") && page.includes('if (t.dataset.ctedit) { openContactPerson(t.dataset.ctedit); return; }'));
ok('F6: a name only for people added by hand; every link and the main contact follow; logged', page.includes("if (pp?.source !== 'manual') return fail('Orbis keeps this name: the next import would change it back.');") && page.includes("updateDoc(d.ref, { personName: name, updatedAt: serverTimestamp() })") && page.includes('const primaryContact = { ...c.primaryContact, name: snap.name, role: snap.role };') && page.includes('`Contact edited: ${'));
ok('F6: the rules let the details permission rename a hand-added person only', rules.includes("|| (can('search.reach') && resource.data.get('source', '') == 'manual' && onlyFields(reachFields().concat(['name', 'nameKey', 'nameTokens', 'namePrefixes'])));"));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
