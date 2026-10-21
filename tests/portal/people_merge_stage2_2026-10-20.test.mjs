// People merge, Stage 2 (20 Oct 2026, switch search.people): several emails,
// phones and LinkedIn per person (no work / personal labels), Orbis values
// hideable, contact people (never owner or manager), the company's main
// contact, and the "search.reach" permission. Runs the page's own reach
// helpers and checks the wiring. Synthetic data.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const page = read('../../portal/search.html'), access = read('../../portal/access.js'), perms = read('../../functions/access/perms.js');
const grab = (start, end = '\n}\n') => { const i = page.indexOf(start); if (i < 0) throw new Error(start); const j = page.indexOf(end, i); return page.slice(i, j + end.length); };
const line = (start) => { const i = page.indexOf(start); if (i < 0) throw new Error(start); return page.slice(i, page.indexOf('\n', i)); };
const ctx = {};
vm.createContext(ctx);
vm.runInContext([
  line('const LEGACY_ORBIS_FIELD') ? grab('const LEGACY_ORBIS_FIELD', '\n};\n') : '', grab('function orbisValues('),
  line('const REACH_TYPES'), line('const REACH_ORBIS'), grab('function reachNorm('), grab('function reachValid('), grab('function reachGuessType('), line('const REACH_LOOKS'), line('const REACH_INVALID'), line('const reachNewId'),
  grab('function reachAdd('), line('const reachUpdate'), line('function reachSetPrimary('), grab('function reachRemove('), line('const reachEmailsOf'), grab('function reachOrbis('),
  'function linkIsCurrent(l){ return l.shCurrent === true || l.mgmtCurrent === true; }', line('const linkCurrentAny'),
  'globalThis.R = { reachAdd, reachUpdate, reachSetPrimary, reachRemove, reachEmailsOf, reachOrbis, reachValid, linkCurrentAny };',
].join('\n'), ctx);
const { R } = ctx;

let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
let r = R.reachAdd([], { type: 'email', value: 'joao@setcereal.pt', by: 'antonio' });
let list = r.list;
ok('first email added, primary, status OK, no label field', list.length === 1 && list[0].primary && list[0].status === 'ok' && !('label' in list[0]));
r = R.reachAdd(list, { type: 'email', value: 'Joao.Silva@Gmail.com', note: 'pessoal' }); list = r.list;
ok('a second email: not primary; note kept', list.length === 2 && !list[1].primary && list[1].note === 'pessoal');
ok('duplicate refused (case-insensitive email)', R.reachAdd(list, { type: 'email', value: 'JOAO@setcereal.pt' }).error === 'Already in the list.');
ok('invalid values refused', !!R.reachAdd(list, { type: 'email', value: 'nope' }).error && !!R.reachAdd(list, { type: 'phone', value: '1234' }).error && !!R.reachAdd(list, { type: 'linkedin', value: 'joao' }).error);
r = R.reachAdd(list, { type: 'phone', value: '+351 938 714 640' }); list = r.list;
ok('a phone is primary for phones while the first email stays primary for emails', list.filter((e) => e.primary).length === 2);
list = R.reachSetPrimary(list, list[1].id);
ok('make the gmail primary → only one primary email', list.filter((e) => e.type === 'email' && e.primary).map((e) => e.value).join() === 'Joao.Silva@Gmail.com');
list = R.reachRemove(list, list[1].id);
ok('delete the primary → the next email becomes primary', list.filter((e) => e.type === 'email').length === 1 && list.find((e) => e.type === 'email').primary);
ok('email index lowercased, emails only', JSON.stringify(R.reachEmailsOf(list)) === '["joao@setcereal.pt"]');
ok('Orbis values with hidden ones marked', JSON.stringify(R.reachOrbis({ orbisPhones: ['+351 21 000 0000', '+351 22 111 1111'], hiddenOrbis: ['+351 21 000 0000'] }, 'phone').map((o) => o.hidden)) === '[true,false]');
ok('a contact link is current unless marked previous; Orbis links by facet', R.linkCurrentAny({ isContact: true }) && !R.linkCurrentAny({ isContact: true, contactCurrent: false }) && !R.linkCurrentAny({ shCurrent: false }));

// Wiring
ok('person page: the reach editor replaces the old Contact card with the switch on', page.includes(`\${isOn('search.people') ? '<div class="card" id="reachCard" data-feature="search.people"></div>' :`) && page.includes("if (isOn('search.people')) renderReachCard(p, links);") && page.includes("document.getElementById('savePersonContactBtn')?.addEventListener"));
ok('saving writes the list, the hidden Orbis values and the email index, and logs it', page.includes("await updateDoc(doc(db,'searchPeople', p.id), { reach, hiddenOrbis, reachEmails: reachEmailsOf(reach), updatedAt: serverTimestamp(), updatedBy: currentUser });") && page.includes("logOnPersonCompanies(p, links, 'person_contact_edited'"));
ok('contact person: own id, source manual, contact link without owner / manager facets', page.includes("const pid = 'm_' + doc(collection(db,'searchPeople')).id;") && page.includes("isContact: true, contactRole: v('cpRole').slice(0, 80) || null, contactCurrent: true,") && page.includes('id="contactPersonModal"'));
ok('contact people never change the company counts', page.includes('if (!link.isContact) await recountCompanyPeople(c.id);') && page.includes('if (!link?.isContact) await recountCompanyPeople(c.id);'));
ok('main contact on the company, logged', page.includes("{ primaryContact: val, updatedAt: serverTimestamp(), updatedBy: currentUser }") && page.includes("data-mainct"));
ok('permission "search.reach" on both lists; Analyst and Intern get it by default', access.includes('["search.reach", "Search CRM",') && perms.includes('["search.reach", "Search CRM",') && /analyst: \{[\s\S]*?"search\.reach"/.test(perms) && /intern: \{[\s\S]*?"search\.reach"/.test(perms));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
