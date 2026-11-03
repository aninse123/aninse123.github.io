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

const sh = fs.readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8');
ok('Search CRM: Edit next to the company email (Overview and contact details) opens the company form on that field', sh.includes('data-ceedit="email"') && sh.includes('data-ceedit="${t}"') && sh.includes("email: 'cCompanyEmail'") && sh.includes('openEditCompany(); if (id) setTimeout('));

const CT = await import(new URL('../../portal/contact-trust.js', import.meta.url));
const dead = { companyEmail: 'a@x.com.pt', companyEmailBounce: { email: 'a@x.com.pt', kind: 'no_mx', reason: 'no mail servers' } }, bounce = { companyEmail: 'b@y.pt', companyEmailBounce: { email: 'b@y.pt', reason: 'hard bounce' } };
ok('Company email pill: "No mail server" for a dead domain, "Bounced" for a refused mailbox; both count as bounced', CT.companyEmailTrust(dead) === 'bounced' && CT.companyEmailLabel(dead) === 'No mail server' && CT.companyEmailTrust(bounce) === 'bounced' && CT.companyEmailLabel(bounce) === null && CT.trustPillHtml('bounced', '', (s) => s, 'No mail server').includes('>No mail server<') && CT.trustPillHtml('bounced', '').includes('>Bounced<'));
ok('Company email title: says nothing was sent for a dead domain', CT.companyEmailTitle(dead).includes('no mail servers, so email cannot reach it (nothing was sent)') && CT.companyEmailTitle(bounce).includes('an email to it bounced'));
ok('the label follows an edited address: a new address is not marked', CT.companyEmailLabel({ ...dead, companyEmail: 'a@x.pt' }) === null);
const CP = await import(new URL('../../portal/company-primary.js', import.meta.url));
const co = { companyEmail: 'sofiasoares@switchboard.com.pt', companyEmailBounce: { email: 'sofiasoares@switchboard.com.pt', kind: 'no_mx' }, companyEmailConfirmedAt: null, reach: [{ id: 'r1', type: 'email', value: 'sofiasoares@switchboard.pt', source: 'manual', status: 'ok', primary: false, addedBy: 'a@x.pt', addedAt: '2026-11-03T14:42:00Z' }, { id: 'r2', type: 'phone', value: '+351 1', status: 'ok' }] };
const sw = CP.swapCompanyPrimary(co, co.reach[0], { by: 'a@x.pt', at: '2026-11-03T15:00:00Z', newId: () => 'old1' });
ok('Star: the added email becomes the company email, and is remembered as chosen by the team', sw.patch.companyEmail === 'sofiasoares@switchboard.pt' && sw.patch.companyPrimaryChosen.companyEmail.by === 'a@x.pt');
ok('Star: the old main email moves into the list, still marked (No mail server), not usable', sw.list.some((e) => e.id === 'old1' && e.value === 'sofiasoares@switchboard.com.pt' && e.status === 'bounced' && e.note === 'no mail servers') && !sw.list.some((e) => e.id === 'r1') && sw.list.some((e) => e.id === 'r2'));
ok('Star: the new email is confirmed (typed by the team) and the old bounce mark is cleared from the company', sw.patch.companyEmailConfirmedFor === 'sofiasoares@switchboard.pt' && !!sw.patch.companyEmailConfirmedAt && sw.patch.companyEmailBounce === null);
const back = CP.swapCompanyPrimary({ ...co, ...sw.patch, reach: sw.list }, sw.list.find((e) => e.id === 'old1'), { by: 'a@x.pt', at: 'z', newId: () => 'old2' });
ok('Star: choosing the old (Orbis) one again swaps back; it is not confirmed by a team member', back.patch.companyEmail === 'sofiasoares@switchboard.com.pt' && back.patch.companyEmailConfirmedAt === null && back.list.some((e) => e.id === 'old2' && e.value === 'sofiasoares@switchboard.pt'));
ok('Star on a phone changes companyPhone only', CP.swapCompanyPrimary({ companyPhone: '+351 9', reach: [{ id: 'p', type: 'phone', value: '+351 2' }] }, { id: 'p', type: 'phone', value: '+351 2' }, { newId: () => 'q' }).patch.companyPhone === '+351 2');
const chosen = { companyPrimaryChosen: { companyEmail: { by: 'a' } } };
ok('Orbis import: leaves out the fields the team chose, keeps the rest', JSON.stringify(CP.withoutChosen(chosen, { companyEmail: 'x@old.pt', companyPhone: '+351 5', name: 'N' })) === JSON.stringify({ companyPhone: '+351 5', name: 'N' }) && CP.withoutChosen({}, { companyEmail: 'x@y.pt' }).companyEmail === 'x@y.pt');
ok('Company form: a corrected email or phone is a team choice; other edits are not', CP.chosenAfterEdit({}, { companyEmail: 'new@x.pt' }, 'a', 't').companyEmail.by === 'a' && CP.chosenAfterEdit({}, { stage: 'pass' }, 'a', 't') === null && CP.chosenAfterEdit(chosen, { companyPhone: '1' }, 'a', 't').companyEmail.by === 'a');
ok('Search CRM wiring: ★ on the company card, Orbis import and the company form use it', sh.includes('swapCompanyPrimary(c, e,') && sh.includes('withoutChosen(match, r.payload)') && sh.includes('...pl,') && sh.includes('chosenAfterEdit(prev, changed') && !sh.includes('#companyReachCard [data-reachprimary]'));

const dead2 = { companyEmail: 'a@dead.com.pt', companyEmailBounce: { email: 'a@dead.com.pt', kind: 'no_mx' }, reach: [{ id: 'r1', type: 'email', value: 'b@ok.pt', status: 'ok', source: 'manual' }, { id: 'r2', type: 'email', value: 'c@bad.pt', status: 'bounced' }, { id: 'r3', type: 'email', value: 'd@ok.pt', status: 'ok' }] };
const ord = CP.companyEmailsInOrder(dead2);
ok('Order: a dead own email goes last, the next usable first (bounced ones left out)', ord.usable.map((u) => u.value).join() === 'b@ok.pt,d@ok.pt' && ord.dead === 'a@dead.com.pt');
ok('Order: a working own email stays first', CP.companyEmailsInOrder({ companyEmail: 'a@x.pt', reach: [{ type: 'email', value: 'b@x.pt', status: 'ok' }] }).usable.map((u) => u.value).join() === 'a@x.pt,b@x.pt' && CP.firstUsableCompanyEmail({ companyEmail: 'a@x.pt', reach: [{ id: 'q', type: 'email', value: 'b@x.pt', status: 'ok' }] }) === null);
ok('Overview shows the usable one first when the own one is dead; none usable = as before', CP.firstUsableCompanyEmail(dead2).value === 'b@ok.pt' && CP.firstUsableCompanyEmail({ ...dead2, reach: [] }) === null);
ok('Search CRM wiring: Overview row and the send-email options use the order', sh.includes('companyEmailRowHtml(c)') && sh.includes('companyEmailsInOrder(c)') && sh.includes('cannot receive email)'));

ok('Addresses window: an address that bounced or cannot be used is never ticked, does not count, and goes last', html.includes("const unusable = (x) => x.blocked || x.trust === 'bounced';") && html.includes('{ ...x, selected: false }') && html.includes('...list.filter((x, i) => unusable(x) && !(r.locked && i === 0))'));

// the page remembers where you are across a refresh (address hash), from the page's own saveWhere
const wSrc = html.slice(html.indexOf("    let curTab = 'inbox';"), html.indexOf('    function restoreWhere() {'));
const mkWhere = (hash, st) => {
  const loc = { hash, pathname: '/portal/outreach.html', search: '' }, hist = { replaceState: (a, b, url) => { loc.hash = url.includes('#') ? '#' + url.split('#')[1] : ''; } };
  const doc = { querySelector: () => (st.ss ? { dataset: { sec: st.ss } } : null) };
  const run = new Function('location', 'history', 'document', 'URLSearchParams', 'S', 'let curCampId = S.camp, campSec = S.sec, taskView = S.tv, selectedId = S.th; ' + wSrc + '; return { saveWhere, set: (o) => { if ("tab" in o) curTab = o.tab; if ("camp" in o) curCampId = o.camp; if ("sec" in o) campSec = o.sec; if ("tv" in o) taskView = o.tv; if ("th" in o) selectedId = o.th; }, wherePending };');
  return { loc, ...run(loc, hist, doc, URLSearchParams, st) };
};
let w = mkWhere('#tab=campaigns&camp=ABC&sec=audience', { camp: null, sec: 'overview', tv: 'todo', th: null });
ok('Refresh: the address is read into what to restore', w.wherePending.tab === 'campaigns' && w.wherePending.camp === 'ABC' && w.wherePending.sec === 'audience');
w.set({ tab: 'campaigns' }); w.saveWhere();
ok('Refresh: until the campaign list has loaded, the campaign stays in the address', w.loc.hash === '#tab=campaigns&camp=ABC&sec=audience');
w.set({ camp: 'ABC', sec: 'sequence' }); w.saveWhere();
ok('Refresh: moving to another section updates the address; Overview is the default and is not written', w.loc.hash === '#tab=campaigns&camp=ABC&sec=sequence');
w.set({ tab: 'tasks', tv: 'letters' }); w.saveWhere();
ok('Refresh: on Tasks it keeps the task view and the campaign you had open', w.loc.hash === '#tab=tasks&camp=ABC&sec=sequence&tv=letters');
w.set({ tab: 'inbox', camp: null, tv: 'todo', th: 'T1' }); w.wherePending.camp = null; w.saveWhere();
ok('Refresh: the Inbox keeps the open conversation; the default tab is not written', w.loc.hash === '#th=T1');
ok('Refresh: wired into tabs, campaign, section, task view, settings, conversation and the campaign list', ["curTab = name;", "campSec = name; saveWhere();", "taskView = v; saveWhere();", "selectedId = id; saveWhere();", "restoreWhere();", "restoreCampaign(); //", "|| wherePending.th;"].every((x) => html.includes(x)));

ok('Addresses window: a dead first address (email 1 already sent) is not counted in "N emails will be sent"', html.includes('- (r.locked && list[0] && unusable(list[0]) && list[0].selected ? 1 : 0)'));

ok('Address: street, postcode and municipality, in words (not capitals)', CP.fullAddress({ hqAddress: 'RUA DE TRAS - NOGUEIRA', postcode: '4475-500', concelho: 'Maia' }) === 'Rua de Tras - Nogueira, 4475-500 Maia' && CP.fullAddress({ hqAddress: 'RUA LUIS DE CAMOES, TORRE 6 C/V 3', postcode: '2620-105', concelho: 'Odivelas' }) === 'Rua Luis de Camoes, Torre 6 C/V 3, 2620-105 Odivelas');
ok('Address: already complete or mixed case is left alone; no duplicate postcode or town; city when there is no municipality', CP.fullAddress({ hqAddress: 'Rua das Flores 12, 4000-100 Porto', postcode: '4000-100', concelho: 'Porto' }) === 'Rua das Flores 12, 4000-100 Porto' && CP.fullAddress({ hqAddress: 'EN 109, KM 5', postcode: '3000-001', city: 'COIMBRA' }) === 'EN 109, KM 5, 3000-001 Coimbra' && CP.fullAddress({}) === '');
ok('Search CRM: the Overview and the contact card show the full address, and Maps gets it with the country', sh.includes('fullAddress(c)') && sh.includes("encodeURIComponent(fullAddress(c) + ', Portugal')") && sh.includes("t === 'address' ? fullAddress(c) || single : single"));
ok('Overview: Edit next to the email goes to the Contacts tab (company contact details), not the whole company form', sh.includes('data-ceedit="email" data-from="ov"') && sh.includes("if (b.dataset.from === 'ov')") && sh.includes("getElementById('companyReachCard')?.scrollIntoView"));

ok('Letters: street line, then postcode and municipality', JSON.stringify(CP.addressLines({ hqAddress: 'RUA DA INDUSTRIA, 7', postcode: '2860-706', concelho: 'Moita' })) === JSON.stringify(['RUA DA INDUSTRIA, 7', '2860-706 Moita']));
ok('Letters: an address that carries its postcode is split there, not repeated', JSON.stringify(CP.addressLines({ hqAddress: 'R. de Trás 421, 4475-500 Maia', postcode: '4475-500', concelho: 'Maia' })) === JSON.stringify(['R. de Trás 421', '4475-500 Maia']) && JSON.stringify(CP.addressLines({})) === '[]');
ok('Letters: the envelope, the print list and the letter preview all use it', !html.includes("c.hqAddress || '', [c.postcode, c.concelho]") && (html.match(/addressLines\(/g) || []).length >= 4);

const RS = await import(new URL('../../portal/read-state.js', import.meta.url));
const AM = 'andre.rocha@douropartners.pt', AN = 'antonio.carvalho@douropartners.pt';
const th1 = { unread: true, lastInboundAt: T('2026-11-03T10:00:00Z'), lastMessageAt: T('2026-11-03T10:00:00Z') };
ok('Read: a new reply is unread for both partners', RS.isUnreadFor(th1, AM) && RS.isUnreadFor(th1, AN));
const th2 = { ...th1, readBy: { andre_rocha: T('2026-11-03T11:00:00Z') } };
ok('Read: when one opens it, it is read for that person only', !RS.isUnreadFor(th2, AM) && RS.isUnreadFor(th2, AN));
const th3 = { ...th2, lastInboundAt: T('2026-11-03T12:00:00Z'), lastMessageAt: T('2026-11-03T12:00:00Z') };
ok('Read: a newer email makes it unread again for the one who had opened it', RS.isUnreadFor(th3, AM));
ok('Read: an answered conversation (unread false) is read for everyone; an old one with no lastInboundAt uses lastMessageAt', !RS.isUnreadFor({ unread: false }, AM) && RS.isUnreadFor({ unread: true, lastMessageAt: T('2026-11-03T10:00:00Z') }, AN) && !RS.isUnreadFor({ unread: true, lastMessageAt: T('2026-11-03T10:00:00Z'), readBy: { antonio_carvalho: T('2026-11-03T10:05:00Z') } }, AN));
ok('Read: an answer from Gmail (attentionAt) makes it unread again for both, even for the one who had opened it', RS.isUnreadFor({ ...th2, attentionAt: T('2026-11-03T13:00:00Z') }, AM) && RS.isUnreadFor({ ...th2, attentionAt: T('2026-11-03T13:00:00Z') }, AN) && !RS.isUnreadFor({ ...th2, attentionAt: T('2026-11-03T10:30:00Z') }, AM));
ok('Read: answering marks it read for the one who answered only (the send writes readBy for the caller, no longer unread false for everyone)', fs.readFileSync(new URL('../../functions/outreach/send_core.js', import.meta.url), 'utf8').includes('readBy.${String(p.callerEmail)'));
ok('Inbox and the menu badge use it; opening marks it read for me only', html.includes('.filter(isUnread).length') && html.includes("['readBy.' + readKeyOf(me)]: serverTimestamp()") && fs.readFileSync(new URL('../../portal/nav.js', import.meta.url), 'utf8').includes('isUnreadFor(d.data(), mail)') && fs.readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8').includes("onlyFields(['unread', 'readBy'])") && fs.readFileSync(new URL('../../functions/outreach/inbound.js', import.meta.url), 'utf8').includes('lastInboundAt: Timestamp.now()'));

ok('Addresses… shows when the first address has stopped but the company still runs (liveOthers)', html.includes('function canChooseRecipients(e, liveOthers = [])') && html.includes('(LIVE_ENROL.includes(e.status) || liveOthers.length > 0)') && html.includes('canChooseRecipients(root, liveG)'));
const ccStart = html.indexOf('    function canChooseRecipients(e, liveOthers = [])'), cc = html.slice(ccStart, html.indexOf(String.fromCharCode(10), ccStart));
]*
/)[0];
const mkCC = new Function('isOn', 'LIVE_ENROL', 'isOnMulti', cc + '; return canChooseRecipients;')(() => true, ['pending', 'active', 'awaiting_approval', 'awaiting_task', 'paused'], true);
const stoppedRoot = { companyId: 'c', status: 'stopped', threadId: 't', currentStep: 1 };
ok('Addresses…: stopped first address + another live address = shown; nobody live = not shown; an extra address never', mkCC(stoppedRoot, [{ status: 'active' }]) === true && mkCC(stoppedRoot, []) === false && mkCC({ ...stoppedRoot, trackOf: 'r' }, [{}]) === false && mkCC({ ...stoppedRoot, status: 'active' }, []) === true);

// switches exist on both sides with the same text
const cat = fs.readFileSync(new URL('../../functions/features/catalog.js', import.meta.url), 'utf8');
const pf = fs.readFileSync(new URL('../../portal/features.js', import.meta.url), 'utf8');
for (const k of ['outreach.visitMeetings', 'outreach.companyCounts']) ok(`switch ${k} is in the server catalog and the page list`, cat.includes(`"${k}"`) && pf.includes(`'${k}'`));
console.log(fail ? `\n${fail} FAILED` : '\nAll passed');
process.exit(fail ? 1 : 0);
