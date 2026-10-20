// People merge, Stage 3 (20 Oct 2026, switch search.people): the company's
// Contacts tab becomes "People" — everyone at the company (Orbis owners and
// managers, then contact people) with their emails / phones / LinkedIn, "＋
// detail" in place, main contact, Mark previous / current, the old Contacts
// list folded until the migration. Wiring checks on the page source.
import { readFileSync } from 'node:fs';
const page = readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

ok('switch on: the tab is renamed "People" and renders the people list instead of the contacts', page.includes("if (tabBtn) tabBtn.textContent = isOn('search.people') ? 'People' : 'Contacts';") && page.includes("if (isOn('search.people')) { renderCompanyPeople(c); return; }"));
ok('people = links that are people (company shareholders stay on Ownership)', page.includes("const persons = links.filter(l => l.personId && l.personEntityType !== 'entity');"));
ok('current first, then the main contact, then Orbis before contacts, then by %', page.includes('(linkCurrentAny(b) - linkCurrentAny(a)) || ((b.personId === mainId) - (a.personId === mainId)) || ((!!a.isContact) - (!!b.isContact))'));
ok('details: own first (bounced last), then typed-before, then Orbis not hidden', page.includes('const all = [...own, ...legacy, ...orb];') && page.includes('reachOrbis(pp, t).filter(o => !o.hidden'));
ok('"＋ detail" saves through the same path as the person page and logs it', page.includes('async function savePersonReach(p, reach, hiddenOrbis, change, links)') && page.includes("await savePersonReach(pp, r.list, pp.hiddenOrbis || [], `added ${r.entry.value}`);") && page.includes('await savePersonReach(p, reach, hiddenOrbis, change, links);'));
ok('main contact, Mark previous / current (hand-added) and ✕ (contacts) on each row', page.includes('data-mainct="${esc(l.personId)}" title="Make them the main contact"') && page.includes('${isHandLink(l) ? `<button class="btn btn--ghost btn--sm" data-handcur=') && page.includes('${l.isContact ? `<button class="btn btn--icon btn--danger" data-rmlink='));
ok('previous people folded behind "Show previous (N)"', page.includes('${companyPeopleShowPrev ? \'Hide\' : \'Show\'} previous (${prevN})'));
ok('the old Contacts list stays visible, folded, until the migration', page.includes('Old Contacts list (${old.length}) — moves into People in the migration'));
ok('a new contact appears on the People tab straight away', page.includes("if (isOn('search.people')) renderCompanyPeople(c); // 20 Oct (Stage 3)"));
ok('clicking a name opens the person page and Back returns to this tab', page.includes("openPerson(t.dataset.person, { type: 'company', id: c.id, tab: 'contacts' })"));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
