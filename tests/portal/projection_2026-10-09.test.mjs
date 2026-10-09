// "How long each step will take" (9 Oct 2026): follow-ups can't be done before
// the last company's previous step + the wait. projectionHtml lifted verbatim.
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
  dayFmt: { format: (d) => d.toISOString().slice(0, 10) },
  curEnrols: Array.from({ length: 69 }, (_, i) => ({ status: 'pending', currentStep: 0 })),
};
vm.createContext(ctx);
vm.runInContext(liftFn('projectionHtml') + '\nthis.__p = projectionHtml;', ctx);
const camp = { audienceType: 'companies', pacing: { newPerDay: 10 }, senderPolicy: { mode: 'fixed', senderIds: ['s1', 's2', 's3', 's4'] },
  steps: [{ name: 'Email 1' }, { name: 'Email 2', wait: { days: 4, unit: 'working' } }, { name: 'Email 3', wait: { days: 7, unit: 'working' } }] };
const html = ctx.__p(camp);
const done = [...html.matchAll(/≈ (\d{4}-\d{2}-\d{2})/g)].map(m => m[1]);
const days = [...html.matchAll(/<td class="num">(\d+|—)<\/td><td style="white-space:nowrap/g)].map(m => m[1]);
console.log('done by:', done.join(', '), '| sending days:', days.join(', '));
ok('Email 1 done after 7 sending days (69 at 10 a day) — Tue 20 Oct', done[0] === '2026-10-20');
ok('Email 2 done 4 working days later — Mon 26 Oct (was 12 Oct)', done[1] === '2026-10-26');
ok('Email 3 done 7 working days after that — Wed 4 Nov', done[2] === '2026-11-04');
ok('follow-ups spread over the same 7 days (not 1)', days.every(d => d === '7'));
ok('the "Day" column stays day 1 / 5 / 12', /day 1<\/td>/.test(html) && /day 5<\/td>/.test(html) && /day 12<\/td>/.test(html));
if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nall projection tests passed');
