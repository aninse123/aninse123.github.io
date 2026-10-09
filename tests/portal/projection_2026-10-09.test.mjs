// "How long each step will take" (9 Oct 2026): follow-ups can't be done before
// the last company's previous step + the wait; "Day" counts the campaign's own
// sending days; first / last companies' dates. projectionHtml lifted verbatim.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8');
function liftFn(name){
  const start = page.indexOf(`function ${name}(`); if (start < 0) throw new Error(name);
  let p = page.indexOf('(', start), pd = 0; do { if (page[p] === '(') pd++; else if (page[p] === ')') pd--; p++; } while (pd > 0);
  let j = page.indexOf('{', p), depth = 0; do { if (page[j] === '{') depth++; else if (page[j] === '}') depth--; j++; } while (depth > 0);
  return page.slice(start, j);
}
let fail = 0;
const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
const RealDate = Date;
const ctx = {
  Math, Number, String, Infinity, JSON,
  Date: class extends RealDate { constructor(...a) { if (a.length) super(...a); else super('2026-10-09T19:00:00'); } }, // Friday evening
  LIVE_ENROL: ['pending', 'active', 'awaiting_approval', 'awaiting_task', 'paused'],
  settings: { automationBudget: 80, sendWindow: { days: [1, 2, 3, 4, 5] } },
  senders: [1, 2, 3, 4].map(i => ({ id: `s${i}`, status: 'active', dailyCap: 25 })),
  esc: (s) => String(s), num: (n) => String(n),
  dayFmt: { format: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` },
  curEnrols: Array.from({ length: 69 }, () => ({ status: 'pending', currentStep: 0 })),
};
vm.createContext(ctx);
vm.runInContext(liftFn('projectionHtml') + '\nthis.__p = projectionHtml;', ctx);
const camp = { audienceType: 'companies', pacing: { newPerDay: 10 }, senderPolicy: { mode: 'fixed', senderIds: ['s1', 's2', 's3', 's4'] },
  steps: [{ name: 'Email 1' }, { name: 'Email 2', wait: { days: 4, unit: 'working' } }, { name: 'Email 3', wait: { days: 7, unit: 'working' } }] };
const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/≈ /, '').trim();
const cells = (html) => [...html.matchAll(/<tr><td>[\s\S]*?<\/tr>/g)].map(m => [...m[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => strip(c[1])));
const show = (rows) => console.log(rows.map(r => r.slice(1).join(' | ')).join('\n'));

const rows = cells(ctx.__p(camp));
show(rows);
ok('Email 1: first companies Mon 12 Oct, done Tue 20 Oct (69 at 10 a day)', rows[0][2] === '2026-10-12' && rows[0][3] === '2026-10-20');
ok('Email 2: first Fri 16 Oct (day 5), done Mon 26 Oct', rows[1][2] === '2026-10-16' && rows[1][3] === '2026-10-26');
ok('Email 3: first Tue 27 Oct (day 12), done Wed 4 Nov', rows[2][2] === '2026-10-27' && rows[2][3] === '2026-11-04');
ok('follow-ups spread over the same 7 sending days', rows.every(r => r[5] === '7'));
ok('the "Day" column stays day 1 / 5 / 12', rows[0][1] === 'day 1' && rows[1][1] === 'day 5' && rows[2][1] === 'day 12');

// A Thu–Sat campaign: waits count its own sending days, and the note names them.
const thuSat = { ...camp, sendWindow: { days: [4, 5, 6], from: '09:00', to: '18:00' } };
const h2 = ctx.__p(thuSat), r2 = cells(h2);
show(r2);
// From Friday evening the next Thu–Sat sending day is Saturday 10 Oct; + 4 of its sending days = Thu 15, Fri 16, Sat 17, Thu 22.
ok('Thu–Sat: first emails Sat 10 Oct; Email 2 first on Thu 22 Oct (4 of its sending days later, skipping Sun–Wed)', r2[0][2] === '2026-10-10' && r2[1][2] === '2026-10-22');
ok('note: Day counts this campaign\'s sending days (Thu–Sat), holidays skipped', /sending days \(Thu–Sat; national holidays skipped\)/.test(h2));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nall projection tests passed');
