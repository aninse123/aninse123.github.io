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

// switches exist on both sides with the same text
const cat = fs.readFileSync(new URL('../../functions/features/catalog.js', import.meta.url), 'utf8');
const pf = fs.readFileSync(new URL('../../portal/features.js', import.meta.url), 'utf8');
for (const k of ['outreach.visitMeetings', 'outreach.companyCounts']) ok(`switch ${k} is in the server catalog and the page list`, cat.includes(`"${k}"`) && pf.includes(`'${k}'`));
console.log(fail ? `\n${fail} FAILED` : '\nAll passed');
process.exit(fail ? 1 : 0);
