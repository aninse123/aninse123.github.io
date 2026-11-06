// Budget v2, Stage 0 (6 Nov 2026, switch budget.v2): company details (NIF check), JSON backup, settings rule and the switch itself.
// Source-level checks like the other portal suites; the NIF helpers are exercised directly.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isValidNif, normalizeNif, nifStatus, cleanCompanyDetails } from '../../portal/budget-fiscal.js';
const require = createRequire(import.meta.url);
const { FEATURES } = require('../../functions/features/catalog.js');
const page = readFileSync(new URL('../../portal/budget.html', import.meta.url), 'utf8');
const fsRules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const webFeatures = readFileSync(new URL('../../portal/features.js', import.meta.url), 'utf8');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

const f = FEATURES.find((x) => x.key === 'budget.v2');
ok('switch exists: a release switch in the Budget area (On in staging, Off in production)', !!f && f.kind === 'release' && f.area === 'Budget' && f.defaults.staging === 'on' && f.defaults.production === 'off');
ok('switch is also in portal/features.js (parity)', webFeatures.includes("'budget.v2'"));

ok('NIF: a real one passes (Autoridade Tributaria 600084779)', isValidNif('600084779'));
ok('NIF: a wrong check digit fails', !isValidNif('600084778'));
ok('NIF: spaces, dots, dashes and a leading PT are ignored', isValidNif('PT 600 084 779') && isValidNif('600.084-779') && normalizeNif('pt600084779') === '600084779');
ok('NIF: not 9 digits fails (short, long, letters, empty)', !isValidNif('60008477') && !isValidNif('6000847790') && !isValidNif('60008477A') && !isValidNif(''));
ok('NIF: remainder 10 and 11 both give check digit 0', (() => { const mk = (p8) => { let s = 0; for (let i = 0; i < 8; i++) s += Number(p8[i]) * (9 - i); let c = 11 - (s % 11); if (c >= 10) c = 0; return p8 + c; }; let hit = 0; for (let n = 0; n < 4000; n++) { const p8 = String(50000000 + n * 7).padStart(8, '0').slice(0, 8); const v = mk(p8); if (v.endsWith('0') && isValidNif(v)) hit++; } return hit > 0; })());
ok('status: empty / ok / badFormat / badCheck', nifStatus('') === 'empty' && nifStatus('600084779') === 'ok' && nifStatus('1234') === 'badFormat' && nifStatus('600084778') === 'badCheck');
ok('details are trimmed, the NIF kept as digits, lengths capped', (() => { const d = cleanCompanyDetails({ companyName: '  Douro Partners, Lda  ', companyNif: 'PT 600 084 779', companyAddress: ' Rua X \n 1000-001 Lisboa ' }); return d.companyName === 'Douro Partners, Lda' && d.companyNif === '600084779' && d.companyAddress === 'Rua X \n 1000-001 Lisboa' && cleanCompanyDetails({ companyName: 'x'.repeat(500) }).companyName.length === 200; })());

ok('Backup and Company details buttons are hidden while the switch is Off (data-feature)', /id="backupBtn" data-feature="budget\.v2"/.test(page) && /id="companyBtn" data-feature="budget\.v2"/.test(page) && /id="companyModal" data-feature="budget\.v2"/.test(page));
ok('backup reads every budgetItems document, turns timestamps into text, downloads one JSON file and logs it', /getDocs\(collection\(db, 'budgetItems'\)\)/.test(page) && /v\.toDate\(\)\.toISOString\(\)/.test(page) && /douro-budget-backup-/.test(page) && /logEvent\('budget_backup'/.test(page));
ok('backup does not change any document', !/backupJson[\s\S]{0,1500}(updateDoc|setDoc|deleteDoc)\(/.test(page.slice(page.indexOf('async function backupJson'), page.indexOf('// ── Company details'))));
ok('company details live in budgetSettings/main, read only when the window opens', /getDoc\(doc\(db, 'budgetSettings', 'main'\)\)/.test(page) && /async function openCompanyModal/.test(page) && !/loadAll\(\)[^;]*budgetSettings/.test(page));
ok('saving needs budget.edit, keeps who saved, and a bad check digit warns but still saves', /id="saveCompanyBtn" data-perm="budget\.edit"/.test(page) && /updatedBy: adminEmail/.test(page) && /You can still save it/.test(page) && /badFormat'\) \{ alert/.test(page));
ok('Firestore: budgetSettings read needs budget.view, write needs budget.edit', /match \/budgetSettings\/\{id\} \{\s*allow read: if can\('budget\.view'\);\s*allow write: if can\('budget\.edit'\);/.test(fsRules));

console.log(fail ? `\n${fail} FAILED` : '\nall budget stage 0 tests passed'); process.exit(fail ? 1 : 0);
