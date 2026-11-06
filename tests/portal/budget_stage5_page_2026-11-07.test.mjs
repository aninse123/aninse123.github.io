// Budget v2, Stage 5a (7 Nov 2026): the Packs tab in portal/budget-v2.js, "changed since shared" by fingerprint, and the budgetPacks rule.
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const v2 = read('../../portal/budget-v2.js'), rules = read('../../firestore.rules');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

ok('a Packs tab, for people who can edit the budget', /data-tab="packs" data-perm="budget\.edit"/.test(v2) && /packs: renderPacks/.test(v2));
ok('the month starts as last month; picking another month or ticking "include already sent" resets the unticked items', /d\.setUTCMonth\(d\.getUTCMonth\(\) - 1\)/.test(v2) && /id="pk-month"/.test(v2) && /id="pk-sent"/.test(v2) && /packUi\.off\.clear\(\)/.test(v2));
ok('the preview shows expenses, money received, files, VAT, the items to fix (each opens its item), changed-since-sent items, and a row per item with an untick box', ['Receipt files', 'VAT on these expenses', 'with missing or wrong paperwork', 'Changed since sent', 'data-poff=', 'data-pedit='].every((t) => v2.includes(t)) && /packCandidates\(S\.items, \{ \.\.\.range, includeSent: packUi\.includeSent \}\)/.test(v2));
ok('a paperwork problem never blocks the pack: it is listed as missing (with what to ask for)', /You can still create the pack: they are listed on its "Missing documents" sheet/.test(v2) && /still have missing or wrong paperwork and will be listed as missing/.test(v2));
ok('"Download Excel preview" builds the file and changes nothing (no write call in it)', (() => { const i = v2.indexOf("body.querySelector('#pk-preview')"); const seg = v2.slice(i, v2.indexOf("body.querySelector('#pk-create')")); return /buildXlsx\(packSheets\(sel, packContext\(range, now\)\)\.sheets\)/.test(seg) && !/addDoc|updateDoc|setDoc|writeBatch|deleteDoc/.test(seg); })());
ok('creating the pack asks first, saves a frozen copy (the sheets as one JSON text, the item ids, counts, totals, who and when), then marks every item shared with the pack id and its fingerprint, in batches of 400', /if \(!confirm\(msg\)\) return;/.test(v2) && /addDoc\(collection\(db, 'budgetPacks'\), \{ from: range\.from, to: range\.to, status: 'created'/.test(v2) && /sheetsJson: json/.test(v2) && /itemIds: sel\.map/.test(v2) && /sharedAt: at, sharedBy: access\.email, packId: k\.id, sharedHash: packHash\(c\.item\), changedSinceShared: false/.test(v2) && /i \+= 400/.test(v2));
ok('a pack too large to save as one copy is refused, with advice to choose a shorter period', /json\.length > 900000/.test(v2) && /Choose a shorter period/.test(v2));
ok('the Excel file downloads after creating; a saved pack can be downloaded again from its frozen copy', /downloadBytes\(packFileName\(INSTANCE\.orgName, range\), buildXlsx\(P\.sheets\)\)/.test(v2) && /buildXlsx\(JSON\.parse\(k\.sheetsJson\)\)/.test(v2));
ok('Undo asks first, takes the shared mark off exactly the items of that pack and marks the pack unmarked (the saved copy stays)', /async function undoPack/.test(v2) && /S\.items\.filter\(\(i\) => i\.packId === id\)/.test(v2) && /sharedAt: '', sharedBy: '', packId: '', sharedHash: '', changedSinceShared: false/.test(v2) && /status: 'undone'/.test(v2) && /The saved copy stays in the list as unmarked/.test(v2));
ok('the bank lines sheet is only built for people who may see bank data', /movements: can\('budget\.accounts'\) \? S\.movements : undefined/.test(v2));
ok('the file name carries the organisation from the instance settings, not a typed name', /packFileName\(INSTANCE\.orgName/.test(v2));
ok('"changed since shared" now depends on what the accountant sees (the fingerprint), on save, in bulk share and in the Items table', /packHash\(merged\) !== existing\.sharedHash/.test(v2) && /sharedHash: packHash\(it\)/.test(v2) && /\$\{changedSince\(i\) \?/.test(v2) && /data\.sharedHash = packHash\(merged\)/.test(v2));
ok('unsharing (the box or bulk) clears the fingerprint and the pack link', /sharedHash: '', packId: ''/.test(v2) && /data\.sharedHash = ''; data\.packId = ''/.test(v2));
ok('no network call anywhere: the pack is built in the browser and downloaded', !/fetch\(|httpsCallable|XMLHttpRequest|sendBeacon/.test(v2));
ok('Firestore: packs are read with budget.view and written with budget.edit', /match \/budgetPacks\/\{id\} \{\s*allow read: if can\('budget\.view'\);\s*allow write: if can\('budget\.edit'\);/.test(rules));

console.log(fail ? `\n${fail} FAILED` : '\nall budget stage 5a page tests passed'); process.exit(fail ? 1 : 0);
