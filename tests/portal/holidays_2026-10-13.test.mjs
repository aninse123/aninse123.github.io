// National holidays (13 Oct 2026): the page's list (Settings and the Overview
// dates) equals the server's (functions/outreach/schedule_util.js) for 2026–2030;
// Settings tick box, campaign override and the Overview follow the choice.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../../functions/outreach/schedule_util.js');
const page = readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const lift = (name) => { const a = page.indexOf(`function ${name}(`); let d = 0, i = page.indexOf('{', page.indexOf(')', a)); for (; ; i++) { if (page[i] === '{') d++; else if (page[i] === '}' && --d === 0) break; } return page.slice(a, i + 1); };
const ctx = {}; vm.createContext(ctx);
vm.runInContext([lift('easterUtc'), lift('ptHolidays'), lift('isPtHoliday')].join('\n') + '\nglobalThis.H = { ptHolidays, isPtHoliday };', ctx);
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

const same = [2026, 2027, 2028, 2029, 2030].every((y) => JSON.stringify(ctx.H.ptHolidays(y)) === JSON.stringify(S.holidayList(y)));
ok('page list = server list, 2026–2030 (dates and names)', same);
ok('isPtHoliday: 25 Dec 2026 yes, 26 Dec no', ctx.H.isPtHoliday(new Date('2026-12-25T12:00:00')) && !ctx.H.isPtHoliday(new Date('2026-12-26T12:00:00')));
ok('Settings: tick box saved as skipNationalHolidays, list shown', page.includes('id="gHolidays"') && page.includes("skipNationalHolidays: $('gHolidays').checked") && page.includes('id="gHolList"'));
ok('campaign: As in Settings / Skip / Send on them', page.includes('id="csHol"') && page.includes("skipHolidays: $('csHol').value === 'skip' ? true : $('csHol').value === 'send' ? false : null"));
ok('Overview dates skip holidays only when chosen', page.includes("const isSendDay = (d) => (win.days || []).includes(d.getDay()) && !(skipHol && isPtHoliday(d));"));
if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
