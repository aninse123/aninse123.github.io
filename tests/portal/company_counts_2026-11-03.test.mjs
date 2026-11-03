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
ok('the page rolls up before counting, only under the switch', html.includes("const rolled = isOn('outreach.companyCounts') && c.audienceType !== 'people';") && html.includes('const eRows = rolled ? rollupByCompany(curEnrols) : curEnrols;') && html.includes('POSITIVE, rolled)'));

// switches exist on both sides with the same text
const cat = fs.readFileSync(new URL('../../functions/features/catalog.js', import.meta.url), 'utf8');
const pf = fs.readFileSync(new URL('../../portal/features.js', import.meta.url), 'utf8');
for (const k of ['outreach.visitMeetings', 'outreach.companyCounts']) ok(`switch ${k} is in the server catalog and the page list`, cat.includes(`"${k}"`) && pf.includes(`'${k}'`));
console.log(fail ? `\n${fail} FAILED` : '\nAll passed');
process.exit(fail ? 1 : 0);
