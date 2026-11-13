// Budget v2 simplifications (13 Nov 2026, review claude.ai/artifact/Qqz7WqFj4Ej7FiEypmAfhR): six tabs, a shorter item form,
// "Used by" as ticks, the spending plan hidden until used, the manual "shared" mark tucked away. Source-level checks like the other portal suites.
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const v2 = read('../../portal/budget-v2.js');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
const tabs = [...v2.matchAll(/<button data-tab="([a-z]+)"/g)].map((m) => m[1]);

// S1 — six tabs
ok('S1: exactly six tabs, in order: Overview, Items, Reports, Packs, Inbox, Settings', tabs.join(',') === 'overview,items,reports,packs,inbox,settings');
ok('S1: an old Bank / Accounts / Suppliers tab value opens Inbox or Settings', /const TAB_MOVED = \{ bank: 'inbox', accounts: 'settings', suppliers: 'settings' \}/.test(v2) && /if \(TAB_MOVED\[S\.tab\]\) S\.tab = TAB_MOVED\[S\.tab\]/.test(v2));
ok('S1: no renderBank / renderAccounts / renderSuppliers left, and nothing sends you to a Bank tab', !/renderBank|renderAccounts|renderSuppliers/.test(v2) && !/S\.tab = 'bank'/.test(v2) && !/Bank tab/.test(v2));
ok('S1: the Inbox draws the import box (budget.import) above the bank lines and wires it', /\$\{accountsOn \? bankImportHtml\(lines\.length\) : ''\}/.test(v2) && /wireBankImport\(body\);/.test(v2));
ok('S1: the import box is open while no lines wait or a file is being read; the person\'s own open/close is remembered', /const open = bankPlans\.length > 0 \|\| \(importUi\.open == null \? !waiting : importUi\.open\)/.test(v2) && /importUi\.open = !box\.open/.test(v2));
ok('S1: past imports with Undo sit in a folded "Imports so far" inside the box', /id="b-hist"/.test(v2) && /data-undo="\$\{b\.id\}"/.test(v2));
ok('S1: Settings has a jump list and the sections company, accountant, bank accounts, partners, suppliers, plan, lists, backup', ['set-company', 'set-accountant', 'set-accounts', 'set-partners', 'set-suppliers', 'set-plan', 'set-lists', 'set-backup'].every((id) => v2.includes(`id="${id}"`)) && /data-jump="\$\{id\}"/.test(v2));
ok('S1: bank accounts and partner profiles in Settings only for budget.accounts holders (same as the old tab)', /const accountsOn = can\('budget\.accounts'\);\s*const jump = /.test(v2) && /if \(accountsOn\) wireAccounts\(body\);/.test(v2));
ok('S1: with no bank account the import points to Settings', /Add a bank account first \(Settings → Bank accounts and cards\)/.test(v2));

// S2 — shorter item form
const form = v2.slice(v2.indexOf('function openItem('), v2.indexOf('function wireItemForm('));
const fold = form.slice(form.indexOf('id="f-more"'), form.indexOf('</details>'));
ok('S2: Document, Shows our NIF, Supplier and VAT amount stay outside the fold', ['f-doctype', 'f-issued', 'f-supplier', 'f-vatamt'].every((id) => form.includes(`id="${id}"`) && !fold.includes(`id="${id}"`)));
ok('S2: the other invoice fields are folded under "More invoice details"', /More invoice details/.test(fold) && ['f-taxid', 'f-docnum', 'f-atcud', 'f-invdate', 'f-country', 'f-vatrate', 'f-vatded', 'f-currency', 'f-orig'].every((id) => fold.includes(`id="${id}"`)));
ok('S2: the fold shows a one-line summary and opens by itself for a foreign country or currency, a deductible answer, an ATCUD or a warning about a field inside', /\$\('f-moresum'\)\.textContent = /.test(v2) && /more\.country !== 'PT' \|\| more\.cur !== 'EUR' \|\| more\.ded !== 'ask'/.test(v2) && /x === 'supplierTaxId' \|\| x === 'docNumber'/.test(v2) && /if \(needsMore && !\$\('f-more'\)\.open\) \$\('f-more'\)\.open = true/.test(v2));
ok('S2: an item that already has invoice details opens with them shown', /\['f-taxid', 'f-docnum', 'f-atcud', 'f-invdate', 'f-vatrate'\]\.some\(/.test(v2));

// S3 — Used by as ticks
ok('S3: the weight boxes start hidden; "Unequal split…" shows them, "Split equally again" resets them to 1', /style="visibility:hidden"><\/div>`\)\.join\(''\)\}<\/div>/.test(v2) && /id="f-unequal">Unequal split…/.test(v2) && /\$\('f-equal'\)\.addEventListener\('click', \(\) => \{ S\.edit\.unequal = false; m\.querySelectorAll\('\[data-weight\]'\)\.forEach\(\(w\) => \{ w\.value = 1; \}\)/.test(v2));
ok('S3: an item saved with unequal weights opens with the boxes shown', /unequal: unequalWeights\(\(it \|\| preset \|\| \{\}\)\.usedBy\)/.test(v2) && /new Set\(usedBy\.map\(\(u\) => Number\(u\.weight\) \|\| 1\)\)\.size > 1/.test(v2));
ok('S3: without an unequal split every person ticked is saved with weight 1', /weight: S\.edit\.unequal && w > 0 \? w : 1/.test(v2));

// S4 — spending plan hidden until used
ok('S4: the plan is on when ticked in Settings, or (nobody chose yet) when plan items exist', /const planOn = \(\) => \(typeof S\.company\.usePlan === 'boolean' \? S\.company\.usePlan : S\.items\.some\(\(i\) => i\.kind === 'plan' && !i\.archived\)\)/.test(v2));
ok('S4: "Plan allocation" is offered in the form and the Items filter only with the plan on (an existing plan item keeps it)', /<select id="f-kind">\$\{kindsShown\(d\.kind\)/.test(v2) && /<select id="fKind">.*\$\{kindsShown\(f\.kind\)/.test(v2) && /k\.id !== 'plan' \|\| planOn\(\) \|\| keep === 'plan'/.test(v2));
ok('S4: the Overview card, the Reports tables and the review "Plan" button are behind planOn()', /\$\{planOn\(\) \? `<div class="stat-card"><div class="stat-card__label">Plan used/.test(v2) && /\$\{planOn\(\) \? `<div class="two"><div class="section"><div class="section-header"><h2 class="section-title" style="font-size:1\.15rem">Plan against actual/.test(v2) && /\$\{planOn\(\) \? `<button class="btn btn--ghost btn--sm" data-rev="\$\{i\.id\}" data-as="plan">/.test(v2));
ok('S4: the Settings tick saves usePlan in budgetSettings/main (no new rule needed)', /id="pl-on"/.test(v2) && /setDoc\(doc\(db, 'budgetSettings', 'main'\), \{ usePlan, updatedAt: serverTimestamp\(\), updatedBy: access\.email \}, \{ merge: true \}\)/.test(v2));

// S5 — shared mark tucked away
ok('S5: the form shows the shared state as text with a link, no visible tick box', /<input type="checkbox" id="f-shared" \$\{d\.sharedAt \? 'checked' : ''\} hidden>/.test(v2) && /'Mark as shared outside a pack'/.test(v2) && /Not shared yet: it goes in the next pack/.test(v2));
ok('S5: a shared item names its pack (or "outside a pack") and the changed-since warning', /in the pack for \$\{fmtDate\(pk\.from\)\}/.test(v2) && /' outside a pack'/.test(v2) && /changedSince\(existing\)/.test(v2));
ok('S5: bulk mark shared / not shared moved into a More menu that asks first', /<select id="bulkMore"/.test(v2) && !/data-bulk="share"/.test(v2) && /Only for items you sent another way/.test(v2));
ok('S5: the Inbox card points to Packs instead of the bulk button', /creating the pack in Packs marks them as shared/.test(v2) && /id="i-packs"/.test(v2) && !/use "Mark shared with accountant"/.test(v2));

console.log(fail ? `${fail} FAILED` : 'All passed');
process.exit(fail ? 1 : 0);
