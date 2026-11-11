// Budget v2 (7 Nov 2026): every text box, date box and dropdown has the portal look; the split lines are laid out in a grid.
import { readFileSync } from 'node:fs';
const v2 = readFileSync(new URL('../../portal/budget-v2.js', import.meta.url), 'utf8');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

ok('a zero-specificity base style covers any text/date/number/month box, dropdown and text area (checkbox, radio, file, hidden excluded), so nothing falls back to the browser look', /:where\(#v2root\) :where\(input:not\(\[type=checkbox\]\):not\(\[type=radio\]\):not\(\[type=file\]\):not\(\[type=hidden\]\), select, textarea\) \{[^}]*border:1\.5px solid var\(--border\)/.test(v2));
ok('Reports date boxes (and any date box in a section header) are styled like the Items filters', /#v2root \.section-actions input\[type="date"\] \{[^}]*border:1\.5px solid var\(--border\)/.test(v2));
ok('a split line is a grid: weight, category, purpose on the first row; company on its own row; amount and remove at the end', /#v2root \.split-line \{ display:grid; grid-template-columns:76px minmax\(0,1fr\) minmax\(0,1fr\)/.test(v2) && /class="split-visit"/.test(v2) && /class="split-foot"/.test(v2));
ok('the split line keeps the hooks the form reads (weight, category, purpose, company, amount, remove) and no fixed pixel widths', ['data-lw', 'data-lc', 'data-lp', 'data-lv', 'data-la', 'data-ldel'].every((a) => v2.includes(a + '="${i}"')) && !/data-line="\$\{i\}"[^`]*max-width:1[59]0px/.test(v2));

ok('on a narrow screen the split line puts category and purpose on their own full-width rows so the names are not cut off', /@media \(max-width:560px\) \{ #v2root \.split-line \{ grid-template-columns:76px minmax\(0,1fr\); \} #v2root \.split-line \[data-lc\], #v2root \.split-line \[data-lp\] \{ grid-column:1 \/ -1; \} \}/.test(v2));

ok('Used by says what an empty choice means: nobody ticked is a company cost, shown as Company in Reports', /id="f-usedhint">Nobody ticked = a company cost \(shown as "Company" in Reports\)\./.test(v2) && /stay in the Company line/.test(v2));

ok('a partner remembers the names the bank writes for them (own profile, max 10), and the Inbox passes them to the recogniser; a partner-loan suggestion carries the partner to the item', /id="p-banknames"/.test(v2) && /bankNames: m\.querySelector\('#p-banknames'\)\.value\.split/.test(v2) && /bankNames: \(S\.people\[m\.key\] \|\| \{\}\)\.bankNames \|\| \[\]/.test(v2) && /partnerKey: g\.partnerKey \|\| ''/.test(v2) && /partnerKey: exp \? '' : d\.partnerKey \|\| ''/.test(v2));

ok('Investor is a dropdown that always lists every investor (a text box with a list only shows the names that match what is typed); the supplier box says how to see all suppliers', /<select id="f-investor"><option value="">None/.test(v2) && !/id="f-invlist"/.test(v2) && /clear the box to see them all/.test(v2));

ok('lines still waiting in the Inbox are re-read with today\'s rules, partners and investors (the suggestion saved at import time is not final); only lines with status new, nothing is saved', /function refreshSuggestions\(\)/.test(v2) && /S\.movements\.filter\(\(m\) => m\.status === 'new'\)\.forEach\(\(m\) => \{\s*try \{ m\.sug = recognise\(\{ description: m\.description, amount: m\.amount, posted: m\.posted, cardLast4: m\.cardLast4 \}, recCtx\(m\.accountId\)\)/.test(v2) && /function renderInbox\(body\) \{\s*refreshSuggestions\(\);/.test(v2));

console.log(fail ? `\n${fail} FAILED` : '\nall UI control tests passed'); process.exit(fail ? 1 : 0);
