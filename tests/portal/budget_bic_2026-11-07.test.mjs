// Budget v2 (7 Nov 2026): optional BIC / SWIFT on company accounts and partner IBAN profiles.
import { readFileSync } from 'node:fs';
import { cleanBic, isValidBic, bicStatus } from '../../portal/budget-lib.js';
const v2 = readFileSync(new URL('../../portal/budget-v2.js', import.meta.url), 'utf8');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

ok('cleanBic removes spaces and upper-cases; null and undefined give empty', cleanBic(' totapt pl ') === 'TOTAPTPL' && cleanBic(null) === '' && cleanBic(undefined) === '');
ok('8 and 11 character BICs are valid', isValidBic('TOTAPTPL') && isValidBic('totapt pl') && isValidBic('DEUTDEFF500') && isValidBic('CHASUS33'));
ok('wrong length or wrong shape is not valid', !isValidBic('TOTAPTP') && !isValidBic('TOTAPTPL1') && !isValidBic('TOTAPTPL12') && !isValidBic('1234PTPL') && !isValidBic('TOTA1TPL') && !isValidBic('PT50 0018'));
ok('status: empty (nothing typed, so nothing to warn about), ok, bad', bicStatus('') === 'empty' && bicStatus('  ') === 'empty' && bicStatus('TOTAPTPL') === 'ok' && bicStatus('nope') === 'bad');

ok('the account form has an optional BIC field, warns but never blocks, and saves it cleaned', /id="a-bic"/.test(v2) && /id="a-bichint"/.test(v2) && /bic: cleanBic\(m\.querySelector\('#a-bic'\)\.value\)/.test(v2) && /You can still save it/.test(v2));
ok('the partner profile has the same field and saves it into the person\'s own document', /id="p-bic"/.test(v2) && /bic: cleanBic\(m\.querySelector\('#p-bic'\)\.value\)/.test(v2));
ok('BIC is shown on the account and partner cards only when filled in', /\$\{a\.bic \? `<div class="mini">BIC \/ SWIFT:/.test(v2) && /\$\{pr\.bic \? `<div class="mini">BIC \/ SWIFT:/.test(v2));
ok('"Copy transfer details" includes the BIC only when there is one', /\$\{pr\.bic \? '\\nBIC ' \+ cleanBic\(pr\.bic\) : ''\}/.test(v2));
ok('there is an i hover explanation for it, saying it is optional and cannot be looked up', /^  bic: 'Optional\./m.test(v2) && /the app cannot look it up/.test(v2));
ok('nothing is looked up or sent: still no network call besides the pack link', !/fetch\(|XMLHttpRequest|sendBeacon/.test(v2) && (v2.match(/httpsCallable\(/g) || []).length === 1);

console.log(fail ? `\n${fail} FAILED` : '\nall BIC tests passed'); process.exit(fail ? 1 : 0);
