// Contacted + Flags columns in the Search CRM list (27 Oct 2026, switch
// search.contactColumns): the page's contact summary agrees with the server's,
// the icons and their colours, the flags, the hover text, and the wiring.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const page = read('../../portal/search.html'), rules = read('../../firestore.rules'), feat = read('../../portal/features.js'), cat = read('../../functions/features/catalog.js');
const P = await import(new URL('../../portal/contact-summary.js', import.meta.url));
const require = createRequire(import.meta.url);
const S = require('../../functions/outreach/contact_summary.js');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

const d = (iso) => ({ seconds: Date.parse(iso) / 1000 });
const acts = [
  { type: 'email', date: d('2026-10-10T09:00:00Z'), createdBy: 'scheduler' }, { type: 'email', date: d('2026-10-14T09:00:00Z'), createdBy: 'andre' },
  { type: 'email_received', date: d('2026-10-16T10:00:00Z') }, { type: 'call_attempted', date: d('2026-10-18T10:00:00Z'), createdBy: 'antonio' },
  { type: 'call_connected', date: d('2026-10-19T10:00:00Z') }, { type: 'whatsapp', date: d('2026-10-20T10:00:00Z'), outcome: 'replied' },
  { type: 'meeting_scheduled', date: d('2026-10-21T10:00:00Z') }, { type: 'warm_intro', date: d('2026-10-22T10:00:00Z') },
  { type: 'email_test', date: d('2026-10-21T10:00:00Z') }, { type: 'task_test', date: d('2026-10-21T10:00:00Z') }, { type: 'note', date: d('2026-10-21T10:00:00Z') },
];
const now = Date.parse('2026-10-27T00:00:00Z');
ok('the page and the server build the same summary (same channels, counts, latest, answers)', JSON.stringify(P.summaryOf(acts, now)) === JSON.stringify(S.summaryOf(acts, now)) && P.CHANNELS.join() === S.CHANNELS.join() && P.ANSWER_OUTCOMES.join() === S.ANSWER_OUTCOMES.join());

const touches = P.summaryOf(acts, now);
const c = { id: 'c1', name: 'AGROMAX, LDA', outreachStatus: 'replied', touches, activeCampaignName: 'Food distributors' };
const html = P.contactedHtml(c);
ok('Contacted: 📣 first while in a campaign, then one icon per channel in a fixed order (email, call, WhatsApp, meeting, warm intro)', /^<span class="ct ct--camp"/.test(html) && [...html.matchAll(/data-ct="(\w+)"/g)].map((m) => m[1]).join() === 'campaign,email,call,whatsapp,meeting,intro');
ok('green when answered (email replied, call connected, WhatsApp replied); plain when not (meeting scheduled, intro)', /ct--ok" data-ct="email"/.test(html) && /ct--ok" data-ct="call"/.test(html) && /ct--ok" data-ct="whatsapp"/.test(html) && /ct--plain" data-ct="meeting"/.test(html));
ok('red when the email bounced or they unsubscribed', P.stateOf({ outreachStatus: 'bounced', touches: { email: { n: 1 } } }, 'email') === 'bad' && P.stateOf({ outreachStatus: 'unsubscribed' }, 'email') === 'bad');
ok('campaign over: no 📣, the channels stay; never contacted: "—"; email shown for older companies with only the status', !/ct--camp/.test(P.contactedHtml({ ...c, activeCampaignName: null })) && P.contactedHtml({}) === '<span class="ct-none">—</span>' && /data-ct="email"/.test(P.contactedHtml({ outreachStatus: 'contacted' })));
ok('hover line: "Email · 2 sent · last 14 Oct by André · replied 16 Oct"; the scheduler isn\'t named', P.channelLine(c, 'email', (x) => (x === 'andre' ? 'André' : x)) === 'Email · 2 sent · last 14 Oct by André · replied 16 Oct' && !/scheduler/.test(P.channelLine({ touches: { email: { n: 1, at: d('2026-10-10T09:00:00Z'), by: 'scheduler' } } }, 'email')));
const tip = P.tipHtml({ ...c, activeCampaignName: null }, { enrolments: [{ status: 'completed', campaignName: 'Old one', endedAt: d('2026-10-20T00:00:00Z') }, { status: 'completed', campaignName: 'Paths', stopReason: 'Left out by the campaign\'s paths ("Everyone else")' }, { status: 'active', campaignName: 'Now' }] });
ok('hover card: campaigns before, how each ended ("finished, no reply 20 Oct", "left out by paths"); running ones not listed as before', /Campaigns before: Old one \(finished, no reply 20 Oct\); Paths \(left out by paths\)/.test(tip) && !/Now \(/.test(tip));
const flags = P.flagsOf({ doNotContact: { on: true, reason: 'asked by phone', by: 'antonio.carvalho@douropartners.pt' }, contactable: false, contactableSource: 'rules', contactableNote: 'closed', stage: 'pass', reasonExcluded: 'outside_sector', caeCode: '46213' });
ok('Flags: 🚫 do not contact (why, who), ⛔ not contactable (rules / by hand, why), ⊘ excluded sector (CAE)', flags.map((f) => f.icon).join('') === '🚫⛔⊘' && /asked by phone/.test(flags[0].text) && /antonio\.carvalho/.test(flags[0].text) && /from the contactable rules: closed/.test(flags[1].text) && /CAE 46213/.test(flags[2].text) && P.flagsHtml({}) === '');

// Wiring
ok('switch search.contactColumns in both catalogs', feat.includes("['search.contactColumns', 'Search CRM', 'release'") && cat.includes('key: "search.contactColumns"'));
ok('list: Flags and Contacted columns after Company (behind the switch); the name alone when on, the old tags when off', page.includes('<th data-feature="search.contactColumns" title="Do not contact, not contactable, excluded sector — hover for why">Flags</th>') && page.includes("const ctOn = isOn('search.contactColumns');") && page.includes("${esc(c.name)}${ctOn ? '' : `${excluded?") && page.includes('data-ctid="${esc(c.id)}">${ctOn ? contactedHtml(c) : \'\'}'));
ok('hover card: campaigns read once per company, on hover; test campaigns left out', page.includes("getDocs(query(collection(db, 'outreachEnrolments'), where('companyId', '==', c.id), limit(20)))") && page.includes('.filter(e => !e.isTest)'));
ok('hover names: a team address (contactEmail, or andre.rocha@… → key andre) shows the first name, not the address', page.includes("String(t.contactEmail || '').toLowerCase() === e || (e.includes('@') && t.key === local.split('.')[0])"));
ok('Ownership group table (28 Oct): Company | Revenue | EBITDA | Employees | Flags | Contacted | Fit | Tier | Owner | CAE + description | Stage, totals under the first three; the old table when the switch is off', page.includes('<thead><tr><th>Company</th><th class="num">Revenue</th><th class="num">EBITDA</th><th class="num">Employees</th><th title="Do not contact, not contactable, excluded sector — hover for why">Flags</th>') && page.includes('<th>Fit</th><th>Tier</th><th>Owner</th><th>CAE</th><th>Stage</th>') && page.includes("m.caeDescription ? `<div class=\"ot-meta\"") && page.includes('<td colspan="7"></td></tr></tfoot>') && page.includes("<th>Stage</th><th>Contactable</th></tr></thead>"));
ok('Ladder and Subsidiaries: the icons after a CRM company's name; the status line drops the contact words; the hover finds companies not in the loaded list', page.includes('name += ` <span class="ct-cell" data-ctid="${esc(co.id)}">${flagsHtml(co)}${contactedHtml(co)}</span>`') && page.includes("if (!isOn('search.contactColumns')) { // with the columns on, the icons say it") && page.includes('|| ctExtra.get(cell.dataset.ctid)'));
ok('logging an activity rebuilds the summary with the other activity fields; the rules allow it for "log activities"', page.includes('const touches = contactSummaryOf(activities);') && /function activityTouch\(\) \{ return onlyFields\(\[[^\]]*'touches'\]\); \}/.test(rules));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
