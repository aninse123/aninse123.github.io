// Feature switches — page side ("Portal - Feature Switches Plan.md").
//
// Each feature is Off / Test / On, separately for staging and production.
// Elements tagged data-feature="key" (several = all needed) disappear when
// the feature isn't available to this viewer; for testers, anything shown
// only because it's in Test gets a TEST badge. Settings live in
// config/features (read live; the last known is remembered for a fast start);
// anything missing uses the catalog default below.
//
// Keep FEATURES in sync with functions/features/catalog.js (parity test).
import { INSTANCE } from './instance-config.js';
import { db } from './firebase-config.js';
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

export const STATES = ['off', 'test', 'on'];
export const FEATURES = [
  ['outreach', 'Outreach', 'release', 'Outreach', 'The Outreach tab: inbox, compose, sent, campaigns, tasks, metrics, settings.'],
  ['outreach.campaigns', 'Outreach', 'release', 'Company campaigns', 'Campaigns to companies, and "Add to campaign" / email in the Search CRM.'],
  ['outreach.people', 'Outreach', 'release', 'People campaigns & lists', 'Campaigns to people (investors, brokers, press…), lists, adding people.'],
  ['outreach.recurring', 'Outreach', 'release', 'Recurring emails', 'Recurring emails, e.g. the investor update.'],
  ['outreach.ai', 'Outreach', 'release', 'AI openers', 'AI-written first lines in drafts.'],
  ['outreach.relationship', 'Outreach', 'release', 'Emails from Investor CRM / Network', '"Send email" in the Investor CRM and Network, sent through Outreach. (Admin notices to investors are never switched.)'],
  ['outreach.oneInbox', 'Outreach', 'release', 'One inbox', 'Same email address on two companies: never two cold emails to one address within the campaign’s "contacted in the last N days" window, nor two first drafts on one day (checked when adding companies and before each first email; the automatic part follows the production setting, Test = test campaigns). Inbox: Reply goes to the address you last wrote to, conversations remember every address, and a reply you write can stop the company’s campaign.'],
  ['outreach.waitFromWindowStart', 'Outreach', 'release', 'Waits from the window\'s opening', 'Waits in sending days end when the campaign’s sending window opens on that day (e.g. 09:00), not at the time of the previous email — never sooner than the minimum gap after it (Settings → General, default 12 hours). Calendar days keep the time of day. The scheduler follows the production setting; Test = test campaigns.'],
  ['outreach.ownerAware', 'Outreach', 'release', 'Owner-aware outreach', 'Owner-aware outreach: related companies (same owner at any %, parent / subsidiary, same group, confirmed same email) and their status when adding companies to a campaign (Proceed / Skip for now / Proceed and mention) and on each draft to approve; {{owner.otherCompanies}} for templates; "In conversation via X" and "Group contacted via X" on related companies; the Monday report and metrics by owner. Background jobs follow the production setting (Test = test campaigns).'],
  ['search.emailNameCheck', 'Search CRM', 'release', 'Email name check', 'Flags the name a company gets in emails ({{company.shortName}}) when it looks wrong — an Orbis trade name naming another activity than the CAE ("Café Tony" for a fuel station), legal-form words, a short name not in the legal name, capitals, extra spaces — in Add companies, on drafts to approve, on the company’s Overview and in a Search CRM filter, with "Use the legal name" / "Keep this name". The draft flag follows the production setting.'],
  ['search.contactColumns', 'Search CRM', 'release', 'Contacted and Flags columns', 'The Search CRM list gets two narrow columns after the company name: Flags (do not contact, not contactable, excluded sector) and Contacted (one icon per channel used — email, call, letter, LinkedIn, WhatsApp, visit, meeting, warm intro — green when answered, red when bounced or unsubscribed, and 📣 while in a running campaign), with the detail on hover. The name no longer carries those tags.'],
  ['outreach.inboxSearchAll', 'Outreach', 'release', 'Inbox: search all conversations', 'The Inbox loads the 150 most recent conversations; a search that finds nothing there looks the company up in the whole database (name, NIF, email or @domain) and loads its conversations, "Load older conversations" pages back 150 at a time, and a hint says when the Mine / person filter hides matches.'],
  ['outreach.paths', 'Outreach', 'release', 'Campaign paths', 'A different sequence per filter: each campaign path is a Search CRM filter (fit score, revenue, EBITDA, growth, tier, sector, region…) with its own steps; the first path that matches takes the company when it starts, "Everyone else" takes the rest (or leaves them out). List and tree views; "Check who goes where". The choice when companies start follows the production setting.'],
  ['outreach.sendAllNow', 'Outreach', 'release', 'Send approved emails all at once', 'A campaign setting "Send approved emails all at once": its approved emails leave together instead of one per sending address every 10 minutes (the daily limits still apply), and a "Send approved now" button sends them at once inside the sending window. For a one-off email to a list, e.g. an investor notice.'],
  ['outreach.campaignCc', 'Outreach', 'release', 'Cc on every email of a campaign', 'A campaign setting “Cc on every email”: up to 3 of the team’s own addresses copied on every email of the campaign — e.g. a co-founder on an investor notice. Shown on the drafts in To approve.'],
  ['contacts.trustLabels', 'Search CRM', 'release', 'Contact trust labels', 'Every email, mobile number and LinkedIn profile of a person shows one status: Confirmed, Tool-verified, Not verified or Bounced (Bounced replaces the others). A "Confirmed by me" tick on the Search CRM contact details, and a campaign option "Use not-verified addresses" (off: only Confirmed and Tool-verified addresses are used, and the recipient preview says how many companies were held back). Existing data keeps working: typed contacts are Confirmed, Orbis ones Tool-verified.'],
  ['outreach.multiRecipient', 'Outreach', 'release', 'Several recipients per company', 'A campaign can write to more than one address of a company: tick them in Companies → Goes to → Choose…, and each ticked address gets its own email and conversation (the 2nd and 3rd start a working day after the first, a late-added address always waits in To approve). If an email bounces, the next address takes over. A reply from anyone stops the company, says who replied, and Restart company brings it back at the step it was on.'],
  ['outreach.letterTools', 'Outreach', 'release', 'Letters: preview, edit and checks', 'Tasks → Letters to print: read each letter before printing, edit the text of any letter (that letter only, back to the template with one click), a warning and no printing while a field is missing (e.g. the hand-researched intro), and an "Ao cuidado de …" line with the owner name above the address. The company figures fields (revenue, EBITDA, growth…) work in letters and call scripts with or without this switch.'],
  ['outreach.sectorWording', 'Outreach', 'release', 'Sector wording per company', 'A sector wording typed on each company (Search CRM → edit company → Sector wording) replaces the sector text of the campaign for that company in the emails, letters and call scripts, for example "da refrigeração doméstica e comercial" instead of "dos eletrodomésticos". Empty = the campaign wording is used. While Off the field is hidden and not saved, and emails use the campaign wording.'],
  ['outreach.visitMeetings', 'Outreach', 'release', 'A visit is a meeting', 'Booking a visit (Tasks → Visit, or from a conversation) logs "Meeting scheduled" on the company for the visit date; "Met" logs "Meeting done" (and closes the scheduled one); "Reschedule…" moves the scheduled date. The Monday report counts meetings booked and meetings held.'],
  ['outreach.companyCounts', 'Outreach', 'release', 'Company counts in the metrics', 'Replied and Positive are counted once per company, not once per conversation: an answer by phone or in person (call Connected, visit Met) counts as a reply, and so does a conversation you classified as positive. Metrics page, campaign Overview and the Monday report.'],
  ['outreach.replyContacts', 'Outreach', 'release', 'Contact details found in a reply', 'Under a conversation: the phone numbers, other emails, website, postal address and NIPC found in the latest reply, compared with what the CRM has (already on file / new), with one click to add each, and Check address (a free OpenStreetMap look-up, only when you ask). Nothing is saved without the click.'],
  ['outreach.attachments', 'Outreach', 'release', 'Attachments on outgoing email', 'Attach files to the emails you send: a library of files (Settings → Files), upload on the spot, attach to a reply, a new email or a template (it then goes with every email of the template), and send a calendar invite. Received attachments can be saved to the company files, on request.'],
  ['outreach.taskActions', 'Outreach', 'release', 'Task actions: pause, remove, follow-up, postpone', 'Task actions: on a draft in To approve, Pause company next to Remove from the campaign; on a task card, Follow-up task (a new task on the same company or person), Postpone... (move the task to another day), Pause and Remove from the campaign. Pausing keeps the company in the campaign and writes the step again after the resume.'],
  ['outreach.stepResults', 'Outreach', 'release', 'Results of a task step', 'The results of a task step of the Other type: in the campaign sequence you can name up to 6 results (the default is Done) and give each a rule (end the sequence or go to a later step), for example Funds arrived and Not yet. Tasks that already carry results keep showing them whatever this switch says.'],
  ['outreach.taskContact', 'Outreach', 'release', 'Who / which number on a task', 'On a call, WhatsApp, LinkedIn or visit task: Who / which number, a choice among the contacts on the card or a new contact (optionally added to the CRM through the Add to company window); the company activity then says who it was to.'],
  ['outreach.inviteManage', 'Outreach', 'release', 'Change or cancel a calendar invite', 'Invites as objects: after an email with a calendar invite is sent, the conversation shows an invite card (the guests and their answers) with Change and Cancel meeting. Change sends the guests an updated invite (the same event is replaced in their calendars) and moves the visit task; Cancel sends a cancellation, removes the event from their calendars and closes the visit task. A calendar answer (Accepted, Declined, Tentative) updates the guest line and is not counted as a reply from the company.'],
  ['outreach.testCampaigns', 'Outreach', 'release', 'Test campaigns', '"Test campaign" when creating a campaign after go-live: every email of it goes to the campaign test address (Settings → General), marked TEST and left out of metrics; its companies keep their place free for real campaigns; "Run now (test)" works on it. For trying features on Test without touching real companies.'],
  ['investorview', 'Investor portal', 'release', 'Investor view', '"View the portal as" a chosen investor, read only.'],
  ['search.tier', 'Search CRM', 'release', 'Target tier & contactable', 'Target tier (rules and per company), contactable, their filters and bulk actions, and the campaign option to include not-contactable companies.'],
  ['search.contactableRules', 'Search CRM', 'release', 'Contactable rules & owner data', 'Owner size, listing and country on the company page (from the Orbis owner columns); later the contactable rules panel, its preview and the reason on each company.'],
  ['search.sameEmail', 'Search CRM', 'release', 'Same email on two companies', 'Same email on two companies: "also the email of X" next to the email on the company’s Overview, and "Possible link: same email" with Confirm / Dismiss on the Ownership tab (confirmed links count as related in the owner panel and the weekly report).'],
  ['search.ownership', 'Search CRM', 'release', 'Ownership ladder & groups', 'On the company’s Ownership tab: the ladder up to the ultimate owner, subsidiaries, the group (same ultimate owner) and people’s other companies; group filters in the Search CRM.'],
  ['search.people', 'Search CRM', 'release', 'People & reach details', 'People added by hand on a company’s Ownership tab: who added them, “not in the latest Orbis import”, Mark previous / current, and the “Possible same people” review after an Orbis import (People view). Later stages: several emails and phones per person and one People list per company (Contacts retires).'],
  ['search.companyFiles', 'Search CRM', 'release', 'Company files', 'A Files tab on the company page: upload documents (briefings, NDAs, data room files, spreadsheets, slides, images; up to 10 MB each) and open or remove them. Uploads and removals are logged in Activities. Files saved from a reply in Outreach appear here too, and files uploaded here show in the Outreach company files.'],
  ['budget.capital', 'Budget', 'release', 'Capital received per investor', 'Money received linked to investors: an Investor field on capital calls, investors recognised in bank lines (the sender names are remembered), and a Capital received card on each investor record in the Investor CRM, next to the commitments. Needs Budget v2.'],
  ['budget.companyCosts', 'Budget', 'release', 'Costs tab on the company page', 'A Costs tab on the company page in the Search CRM: the field visits to that company and the cost charged to them, by category. Needs Budget v2 and the budget view permission.'],
  ['budget.packLink', 'Budget', 'release', 'Send the accountant pack by link', 'Send the monthly accountant pack as a link and a 6-digit code: the receipts and the Excel in one zip, a link that works for 14 days, the code by email or shown on screen, revoke at any time. Needs Budget v2.'],
  ['budget.v2', 'Budget', 'release', 'Budget v2', 'The new budget (plan Budget v2 - Plan.md), built stage by stage: company details for invoices and a backup of today’s items first; later accounts, categories, invoice fields, bank import, visits and the accountant pack.'],
  ['mobile', 'Mobile', 'release', 'Douro mobile', 'The phone app (portal/m/) and its search.'],
  ['kill.outreach.sending', 'Kill switches', 'kill', 'Outreach: automatic sending', 'Off: the scheduler sends no campaign emails (drafts still wait). Test: only test campaigns send.'],
  ['kill.outreach.scheduler', 'Kill switches', 'kill', 'Outreach: scheduler', 'Off: nothing moves — no drafts, tasks, starts or new audience matches. Test: only test campaigns move.'],
  ['kill.recurring.drafting', 'Kill switches', 'kill', 'Recurring emails: drafting', 'Off: no new issues are written. Test: only while Outreach is in test mode.'],
  ['kill.ai', 'Kill switches', 'kill', 'AI openers', 'Off: no AI calls at all (also stops the Anthropic cost). Test: only testers\' requests.'],
].map(([key, area, kind, name, description]) => ({ key, area, kind, name, description, defaults: kind === 'kill' ? { staging: 'on', production: 'on' } : { staging: 'on', production: 'off' } }));
const BY_KEY = Object.fromEntries(FEATURES.map((f) => [f.key, f]));

// Tabs that are a feature as a whole.
export const PAGE_FEATURE = { outreach: 'outreach' };

const PRODUCTION_HOSTS = new Set(INSTANCE.productionHosts);
export const siteOfHost = (host) => (PRODUCTION_HOSTS.has(String(host || '').toLowerCase()) ? 'production' : 'staging');
export const SITE = typeof location !== 'undefined' ? siteOfHost(location.hostname) : 'staging';

export function stateOf(flags, key, site = SITE) {
  const f = BY_KEY[key];
  if (!f) return 'off';
  const v = flags?.[key]?.[site];
  return STATES.includes(v) ? v : f.defaults[site];
}
// Testers: the permission, or named on the switch — in Preview only the
// previewed role counts (so previewing as Intern hides Test features).
export function isTester(a, flags, key) {
  if (!a) return false;
  if (a.can?.('features.test')) return true;
  return !a.preview && !!a.email && (flags?.[key]?.testers || []).includes(a.email);
}
export function available(flags, key, a, site = SITE) {
  const st = stateOf(flags, key, site);
  return st === 'on' || (st === 'test' && isTester(a, flags, key));
}

// ── Live state ──
const CACHE_KEY = 'douroFeatures';
let flags = (() => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') || {}; } catch (e) { return {}; } })();
let access = null, started = null, observer = null;
const listeners = [];
export const currentFlags = () => flags;
export const isOn = (key) => available(flags, key, access);
export const onFeaturesChange = (fn) => listeners.push(fn);

// Start once per page (guardPage does it for every staff page). Resolves when
// the settings are known (or after 2.5 s with the last known / defaults).
export function startFeatures(a) {
  access = a;
  if (started) { apply(); return started; }
  started = new Promise((resolve) => {
    const done = () => { apply(); resolve(); };
    const t = setTimeout(done, 2500);
    try {
      onSnapshot(doc(db, 'config', 'features'), (snap) => {
        flags = snap.exists() ? (snap.data().flags || {}) : {};
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(flags)); } catch (e) { /* private mode */ }
        clearTimeout(t); done();
        listeners.forEach((fn) => { try { fn(flags); } catch (e) { /* a listener's problem */ } });
      }, () => { clearTimeout(t); done(); });
    } catch (e) { clearTimeout(t); done(); }
  });
  return started;
}

// Hide what isn't available; badge what's visible only because it's in Test.
function apply() {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('featureStyle');
  if (!el) { el = document.createElement('style'); el.id = 'featureStyle'; document.head.appendChild(el); }
  const hidden = FEATURES.filter((f) => !available(flags, f.key, access)).map((f) => `[data-feature~="${f.key}"]`);
  el.textContent = (hidden.length ? `${hidden.join(',\n')} { display: none !important; }\n` : '')
    + '.feat-test:not(a):not(button):not(span):not(summary) { outline: 1px dashed #B45309; outline-offset: 2px; }\n'
    + 'a.feat-test::after, button.feat-test::after, span.feat-test::after, summary.feat-test::after { content: "TEST"; margin-left: 6px; font: 700 9px/1 Inter, sans-serif; letter-spacing: .06em; color: #fff; background: #B45309; border-radius: 4px; padding: 2px 4px; vertical-align: middle; }';
  tagTests(document);
  if (!observer && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver((muts) => { for (const m of muts) m.addedNodes.forEach((n) => { if (n.nodeType === 1) tagTests(n); }); });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  testerNote();
}
const testKeys = () => FEATURES.filter((f) => stateOf(flags, f.key) === 'test' && isTester(access, flags, f.key)).map((f) => f.key);
function tagTests(root) {
  const keys = new Set(testKeys());
  const nodes = [...(root.matches?.('[data-feature]') ? [root] : []), ...(root.querySelectorAll?.('[data-feature]') || [])];
  nodes.forEach((n) => n.classList.toggle('feat-test', n.dataset.feature.split(/\s+/).some((k) => keys.has(k))));
}
// A tester sees which features are in Test on this site.
function testerNote() {
  const keys = testKeys();
  let n = document.getElementById('featureTestNote');
  if (!keys.length) { n?.remove(); return; }
  if (!n) {
    n = document.createElement('div');
    n.id = 'featureTestNote';
    n.setAttribute('role', 'status');
    n.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:400;background:#B45309;color:#fff;font:600 0.74rem Inter,sans-serif;padding:5px 10px;border-radius:999px;box-shadow:0 2px 10px rgba(0,0,0,.2);cursor:default;';
    document.body.appendChild(n);
  }
  n.textContent = `Testing: ${keys.length} feature${keys.length === 1 ? '' : 's'}`;
  n.title = `In Test on ${SITE} (only testers see them):\n` + keys.map((k) => '• ' + BY_KEY[k].name).join('\n');
}
