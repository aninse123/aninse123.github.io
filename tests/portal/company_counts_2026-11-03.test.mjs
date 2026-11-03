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
ok('the page rolls up before counting, only under the switch', html.includes("const rolled = isOn('outreach.companyCounts') && c.audienceType !== 'people';") && html.includes('const eRows = rolled ? rollupByCompany(curEnrols, answeredSet) : curEnrols;') && html.includes('POSITIVE, rolled, repliedSet)'));

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
  const names = ['isOn', 'curCamp', 'curEnrols', 'rollupByCompany', 'norm', 'audSearch', 'audPath', 'audFilter', 'audAll', 'audToggle', 'hasPaths', 'pathsOf', 'pathIdOf', 'isLeftOut', 'campEditable', '$', 'num', 'esc', 'LIVE_ENROL', 'ENROL_PILL', 'pill', 'tsMs', 'stepLabelIn', 'stepsFor', 'waitingFor', 'canChooseRecipients', 'localPart', 'stepLabel', 'goesTo', 'loadCampaignData', 'openAddPeople', 'openAddCompanies', 'repliesByCompany', 'curThreads', 'POSITIVE'];
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
    { active: ['In sequence'], stopped: ['Stopped'], replied: ['Replied'], pending: ['Pending'], paused: ['Paused'] }, (m, st) => `[${st}]`, () => 0, () => 'STEP', () => [], () => 'WAIT', () => false, (x) => String(x || ''), () => 'STEP', () => 'GOES', () => {}, () => {}, () => {}, P.repliesByCompany, [], []];
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
const mkCC = new Function('isOn', 'LIVE_ENROL', 'isOnMulti', cc + String.fromCharCode(10) + '; return canChooseRecipients;')(() => true, ['pending', 'active', 'awaiting_approval', 'awaiting_task', 'paused'], true);
const stoppedRoot = { companyId: 'c', status: 'stopped', threadId: 't', currentStep: 1 };
ok('Addresses…: stopped first address + another live address = shown; nobody live = not shown; an extra address never', mkCC(stoppedRoot, [{ status: 'active' }]) === true && mkCC(stoppedRoot, []) === false && mkCC({ ...stoppedRoot, trackOf: 'r' }, [{}]) === false && mkCC({ ...stoppedRoot, status: 'active' }, []) === true);

const stoppedByHand = [{ id: 's', companyId: 'cs', companyName: 'SHORTLEC', status: 'stopped', stopReason: 'Stopped: André replied by hand', history: [] }, { id: 's__t1', companyId: 'cs', status: 'stopped', isExtra: true, history: [] }, { id: 'z', companyId: 'cz', status: 'stopped', stopReason: 'Email bounced', history: [] }];
const callThreads = [{ companyId: 'cs', otherReplyAt: T('2026-11-02T12:00:00Z'), otherReplyChannel: 'call' }, { companyId: 'cz', responseCategory: 'interested' }];
const ans = new Set([...P.repliesByCompany(callThreads, stoppedByHand, POSITIVE)].filter(([, v]) => v.channel !== 'marked').map(([k]) => k));
const rr = Object.fromEntries(P.rollupByCompany(stoppedByHand, ans).map((r) => [r.companyId, r.status]));
ok('Replied, not Stopped: a company that called you (its addresses stopped by your answer) is Replied; one that only bounced stays Stopped (a positive mark alone is not a reply)', rr.cs === 'replied' && rr.cz === 'stopped' && P.rollupByCompany(stoppedByHand).find((r) => r.companyId === 'cs').status === 'stopped' && P.rollupByCompany([{ id: 'a', companyId: 'cs', status: 'active', history: [] }], ans)[0].status === 'active');
ok('Overview and Audience roll up with the companies that answered', html.includes('rollupByCompany(curEnrols, answeredSet)') && html.includes('rollupByCompany(curEnrols, new Set([...repliesByCompany(curThreads, curEnrols, POSITIVE)]'));

ok('Letters to print: a campaign filter with counts (All campaigns, each campaign, Own tasks); Select all and Print follow it', html.includes('let todoWho') && html.includes("lettersCampaign = 'all'") && html.includes('id="letCamp"') && html.includes("$('letCamp').addEventListener('change'") && html.includes("const list = allLetters.filter(t => lettersCampaign === 'all'"));
ok('To do: the campaign filter shows the counts under the other filters', html.includes('const cntCamp = (id)') && html.includes('All campaigns (${num(forCamp.length)})'));

const RCm = await import(new URL('../../portal/reply-contacts.js', import.meta.url));
const QV = `Bom dia

Podemos reunir pessoalmente ou falar online quando quiserem sem qualquer problema.

Com os melhores cumprimentos,

Hermínio Cardoso

Rua da Quinta da Serra Nº4

Paradinha

3510-107 Viseu - Portugal

Tel: (+351) 232 448 531

(Chamada para a rede fixa nacional)

Movel: (+351) 962405366

(Chamada para a rede movel nacional)

e-mail: gerencia@quadroviseu.com <mailto:gerencia@quadroviseu.com>  / hfc.quadroviseu@sapo.pt <mailto:hfc.quadroviseu@sapo.pt>

website: www.quadroviseu.com <http://www.quadroviseu.com/>

De: Quadroviseu Geral <geral@quadroviseu.com>
Enviada: 3 de novembro de 2026 11:20
Para: hfc.quadroviseu@sapo.pt
Assunto: FW: Continuidade da Quadroviseu | Confidencial

Tel: 999 888 777`;
const qv = RCm.extractContacts(QV, { ignoreEmail: (e) => /douropartners/.test(e) });
ok('Reply contacts (QUADROVISEU): both phones, kinds, the two emails, the site and the factory address', qv.phones.map((p) => p.norm + ':' + p.kind).join() === '232448531:landline,962405366:mobile' && qv.emails.join() === 'gerencia@quadroviseu.com,hfc.quadroviseu@sapo.pt' && qv.urls[0].host === 'quadroviseu.com' && JSON.stringify(qv.address) === JSON.stringify({ street: 'Rua da Quinta da Serra Nº4, Paradinha', postcode: '3510-107', place: 'Viseu' }));
ok('Reply contacts: the quoted / forwarded part is never read (its phone is ignored)', !qv.phones.some((p) => p.norm === '999888777') && RCm.ownText(QV).includes('Hermínio Cardoso') && !RCm.ownText(QV).includes('Enviada'));
const SL = `Obrigado

amontanha@shortlec.com _ *91 460 52 02*

Shortlec - Sistemas Elétricos, Lda
NIPC_ 513 470 417
Tel_ 22 328 68 30
Av. Dom Miguel 150
4435-678 Baguim do Monte, Porto, Portugal`;
const sl = RCm.extractContacts(SL);
ok('Reply contacts (SHORTLEC): 2-3-2-2 numbers, the NIPC is not a phone, the address and the sender email', sl.phones.map((p) => p.norm + ':' + p.kind).join() === '914605202:mobile,223286830:landline' && sl.nipc === '513470417' && sl.address.street === 'Av. Dom Miguel 150' && sl.address.postcode === '4435-678' && sl.address.place === 'Baguim do Monte' && sl.emails.join() === 'amontanha@shortlec.com');
const AC = RCm.extractContacts(`Tel.: 21 950 3600 / 21 213 7000 (Chamada para rede fixa nacional)

TM: 91 992 4411 (Chamada para rede movel nacional)

 <http://www.acconsulting.pt/> http://www.acconsulting.pt`);
ok('Reply contacts (AC Consulting): 21 950 3600 style, two landlines and a mobile, one website', AC.phones.map((p) => p.norm).join() === '219503600,212137000,919924411' && AC.urls.length === 1 && AC.urls[0].host === 'acconsulting.pt');
ok('Reply contacts: no guessing — a postcode line with no street above it, a fax and a NIF are skipped', RCm.findAddress('Maria\n3510-107 Viseu') === null && RCm.findPhones('Fax: 232 448 530\nNIF 509 123 456').length === 0);
ok('Reply contacts: the street and the postcode on one line, a street over two lines, and the person the sender looks like', JSON.stringify(RCm.findAddress('Av Brasil 17, 11º 2005-136 Santarém - Portugal')) === JSON.stringify({ street: 'Av Brasil 17, 11º', postcode: '2005-136', place: 'Santarém' }) && RCm.findAddress('ARMAZÉM, Lda\nParque Industrial Lt 18 6200-027 Covilhã\nPortugal').street === 'Parque Industrial Lt 18' && RCm.findAddress('Vomar - Comércio, Lda\nAv. José Saramago - Majapoas\nApartado 14\n7580-206 Alcácer do Sal').street === 'Av. José Saramago - Majapoas, Apartado 14' && RCm.guessPerson([{ personId: 'r', name: 'Raul Jorge Marques Abraao' }, { personId: 'x', name: 'Ana Silva' }], 'Raul Abraão', 'rabraao@x.pt')?.personId === 'r' && RCm.guessPerson([{ personId: 'r', name: 'Raul Jorge Marques Abraao' }], '', 'rabraao@x.pt')?.personId === 'r' && RCm.guessPerson([{ personId: 'x', name: 'Ana Silva' }], 'Raul Abraão', 'rabraao@x.pt') === null);
const qvCo = { companyPhone: '+351 232448531', companyEmail: 'geral@quadroviseu.com', website: 'www.quadroviseu.com', postcode: '4465-686', hqAddress: 'RUA X, 42. 4465-686 Matosinhos', nif: '501234567', reach: [], contacts: [] };
const cq = RCm.compareContacts(qv, { company: qvCo, peopleEmails: ['hfc.quadroviseu@sapo.pt'], senderEmail: 'hfc.quadroviseu@sapo.pt', senderPhones: [] });
const by = Object.fromEntries(cq.items.map((i) => [i.type + ':' + (i.norm || i.value), i]));
ok('Compare (QUADROVISEU): the landline and the site are already on file; the mobile, gerencia@ and the factory address are new', by['phone:232448531'].have === true && by['phone:962405366'].have === false && by['phone:962405366'].target === 'person' && by['email:gerencia@quadroviseu.com'].have === false && by['email:hfc.quadroviseu@sapo.pt'].have === true && by['website:https://www.quadroviseu.com'].have === true && cq.items.find((i) => i.type === 'address').have === false);
ok('Compare: NIPC — matches the company, differs, or the company has none; a second landline on the company reach counts as on file', RCm.compareContacts(sl, { company: { nif: '513470417' } }).nipc.matches === true && RCm.compareContacts(sl, { company: { nif: '500000000' } }).nipc.matches === false && RCm.compareContacts(sl, { company: {} }).nipc.matches === null && RCm.compareContacts(sl, { company: { reach: [{ type: 'phone', value: '+351 22 328 68 30' }] } }).items.find((i) => i.norm === '223286830').have === true);
ok('Compare: an address with the postcode already on file is "already on file"', RCm.compareContacts(sl, { company: { reach: [{ type: 'address', value: 'Av. Dom Miguel 150, 4435-678 Baguim do Monte' }] } }).items.find((i) => i.type === 'address').have === true);
const raw0 = fs.readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8');
ok('Inbox card: under the conversation head, behind outreach.replyContacts, one click to add, Check address on request', raw0.includes('id="replyContacts"') && raw0.includes("if (!isOn('outreach.replyContacts') || !t.companyId)") && raw0.includes('data-rcadd=') && raw0.includes("action: 'checkAddress'") && raw0.includes('updateReplyContacts(tt)') && raw0.includes('Nothing is saved until you click Add.'));
ok('Inbox: an address added from the inbox that wrote to us is confirmed by the reply', raw0.includes("...(replied ? { origin: 'person', confirmedAt: at, confirmedBy: 'reply', confirmedVia: 'reply' } : {})"));
ok('The switch exists on both sides', fs.readFileSync(new URL('../../functions/features/catalog.js', import.meta.url), 'utf8').includes('"outreach.replyContacts"') && fs.readFileSync(new URL('../../portal/features.js', import.meta.url), 'utf8').includes("'outreach.replyContacts'"));

const rcStart = raw0.indexOf('    const checkText = (r) =>'), rcEnd = raw0.indexOf('    // Where a detail goes:');
const rcEl = { innerHTML: '', querySelectorAll: () => [] };
const renderRC = new Function('$', 'esc', 'window', rcEnd > rcStart && rcStart > 0 ? raw0.slice(rcStart, rcEnd) + '; return renderReplyContacts;' : 'throw new Error("not found")')(() => rcEl, (x) => String(x == null ? '' : x), { pageAccess: { can: () => true, key: 'andre' } });
const rcCo = { owner: 'andre', ...qvCo }, rcCmp = RCm.compareContacts(qv, { company: qvCo, peopleEmails: ['hfc.quadroviseu@sapo.pt'], senderEmail: 'hfc.quadroviseu@sapo.pt' });
renderRC({ co: rcCo, sender: { personId: 'p1', name: 'Herminio Ferreira Cardoso' }, from: { name: 'Hermínio Cardoso', email: 'hfc.quadroviseu@sapo.pt' }, cmp: rcCmp, checks: {} });
ok('Inbox card (QUADROVISEU): 3 new (mobile, gerencia@, address), the mobile goes to Herminio, the landline is on file, address offers Check address', rcEl.innerHTML.includes('(3 new)') && rcEl.innerHTML.includes('Add to Herminio') && rcEl.innerHTML.includes('962 405 366') && rcEl.innerHTML.includes('already on file') && rcEl.innerHTML.includes('data-rcchk=') && rcEl.innerHTML.includes('Rua da Quinta da Serra Nº4, Paradinha, 3510-107 Viseu') && rcEl.innerHTML.includes('<details') && rcEl.innerHTML.includes(' open'));
renderRC({ co: rcCo, sender: null, from: { email: 'x@y.pt' }, cmp: RCm.compareContacts(sl, { company: { nif: '513470417', owner: 'andre' } }), checks: { 3: { status: 'postcode_only', note: 'The postcode exists, but OpenStreetMap does not list that street (common in small places): not proof either way.' } } });
ok('Inbox card (SHORTLEC): no known sender → the mobile goes to the company; the NIPC says it matches; a check result is shown', rcEl.innerHTML.includes('Add to company') && !rcEl.innerHTML.includes('Add to Herminio') && rcEl.innerHTML.includes('matches the company') && rcEl.innerHTML.includes('not proof either way'));
renderRC({ co: rcCo, sender: null, from: { email: 'x@y.pt' }, cmp: { items: [], nipc: null }, checks: {} });
ok('Inbox card: nothing found → nothing shown', rcEl.innerHTML === '');

const CPm = await import(new URL('../../portal/company-primary.js', import.meta.url));
ok('Letter check: the street, postcode and place come from the envelope lines (the name and "Ao cuidado" are never the street)', JSON.stringify(CPm.letterAddressParts(['ISOGNOM, LDA', 'Ao cuidado do Senhor X', 'R. de Trás 421', '4475-500 Maia'])) === JSON.stringify({ street: 'R. de Trás 421', postcode: '4475-500', place: 'Maia' }) && JSON.stringify(CPm.letterAddressParts(['QV, LDA', 'Rua da Quinta da Serra Nº4, Paradinha', '3510-107 Viseu - Portugal'])) === JSON.stringify({ street: 'Rua da Quinta da Serra Nº4, Paradinha', postcode: '3510-107', place: 'Viseu' }));
ok('Letter check: no postcode, or only the name and a postcode, = nothing to check', CPm.letterAddressParts(['QV, LDA', 'Rua do Sol']) === null && CPm.letterAddressParts(['QV, LDA', '3510-107 Viseu']) === null && CPm.letterAddressParts(['QV, LDA', 'Ao cuidado de Y', '3510-107 Viseu']) === null);
ok('Letters to print: Check addresses one at a time (1.2 s apart), a pill per letter, print asks when an address did not check out', html.includes('id="letCheck"') && html.includes("action: 'checkAddress', street: p.street") && html.includes('setTimeout(r, 1200)') && html.includes('data-lchk=') && html.includes('const checkBad = (r)') && html.includes('have an address that did not check out'));
ok('Inbox: the company figures sit next to its name, and the related companies under the conversation (outreach.ownerAware)', html.includes('${company}${coFiguresHtml(coCache.get(t.companyId))}${addrTrail(t)}') && html.includes('id="relLine"') && html.includes("callCampaign({ action: 'related', companyId: t.companyId })") && html.includes('Related companies (${d.related.length})'));
ok('Inbox: Forward and Task or activity also sit next to Reply / Reply all, same actions as the buttons at the top', html.includes('id="replyFwdBtn"') && html.includes('id="replyTaskBtn"') && html.includes("$('replyFwdBtn')?.addEventListener('click', () => openForward(t))") && html.includes("$('taskBtn')?.addEventListener('click', () => openThreadTask(t))") && html.includes("$('replyTaskBtn')?.addEventListener('click', () => openThreadTask(t))"));

const wiStart = html.indexOf('    function whoIsAddress(a, t) {'), wiEnd = html.indexOf('    function addrWho(t) {');
const whoIs = new Function('coCache', 'peopleCache', html.slice(wiStart, wiEnd) + '; return whoIsAddress;')(new Map([['c1', { companyEmail: 'geral@x.pt', contacts: [] }]]), new Map([['c1', [{ name: 'Fernando Gouveia Pereira', role: 'Manager', emails: ['fernando.ok@x.pt'], badEmails: ['fernandogouveia.pereira@x.pt'] }]]]));
ok('Inbox: an address that bounced is still on the person record ("Fernando · bounced address"), not "not in the CRM"; a stranger still is', whoIs('fernandogouveia.pereira@x.pt', { companyId: 'c1' }) === 'Fernando Gouveia Pereira · bounced address' && whoIs('fernando.ok@x.pt', { companyId: 'c1' }).startsWith('Fernando Gouveia Pereira (Manager)') && whoIs('geral@x.pt', { companyId: 'c1' }) === 'company address' && whoIs('stranger@y.pt', { companyId: 'c1' }) === '');

const adStart = html.indexOf('    async function addReplyContact(rc, item, target) {'), adEnd = html.indexOf("    // 3 Nov: the company's figures next to its name");
const calls = [];
const store2 = new Map([['searchPeople/p1', { reach: [{ type: 'phone', value: '+351 111111111' }], name: 'Carla Caridade' }], ['searchCompanies/c1', { reach: [], emailKeys: [] }]]);
const mkAdd = () => new Function('doc', 'collection', 'getDoc', 'setDoc', 'updateDoc', 'addDoc', 'serverTimestamp', 'emailKeysFor', 'dayFmt', 'tsMs', 'me', 'db', 'addReads', 'toast', 'peopleCache', 'threadPeopleLoaded', html.slice(adStart, adEnd) + '; return addReplyContact;')(
  (a, b, c) => (a && a.col && b === undefined ? { p: a.col + '/gen1', id: 'gen1' } : { p: b + '/' + c, id: c }),
  (d, name) => ({ col: name }),
  async (ref) => ({ exists: () => store2.has(ref.p), data: () => store2.get(ref.p) }),
  async (ref, v) => { calls.push(['set', ref.p, v]); },
  async (ref, v) => { calls.push(['update', ref.p, v]); },
  async (col, v) => { calls.push(['add', 'activity', v]); },
  () => 'TS', (emails) => emails.map((e) => e.slice(0, 3)), { format: () => '3 Nov' }, () => 0, 'andre@x.pt', {}, () => {}, () => {}, new Map(), new Set());
const addRC = mkAdd();
const rcx = { t: { companyId: 'c1', companyName: 'GAIACEDE' }, msg: { createdAt: 0 }, co: { reach: [] }, sender: null, from: { name: 'Carla Caridade', email: 'ccaridade@gaiacede.pt' } };
const mob = { type: 'phone', kind: 'mobile', norm: '937864404', value: '937 864 404', have: false, target: 'person' };
await addRC(rcx, mob, { kind: 'new', name: 'Carla Caridade', role: 'Directora', withMail: true });
const setP = calls.find((c) => c[0] === 'set' && c[1].startsWith('searchPeople')), setL = calls.find((c) => c[0] === 'set' && c[1].startsWith('searchPersonLinks'));
ok('Add to a NEW contact: the person is created with the phone and the sender address, linked as a contact with the role, and logged', setP && setP[2].name === 'Carla Caridade' && setP[2].reach.some((r) => r.type === 'phone' && r.value === '+351 937864404' && r.origin === 'person') && setP[2].reach.some((r) => r.type === 'email' && r.value === 'ccaridade@gaiacede.pt') && setP[2].reachEmails.join() === 'ccaridade@gaiacede.pt' && setL && setL[2].isContact === true && setL[2].contactRole === 'Directora' && calls.some((c) => c[0] === 'add' && c[2].type === 'person_linked'));
calls.length = 0;
await addRC(rcx, mob, { kind: 'person', personId: 'p1', name: 'Carla Caridade' });
const up = calls.find((c) => c[0] === 'update' && c[1] === 'searchPeople/p1');
ok('Add to an EXISTING person (any of the company\'s people): the phone is appended to their record', up && up[2].reach.length === 2 && up[2].reach[1].value === '+351 937864404');
calls.length = 0;
await addRC(rcx, { type: 'email', value: 'gerencia@x.pt', have: false, target: 'company' }, { kind: 'company' });
ok('Add to the COMPANY: the email goes to the company\'s general contacts, with the search keys', calls.some((c) => c[0] === 'update' && c[1] === 'searchCompanies/c1' && c[2].reach[0].value === 'gerencia@x.pt' && c[2].emailKeys.length > 0));
store2.set('searchPeople/p1', { name: 'Carla Caridade', reach: [{ type: 'phone', value: '+351 937 864 404' }] });
let dupErr = ''; try { await addRC({ ...rcx, co: { reach: [] } }, mob, { kind: 'person', personId: 'p1', name: 'Carla' }); } catch (e) { dupErr = e.message; }
ok('A detail already on the record is refused, not added twice', /already on their record/.test(dupErr));
ok('The ▾ next to Add opens the choice: company, each person, a new contact', html.includes('data-rcmore=') && html.includes('function openRcTarget(rc, item)') && html.includes('A new contact…') && html.includes('The company (general contact details)'));

const ATm = await import(new URL('../../portal/attachments.js', import.meta.url));
ok('Files: allowed types and the limits (10 MB each, 5 files, 20 MB together); a type that can run is refused', ATm.allowedName('Relatório.PDF') && ATm.allowedName('convite.ics') && !ATm.allowedName('a.exe') && !ATm.allowedName('x.zip') && !ATm.allowedName('noext') && ATm.fileProblem({ name: 'a.exe', size: 5 }) !== '' && /larger than 10 MB/.test(ATm.fileProblem({ name: 'a.pdf', size: 11 * 1048576 })) && /At most 5/.test(ATm.fileProblem({ name: 'a.pdf', size: 5 }, [{}, {}, {}, {}, {}])) && /20 MB/.test(ATm.fileProblem({ name: 'a.pdf', size: 9 * 1048576 }, [{ size: 9 * 1048576 }, { size: 9 * 1048576 }])) && ATm.fileProblem({ name: 'a.pdf', size: 5 }, []) === '');
ok('Files: content type by extension, a safe name, a readable size', ATm.contentTypeFor('x.XLSX') === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' && ATm.safeName('Balanço 2025/final?.pdf') === 'Balan_o 2025_final_.pdf' && ATm.fmtSize(1536) === '2 KB' && ATm.fmtSize(3 * 1048576) === '3.0 MB');
ok('Invite: Lisbon time becomes the right instant, winter and summer', ATm.lisbonToUtc('2026-11-06', '14:30').toISOString() === '2026-11-06T14:30:00.000Z' && ATm.lisbonToUtc('2026-07-06', '14:30').toISOString() === '2026-07-06T13:30:00.000Z');
const ics = ATm.buildIcs({ uid: 'u1@x', title: 'Reunião — SHORTLEC, Lda', start: ATm.lisbonToUtc('2026-11-06', '14:30'), minutes: 45, location: 'Av. Dom Miguel 150, 4435-678 Baguim do Monte', description: 'Linha 1\nLinha 2', organizer: { name: 'André Rocha', email: 'a.rocha@mail.example.test' }, attendees: [{ name: 'Carlos', email: 'c@shortlec.com' }], now: new Date('2026-11-03T12:00:00Z') });
const unfolded = ics.replace(/\r\n /g, '');
ok('Invite (.ics): a request with the organiser, the attendee who must answer, UTC start and end, CRLF lines', ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n') && unfolded.includes('METHOD:REQUEST') && unfolded.includes('DTSTART:20261106T143000Z') && unfolded.includes('DTEND:20261106T151500Z') && unfolded.includes('ORGANIZER;CN=André Rocha:mailto:a.rocha@mail.example.test') && unfolded.includes('ATTENDEE;CN=Carlos;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:c@shortlec.com') && !/[^\r]\n/.test(ics));
ok('Invite (.ics): commas, semicolons and new lines in the text are escaped; no line is longer than 75 bytes', unfolded.includes('SUMMARY:Reunião — SHORTLEC\\, Lda') && unfolded.includes('DESCRIPTION:Linha 1\\nLinha 2') && ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75));
const atStart = html.indexOf('    async function uploadFile(file,'), atEnd = html.indexOf('    // The box under a reply, a new email or a template');
const upCalls = [];
const upload = new Function('doc', 'collection', 'db', 'ref', 'storage', 'uploadBytes', 'setDoc', 'serverTimestamp', 'me', 'fileById', 'safeName', 'contentTypeFor', html.slice(atStart, atEnd) + '; return uploadFile;')(
  () => ({ id: 'F9' }), () => ({}), {}, (s, path) => ({ path }), {}, async (r, file, meta) => upCalls.push(['bytes', r.path, meta.contentType]), async (d, data) => upCalls.push(['doc', data]), () => 'TS', 'andre@x.pt', new Map(), ATm.safeName, ATm.contentTypeFor);
const fid = await upload({ name: 'Apresentação 2026.pdf', size: 1234 }, { keep: true });
const icsLink = (link, loc) => ATm.buildIcs({ uid: 'u@x', title: 'Reunião', start: ATm.lisbonToUtc('2026-11-06', '10:00'), location: loc || '', description: 'Nota', link, organizer: { name: 'A', email: 'a@x.pt' }, attendees: [{ name: 'C', email: 'c@y.pt' }], now: new Date('2026-11-03T12:00:00Z') }).replace(/\r\n /g, '');
const icsMeet = icsLink('https://meet.google.com/abc-defg-hij'), icsTeams = icsLink('https://teams.microsoft.com/l/meetup-join/x', 'Escritório do Porto');
ok('Invite with a meeting link: the link is the place (when none), in the description, the event URL and, for Google Meet, its conference property', icsMeet.includes('LOCATION:https://meet.google.com/abc-defg-hij') && icsMeet.includes('DESCRIPTION:Ligação para a reunião: https://meet.google.com/abc-defg-hij\\n\\nNota') && icsMeet.includes('URL:https://meet.google.com/abc-defg-hij') && icsMeet.includes('X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij'));
ok('Invite with Teams or Zoom and a typed place: the place stays, the link is in the description and the URL, no Google property', icsTeams.includes('LOCATION:Escritório do Porto') && icsTeams.includes('URL:https://teams.microsoft.com/l/meetup-join/x') && !icsTeams.includes('X-GOOGLE-CONFERENCE') && !icsLink('').includes('URL:') && html.includes('id="ivLink"') && html.includes('The meeting link must start with https://'));
ok('Upload: the file goes to outreach/files/<id>/<name> with its type, then its record (name, size, path, library, who) is written', fid === 'F9' && upCalls[0][0] === 'bytes' && upCalls[0][1] === 'outreach/files/F9/Apresenta__o 2026.pdf' && upCalls[0][2] === 'application/pdf' && upCalls[1][1].name === 'Apresentação 2026.pdf' && upCalls[1][1].library === true && upCalls[1][1].size === 1234 && upCalls[1][1].createdBy === 'andre@x.pt' && upCalls[1][1].source === 'upload');
const fidInvite = await upload({ name: 'convite.ics', size: 500 }, { keep: false, source: 'invite', contentType: 'text/calendar; method=REQUEST; charset=UTF-8' });
ok('An invite is stored out of the library, as text/calendar with method=REQUEST', upCalls[3][1].library === false && upCalls[3][1].source === 'invite' && /method=REQUEST/.test(upCalls[3][1].contentType) && upCalls[2][2].startsWith('text/calendar'));
ok('Reply, Compose and Template send the chosen files; they are cleared after sending; the template keeps its own list (library files)', html.includes("...(replyAtt.ids.length ? { attachments: replyAtt.ids } : {})") && html.includes("...(composeAtt.ids.length ? { attachments: composeAtt.ids } : {})") && html.includes('attachments: kind === \'email\' ? tplAtt.ids : []') && html.includes("renderAttachBox('tAtt', tplAtt, { keepAlways: true })") && html.includes("composeAtt.ids = []"));
ok('Compose warns that a file on a first email may land in spam (free, with a warning); Settings → Files lists the library and the files saved from replies', html.includes('firstEmail: () => true') && html.includes('makes it more likely to land in spam') && html.includes('id="sec-files"') && html.includes('data-sec="files"') && html.includes('id="filesRecvBody"'));
ok('Received files: the Inbox asks to save them to the company (Save / Not now), and lists the company files under the conversation; Forward can take them along', html.includes('data-attsave=') && html.includes('data-attsaveno=') && html.includes("action: 'saveReceivedFiles'") && html.includes('id="coFilesLine"') && html.includes("includeFiles: true") && html.includes('id="fwdFiles"'));
ok('Calendar invite: from the reply box and from Compose, with the company address as the place', html.includes("data-attcal") && html.includes('function replyInviteCtx(t)') && html.includes('function composeInviteCtx()') && html.includes("'Attach the invite'"));
ok('The switch exists on both sides', fs.readFileSync(new URL('../../functions/features/catalog.js', import.meta.url), 'utf8').includes('"outreach.attachments"') && fs.readFileSync(new URL('../../portal/features.js', import.meta.url), 'utf8').includes("'outreach.attachments'"));

const bareInputs = [...html.matchAll(/<input id="[^"]+"(?![^>]*type=)[^>]*>/g)].map((m) => m[0]);
ok('Every text field in the new modals has a type, so the page style (rounded, bordered) applies: no <input id=...> without type', bareInputs.length === 0 && html.includes('<input type="text" id="ivTitle"') && html.includes('<input type="url" id="ivLink"'));

ok('Invite: time zones — Madrid in summer, New York in winter, Lisbon; the same wall-clock time is a different instant', ATm.zoneToUtc('2026-07-06', '10:00', 'Europe/Madrid').toISOString() === '2026-07-06T08:00:00.000Z' && ATm.zoneToUtc('2026-11-06', '09:00', 'America/New_York').toISOString() === '2026-11-06T14:00:00.000Z' && ATm.zoneToUtc('2026-11-06', '14:30').toISOString() === '2026-11-06T14:30:00.000Z' && ATm.ZONES[0][0] === 'Europe/Lisbon');
ok('Invite guests: merged one per address (case-insensitive, first name wins), what is not an email is dropped', JSON.stringify(ATm.mergeGuests([{ email: 'a@x.pt', name: 'A' }], [{ email: 'A@X.pt', name: 'dup' }, { email: 'bad' }, { email: 'b@y.pt' }])) === JSON.stringify([{ email: 'a@x.pt', name: 'A' }, { email: 'b@y.pt', name: '' }]) && ATm.isEmail('x@y.pt') && !ATm.isEmail('x@y') && !ATm.isEmail('a b@y.pt'));
const icsGuests = ATm.buildIcs({ uid: 'g@x', title: 'Reunião', start: ATm.zoneToUtc('2026-11-06', '10:00'), minutes: 30, organizer: { name: 'A', email: 'a@mail.example.test' }, attendees: ATm.mergeGuests([{ email: 'carlos@empresa.pt', name: 'Carlos' }], [{ email: 'partner1@example.test', name: 'André' }, { email: 'partner2@example.test', name: 'António' }]), now: new Date('2026-11-03T12:00:00Z') }).replace(/\r\n /g, '');
ok('Invite (.ics): every guest is an attendee — the company contact and both partners', (icsGuests.match(/ATTENDEE;/g) || []).length === 3 && icsGuests.includes('mailto:partner1@example.test') && icsGuests.includes('mailto:partner2@example.test') && icsGuests.includes('mailto:carlos@empresa.pt'));
const bkStart = html.indexOf('    async function bookInviteMeetings('), bkEnd = html.indexOf('    const orgSenderName = ');
const bk = [], toasts = [];
const metaMap = new Map([['f1', { title: 'Reunião — SHORTLEC', start: '2026-11-06T14:30:00.000Z', where: 'Av. Dom Miguel 150', link: 'https://meet.google.com/abc', guests: ['c@x.pt', 'a@y.pt'] }]]);
const book = new Function('inviteMeta', 'callCampaign', 'myOwner', 'toast', 'errText', html.slice(bkStart, bkEnd) + '; return bookInviteMeetings;')(metaMap, async (p) => { bk.push(p); return { data: {} }; }, 'andre', (m) => toasts.push(m), (e) => e.message);
await book(['f1', 'unknown'], { companyId: 'co1', threadId: 't1' });
ok('Sending the invite books the meeting: a visit task on the company, due at the meeting time, assigned to the sender, with the place, the link and the guests', bk.length === 1 && bk[0].action === 'createTask' && bk[0].companyId === 'co1' && bk[0].threadId === 't1' && bk[0].channel === 'visit' && bk[0].dueAt === '2026-11-06T14:30:00.000Z' && bk[0].assignee === 'andre' && /Reunião — SHORTLEC — Av\. Dom Miguel 150/.test(bk[0].instructions) && /Link: https:\/\/meet\.google\.com\/abc/.test(bk[0].instructions) && /Guests: c@x\.pt, a@y\.pt/.test(bk[0].instructions) && toasts.length === 1 && !metaMap.has('f1'));
await book(['f1'], { companyId: 'co1' });
ok('…once only (the meeting is forgotten after booking), and not without a company', bk.length === 1);
metaMap.set('f2', { title: 'X', start: '2026-11-06T14:30:00.000Z', guests: [] });
await book(['f2'], { companyId: null });
ok('A test send with no company books nothing', bk.length === 1 && !metaMap.has('f2'));
ok('The invite form: title, date, zone, start, end, place, link, guests with suggestions (partners by default, removable), notes; no duration box', html.includes('id="ivZone"') && html.includes('id="ivEnd"') && html.includes('id="ivGuest" list="ivGuestList"') && html.includes('The partners are guests by default') && html.includes("(window.teamDir || []).filter(m => m.partner && m.active !== false && m.contactEmail)") && !html.includes('id="ivMin"'));
ok('A draft (the email waits in To approve) does not book the meeting; a sent reply and a sent Compose do', html.includes('if (res && !res.draft) await bookInviteMeetings(replyAtt.ids, { companyId: t.companyId, threadId: t.id })') && html.includes('await bookInviteMeetings(composeAtt.ids, { companyId: payload.companyId, threadId: res.threadId })'));

// switches exist on both sides with the same text
const cat = fs.readFileSync(new URL('../../functions/features/catalog.js', import.meta.url), 'utf8');
const pf = fs.readFileSync(new URL('../../portal/features.js', import.meta.url), 'utf8');
for (const k of ['outreach.visitMeetings', 'outreach.companyCounts']) ok(`switch ${k} is in the server catalog and the page list`, cat.includes(`"${k}"`) && pf.includes(`'${k}'`));
console.log(fail ? `\n${fail} FAILED` : '\nAll passed');
process.exit(fail ? 1 : 0);
