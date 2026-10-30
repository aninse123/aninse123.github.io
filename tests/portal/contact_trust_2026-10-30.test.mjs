// Contact trust labels (30 Oct 2026, switch contacts.trustLabels): the page module gives the same status as
// the server's, the pill and the hover, and the Search CRM / Outreach screens use it behind the switch.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = await import('../../portal/contact-trust.js');
const S = require('../../functions/outreach/contact_trust.js');
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const search = read('../../portal/search.html'), outreach = read('../../portal/outreach.html'), campaigns = read('../../functions/outreach/campaigns.js'), sched = read('../../functions/outreach/scheduler.js');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

// The page and the server decide the same, on every combination
const origins = [undefined, 'team', 'person', 'database', 'enrichment'], types = ['email', 'phone', 'linkedin'], tools = [undefined, 'verified', 'unconfirmed'], confs = [undefined, '2026-10-30T10:00:00Z'], stats = [undefined, 'ok', 'bounced', 'old'];
let same = true, n = 0;
for (const origin of origins) for (const type of types) for (const toolStatus of tools) for (const confirmedAt of confs) for (const status of stats) {
  const e = { origin, type, toolStatus, confirmedAt, status }; n++;
  if (P.trustOf(e) !== S.trustOf(e)) same = false;
}
ok(`page and server module agree on all ${n} combinations`, same);
ok('same labels and the same sending rule', JSON.stringify(P.STATUS) === JSON.stringify(S.STATUS) && [['confirmed', false], ['tool', false], ['unverified', false], ['unverified', true], ['bounced', true]].every(([k, inc]) => P.usable(k, inc) === S.usable(k, inc)));
ok('the four labels, in words', P.STATUS.confirmed === 'Confirmed' && P.STATUS.tool === 'Tool-verified' && P.STATUS.unverified === 'Not verified' && P.STATUS.bounced === 'Bounced');

// The hover and the pill
const t1 = P.trustTitle({ origin: 'enrichment', type: 'email', toolStatus: 'verified', confirmedAt: '2026-10-30T10:00:00Z', confirmedBy: 'andre.rocha@douropartners.pt' });
ok('hover: where it came from, what the tool said, who confirmed it and when, never the tool\'s name', /enrichment tool/.test(t1) && /valid/.test(t1) && /confirmed by andre\.rocha on 2026-10-30/.test(t1) && !/clay/i.test(t1));
ok('hover for a LinkedIn profile from a tool says the tool does not check it', /does not check this kind of detail/.test(P.trustTitle({ origin: 'enrichment', type: 'linkedin' })) && /not confirmed by a person/.test(P.trustTitle({ origin: 'enrichment', type: 'linkedin' })));
ok('the pill carries the status and is escaped', P.trustPillHtml('tool', 'a "b"', (s) => String(s).replace(/"/g, '&quot;')) === '<span class="trust trust--tool" title="a &quot;b&quot;">Tool-verified</span>' && /trust--bounced/.test(P.TRUST_CSS));

// The screens
ok('Search CRM: module imported with its styles; one status per detail, Bounced replacing the old badge, only with the switch', search.includes("from './contact-trust.js'") && search.includes("isOn('contacts.trustLabels'), tk = TL ? trustOf(e) : null") && search.includes("!(TL && e.status === 'bounced')"));
ok('Search CRM: Confirm / Unconfirm button on every detail (not on a bounced one), saved with who and when', search.includes('data-reachconfirm') && search.includes("tk !== 'bounced'") && search.includes("confirmedBy: currentUser, confirmedAt: new Date().toISOString()") && search.includes('confirmedBy: null, confirmedAt: null'));
ok('Search CRM: both click handlers (company people list and person page) handle the Confirm button', (search.match(/reachconfirm/g) || []).length >= 8 && search.includes('reachUpdate(own, e.id, reachConfirmPatch(t.dataset.undo))'));
ok('Search CRM: an Orbis value shows the Tool-verified pill', search.includes("trustPillHtml('tool', trustTitle({ origin: 'database', type: t }, reachDay), esc)"));
ok('Outreach: label next to "Goes to", the held-back count in the recipients check, and the campaign option saved', outreach.includes("trustPillHtml(p.trust, '', esc)") && outreach.includes('r.heldBack') && outreach.includes('id="csUnverified"') && outreach.includes("useUnverified: $('csUnverified').checked") && outreach.includes('TRUST_CSS'));
ok('server: the scheduler reads the switch and passes it with the campaign\'s option; the preview does too', sched.includes('Feat.jobState("contacts.trustLabels")') && sched.includes('includeUnverified: !!campaign.useUnverified') && campaigns.includes('Feat.isOnFor(request, "contacts.trustLabels")') && campaigns.includes('includeUnverified: !!campaign.useUnverified'));
ok('the switch is in the catalog and in the page list, as a release switch', read('../../functions/features/catalog.js').includes('key: "contacts.trustLabels"') && read('../../portal/features.js').includes("'contacts.trustLabels', 'Search CRM', 'release'"));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
