// People merge, Stage 1 (20 Oct 2026, switch search.people): an Orbis import
// never marks a person added by hand "previous"; those the file doesn't list
// are flagged; a same or similar name brought by the file to the same company
// goes to the review list (never merged automatically). Runs the page's own
// helpers (isHandLink, personNameMatch, handLinksAfterImport, computeFacetScope)
// and checks the wiring. Synthetic data.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const grab = (start, endMarker = '\n}\n') => { const i = page.indexOf(start); if (i < 0) throw new Error(start); const j = page.indexOf(endMarker, i); return page.slice(i, j + endMarker.length); };
const line = (start) => { const i = page.indexOf(start); if (i < 0) throw new Error(start); return page.slice(i, page.indexOf('\n', i)); };
const ctx = {};
vm.createContext(ctx);
vm.runInContext([
  line('const PERSON_SALUT'), grab('function deburr('), grab('function personNameKey('), line('const PERSON_STOPWORDS'), line('function personNameTokens('),
  line('const isHandLink ='), grab('function personNameMatch('), grab('function handLinksAfterImport('), grab('function computeFacetScope('),
  'globalThis.H = { isHandLink, personNameMatch, handLinksAfterImport, computeFacetScope };',
].join('\n'), ctx);
const { H } = ctx;

let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

ok('hand link = source other than orbis; old Orbis links (no source) are Orbis', H.isHandLink({ source: 'manual' }) && !H.isHandLink({ source: 'orbis' }) && !H.isHandLink({}));
ok('same name once titles, accents and capitals are ignored', H.personNameMatch('Mr José Silva', 'JOSE SILVA') === 'same');
ok('similar: one name inside the other', H.personNameMatch('Manuel Fernandes', 'Manuel dos Santos Fernandes') === 'similar');
ok('similar: same first and last word', H.personNameMatch('Ana Maria Costa', 'Ana Rita Costa') === 'similar');
ok('different people: no match', H.personNameMatch('Ana Costa', 'Rui Costa') === null && H.personNameMatch('Silva', 'Ana Silva') === null);

// A file covering company C1: Orbis lists Manuel dos Santos Fernandes and Ana; João was added by hand.
const rows = [
  { companyId: 'C1', personId: 'u_1', personName: 'MANUEL DOS SANTOS FERNANDES', isSh: true },
  { companyId: 'C1', personId: 'u_2', personName: 'ANA COSTA', isMgmt: true },
];
const links = new Map([['C1', [
  { id: 'u_1__C1', personId: 'u_1', companyId: 'C1', personName: 'Manuel dos Santos Fernandes', source: 'orbis', shCurrent: true },
  { id: 'n_MANUEL_FERNANDES__C1', personId: 'n_MANUEL_FERNANDES', companyId: 'C1', personName: 'Manuel Fernandes', source: 'manual', mgmtCurrent: true },
  { id: 'n_JOAO__C1', personId: 'n_JOAO', companyId: 'C1', personName: 'João Moura', source: 'manual', mgmtCurrent: true },
]], ['C2', [
  { id: 'n_RUI__C2', personId: 'n_RUI', companyId: 'C2', personName: 'Rui', source: 'manual', mgmtCurrent: true },
]]]);
const scope = H.computeFacetScope(rows);
const res = H.handLinksAfterImport(rows, links, scope);
ok('hand-added people on a covered company, not in the file → flagged (both)', res.missing.map((l) => l.id).sort().join() === 'n_JOAO__C1,n_MANUEL_FERNANDES__C1');
ok('a company the file doesn\'t cover is left alone', !res.missing.some((l) => l.companyId === 'C2'));
ok('Manuel Fernandes ↔ Manuel dos Santos Fernandes → one review pair, "similar"', res.reviews.length === 1 && res.reviews[0].id === 'n_MANUEL_FERNANDES__C1__u_1' && res.reviews[0].match === 'similar');

// Page wiring
ok('import never demotes a hand link (real import and the dry-run check)', (page.match(/if \(isHandLink\(l\)\) continue;/g) || []).length === 2);
ok('flag written, review pairs only with the switch on and only once per pair', page.includes("batch.update(doc(db,'searchPersonLinks', l.id), { orbisMissingAt: serverTimestamp() })") && page.includes("if (hand.reviews.length && isOn('search.people'))") && page.includes("const ex = await getDoc(doc(db,'peopleReview', rv.id)); addReads(1); if (!ex.exists()) fresh.push(rv);"));
ok('import summary tells how many were kept and how many to review', page.includes('hand-added ${hand.missing.length === 1 ? \'person\' : \'people\'} kept, not in this file.') && page.includes('to review (People view).'));
ok('Add Person records who and when (new links only)', page.includes("...(editLinkId ? {} : { addedBy: currentUser, addedAt: serverTimestamp() })"));
ok('Ownership card: chips and Mark previous / current only for hand links, switch on', page.includes('const handBtn = l => !peopleOn || !isHandLink(l) ?') && page.includes('${handBtn(l)}') && page.includes('${handChips(l)}') && page.includes('async function toggleHandLink(linkId)'));
ok('People view: Added by hand, Possible same people, Merge / Keep separate', page.includes('id="peopleHandBtn"') && page.includes('id="peopleReviewBtn"') && page.includes('data-rvmerge') && page.includes('data-rvkeep') && page.includes("status: merge ? 'merged' : 'kept'"));
ok('merge is logged and never counts as a touch', page.includes("logAuto(r.companyId, 'person_merged'") && /AUTO_TYPES = \[[^\]]*'person_merged'\]/.test(page));
ok('rules: peopleReview readable with search.view, never deleted', /match \/peopleReview\/\{id\} \{\n\s+allow read: if can\('search\.view'\);\n\s+allow create: if can\('search\.import'\) \|\| can\('search\.editall'\);\n\s+allow update: if can\('search\.editall'\);\n\s+\}/.test(rules));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
