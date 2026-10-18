// Municipal holidays you can check (18 Oct 2026): Outreach → Settings lists the 308 with their
// next date and a search box; the Search CRM company page shows the company's own. The company
// page reads portal/mun-holidays.js, generated from functions/outreach/places.js (the scheduler's
// table) — this test fails if the two drift: python tests/portal/gen_mun_holidays.py.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../../functions/outreach/places.js');
const M = await import(new URL('../../portal/mun-holidays.js', import.meta.url));
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

ok('same 308 municipalities and holiday rules as the scheduler', Object.keys(M.MUN_HOL).length === 308 && JSON.stringify(M.MUN_HOL) === JSON.stringify(S.MUN_HOL) && JSON.stringify(M.IN_CITY) === JSON.stringify(S.IN_CITY));
let same = true;
for (const k of Object.keys(S.MUN_HOL)) for (const y of [2026, 2027, 2028]) if (M.munHolidayMD(k, y) !== S.munHolidayMD(k, y)) same = false;
ok('same dates for every municipality, 2026–2028 (Easter-based and "Monday after" rules too)', same);
const cos = [{ concelho: 'Covilhã' }, { concelho: 'Vila Franca de Xira' }, { city: '2600 VILA FRANCA DE XIRA' }, { concelho: 'Calheta', distrito: 'Madeira' }, { concelho: 'Lagoa', distrito: 'Faro' }, { concelho: 'Tortosendo' }, { concelho: 'Nowhere' }];
ok('same municipality for a company (names, postcode city, aliases, the two Calhetas / Lagoas)', cos.every((c) => M.municipalityOf(c) === S.municipalityOf(c)));
ok('the generated file is what the generator writes today (no hand edits)', read('../../portal/mun-holidays.js').startsWith('// Generated from functions/outreach/places.js by tests/portal/gen_mun_holidays.py — do not edit.'));

ok('names without the preposition, regions kept', M.munName('covilha') === 'Covilhã' && M.munName('porto') === 'Porto' && M.munName('calheta (acores)') === 'Calheta (Açores)' && M.munName('lagoa (algarve)') === 'Lagoa (Algarve)');
ok('next date: Covilhã 20 Oct 2026 seen from 18 Oct; today counts; after it, next year', M.nextMunHoliday('covilha', '2026-10-18') === '2026-10-20' && M.nextMunHoliday('covilha', '2026-10-20') === '2026-10-20' && M.nextMunHoliday('covilha', '2026-10-21').startsWith('2027-'));

const out = read('../../portal/outreach.html'), page = read('../../portal/search.html');
ok('Outreach → Settings: "The municipal holidays (308)" with a search box, next date first', /The municipal holidays \(308\)/.test(out) && /id="gMunSearch"/.test(out) && /function renderMunList\(\)/.test(out) && /\(a\.next \|\| '9999'\)\.localeCompare/.test(out));
ok('company page: a "Municipal holiday" row, behind the Outreach switch, from portal/mun-holidays.js', /<div class="info-row" data-feature="outreach"><span class="k"[^>]*>Municipal holiday<\/span><span class="v" data-munhol>/.test(page) && /import\('\.\/mun-holidays\.js'\)/.test(page) && /function renderOverview\(c\)\{\n  fillMunHoliday\(c\);/.test(page));

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
