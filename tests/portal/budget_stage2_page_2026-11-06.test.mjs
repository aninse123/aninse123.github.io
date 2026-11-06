// Budget v2, Stage 2 (6 Nov 2026): the Bank and Inbox tabs in portal/budget-v2.js, the permission and the rules.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../../functions/access/perms.js');
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const v2 = read('../../portal/budget-v2.js'), rules = read('../../firestore.rules'), access = read('../../portal/access.js');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

ok('tabs: Inbox (needs budget.accounts, shows a count of waiting lines) and Bank (needs budget.import)', /data-tab="inbox" data-perm="budget\.accounts"/.test(v2) && /data-tab="bank" data-perm="budget\.import"/.test(v2) && /const inboxCount = \(\) => S\.movements\.filter\(\(m\) => m\.status === 'new'\)\.length/.test(v2));
ok('the bank file is read in the browser only: decoded as the bank writes it, parsed, nothing is sent anywhere', /decodeBank\(await f\.arrayBuffer\(\)\)/.test(v2) && !/fetch\(|httpsCallable|XMLHttpRequest/.test(v2));
ok('several files are checked oldest first, each against the one before, and against what is already stored', /parsed\.sort\(\(a, b\) => a\.from\.localeCompare\(b\.from\)\)/.test(v2) && /existing\.add\(l\.id\)/.test(v2) && /lastStored\(accountId\)/.test(v2));
ok('a file for another account number is blocked; an account without a number remembers it', /but "\$\{acc\.name\}" is set to/.test(v2) && /fileAccountNo: b\.accountNo/.test(v2));
ok('the preview shows new / already imported / period / in / out / balances, the warnings (gap, balance chain, unreadable lines) and what each line looks like — before anything is saved', /already imported/.test(v2) && /<strong>Check:<\/strong>/.test(v2) && /could not be read and will be skipped/.test(v2) && /do not add up from line/.test(v2) && /Looks like/.test(v2));
ok('importing writes each line under its fingerprint (so a repeat can never double), in batches of 400, and records the import', /wb\.set\(doc\(db, 'budgetMovements', l\.id\)/.test(v2) && /i \+= 400/.test(v2) && /addDoc\(collection\(db, 'budgetImports'\)/.test(v2) && /status: 'new'/.test(v2));
ok('importing books nothing: lines wait in the Inbox', /They are waiting in the Inbox/.test(v2) && !/budgetItems[^;]{0,200}importBatch/.test(v2));
ok('an import can be undone: lines still waiting or ignored are removed, booked ones stay, and the batch is marked undone', /async function undoImport/.test(v2) && /m\.status === 'new' \|\| m\.status === 'ignored'/.test(v2) && /status: 'undone'/.test(v2) && /already booked or marked as partner transfers and stay/.test(v2));
ok('Inbox lines: Accept, Edit / Categorise, Link to a matching expense, Ignore; a line with no category cannot be accepted without choosing one', /data-acc=/.test(v2) && /Categorise…/.test(v2) && /data-link=/.test(v2) && /data-ign=/.test(v2) && /g\.kind === 'expense' && !g\.categoryId\) \{ skip\.push\(m\)/.test(v2));
ok('bank charges and interest can be accepted all at once, after a confirmation; money in and partner transfers always need a click', /Accept all \$\{autoN\}/.test(v2) && /sug \|\| \{\}\)\.autoAccept/.test(v2) && /Book \$\{l\.length\} bank charge/.test(v2));
ok('bulk: book the selected payments as expenses in one category and purpose, accept the suggestions, or ignore', /id="ib-go"/.test(v2) && /id="ib-acc"/.test(v2) && /id="ib-ign"/.test(v2) && /Book \$\{exp\.length\} payment\(s\) as expenses/.test(v2) && /Only payments \(money out\) can be booked as expenses/.test(v2));
ok('booking a line creates the item and links both ways in one batch (item.movementId, movement.itemId, status linked)', /wb\.set\(iref, \{ \.\.\.itemDocFromDraft\(d\)/.test(v2) && /status: 'linked', itemId: iref\.id/.test(v2) && /movementId: d\.movementId/.test(v2));
ok('Categorise opens the normal item form already filled from the line, and saving links the line', /openItem\(null, draftFromMovement\(m\)\)/.test(v2) && /updateDoc\(doc\(db, 'budgetMovements', movementId\), \{ status: 'linked', itemId: added\.id \}\)/.test(v2));
ok('a transfer to a partner is parked as "settlement" for the reimbursements step, never booked as a cost', /status: 'settlement', partnerKey/.test(v2) && /Linking these to the expenses they repay comes in the reimbursements step/.test(v2));
ok('Inbox also lists documents to fix, items not yet shared, and what the company owes each partner', /Documents to fix/.test(v2) && /Not shared with the accountant/.test(v2) && /The company owes/.test(v2));
ok('ignored lines can be shown and restored', /data-back=/.test(v2) && /Show \$\{ignored\.length\} ignored line/.test(v2) || /ignored line\$\{ignored\.length === 1/.test(v2));

ok('Items bulk edit can also set category and purpose on the selected items (money received keeps its own type)', /data-bulk="classify"/.test(v2) && /if \(it\.kind === 'income'\) continue/.test(v2) && /Choose a category and\/or a purpose first/.test(v2));
ok('permission budget.import exists in both lists with the same wording; Partners have it, interns do not, it is not Admin-only', (() => { const re = /\["budget\.import", "Budget", "([^"]+)"\]/; const a = re.exec(read('../../functions/access/perms.js')), b = re.exec(access); return !!a && !!b && a[1] === b[1]; })() && P.PARTNER_PERMS.includes('budget.import') && !P.ADMIN_ONLY.includes('budget.import') && !P.DEFAULT_ROLES.intern.perms.includes('budget.import'));
ok('Firestore: bank lines and import batches are read with budget.accounts and written with budget.import', /match \/budgetMovements\/\{id\} \{\s*allow read: if can\('budget\.accounts'\);\s*allow write: if can\('budget\.import'\);/.test(rules) && /match \/budgetImports\/\{id\} \{\s*allow read: if can\('budget\.accounts'\);\s*allow write: if can\('budget\.import'\);/.test(rules));

console.log(fail ? `\n${fail} FAILED` : '\nall budget stage 2 page tests passed'); process.exit(fail ? 1 : 0);
