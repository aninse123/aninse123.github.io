// Outbox (13 Oct 2026): outboxPlan() — the page's dry run of the scheduler's
// rules — lifted between its markers and run on synthetic campaigns.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const a = page.indexOf('// ── Outbox (13 Oct) — planner begin ──'), b = page.indexOf('// ── Outbox — planner end ──');
const lift = (name) => { const i = page.indexOf(`function ${name}(`); let d = 0, j = page.indexOf('{', page.indexOf(')', i)); for (; ; j++) { if (page[j] === '{') d++; else if (page[j] === '}' && --d === 0) break; } return page.slice(i, j + 1); };
const ctx = {}; vm.createContext(ctx);
vm.runInContext([lift('tsMs'), lift('senderKey'), lift('easterUtc'), lift('ptHolidays'), lift('isPtHoliday'), page.slice(a, b), 'globalThis.P = outboxPlan;'].join('\n'), ctx);
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const S4 = ['a', 'b', 'c', 'd'].map((x) => ({ id: `${x}@mail.douropartners-team.pt`, status: 'active', dailyCap: 25, owner: 'andre' }));
const settings = { sendWindow: { days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' }, automationBudget: 80 };

// 1. Like 78.20: approval on every step, 10 new a day, 4 addresses. Tue 13 Oct 08:00.
const camp = { id: 'c1', name: '78.20', status: 'active', approvalDefault: 'approval', pacing: { newPerDay: 10 }, senderPolicy: { mode: 'fixed', senderIds: S4.map((s) => s.id) },
  steps: [{ name: 'Email 1' }, { name: 'Email 2', wait: { days: 4 } }, { name: 'Email 3', wait: { days: 7 } }] };
const enrols = [
  ...Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, campaignId: 'c1', status: 'active', currentStep: 1, nextActionAt: '2026-10-16T09:00:00', senderId: S4[i % 4].id, companyName: `Started ${i}` })),
  ...Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, campaignId: 'c1', status: 'pending', enrolledAt: `2026-10-10T10:${String(i).padStart(2, '0')}:00`, companyName: `Pending ${i}` })),
  { id: 'ap', campaignId: 'c1', status: 'active', currentStep: 0, nextActionAt: '2026-10-12T09:00:00', companyName: 'Approved Co' },
  { id: 'aw', campaignId: 'c1', status: 'awaiting_approval', currentStep: 0, companyName: 'Waiting Co' },
];
const approved = new Map([['ap', { id: 'msgAP', enrolmentId: 'ap', senderId: S4[2].id }]]);
const r1 = ctx.P({ now: new Date('2026-10-13T08:00:00'), campaigns: [camp], enrols, approved, senders: S4, settings, daily: {} });
const tue = r1.rows.filter((r) => ymd(r.at) === '2026-10-13');
ok('Tue 09:00: the approved draft goes out from its address', tue.some((r) => r.kind === 'send' && r.enrolmentId === 'ap' && hm(r.at) === '09:00' && r.senderId === S4[2].id && r.approvedMessageId === 'msgAP'));
ok('Tue 09:00: 10 companies start → 10 drafts (first email), not sends', tue.filter((r) => r.kind === 'draft' && r.starts && hm(r.at) === '09:00').length === 10);
ok('Wed: the last 2 not-started companies → 2 drafts', r1.rows.filter((r) => ymd(r.at) === '2026-10-14' && r.kind === 'draft').length === 2);
ok('Fri 16 Oct 09:00: the 9 started ones → 9 drafts for Email 2', r1.rows.filter((r) => ymd(r.at) === '2026-10-16' && r.kind === 'draft' && r.stepIndex === 1).length === 9);
ok('the approved company\'s Email 2 follows 4 sending days later (Mon 19 Oct) as a draft', r1.rows.some((r) => r.enrolmentId === 'ap' && r.stepIndex === 1 && r.kind === 'draft' && ymd(r.at) === '2026-10-19'));
ok('already waiting in To approve: counted, not planned', r1.awaiting === 1 && !r1.rows.some((r) => r.enrolmentId === 'aw'));

// 2. Automatic campaign, 2 addresses: at most one email per address per run → 2 per run.
const auto = { id: 'c2', name: 'Auto', status: 'active', approvalDefault: 'auto', pacing: { newPerDay: 10 }, senderPolicy: { mode: 'fixed', senderIds: [S4[0].id, S4[1].id] }, steps: [{ name: 'Email 1' }] };
const en2 = Array.from({ length: 6 }, (_, i) => ({ id: `q${i}`, campaignId: 'c2', status: 'pending', enrolledAt: `2026-10-10T10:0${i}:00`, owner: 'andre', companyName: `Auto ${i}` }));
const r2 = ctx.P({ now: new Date('2026-10-13T08:55:00'), campaigns: [auto], enrols: en2, approved: new Map(), senders: S4, settings, daily: {} });
const sends = r2.rows.filter((r) => r.kind === 'send');
ok('6 sends: 2 at 09:00, 2 at 09:10, 2 at 09:20, alternating the 2 addresses', sends.length === 6 && ['09:00', '09:00', '09:10', '09:10', '09:20', '09:20'].every((t, i) => hm(sends[i].at) === t) && new Set(sends.slice(0, 2).map((r) => r.senderId)).size === 2);
// Automations limit 3 → 3 today, the rest tomorrow.
const r3 = ctx.P({ now: new Date('2026-10-13T08:55:00'), campaigns: [auto], enrols: en2, approved: new Map(), senders: S4, settings: { ...settings, automationBudget: 3 }, daily: {} });
ok('automations limit 3: 3 sends today, 3 tomorrow at 09:00', r3.rows.filter((r) => ymd(r.at) === '2026-10-13').length === 3 && r3.rows.filter((r) => ymd(r.at) === '2026-10-14').length === 3);
// Today's sends already counted: address a already at its cap → only b sends.
const r4 = ctx.P({ now: new Date('2026-10-13T08:55:00'), campaigns: [auto], enrols: en2.slice(0, 2), approved: new Map(), senders: S4, settings, daily: { bySender: { 'a_mail_douropartners-team_pt': 25 } } });
ok('an address already at today\'s cap sends nothing today', r4.rows.filter((r) => ymd(r.at) === '2026-10-13').every((r) => r.senderId === S4[1].id));
// Holiday: Tue 8 Dec 2026 skipped by default; included when the campaign sends on holidays.
const r5 = ctx.P({ now: new Date('2026-12-08T08:00:00'), campaigns: [auto], enrols: en2.slice(0, 1), approved: new Map(), senders: S4, settings, daily: {} });
const r6 = ctx.P({ now: new Date('2026-12-08T08:00:00'), campaigns: [{ ...auto, skipHolidays: false }], enrols: en2.slice(0, 1), approved: new Map(), senders: S4, settings, daily: {} });
ok('national holiday: first send on Wed 9 Dec; sent on 8 Dec when the campaign sends on holidays', ymd(r5.rows[0].at) === '2026-12-09' && ymd(r6.rows[0].at) === '2026-12-08');
ok('paused / finished campaigns are not planned', ctx.P({ now: new Date('2026-10-13T08:00:00'), campaigns: [{ ...auto, status: 'paused' }], enrols: en2, approved: new Map(), senders: S4, settings, daily: {} }).rows.length === 0);

ok('page: Outbox chip, view, actions Back to To approve / Pause', page.includes('data-tview="outbox"') && page.includes("action: 'unapprove', messageId") && page.includes("op: 'pause'"));
if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
