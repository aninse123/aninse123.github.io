// Waits from the window's opening (21 Oct 2026, switch
// outreach.waitFromWindowStart): Settings → General has the minimum gap between
// a company's emails (default 12 h); the Outbox forecast follows the same rule;
// the step's "When" help says so. Wiring checks on the sources.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const out = read('../../portal/outreach.html'), feat = read('../../portal/features.js'), cat = read('../../functions/features/catalog.js');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

ok('the switch is in both catalogs', feat.includes("['outreach.waitFromWindowStart', 'Outreach', 'release'") && cat.includes('key: "outreach.waitFromWindowStart", area: "Outreach", kind: "release"'));
ok('Settings: the minimum gap field, shown with the switch', out.includes('<div data-feature="outreach.waitFromWindowStart"') && out.includes('id="gMinGap"'));
ok('Settings: loads 12 by default, checks 0–72, saves minGapHours', out.includes("$('gMinGap').value = s.minGapHours ?? 12;") && out.includes('minGap >= 0 && minGap <= 72') && out.includes('minGapHours: minGap,'));
ok('Outbox forecast: window opening + gap after an email, opening only for a first step', out.includes("isOpenDay, waitOpts(it.c, true))") && out.includes("isOpenDay, waitOpts(c, false))") && out.includes('return new Date(Math.max(d.getTime(), from.getTime() + (opts.minGapMs || 0)));'));
ok('the step\'s "When" help explains it when the switch is on', out.includes("const waitStartNote = isOn('outreach.waitFromWindowStart')") && (out.match(/\$\{waitStartNote\}/g) || []).length === 2);

// The forecast itself (lifted like outbox_2026-10-13): email 1 at Tue 16:00, email 2 after 3 sending days.
const page = out, a = page.indexOf('// ── Outbox (13 Oct) — planner begin ──'), b = page.indexOf('// ── Outbox — planner end ──');
const lift = (name) => { const i = page.indexOf(`function ${name}(`); let d = 0, j = page.indexOf('{', page.indexOf(')', i)); for (; ; j++) { if (page[j] === '{') d++; else if (page[j] === '}' && --d === 0) break; } return page.slice(i, j + 1); };
const ctx = {}; vm.createContext(ctx);
Object.assign(ctx, await import(new URL("../../portal/campaign-paths.js", import.meta.url))); // 27 Oct: the path helpers the page imports
vm.runInContext([lift('tsMs'), lift('senderKey'), lift('easterUtc'), lift('ptHolidays'), lift('isPtHoliday'), page.slice(a, b), 'globalThis.P = outboxPlan;'].join('\n'), ctx);
const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const S1 = [{ id: 'a@mail.douropartners-team.pt', status: 'active', dailyCap: 25, owner: 'andre' }];
const camp = { id: 'w', name: 'Espera', status: 'active', approvalDefault: 'auto', pacing: { newPerDay: 10 }, senderPolicy: { mode: 'fixed', senderIds: [S1[0].id] }, steps: [{ name: 'Email 1' }, { name: 'Email 2', wait: { days: 3 } }] };
const enrols = [{ id: 'e1', campaignId: 'w', status: 'active', currentStep: 0, nextActionAt: '2026-09-29T15:55:00', companyName: 'Empresa' }];
const plan = (waitFromStart, extra = {}) => ctx.P({ now: new Date('2026-09-29T15:50:00'), campaigns: [camp], enrols, approved: new Map(), senders: S1, settings: { sendWindow: { days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' }, automationBudget: 80, ...extra }, daily: {}, waitFromStart }).rows.filter((r) => r.enrolmentId === 'e1').map((r) => `${r.at.getDate()} ${hm(r.at)}`);
ok('forecast, switch on: Tue 29 16:00, then Fri 2 at 09:00', plan(true).join(',') === '29 16:00,2 09:00');
ok('forecast, switch off: Fri 2 at 16:00, as before', plan(false).join(',') === '29 16:00,2 16:00');

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
