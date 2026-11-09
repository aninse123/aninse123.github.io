// Ownership tab (9 Nov 2026, switch search.hideNonDeciders): people who only have roles that never decide and hold no share
// are hidden from the People list and the Network graph, with a "N people hidden" line; everyone else shows as before.
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const search = read('../../portal/search.html');
const catalog = read('../../functions/features/catalog.js');
const features = read('../../portal/features.js');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

const re = /const OWN_AUDITOR_RE = (\/.*\/[a-z]*);/.exec(search);
const fn = /function linkNonDeciderOnly\(l\)\{[\s\S]*?\n\}/.exec(search);
ok('the page defines the role list and the filter', !!re && !!fn);
const linkIsShareholder = (l) => l.shCurrent !== undefined && l.shDirectPct != null;
const hid = new Function('OWN_AUDITOR_RE', 'linkIsShareholder', `${fn[0]}; return linkNonDeciderOnly;`)(eval(re[1]), linkIsShareholder);

ok('sole auditor (fiscal único): hidden', hid({ mgmtRoles: ['Sole Fiscal', 'Fiscal Unico'] }) === true);
ok('substitute sole fiscal with "no specific function": hidden', hid({ mgmtRoles: ['Substitute Sole Fiscal', 'Fiscal Unico - Sup.', 'No specific function'] }) === true);
ok('assembly secretary and president: hidden', hid({ mgmtRoles: ['Secretary of the General Assembly'] }) === true && hid({ mgmtRoles: ['Presidente da Assembleia Geral'] }) === true);
ok('a gerente, a board member and a functional director: shown', hid({ mgmtRoles: ['Manager', 'Gerente'] }) === false && hid({ mgmtRoles: ['Voter of the Board of Directors'] }) === false && hid({ mgmtRoles: ['Financial Director'] }) === false);
ok('a mix of a fiscal role and a real role: shown', hid({ mgmtRoles: ['Sole Fiscal', 'Manager'] }) === false);
ok('a holder with a stake: shown, whatever the role', hid({ mgmtRoles: ['Sole Fiscal'], shCurrent: true, shDirectPct: 30 }) === false);
ok('a contact or a hand-added person: shown', hid({ mgmtRoles: ['Sole Fiscal'], isContact: true }) === false && hid({ mgmtRoles: ['Sole Fiscal'], addedBy: 'a@b.pt' }) === false);
ok('no role at all: shown (nothing says they never decide)', hid({ mgmtRoles: [] }) === false && hid({}) === false);

ok('switch in the catalog and in the portal list, as a release switch', /key: "search\.hideNonDeciders", area: "Search CRM", kind: "release"/.test(catalog) && /\['search\.hideNonDeciders', 'Search CRM', 'release'/.test(features));
ok('People list: filtered only when the switch is on, with the hidden line', /const hideOn = isOn\('search\.hideNonDeciders'\);/.test(search) && /rows\.filter\(l => !linkNonDeciderOnly\(l\)\)/.test(search) && search.includes('data-hidden-people'));
ok('Network graph: same filter on the links of the company, only when the switch is on', search.includes("filter(l => !(isOn('search.hideNonDeciders') && linkNonDeciderOnly(l)))"));
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
