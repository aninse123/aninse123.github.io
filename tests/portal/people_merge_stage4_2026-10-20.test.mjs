// People merge, Stage 4 (20 Oct 2026, switch search.people): everything that
// read the old Contacts reads People — Compose / task cards / WhatsApp in
// Outreach, the send modal, header, export, activity form, email search and
// mobile in the Search CRM. Runs the pages' own helpers and checks the wiring.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const out = read('../../portal/outreach.html'), search = read('../../portal/search.html'), mob = read('../../portal/m/app.js'), rules = read('../../firestore.rules');
const grab = (src, start, end) => { const i = src.indexOf(start); if (i < 0) throw new Error(start); const j = src.indexOf(end, i); return src.slice(i, j + end.length); };

// Outreach helpers
const o = {}; vm.createContext(o);
vm.runInContext([grab(out, '    function personValues(', '\n    }\n'), grab(out, '    function companyDomainsOf(', '\n    }\n'), grab(out, '    function personDetails(', '\n    }\n'), 'globalThis.D = { personDetails };'].join('\n'), o);
// Search CRM helper
const s = {}; vm.createContext(s);
vm.runInContext([grab(search, 'const LEGACY_ORBIS_FIELD', '\n};\n'), grab(search, 'function orbisValues(', '\n}\n'), grab(search, 'function personEmailsFor(', '\n}\n'), 'globalThis.E = { personEmailsFor };'].join('\n'), s);

let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
const co = { companyEmail: 'geral@empresa.pt', website: 'www.empresa.pt' };
const p = { email: 'typed@empresa.pt', orbisEmails: ['orbis@empresa.pt', 'hidden@empresa.pt'], orbisPhones: ['+351 21 000 0000'], hiddenOrbis: ['hidden@empresa.pt'],
  reach: [{ type: 'email', value: 'Joao@Gmail.com', status: 'ok', primary: true }, { type: 'email', value: 'joao@empresa.pt', status: 'ok' }, { type: 'email', value: 'old@empresa.pt', status: 'bounced' }, { type: 'phone', value: '+351 910 000 000', status: 'ok', primary: true }] };

ok('Outreach, switch off: as before (typed, then Orbis)', JSON.stringify(o.D.personDetails(p, 'email', co, false)) === JSON.stringify(['typed@empresa.pt', 'hidden@empresa.pt', 'orbis@empresa.pt']));
ok('Outreach, switch on: own (company domain, then primary), typed, Orbis — no bounced / hidden', JSON.stringify(o.D.personDetails(p, 'email', co, true)) === JSON.stringify(['joao@empresa.pt', 'Joao@Gmail.com', 'typed@empresa.pt', 'orbis@empresa.pt']));
ok('Outreach, switch on: the own phone first, then Orbis', JSON.stringify(o.D.personDetails(p, 'phone', co, true)) === JSON.stringify(['+351 910 000 000', '+351 21 000 0000']));
ok('Search CRM send modal: same order, lowercased', JSON.stringify(s.E.personEmailsFor(p, co)) === JSON.stringify(['joao@empresa.pt', 'joao@gmail.com', 'typed@empresa.pt', 'orbis@empresa.pt']));

// Wiring
ok('Outreach: people list leaves out previous contacts (switch on) and all contacts (off); role "Contact"', out.includes("(isOn('search.people') ? !(l.isContact && l.contactCurrent === false) : !l.isContact)") && out.includes("role: l.isContact ? (l.contactRole || 'Contact')"));
ok('Outreach: task card puts the main contact first; WhatsApp falls back to people\'s phones', out.includes("const mainId = isOn('search.people') ? c?.primaryContact?.personId : null;") && out.includes('|| waPeople) : null;'));
ok('Search CRM: send modal offers people\'s own emails, contact people, main contact first', search.includes('const emails = peopleOn ? personEmailsFor(p, c) :') && search.includes("' ★ main contact'"));
ok('Search CRM: header shows the main contact (switch on)', search.includes("const primary = (isOn('search.people') && c.primaryContact?.name) ? { name: c.primaryContact.name, role: c.primaryContact.role || 'main contact' }"));
ok('Search CRM: export has the main contact and its email / phone', search.includes("key: 'mainContactEmail', label: 'Main contact email'") && search.includes("key: 'mainContactPhone', label: 'Main contact phone'"));
ok('Search CRM: "Contact involved" lists the company\'s people', search.includes('const contactOpts = peopleOpts +') && search.includes('${contactOpts?`<div class="form-group"><label>Contact involved'));
ok('Search CRM: main contact saved with name / role / email / phone, refreshed when their details change', search.includes('async function mainContactSnapshot(personId, c, link)') && search.includes('if (co.primaryContact?.personId === p.id) patch.primaryContact ='));
ok('Search CRM: people\'s emails added to their companies\' email search (never removed)', search.includes('if (add.length) patch.emailKeys = [...keys, ...add];') && search.includes('const newKeys = companyEmailKeys({ contacts: reach.filter('));
ok('rules: reach-only users may update primaryContact and emailKeys on a company, nothing else', rules.includes("|| (can('search.reach') && onlyFields(['primaryContact', 'emailKeys'].concat(stampFields())))"));
ok('a main contact removed or marked previous stops being the main contact', search.includes('if (!toCurrent && c.primaryContact?.personId === link.personId) await clearMainContactOf(c, link);') && search.includes('if (link && c.primaryContact?.personId === link.personId) await clearMainContactOf(c, link);'));
ok('mobile: the main contact on top of Contacts (switch on)', mob.includes("const pc = isOn('search.people') ? c.primaryContact : null;") && mob.includes('const contacts = (mainRow + contactsList) ||'));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
