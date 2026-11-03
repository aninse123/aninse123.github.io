// 3 Nov 2026: company counts in the metrics (outreach.companyCounts), "Also contacted at this company", Clear classification
// (outreach.multiRecipient) and a visit as a meeting (outreach.visitMeetings). The page logic is inside outreach.html, so the
// functions that decide the numbers are run from their own source text. Synthetic data only.
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); };

// threadStats, evaluated on its own
const m = html.match(/function threadStats\(list\) \{[\s\S]*?\n    \}\n/);
ok('threadStats found in the page', !!m);
const POSITIVE = ['interested', 'callback_later', 'referred'];
const make = (on) => new Function('POSITIVE', 'isOn', m[0] + '; return threadStats;')(POSITIVE, (k) => on && k === 'outreach.companyCounts');
const threads = [
  { id: 'a', companyId: 'co1', responseCategory: 'interested', repliedAt: null },
  { id: 'b', companyId: 'co1', responseCategory: 'interested', repliedAt: null },
  { id: 'c', companyId: 'co2', responseCategory: null, repliedAt: 1 },
  { id: 'd', companyId: 'co3', responseCategory: null, otherReplyAt: 1 },
  { id: 'e', companyId: 'co4', responseCategory: null },
  { id: 'f', companyId: 'co4', responseCategory: null, status: 'bounced' },
];
const off = make(false)(threads), on = make(true)(threads);
ok('Off: one per conversation (6 started, 1 replied, 2 positive, 1 bounced)', off.started === 6 && off.replied === 1 && off.positive === 2 && off.bounced === 1);
ok('On: one per company (4 started)', on.started === 4);
ok('On: replied = email, phone/visit, or classified positive (co1, co2, co3)', on.replied === 3);
ok('On: positive once per company (co1 counts once)', on.positive === 1);
ok('On: a company is bounced only when all its addresses bounced', on.bounced === 0);

// the page wiring
ok('Clear chip only when a classification exists, never for excluded, behind multiRecipient',
  html.includes(`t.responseCategory && t.responseCategory !== 'excluded' && isOn('outreach.multiRecipient') ? '<button class="chip" data-cat="" data-perm="out.write" title="Remove the classification">Clear</button>'`));
ok('classify turns an empty category into null', html.includes("cat = cat || null;"));
ok('the "Also contacted" line exists and reads the company enrolments', html.includes('id="sibLine"') && html.includes("where('companyId', '==', t.companyId), limit(20)"));
ok('the Overview counts companies under outreach.companyCounts', html.includes("isOn('outreach.companyCounts') && c.audienceType !== 'people'"));

// the Overview and By path count companies, not addresses (a company's extra addresses are enrolments of their own)
const P = await import(new URL('../../portal/campaign-paths.js', import.meta.url));
const sent = (n) => Array.from({ length: n }, () => ({ result: 'sent' }));
const enrols = [
  { id: 'a', companyId: 'co1', status: 'active', pathId: 'A', history: sent(1), sourceLabel: 'List 1' },
  { id: 'a__t1', companyId: 'co1', status: 'stopped', isExtra: true, pathId: 'A', history: sent(1), stopReason: 'Email bounced' },
  { id: 'a__t2', companyId: 'co1', status: 'active', isExtra: true, pathId: 'A', history: sent(1) },
  { id: 'b', companyId: 'co2', status: 'stopped', pathId: 'A', history: sent(1), stopReason: 'Email bounced' },
  { id: 'b__t1', companyId: 'co2', status: 'stopped', isExtra: true, pathId: 'A', history: sent(1) },
  { id: 'c', companyId: 'co3', status: 'replied', pathId: 'B', history: sent(1) },
  { id: 'c__t1', companyId: 'co3', status: 'stopped', isExtra: true, pathId: 'B', history: sent(1) },
  { id: 'd', companyId: 'co4', status: 'pending', plannedPathId: 'B', history: [] },
];
const roll = P.rollupByCompany(enrols);
ok('one row per company (8 enrolments, 4 companies)', roll.length === 4);
const st = Object.fromEntries(roll.map((r) => [r.companyId, r.status]));
ok('a company is in sequence when any address is; stopped only when all are; replied wins', st.co1 === 'active' && st.co2 === 'stopped' && st.co3 === 'replied' && st.co4 === 'pending');
ok('the history of the addresses is joined (emails still add up)', roll.find((r) => r.companyId === 'co1').history.length === 3 && roll.reduce((a, r) => a + r.history.length, 0) === 7);
ok('the main address supplies the rest of the row', roll.find((r) => r.companyId === 'co1').id === 'a' && roll.find((r) => r.companyId === 'co1').sourceLabel === 'List 1');
const camp = { paths: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }, { id: 'main', name: 'Else' }], steps: [] };
const thr = [{ enrolmentId: 'a', companyId: 'co1', responseCategory: 'interested' }, { enrolmentId: 'a__t2', companyId: 'co1', responseCategory: 'interested' }, { enrolmentId: 'c', companyId: 'co3', responseCategory: 'interested' }];
const off2 = P.pathResults(camp, enrols, thr, POSITIVE), on2 = P.pathResults(camp, enrols, thr, POSITIVE, true);
const row = (r, id) => r.rows.find((x) => x.id === id);
ok('By path Off: counts addresses (A has 5)', row(off2, 'A').total === 5);
ok('By path On: counts companies (A has 2, B has 2 with the waiting one)', row(on2, 'A').total === 2 && row(on2, 'B').total === 2);
ok('By path On: contacted and replied per company', row(on2, 'A').contacted === 2 && row(on2, 'B').contacted === 1 && row(on2, 'B').replied === 1);
ok('By path On: positive once per company (co1 answered on two addresses)', row(on2, 'A').positive === 1 && row(on2, 'B').positive === 1 && row(off2, 'A').positive === 2);
ok('the page rolls up before counting, only under the switch', html.includes("const rolled = isOn('outreach.companyCounts') && c.audienceType !== 'people';") && html.includes('const eRows = rolled ? rollupByCompany(curEnrols) : curEnrols;') && html.includes('POSITIVE, rolled, repliedSet)'));

// who answered, and how: the first answer of any kind counts, once per company
const T = (d) => ({ toMillis: () => Date.parse(d) });
const rthr = [
  { companyId: 'co1', repliedAt: T('2026-11-03T08:35:00Z') },
  { companyId: 'co1', otherReplyAt: T('2026-11-02T12:00:00Z'), otherReplyChannel: 'call' },
  { companyId: 'co2', repliedAt: T('2026-11-03T09:00:00Z') },
  { companyId: 'co3', responseCategory: 'interested' },
  { companyId: 'co4', otherReplyAt: T('2026-11-04T09:00:00Z'), otherReplyChannel: 'visit' },
];
const rm = P.repliesByCompany(rthr, [{ companyId: 'co5', status: 'replied' }], POSITIVE);
ok('four companies and the enrolment reply answered: 5', rm.size === 5);
ok('the first answer wins: the call (2 Nov) before the email (3 Nov)', rm.get('co1').channel === 'call' && rm.get('co2').channel === 'email' && rm.get('co4').channel === 'visit');
ok('marked positive only when nothing else answered; an enrolment reply is an email', rm.get('co3').channel === 'marked' && rm.get('co5').channel === 'email');
const camp2 = { paths: [{ id: 'A', name: 'A' }, { id: 'main', name: 'Else' }], steps: [] };
const en2 = [{ id: 'x', companyId: 'co1', status: 'stopped', pathId: 'A', history: sent(1) }, { id: 'y', companyId: 'co2', status: 'active', pathId: 'A', history: sent(1) }];
ok('By path counts a company that answered by call while its enrolment was stopped', P.pathResults(camp2, en2, [], POSITIVE, true, new Set(['co1'])).rows[0].replied === 1 && P.pathResults(camp2, en2, [], POSITIVE, true).rows[0].replied === 0);
ok('the Overview shows how the first answer came, and By step / By source use the same set', html.includes('first answer: ${repliedHow}') && html.includes('repliedSet ? eRows.filter(e => repliedSet.has(e.companyId)') && html.includes('const answered = repliedSet ? repliedSet.has(e.companyId)'));

const delays = P.firstReplyDelays([
  { companyId: 'co1', firstTouchAt: T('2026-11-02T17:45:00Z'), repliedAt: T('2026-11-03T08:35:00Z') },
  { companyId: 'co1', firstTouchAt: T('2026-11-02T18:39:00Z'), otherReplyAt: T('2026-11-02T19:45:00Z'), otherReplyChannel: 'call' },
  { companyId: 'co2', firstTouchAt: T('2026-11-02T10:00:00Z'), repliedAt: T('2026-11-02T12:00:00Z') },
  { companyId: 'co3', firstTouchAt: T('2026-11-02T10:00:00Z') },
]);
ok('reply time: per company, first answer (the call, 2 h after the first email) since its first touch; no answer, no time', delays.length === 2 && delays[0] === 7200000 && delays[1] === 7200000);
ok('Metrics uses it behind the switch', html.includes("isOn('outreach.companyCounts') ? firstReplyDelays(threads)"));
// the Audience table: one row per company, its addresses under it (run from the page's own renderAudience with small stand-ins)
const raSrc = html.match(/    function renderAudience\(\) \{[\s\S]*?\n    \}\n(?=\n    \/\/ I22)/)[0];
const aud = { innerHTML: '', querySelectorAll: () => [] };
const mkAud = (on) => {
  const names = ['isOn', 'curCamp', 'curEnrols', 'rollupByCompany', 'norm', 'audSearch', 'audPath', 'audFilter', 'audAll', 'audToggle', 'hasPaths', 'pathsOf', 'pathIdOf', 'isLeftOut', 'campEditable', '$', 'num', 'esc', 'LIVE_ENROL', 'ENROL_PILL', 'pill', 'tsMs', 'stepLabelIn', 'stepsFor', 'waitingFor', 'canChooseRecipients', 'localPart', 'stepLabel', 'goesTo', 'loadCampaignData', 'openAddPeople', 'openAddCompanies'];
  const camp = { id: 'c1', audienceType: 'companies', status: 'active', steps: [] };
  const enr = [
    { id: 'm', companyId: 'cm', companyName: 'MODULAQUADRO', status: 'stopped', stopReason: 'Email bounced', recipient: { email: 'fernando@m.pt' }, senderId: 'a@x.pt', pathName: 'B' },
    { id: 'm__t1', companyId: 'cm', companyName: 'MODULAQUADRO', status: 'stopped', isExtra: true, stopReason: 'Email bounced', recipient: { email: 'carlos@m.pt' } },
    { id: 'm__t2', companyId: 'cm', companyName: 'MODULAQUADRO', status: 'active', isExtra: true, recipient: { email: 'geral@m.pt' } },
    { id: 'x', companyId: 'cx', companyName: 'XPTO', status: 'active', recipient: { email: 'info@x.pt' } },
    { id: 'y', companyId: 'cy', companyName: 'YOLO', status: 'active', recipient: { email: 'a@y.pt' } },
    { id: 'y__t1', companyId: 'cy', companyName: 'YOLO', status: 'active', isExtra: true, recipient: { email: 'b@y.pt' } },
  ];
  const stand = { $: () => ({ addEventListener() {}, value: '', focus() {}, setSelectionRange() {} }) };
  const vals = [(k) => on && k === 'outreach.companyCounts', () => camp, enr, P.rollupByCompany, (x) => String(x || '').toLowerCase(), '', 'all', 'all', null, new Map(), () => false, () => [{ id: 'main' }], () => null, () => false, () => true,
    (id) => (id === 'cs-audience' ? aud : stand.$()), (n) => String(n), (x) => String(x == null ? '' : x), ['pending', 'active', 'awaiting_approval', 'awaiting_task', 'paused'],
    { active: ['In sequence'], stopped: ['Stopped'], replied: ['Replied'], pending: ['Pending'], paused: ['Paused'] }, (m, st) => `[${st}]`, () => 0, () => 'STEP', () => [], () => 'WAIT', () => false, (x) => String(x || ''), () => 'STEP', () => 'GOES', () => {}, () => {}, () => {}];
  aud.innerHTML = '';
  new Function(...names, raSrc + '; renderAudience();')(...vals);
  return aud.innerHTML;
};
const audOn = mkAud(true), audOff = mkAud(false);
const nCo = (h) => (h.match(/<a href="\/portal\/search\.html\?company=/g) || []).length;
ok('Audience On: one row per company (3 companies, not 6 enrolments)', nCo(audOn) === 3);
ok('Audience On: the company row shows its addresses and what happened to them', audOn.includes('<b>3 addresses</b> · 1 in sequence · 2 bounced') && audOn.includes('<b>2 addresses</b> · 2 in sequence'));
ok('Audience On: the company is In sequence (not Stopped) while one address is live, and says how many', audOn.includes('[active]') && audOn.includes('1 of 3 addresses active'));
ok('Audience On: a company with a stopped address opens by itself; one without stays closed', audOn.includes('↳ carlos@m.pt') && !audOn.includes('↳ a@y.pt') && audOn.includes('data-cotoggle="cy" data-open="0"'));
ok('Audience On: Pause / Move / Remove are for the company; a lone live address has no Stop button', audOn.includes('data-coop="pause" data-ckey="cm"') && audOn.includes('data-coop="remove" data-ckey="cx"') && !audOn.includes('data-addr="1"'));
ok('Audience On: the old Goes to column is gone', !audOn.includes('Goes to') && audOn.includes('<th>Status</th>'));
ok('Audience Off: as before, one row per address with Goes to', nCo(audOff) === 6 && audOff.includes('Goes to') && !audOff.includes('data-coop'));

ok("the campaign's enrolments are loaded without orderBy('enrolledAt') (extra addresses have no enrolledAt and would be left out)", !html.includes("where('campaignId', '==', id), orderBy('enrolledAt', 'desc')") && html.includes("where('campaignId', '==', id), limit(5000))), // 3 Nov: no orderBy"));

// switches exist on both sides with the same text
const cat = fs.readFileSync(new URL('../../functions/features/catalog.js', import.meta.url), 'utf8');
const pf = fs.readFileSync(new URL('../../portal/features.js', import.meta.url), 'utf8');
for (const k of ['outreach.visitMeetings', 'outreach.companyCounts']) ok(`switch ${k} is in the server catalog and the page list`, cat.includes(`"${k}"`) && pf.includes(`'${k}'`));
console.log(fail ? `\n${fail} FAILED` : '\nAll passed');
process.exit(fail ? 1 : 0);
