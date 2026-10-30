// One "Add person" window (21 Oct 2026, people merge follow-ups; switch
// search.people): Owner / Manager / Other in one window on Ownership and People,
// ✎ changes the kind, the Inbox's "Someone new" offers the same, the company
// import adds the file's person to People, Statistics count people with an
// email or phone, a logged activity remembers the person, and the phone app
// shows People. Runs the page's own link-fields helper; wiring checks.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const page = read('../../portal/search.html'), out = read('../../portal/outreach.html'), mob = read('../../portal/m/app.js');
const grab = (start, end = '\n}\n') => { const i = page.indexOf(start); if (i < 0) throw new Error(start); const j = page.indexOf(end, i); return page.slice(i, j + end.length); };
const line = (start) => { const i = page.indexOf(start); if (i < 0) throw new Error(start); return page.slice(i, page.indexOf('\n', i)); };
const ctx = {};
vm.createContext(ctx);
vm.runInContext([
  line('const linkIsShareholder ='), line('const linkIsManager     ='), 'function linkIsCurrent(l){ return l.shCurrent === true || l.mgmtCurrent === true; }', line('const linkCurrentAny'),
  line('const pmKind ='), line('const pmKindOfLink ='), grab('function pmLinkFields('),
  'globalThis.R = { pmLinkFields, pmKind, pmKindOfLink };',
].join('\n'), ctx);
const { R } = ctx;
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

// The kinds
let f = R.pmLinkFields({ other: true, role: 'Diretor comercial' }, null);
ok('Other: a contact link, current, with no owner / manager facets', f.isContact === true && f.contactRole === 'Diretor comercial' && f.contactCurrent === true && f.shCurrent === null && f.mgmtCurrent === null && f.mgmtRoles.length === 0);
f = R.pmLinkFields({ owner: true, manager: true, directPct: 40, totalPct: null, shDate: '06/2026', shCurrent: true, roles: ['Sócio Gerente'], mgmtCurrent: true }, null);
ok('Owner and Manager: both facets, as "Add Person" writes them (shType I, alsoManager)', f.shDirectPct === 40 && f.shCurrent === true && f.shType === 'I' && f.mgmtRoles[0] === 'Sócio Gerente' && f.mgmtCurrent === true && f.alsoManager === true && !('isContact' in f));
const contactLink = { isContact: true, contactRole: 'Comercial', contactCurrent: false };
f = R.pmLinkFields({ manager: true, roles: ['Administrador'], mgmtCurrent: true }, contactLink);
ok('change kind: a contact becomes a manager — the contact fields are cleared', f.isContact === false && f.contactRole === null && f.contactCurrent === null && f.mgmtCurrent === true && f.shCurrent === null);
const handManager = { source: 'manual', mgmtRoles: ['Gerente'], mgmtCurrent: false };
f = R.pmLinkFields({ other: true, role: null }, handManager);
ok('change kind: a hand-added manager becomes a contact — facets cleared, keeps "previous"', f.isContact === true && f.contactCurrent === false && f.mgmtCurrent === null && f.mgmtRoles.length === 0 && f.shCurrent === null);
f = R.pmLinkFields({ owner: true, directPct: 51, shCurrent: true }, { shDirectPct: 50, shCurrent: true });
ok('editing an Orbis owner adds no contact fields to the link', !('isContact' in f) && f.shDirectPct === 51);
ok('kind names for the log', R.pmKind({ owner: true, manager: true }) === 'owner and manager' && R.pmKind({ other: true }) === 'contact' && R.pmKindOfLink({ isContact: true }) === 'contact' && R.pmKindOfLink({ shCurrent: true, mgmtRoles: ['G'] }) === 'owner and manager');

// The window
ok('one window: Owner, Manager, Other (a contact) — Other never with Owner / Manager', page.includes('id="personModal"') && page.includes('<input type="checkbox" id="pmOther"> Other (a contact)') && page.includes("if (e.target.id === 'pmOther' && e.target.checked) { $('pmOwner').checked = false; $('pmManager').checked = false; }"));
ok('only the sections for what is ticked show', page.includes("$('pmOwnerSec').style.display = $('pmOwner').checked ? '' : 'none';") && page.includes("$('pmOtherSec').style.display = $('pmOther').checked ? '' : 'none';"));
ok('permissions: Owner / Manager need edit rights on the company; Other the details permission; Orbis people can\'t become contacts', page.includes("$('pmOwner').disabled = $('pmManager').disabled = !owners;") && page.includes("$('pmOther').disabled = !reach || orbis;")
  && page.includes("if ((f.owner || f.manager) && !canEditCompany(c)) return fail(") && page.includes("if (f.other && link && !isHandLink(link)) return fail("));
ok('adding: owners / managers keep the name-based id; contacts get their own id; email and phone for every kind', page.includes('pid = personDocId(nameKey);') && page.includes("pid = 'm_' + doc(collection(db,'searchPeople')).id;") && page.includes("for (const e of reach) { const r = reachAdd(list,"));
ok('the counts follow when owners / managers change (not for a contact edit — a details-only user can\'t write them)', page.includes('if (!f.other) { await recountCompanyPeople(c.id); await recountPerson(pid); }') && page.includes('if (!(link.isContact && f.other)) await recountCompanyPeople(c.id);'));
ok('a kind change is logged ("contact → manager")', page.includes('if (wasKind !== nowKind) parts.push(`${wasKind} → ${nowKind}`);'));

// Inbox
ok('Inbox "Someone new": Other by default; Manager / Owner / both with edit rights on the company', out.includes('<input type="radio" name="aacKind" value="other" checked>') && out.includes('value="both"> <span>Owner and manager</span>') && out.includes("const canOwners = !a || a.can('search.editall') || (a.can('search.edit') && !!co?.owner && co.owner === a.key);"));
ok('Inbox: an owner / manager gets the facets and the company counts follow; logged with the kind', out.includes("mgmtRoles: manager ? [role || 'Manager'] : []") && out.includes('peopleCounts: { sh: L.filter(l => l.shCurrent === true).length') && out.includes('`Linked person: ${who} (${newKind}) — ${addr} (from the inbox)`'));

// Company import
ok('company import: with the switch on, the file\'s person is not put in the old Contacts list', page.includes("contacts: peopleOn ? [] : contacts,") && page.includes("const person = peopleOn && cName ? { name: cName, role: g('contact role') || '', email: g('contact email') || '', phone: g('contact phone') || '', manager: !g('contact name') } : null;"));
ok('company import: a person (own id), a manager link for a "director" column or a contact link, their email / phone, main contact', page.includes('async function bulkAddPeople(rows, onProgress){') && page.includes("const f = pp.manager ? { manager: true, roles: [role], mgmtCurrent: true } : { other: true, role: role || null };") && page.includes('primaryContact: { personId: pid, name, role: role ||') && page.includes('if (withPerson.length) await bulkAddPeople(withPerson,'));
ok('company import: the person\'s email still finds the company', page.includes('...companyIndexFields(r.person?.email ? { ...co, contacts: [{ email: r.person.email }] } : co),'));

// Statistics
ok('Statistics: companies with a current person who has an OK email or phone', page.includes("where('reach', '!=', [])") && page.includes("(e.status || 'ok') === 'ok')).map(d => d.id);") && page.includes("if (isOn('search.people')) { try { await fetchReachCompanyIds(); }"));
ok('Statistics: the "Contacts" line reads "People with an email or phone"; People statistics count each type', page.includes("get label(){ return reachCompanyIds ? 'People with an email or phone' : 'Contacts'; }") && page.includes("{ title: 'Contact \\u2014 People list', get fields(){"));

// Activity
ok('activity: the person you spoke to is saved and listed on their person page', page.includes('data-pid="${esc(l.personId)}"') && page.includes('contactName: cName||null, contactRole: cRole||null, contactPersonId,') && page.includes("where('contactPersonId', '==', p.id), limit(50)") && page.includes('Activities with them'));

// Phone app
ok('phone: Contacts lists the main contact, then each contact person with their own phone and email', mob.includes("const ctLinks = isOn('search.people') ? links.filter((l) => l.isContact && l.contactCurrent !== false && l.personId !== pc?.personId) : [];") && mob.includes('section(`Contacts <span class="n">${contactCount}</span>`, contacts)'));
ok('phone: a person\'s page shows their own list (all types, Orbis not hidden), contacts count as positions', mob.includes("const contact = isOn('search.people') ? reachHtml(p) : CONTACT_FIELDS") && mob.includes("['website', 'Website / social', 'orbisWebsites']") && mob.includes("if (l.isContact) bits.push('Contact'"));

// 21 Oct (André): add forms one item per line; ☆ on the People tab picks the main entry
ok('add forms: type, value, note and the button each on their own line (person page and People tab)', (page.match(/<div class="reach-add" style="display:grid;/g) || []).length === 2 && page.includes('<label>Type</label><select class="field" id="cpAddType"'));
ok('Contacts tab: the same rows and controls as the person page — ★ to make it the main one, status, ✎, ✕, Hide for Orbis', page.includes("const row = (e) => reachRowHtml(e, canEdit);") && page.includes("reachRowHtml(e, canEdit, pp.id, ICON[e.type] || '')") && page.includes('data-reachprimary="${esc(e.id)}"${P}')
  && page.includes('if (t.dataset.pid && (t.dataset.reachprimary || t.dataset.reachconfirm || t.dataset.reachedit || t.dataset.reachdel || t.dataset.orbhide != null))') && page.includes("const sel = ev.target.closest('[data-reachstatus][data-pid]')") && page.includes('if (edE) { // ✎: change the value or the note, as on the person page'));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
