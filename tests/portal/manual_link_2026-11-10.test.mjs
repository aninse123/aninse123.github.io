// Manual link between companies (10 Nov 2026, switch search.manualLinks): the Ownership tab card, its checks and its wiring.
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const search = read('../../portal/search.html');
const catalog = read('../../functions/features/catalog.js');
const features = read('../../portal/features.js');
const rules = read('../../firestore.rules');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

// the checks, lifted from the page and run on sample data
const consts = /const MANUAL_LINK_MAX = (\d+), MANUAL_NOTE_MIN = (\d+), MANUAL_NOTE_MAX = (\d+);/.exec(search);
const fn = /function manualLinkProblem\(c, o, list, note\)\{[\s\S]*?\n\}/.exec(search);
ok('the page defines the limits and the check', !!consts && !!fn);
const check = new Function(`const MANUAL_LINK_MAX = ${consts[1]}, MANUAL_NOTE_MIN = ${consts[2]}, MANUAL_NOTE_MAX = ${consts[3]}; ${fn[0]}; return manualLinkProblem;`)();
const c = { id: 'c1' }, o = { id: 'c2' };
ok('a company, a few words of note: no problem', check(c, o, [], 'mesma família') === '');
ok('no company chosen', check(c, null, [], 'mesma família') === 'Choose a company.');
ok('a company cannot be linked to itself', check(c, { id: 'c1' }, [], 'mesma família') === 'A company cannot be linked to itself.');
ok('already linked', check(c, o, [{ companyId: 'c2' }], 'mesma família') === 'Already linked.');
ok('at most 10 links', check(c, o, Array.from({ length: 10 }, (_, i) => ({ companyId: 'x' + i })), 'mesma família') === 'At most 10 links on a company.');
ok('the note is required (3 characters at least)', check(c, o, [], '') !== '' && check(c, o, [], '  ab ') !== '' && check(c, o, [], 'abc') === '');
ok('the note is at most 200 characters', check(c, o, [], 'n'.repeat(201)) !== '' && check(c, o, [], 'n'.repeat(200)) === '');

ok('switch in the catalog and in the portal list, as a release switch', /key: "search\.manualLinks", area: "Search CRM", kind: "release"/.test(catalog) && /\['search\.manualLinks', 'Search CRM', 'release'/.test(features));
ok('the card is drawn only when the switch is on, under Same email', /isOn\('search\.manualLinks'\) \? '<div id="ownManualLinks"/.test(search) && /if \(isOn\('search\.manualLinks'\)\) renderManualLinks\(c\)/.test(search));
ok('a link is written on BOTH companies (manualLinks, arrayUnion) and logged on both', (search.match(/manualLinks: arrayUnion\(\{ companyId: (oid|c\.id), note/g) || []).length === 2 && (search.match(/logAuto\((c\.id|oid), 'company_edited', `Manual link:/g) || []).length === 2);
ok('Unlink removes it from both companies', /keepA = \(a\.data\(\)\?\.manualLinks \|\| \[\]\)\.filter\(x => x\.companyId !== oid\), keepB = \(b\.data\(\)\?\.manualLinks \|\| \[\]\)\.filter\(x => x\.companyId !== c\.id\)/.test(search));
ok('the other company is read first (it must exist and have room)', /getDoc\(doc\(db, 'searchCompanies', oid\)\)[\s\S]{0,400}That company no longer exists\./.test(search));
ok('the Firestore rules let search.edit / search.editall change only manualLinks (plus the stamps)', /canAny\(\['search\.edit', 'search\.editall'\]\) && onlyFields\(\['manualLinks'\]\.concat\(stampFields\(\)\)\)/.test(rules));
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
