// Budget v2 simplifications (13 Nov 2026, review claude.ai/artifact/Qqz7WqFj4Ej7FiEypmAfhR): six tabs, a shorter item form,
// "Used by" as ticks, the spending plan hidden until used, the manual "shared" mark tucked away. Source-level checks like the other portal suites.
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const v2 = read('../../portal/budget-v2.js');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
const tabs = [...v2.matchAll(/<button data-tab="([a-z]+)"/g)].map((m) => m[1]);

// S1 — six tabs
// 15 Nov 2026: five tabs; Overview is the top of Reports and Packs is labelled Accountant (key 'packs').
ok('S1: exactly five tabs, in order: Reports, Items, Inbox, Accountant, Settings', tabs.join(',') === 'reports,items,inbox,packs,settings' && /<button data-tab="packs" data-perm="budget\.edit">Accountant<\/button>/.test(v2));
ok('S1: an old Bank / Accounts / Suppliers tab value opens Inbox or Settings', /const TAB_MOVED = \{ bank: 'inbox', accounts: 'settings', suppliers: 'settings', overview: 'reports' \}/.test(v2) && /if \(TAB_MOVED\[S\.tab\]\) S\.tab = TAB_MOVED\[S\.tab\]/.test(v2));
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
// 15 Nov 2026: the people are chips; the weights sit on their own line under the chips, shown only for an unequal split, with % and euros.
ok('S3: one chip per person with the tick box inside', /<label class="uchip"><input type="checkbox" data-used="\$\{esc\(p\.key\)\}"/.test(v2) && /#v2root \.uchip:has\(input:checked\)/.test(v2));
ok('S3: the weights line is shown only for an unequal split with two or more people, one box per person picked, with % and euros', /const showShares = S\.edit\.unequal && ticked > 1;/.test(v2) && /\$\('f-shares'\)\.style\.display = showShares \? '' : 'none'/.test(v2) && /s\.style\.display = on\.includes\(s\.dataset\.ush\)/.test(v2) && /el\.textContent = `→ \$\{total \? Math\.round/.test(v2));
ok('S3: an equal split shows no split text; only "nobody chosen" is explained', /\$\('f-usedhint'\)\.textContent = ticked === 0 \? 'Nobody chosen = a company cost \(shown as "Company" in Reports\)\.' : ''/.test(v2));
ok('S3: "Unequal split…" opens the weights, "Split equally again" resets them to 1', /id="f-unequal">Unequal split…/.test(v2) && /\$\('f-equal'\)\.addEventListener\('click', \(\) => \{ S\.edit\.unequal = false; m\.querySelectorAll\('\[data-weight\]'\)\.forEach\(\(w\) => \{ w\.value = 1; \}\)/.test(v2));
ok('S3: an item saved with unequal weights opens with the boxes shown', /unequal: unequalWeights\(\(it \|\| preset \|\| \{\}\)\.usedBy\)/.test(v2) && /new Set\(usedBy\.map\(\(u\) => Number\(u\.weight\) \|\| 1\)\)\.size > 1/.test(v2));
ok('S3: without an unequal split every person ticked is saved with weight 1', /weight: S\.edit\.unequal && w > 0 \? w : 1/.test(v2));

// S4 — spending plan hidden until used
ok('S4: the plan is on when ticked in Settings, or (nobody chose yet) when plan items exist', /const planOn = \(\) => \(typeof S\.company\.usePlan === 'boolean' \? S\.company\.usePlan : S\.items\.some\(\(i\) => i\.kind === 'plan' && !i\.archived\)\)/.test(v2));
ok('S4: "Plan allocation" is offered in the form and the Items filter only with the plan on (an existing plan item keeps it)', /<select id="f-kind">\$\{kindsShown\(d\.kind\)/.test(v2) && /<select id="fKind">.*\$\{kindsShown\(f\.kind\)/.test(v2) && /k\.id !== 'plan' \|\| planOn\(\) \|\| keep === 'plan'/.test(v2));
ok('S4: the Plan used card, the Reports tables and the review "Plan" button are behind planOn()', /\$\{planOn\(\) \? `<div class="stat-card"><div class="stat-card__label">Plan used/.test(v2) && /\$\{planOn\(\) \? `<div class="two" id="rep-plan"><div class="section"><div class="section-header"><h2 class="section-title" style="font-size:1\.15rem">Plan against actual/.test(v2) && /\$\{planOn\(\) \? `<button class="btn btn--ghost btn--sm" data-rev="\$\{i\.id\}" data-as="plan">/.test(v2));
ok('S4: the Settings tick saves usePlan in budgetSettings/main (no new rule needed)', /id="pl-on"/.test(v2) && /setDoc\(doc\(db, 'budgetSettings', 'main'\), \{ usePlan, updatedAt: serverTimestamp\(\), updatedBy: access\.email \}, \{ merge: true \}\)/.test(v2));

// S5 — shared mark tucked away
ok('S5: the form shows the shared state as text with a link, no visible tick box', /<input type="checkbox" id="f-shared" \$\{d\.sharedAt \? 'checked' : ''\} hidden>/.test(v2) && /'Mark as shared outside a pack'/.test(v2) && /Not shared yet: it goes in the next pack/.test(v2));
ok('S5: a shared item names its pack (or "outside a pack") and the changed-since warning', /in the pack for \$\{fmtDate\(pk\.from\)\}/.test(v2) && /' outside a pack'/.test(v2) && /changedSince\(existing\)/.test(v2));
ok('S5: bulk mark shared / not shared moved into a More menu that asks first', /<select id="bulkMore"/.test(v2) && !/data-bulk="share"/.test(v2) && /Only for items you sent another way/.test(v2));
ok('S5: the Inbox card points to Packs instead of the bulk button', /creating the pack in the Accountant tab marks them as shared/.test(v2) && /id="i-packs"/.test(v2) && !/use "Mark shared with accountant"/.test(v2));

// 15 Nov 2026 — Reports with Overview merged in, one period for every figure
const rep = v2.slice(v2.indexOf('function renderReports('), v2.indexOf('// ── Packs (Stage 5a)'));
ok('R: no renderOverview left; an old "overview" tab value and the default open Reports', !/renderOverview/.test(v2) && /tab: 'reports', items: \[\]/.test(v2) && /\[S\.tab\] \|\| renderReports\)\(body\)/.test(v2));
ok('R: period picker All time / This year / Last 3 months / This month / From – to, All time by default; dates only for From – to', /const PERIODS = \[\['all', 'All time'\], \['year', 'This year'\], \['q', 'Last 3 months'\], \['month', 'This month'\], \['custom', 'From – to'\]\]/.test(v2) && /const repRange = \{ preset: 'all', from: '', to: '' \}/.test(v2) && /repRange\.preset === 'custom' \? `<span class="filter-bar__label">From<\/span><input type="date" id="rFrom"/.test(rep));
ok('R: the cards, VAT, category/purpose and tags use the period; people, companies and plan use the same range', /const items = S\.items\.filter\(\(i\) => i\.kind === 'plan' \|\| inPer\(i\.date\)\)/.test(rep) && /const o = overview\(items\), vat = vatSummary\(items\)/.test(rep) && /const tags = tagTotals\(items\)/.test(rep) && /companyReport\(S\.items, rg\), pr = personReport\(S\.items, rg\), pv = planVsActual\(S\.items, rg\)/.test(rep));
ok('R: the to-do warnings (paperwork, old items, what the company owes) always count everything', /const warn = S\.items\.filter/.test(rep) && /const owed = partnerBalances\(S\.items, S\.movements\)/.test(rep) && /These always count everything, whatever the period/.test(rep));
ok('R: Balance says "in this period" when a period is picked; the page says which period it shows', /'Received − costs in this period' : 'Received − costs'/.test(rep) && /Everything since the start\./.test(rep));
ok('R: a jump list to Summary, VAT, Category and purpose, People, Companies, Tags (and Plan when on)', ['rep-summary', 'rep-vat', 'rep-cat', 'rep-people', 'rep-companies', 'rep-tags', 'rep-plan'].every((id) => rep.includes(`'${id}'`) && rep.includes(`id="${id}"`)));
ok('R: the old wording points to Reports and the Accountant tab, not Overview or Packs', !/Packs tab|in Packs|Open Packs|The Overview lists|Overview shows/.test(v2) && /Open the Accountant tab/.test(v2));

// 15 Nov 2026 — the Items search also finds tags (André: typing "ETA" found nothing although 17 items carry the tag "ETA IESE 2026")
ok('Search: the Items search box looks in name, comments, supplier, counterparty, invoice number, supplier NIF, tags, category, purpose and connected company', /const searchText = \(i\) => \[i\.name, i\.comments, i\.supplierName, i\.counterparty, i\.docNumber, i\.supplierTaxId, \.\.\.\(i\.tags \|\| \[\]\),\s*\.\.\.itemLines\(i\)\.flatMap\(\(l\) => \[catLabel\(l\.categoryId\), purLabel\(l\.purposeId\), l\.companyName\]\)\]/.test(v2) && /if \(q && !searchText\(i\)\.includes\(q\)\) return false;/.test(v2) && /placeholder="Search name, supplier, tag, category, company…"/.test(v2));

// 15 Nov 2026 — a transfer to a partner: one click on the line, the app's guess first (simulation claude.ai/artifact/6B3AKbTWiiX4thEx8GAXM6)
const bank = read('../../portal/budget-bank.js');
ok('P: the recogniser says "Transfer to a partner" (no longer "(reimbursement)"); the pill names the partner', /reason: 'Transfer to a partner', sure: true/.test(bank) && !/Transfer to a partner \(reimbursement\)/.test(bank) && /`To \$\{personLabel\(g\.partnerKey\)\}`/.test(v2));
ok('P: the guess is "expenses" when unpaid expenses add up exactly, else "loan" when a loan is open', /function partnerGuess\(m, key\)/.test(v2) && /const combo = suggestSettlement\(amt, cands\);/.test(v2) && /if \(combo\) return \{ as: 'expenses'/.test(v2) && /if \(bal\.loansOwed > 0\.004\) return \{ as: 'loan'/.test(v2));
ok('P: a line to a partner has no Accept: Repays a loan and Pays back expenses… on the line, the guess as the primary button, needing budget.edit and budget.import', /\(g\.kind === 'settlement' && !toPartner\)/.test(v2) && /<span data-perm="budget\.edit budget\.import">\$\{\[\['loan'/.test(v2) && /btn--\$\{pg\.as === 'loan' \? 'primary' : 'ghost'\} btn--sm" data-loan=/.test(v2) && /btn--\$\{pg\.as === 'expenses' \? 'primary' : 'ghost'\} btn--sm" data-settle=/.test(v2));
ok('P: the same functions as Transfers to partners are used, with a partner chosen by hand allowed', /function openSettle\(id, keyOver = ''\)/.test(v2) && /async function repayLoan\(id, keyOver = ''\)/.test(v2) && /const key = keyOver \|\| m\.partnerKey/.test(v2));
ok('P: the loan confirmation shows the open loan before and after, and says it is not a cost', /Open loan now: \$\{fmtMoney\(open\)\}\. After this:/.test(v2) && /It is not a cost and creates no item\./.test(v2));
ok('P: a money-out line opened with Categorise/Edit asks "What is this line?": An expense or Went to a partner (only with budget.import); the partner window needs a partner first', /\$\{!it && lineOut\(preset\) \? lineKindRow\('expense'\) : ''\}/.test(v2) && /m\.amount < 0 && can\('budget\.import'\)/.test(v2) && /function openPartnerChoice\(m, key = ''\)/.test(v2) && /Choose the partner first\./.test(v2) && /openPartnerChoice\(m, g\.partnerKey\)/.test(v2));

ok('P: To reimburse (Inbox) and the Reports warning leave out a partner owed €0, for example a loan fully paid back', /const bal = partnerBalances\(S\.items, S\.movements\)\.filter\(\(x\) => x\.total > 0\.004\);/.test(v2) && /const owed = partnerBalances\(S\.items, S\.movements\)\.filter\(\(x\) => x\.total > 0\.004\);/.test(v2));

// 15 Nov 2026 — a bank line booked as the wrong item can go back to the Inbox (André: three partner reimbursements were booked as expenses)
ok('L: an item booked from a bank line shows the line with "Send back to the Inbox" (budget.import to see it, budget.edit to use it)', /\$\{it \? bankLineNote\(it\) : ''\}/.test(v2) && /if \(!m \|\| !can\('budget\.import'\)\) return '';/.test(v2) && /id="f-lineback" data-perm="budget\.edit">Send back to the Inbox</.test(v2) && /\$\('f-lineback'\)\?\.addEventListener\('click', \(\) => sendLineBack\(existing\)\)/.test(v2));
ok('L: sending back asks first, keeps the item (only its movementId is cleared) and puts the line back to new when it was booked to this item', /async function sendLineBack\(it\)/.test(v2) && /stays as it is, without the bank line; nothing is deleted/.test(v2) && /wb\.update\(doc\(db, 'budgetItems', it\.id\), \{ movementId: '' \}\);/.test(v2) && /if \(m\.status === 'linked' && m\.itemId === it\.id\) wb\.update\(doc\(db, 'budgetMovements', m\.id\), \{ status: 'new', itemId: '' \}\);/.test(v2));
ok('L: deleting an item booked from a bank line sends the line back to the Inbox in the same write, and says so first', /const line = linkedLine\(it\), back = !!line && can\('budget\.import'\);/.test(v2) && /Its bank line \(\$\{fmtDate\(line\.posted\)\}/.test(v2) && /wb\.delete\(doc\(db, 'budgetItems', id\)\); wb\.update\(doc\(db, 'budgetMovements', line\.id\), \{ status: 'new', itemId: '' \}\);/.test(v2));

console.log(fail ? `${fail} FAILED` : 'All passed');
process.exit(fail ? 1 : 0);
