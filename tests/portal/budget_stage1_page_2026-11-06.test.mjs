// Budget v2, Stage 1 (6 Nov 2026): the page wiring in portal/budget-v2.js and budget.html, the permission, and the rules.
// Source-level checks like the other portal suites; the logic itself is tested in budget_stage1_lib_*.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../../functions/access/perms.js');
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const v2 = read('../../portal/budget-v2.js'), page = read('../../portal/budget.html'), rules = read('../../firestore.rules'), access = read('../../portal/access.js');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

ok('budget.html loads v2 only when the budget.v2 switch is available, and hides the v1 page', /if \(isOn\('budget\.v2'\)\) \{[\s\S]*?v1main'\)\.style\.display = 'none'[\s\S]*?import\('\.\/budget-v2\.js'\)/.test(page));
ok('if v2 fails to start the original page comes back', /Budget v2 failed to start, showing the original page/.test(page) && /v2\.style\.display = 'none';\s*document\.getElementById\('v1main'\)\.style\.display = '';/.test(page));
ok('the original page loads its items only when v2 is not used (no double reads)', /return;\s*\}\s*populateCategorySelects\(\);\s*await loadAll\(\);/.test(page));
ok('v2 has the tabs Overview, Items, Accounts (budget.accounts), Suppliers, Settings', ['overview', 'items', 'suppliers', 'settings'].every((t) => v2.includes(`data-tab="${t}"`)) && /data-tab="accounts" data-perm="budget\.accounts"/.test(v2));
ok('Items filters: kind, category, purpose, tag, paperwork, shared, used by, dates, archived, review', ['fKind', 'fCategory', 'fPurpose', 'fTag', 'fDoc', 'fShared', 'fUsed', 'fFrom', 'fTo', 'fArch', 'fReview'].every((id) => v2.includes(`id="${id}"`)));
ok('every field of the plan is in the item form (kind, category, purpose, tags, paid with, paid personally by, used by, document, our NIF, supplier, tax id, number, ATCUD, invoice date, country, VAT, currency, income type, shared)', ['f-kind', 'f-category', 'f-purpose', 'f-tags', 'f-paidwith', 'f-personal', 'data-used', 'f-doctype', 'f-issued', 'f-supplier', 'f-taxid', 'f-docnum', 'f-atcud', 'f-invdate', 'f-country', 'f-vatrate', 'f-vatamt', 'f-currency', 'f-income', 'f-shared'].every((id) => v2.includes(id)));
ok('the form shows the paperwork status live, with the company name and NIF to ask for', /docStatus\(readDraft\(\)\)/.test(v2) && /Ask for the invoice in the name of/.test(v2) && /Fill in Company details in Settings/.test(v2));
ok('a file picked but not yet saved already clears the "No document" warning', /\.\.\.Array\.from\(\$\('f-files'\)\.files \|\| \[\]\)\.map\(\(f\) => \(\{ name: f\.name \}\)\)/.test(v2));
ok('a Portuguese NIF typed with spaces or PT is stored as 9 digits, a foreign VAT ID as typed', /normalizeNif\(taxRaw\) : taxRaw/.test(v2));
ok('VAT: Overview shows total paid, recovered, still to recover and at risk (with a link to the at-risk items); the accountant decides', ['Total VAT paid', 'VAT recovered', 'Still to recover', 'At risk'].every((t) => v2.includes(t)) && /data-go="vatrisk"/.test(v2) && /your accountant decides what can be recovered/.test(v2));
ok('VAT: a deductible choice per item (default Ask the accountant), a VAT column, a VAT filter, supplier and CSV columns', /id="f-vatded"/.test(v2) && /\(d\.vatDeductible \|\| 'ask'\)/.test(v2) && /<th class="num">VAT<\/th>/.test(v2) && /id="fVat"/.test(v2) && /'VAT deductible', 'VAT group'/.test(v2) && /<th class="num">VAT<\/th><th><\/th>/.test(v2));
ok('VAT: a VAT refund is entered as money received and tells the person where', /type "VAT refund"/.test(v2));
ok('a warning never blocks saving (only name, amount, category and "paid personally by" are required)', !/alert\([^)]*(NIF|paperwork|document)/i.test(v2.slice(v2.indexOf('async function saveItem'), v2.indexOf('// ── Accounts ──'))));
ok('every non-obvious field has an i hover explanation (i icon, hover and keyboard focus)', /const tip = \(k\)/.test(v2) && /\.v2-tip:hover::after, #v2root \.v2-tip:focus::after/.test(v2) && Object.keys(Object.fromEntries([...v2.matchAll(/^  (\w+): '/gm)].map((m) => [m[1], 1]))).length >= 20 && ['kind', 'category', 'purpose', 'tags', 'paidWith', 'paidPersonallyBy', 'usedBy', 'docType', 'issuedToCompany', 'supplierTaxId', 'country', 'shared', 'incomeType', 'iban'].every((k) => new RegExp(`^  ${k}: '`, 'm').test(v2)));
ok('items keep the v1 fields (type cost/revenue, category label) so the v1 page still works if the switch is turned Off', /type: kind === 'expense' \? 'cost' : 'revenue'/.test(v2) && /category: existing\?\.category/.test(v2));
ok('old items are read through normalizeItem and not rewritten until saved or reviewed', /normalizeItem\(\{ id: d\.id, \.\.\.d\.data\(\) \}\)/.test(v2) && !/loadAll[\s\S]{0,400}updateDoc/.test(v2.slice(v2.indexOf('async function loadAll'), v2.indexOf('// ── Small lookups'))));
ok('old Revenue entries are reviewed with one click: Capital call, Interest, Plan or Archive', /data-as="capital_call"/.test(v2) && /data-as="interest"/.test(v2) && /data-as="plan"/.test(v2) && /data-as="archive"/.test(v2) && /patch = as === 'archive' \? \{ archived: true \}/.test(v2));
ok('archiving needs confirmation and deleting offers archive instead; nothing is deleted without asking', /Archive \$\{ids\.length\} item\(s\)\?/.test(v2) && /Archive it instead if you only want it out of the totals/.test(v2));
ok('bulk actions: mark shared / not shared (date and who), add tag, archive, restore', /sharedAt: new Date\(\)\.toISOString\(\), sharedBy: access\.email/.test(v2) && ['share', 'unshare', 'tag', 'archive', 'restore'].every((a) => v2.includes(`data-bulk="${a}"`)));
ok('an item edited after it was shared is flagged "changed since shared"', /data\.changedSinceShared = existing\?\.sharedHash \? packHash\(merged\) !== existing\.sharedHash : true/.test(v2) && /Changed since it was shared/.test(v2));
ok('a new supplier name typed on an item is saved as a supplier', /addDoc\(collection\(db, 'budgetSuppliers'\)/.test(v2) && /A new supplier name is saved for next time/.test(v2));
ok('Used by lists the team directory plus External, with a weight per person', /loadDirectory\(\)/.test(v2) && /key: 'external', label: 'External'/.test(v2) && /data-weight=/.test(v2));
ok('Paid with offers company accounts, company cards, cash and "paid personally"; personal asks who', /Company accounts/.test(v2) && /Company cards/.test(v2) && /value="personal"/.test(v2) && /Choose who paid personally/.test(v2));
ok('IBANs are checked on entry (warn, not block) for company accounts and partner profiles', /ibanHint\(/.test(v2) && /does not pass the check digits/.test(v2));
ok('a partner edits only their own IBAN profile (the Admin any); copy IBAN and transfer details are offered', /const mine = isAdmin \|\| myKey === p\.key/.test(v2) && /Copy transfer details/.test(v2) && /Reference: \${INSTANCE\.orgName} reimbursement/.test(v2));
ok('the app never moves money: no network call of any kind besides Firestore and Storage', !/fetch\(|httpsCallable|XMLHttpRequest|sendBeacon/.test(v2));
ok('lists are editable in Settings: rename, retire/restore, add; saved to budgetSettings/lists; ids never change', /budgetSettings', 'lists'/.test(v2) && /data-arch=/.test(v2) && /newListId\(label, work\[key\]\)/.test(v2) && /never deleted: retire it/.test(v2));
ok('Settings keeps the company details form and the JSON backup from Stage 0', /id="cs-save"/.test(v2) && /douro-budget-backup-/.test(v2) && /logEvent\('budget_backup'/.test(v2));
ok('the CSV export carries every new field and is formula-injection safe', /Supplier NIF \/ VAT ID/.test(v2) && /Invoice shows our NIF/.test(v2) && /Shared with accountant/.test(v2) && /\^\[=\+\\-@/.test(v2));

ok('permission budget.accounts exists in both permission lists (functions and page) with the same wording', (() => { const a = /\["budget\.accounts", "Budget", "([^"]+)"\]/.exec(readFileSync(new URL('../../functions/access/perms.js', import.meta.url), 'utf8')), b = /\["budget\.accounts", "Budget", "([^"]+)"\]/.exec(access); return !!a && !!b && a[1] === b[1]; })());
ok('Partners get budget.accounts by default; it is not Admin-only', P.PARTNER_PERMS.includes('budget.accounts') && !P.ADMIN_ONLY.includes('budget.accounts') && !P.DEFAULT_ROLES.intern.perms.includes('budget.accounts'));
ok('Firestore: suppliers need budget.view / budget.edit', /match \/budgetSuppliers\/\{id\} \{\s*allow read: if can\('budget\.view'\);\s*allow write: if can\('budget\.edit'\);/.test(rules));
ok('Firestore: accounts and cards need budget.accounts', /match \/budgetAccounts\/\{id\} \{\s*allow read, write: if can\('budget\.accounts'\);/.test(rules) && /match \/budgetCards\/\{id\} \{\s*allow read, write: if can\('budget\.accounts'\);/.test(rules));
ok('Firestore: IBAN profiles are read by budget.accounts holders and written only by the person (document id = their key); the Admin by the catch-all', /match \/budgetPeople\/\{key\} \{\s*allow read: if can\('budget\.accounts'\);\s*allow write: if can\('budget\.accounts'\) && request\.auth\.token\.get\('key', ''\) == key;/.test(rules));

console.log(fail ? `\n${fail} FAILED` : '\nall budget stage 1 page tests passed'); process.exit(fail ? 1 : 0);
