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

// The company's general address
const gen = { companyEmail: 'Geral@Empresa.pt', companyEmailConfirmedAt: '2026-10-30T10:00:00Z', companyEmailConfirmedFor: 'geral@empresa.pt', companyEmailConfirmedBy: 'andre.rocha@douropartners.pt' };
let sameCo = true;
for (const c of [{ companyEmail: 'a@b.pt' }, gen, { ...gen, companyEmailBounce: { email: 'geral@empresa.pt' } }, { ...gen, companyEmail: 'outro@empresa.pt' }, { companyEmail: 'a@b.pt', companyEmailBounce: { email: 'x@y.pt' } }]) if (P.companyEmailTrust(c) !== S.companyEmailTrust(c)) sameCo = false;
ok('company address: the page and the server module agree', sameCo && P.companyEmailTrust({ companyEmail: 'a@b.pt' }) === 'tool' && P.companyEmailTrust(gen) === 'confirmed' && P.companyEmailTrust({ ...gen, companyEmailBounce: { email: 'GERAL@empresa.pt' } }) === 'bounced');
const tt = P.companyEmailTitle({ ...gen, companyEmailBounce: { email: 'geral@empresa.pt', at: '2026-10-29T09:00:00Z', reason: 'hard bounce' } });
ok('company address hover: where it came from, the bounce with date and reason, who confirmed it', /registry or the Orbis database/.test(tt) && /bounced on 2026-10-29 \(hard bounce\)/.test(tt) && /confirmed by andre.rocha on 2026-10-30/.test(tt));

// The hover and the pill
const t1 = P.trustTitle({ origin: 'enrichment', type: 'email', toolStatus: 'verified', confirmedAt: '2026-10-30T10:00:00Z', confirmedBy: 'andre.rocha@douropartners.pt' });
ok('hover: where it came from, what the tool said, who confirmed it and when, never the tool\'s name', /enrichment tool/.test(t1) && /valid/.test(t1) && /confirmed by andre\.rocha on 2026-10-30/.test(t1) && !/clay/i.test(t1));
ok('hover for a LinkedIn profile from a tool says the tool does not check it', /does not check this kind of detail/.test(P.trustTitle({ origin: 'enrichment', type: 'linkedin' })) && /not confirmed by a person/.test(P.trustTitle({ origin: 'enrichment', type: 'linkedin' })));
ok('hover for something typed by the team does not say "not confirmed" (the pill says Confirmed)', P.trustTitle({ origin: 'team', type: 'email' }) === 'Typed by the team' && P.trustTitle({ type: 'email' }) === 'Typed by the team' && /not confirmed by a person/.test(P.trustTitle({ origin: 'database', type: 'email' })));
ok('the pill carries the status and is escaped', P.trustPillHtml('tool', 'a "b"', (s) => String(s).replace(/"/g, '&quot;')) === '<span class="trust trust--tool" title="a &quot;b&quot;">Tool-verified</span>' && /trust--bounced/.test(P.TRUST_CSS));

// The screens
ok('Search CRM: module imported with its styles; one status per detail, Bounced replacing the old badge, only with the switch', search.includes("from './contact-trust.js'") && search.includes("isOn('contacts.trustLabels'), tk = TL ? trustOf(e) : null") && search.includes("!(TL && e.status === 'bounced')"));
ok('Search CRM: Confirm only where a person still has to check (tool-verified, not verified), Unconfirm where one confirmed it, nothing on what the team typed or a bounced one; saved with who and when', search.includes('data-reachconfirm') && search.includes("(e.confirmedAt || tk === 'tool' || tk === 'unverified')") && search.includes("confirmedBy: currentUser, confirmedAt: new Date().toISOString()") && search.includes('confirmedBy: null, confirmedAt: null'));
ok('Search CRM: both click handlers (company people list and person page) handle the Confirm button', (search.match(/reachconfirm/g) || []).length >= 8 && search.includes('reachUpdate(own, e.id, reachConfirmPatch(t.dataset.undo))'));
ok('Search CRM: an Orbis value shows the Tool-verified pill', search.includes("trustPillHtml('tool', trustTitle({ origin: 'database', type: t }, reachDay), esc)"));
ok('Overview: the Email row shows the status next to the general address, with Confirm / Unconfirm (only for someone who can edit the company), saved for that address', search.includes('${companyEmailStatusHtml(c)}') && search.includes("isOn('contacts.trustLabels') || !c?.companyEmail") && search.includes('canEditCompany(c)') && search.includes('companyEmailConfirmedFor: String(c.companyEmail).trim().toLowerCase()') && search.includes('companyEmailConfirmedAt: null') && search.includes('{ ...patch, updatedAt: serverTimestamp() }'));
ok('server: a hard bounce or a provider block on the company address is recorded on the company', read('../../functions/outreach/webhook.js').includes('store.markCompanyEmailBounced(companyId, recipient, "hard bounce", isTest)') && read('../../functions/outreach/webhook.js').includes('store.markCompanyEmailBounced(companyId, recipient, "blocked by the provider", isTest)') && read('../../functions/outreach/store.js').includes('async function markCompanyEmailBounced'));
ok('Search CRM: adding an email that already belongs to someone else asks first (another person or a company; the same person is already refused as "Already in the list"), at both places where one is added', search.includes("where('reachEmails', 'array-contains', e)") && search.includes("where('emailKeys', 'array-contains', e)") && (search.match(/confirmEmailElsewhere\(r\.entry\.type, r\.entry\.value,/g) || []).length === 2 && search.includes('is already used by') && search.includes("d.id !== selfPersonId"));
ok('Outreach task cards: the status next to the phone, LinkedIn and email of a person, worked out from the entry, the typed field or Orbis', outreach.includes('function detailTrustKey(p, type, value)') && outreach.includes("pillOf(p.trusts?.phone)") && outreach.includes("pillOf(p.trusts?.linkedin)") && outreach.includes("pillOf(p.trusts?.emails?.[0])") && outreach.includes("return 'tool'; // an Orbis value"));
ok('Company contact card on the Contacts tab (behind the switch, above the people): the single fields stay first with their status, more can be added, confirmed, edited, deleted; only for someone who can edit the company', search.includes('function companyReachCardHtml(c)') && search.includes("${isOn('contacts.trustLabels') ? companyReachCardHtml(c) : ''}<div class=\"card\" data-people-tab>") && search.includes("if (isOn('contacts.trustLabels')) wireCompanyReach(c);") && search.includes('const canEdit = canEditCompany(c)') && search.includes("const CR_SINGLES = { email: 'companyEmail', phone: 'companyPhone', linkedin: 'linkedinUrl', website: 'website', address: 'hqAddress' }") && search.includes("r.entry.primary = false"));
ok('company contact card: saving keeps the same-email index (emailKeys) and the updatedAt the list needs; the same email on another company asks first, not on itself', search.includes('async function saveCompanyReach(c, list, change)') && search.includes("companyEmailKeys({ ...c, contacts: [...(c.contacts || []), ...extra] })") && search.includes('reach: list, emailKeys, updatedAt: serverTimestamp()') && search.includes('cc.docs.filter(d => d.id !== selfCompanyId)') && search.includes('confirmEmailElsewhere(type, value, null, c.id)'));
ok('Overview: "+N more" next to the email, phone, website and LinkedIn when the company has more of that kind, opening the Contacts tab', ['email', 'phone', 'website', 'linkedin'].every((t) => search.includes(`ovMoreHtml(c, '${t}')`)) && search.includes("setActiveTab('contacts'); renderContacts(") && search.includes("isOn('contacts.trustLabels') ? (c?.reach || [])"));
ok('server: the other general addresses of a company are offered after the registry one, behind the switch', read('../../functions/outreach/recipients.js').includes('if (T) (company?.reach || [])') && read('../../functions/outreach/recipients.js').includes('Company address (${e.note})'));
ok('Outreach: label next to "Goes to", the held-back count in the recipients check, and the campaign option saved', outreach.includes("trustPillHtml(p.trust, '', esc)") && outreach.includes('r.heldBack') && outreach.includes('id="csUnverified"') && outreach.includes("useUnverified: $('csUnverified').checked") && outreach.includes('TRUST_CSS'));
ok('server: the scheduler reads the switch and passes it with the campaign\'s option; the preview does too', sched.includes('Feat.jobState("contacts.trustLabels")') && sched.includes('includeUnverified: !!campaign.useUnverified') && campaigns.includes('Feat.isOnFor(request, "contacts.trustLabels")') && campaigns.includes('includeUnverified: !!campaign.useUnverified'));
ok('the switch is in the catalog and in the page list, as a release switch', read('../../functions/features/catalog.js').includes('key: "contacts.trustLabels"') && read('../../portal/features.js').includes("'contacts.trustLabels', 'Search CRM', 'release'"));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
