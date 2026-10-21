// Feature switches — the list of every switchable feature ("Portal - Feature
// Switches Plan.md"). Keep in sync with portal/features.js (parity test).
//
// kind "release": temporary, for features not yet released in production;
//   removed from the code ~30 days after being On everywhere (André's go).
// kind "kill": permanent red buttons for automations; never removed.
// defaults: the state when nothing is stored in config/features.
//   Release switches: On in staging, Off in production — merging to main is
//   safe by default. Kill switches: On in both.

const STATES = ["off", "test", "on"];
const SITES = ["staging", "production"];

const FEATURES = [
  // ── Outreach ──
  { key: "outreach", area: "Outreach", kind: "release", name: "Outreach", description: "The Outreach tab: inbox, compose, sent, campaigns, tasks, metrics, settings." },
  { key: "outreach.campaigns", area: "Outreach", kind: "release", name: "Company campaigns", description: "Campaigns to companies, and \"Add to campaign\" / email in the Search CRM." },
  { key: "outreach.people", area: "Outreach", kind: "release", name: "People campaigns & lists", description: "Campaigns to people (investors, brokers, press…), lists, adding people." },
  { key: "outreach.recurring", area: "Outreach", kind: "release", name: "Recurring emails", description: "Recurring emails, e.g. the investor update." },
  { key: "outreach.ai", area: "Outreach", kind: "release", name: "AI openers", description: "AI-written first lines in drafts." },
  { key: "outreach.relationship", area: "Outreach", kind: "release", name: "Emails from Investor CRM / Network", description: "\"Send email\" in the Investor CRM and Network, sent through Outreach. (Admin notices to investors are never switched.)" },
  { key: "outreach.oneInbox", area: "Outreach", kind: "release", name: "One inbox", description: "Same email address on two companies: never two cold emails to one address within the campaign’s \"contacted in the last N days\" window, nor two first drafts on one day (checked when adding companies and before each first email; the automatic part follows the production setting, Test = test campaigns). Inbox: Reply goes to the address you last wrote to, conversations remember every address, and a reply you write can stop the company’s campaign." },
  { key: "outreach.waitFromWindowStart", area: "Outreach", kind: "release", name: "Waits from the window's opening", description: "Waits in sending days end when the campaign’s sending window opens on that day (e.g. 09:00), not at the time of the previous email — never sooner than the minimum gap after it (Settings → General, default 12 hours). Calendar days keep the time of day. The scheduler follows the production setting; Test = test campaigns." },
  { key: "outreach.ownerAware", area: "Outreach", kind: "release", name: "Owner-aware outreach", description: "Owner-aware outreach: related companies (same owner at any %, parent / subsidiary, same group, confirmed same email) and their status when adding companies to a campaign (Proceed / Skip for now / Proceed and mention) and on each draft to approve; {{owner.otherCompanies}} for templates; \"In conversation via X\" and \"Group contacted via X\" on related companies; the Monday report and metrics by owner. Background jobs follow the production setting (Test = test campaigns)." },
  // ── Other areas ──
  { key: "investorview", area: "Investor portal", kind: "release", name: "Investor view", description: "\"View the portal as\" a chosen investor, read only." },
  { key: "search.tier", area: "Search CRM", kind: "release", name: "Target tier & contactable", description: "Target tier (rules and per company), contactable, their filters and bulk actions, and the campaign option to include not-contactable companies." },
  { key: "search.contactableRules", area: "Search CRM", kind: "release", name: "Contactable rules & owner data", description: "Owner size, listing and country on the company page (from the Orbis owner columns); later the contactable rules panel, its preview and the reason on each company." },
  { key: "search.sameEmail", area: "Search CRM", kind: "release", name: "Same email on two companies", description: "Same email on two companies: \"also the email of X\" next to the email on the company’s Overview, and \"Possible link: same email\" with Confirm / Dismiss on the Ownership tab (confirmed links count as related in the owner panel and the weekly report)." },
  { key: "search.ownership", area: "Search CRM", kind: "release", name: "Ownership ladder & groups", description: "On the company’s Ownership tab: the ladder up to the ultimate owner, subsidiaries, the group (same ultimate owner) and people’s other companies; group filters in the Search CRM." },
  { key: "search.people", area: "Search CRM", kind: "release", name: "People & reach details", description: "People added by hand on a company’s Ownership tab: who added them, “not in the latest Orbis import”, Mark previous / current, and the “Possible same people” review after an Orbis import (People view). Later stages: several emails and phones per person and one People list per company (Contacts retires)." },
  { key: "mobile", area: "Mobile", kind: "release", name: "Douro mobile", description: "The phone app (portal/m/) and its search." },
  // ── Kill switches ──
  { key: "kill.outreach.sending", area: "Kill switches", kind: "kill", name: "Outreach: automatic sending", description: "Off: the scheduler sends no campaign emails (drafts still wait). Test: only test campaigns send." },
  { key: "kill.outreach.scheduler", area: "Kill switches", kind: "kill", name: "Outreach: scheduler", description: "Off: nothing moves — no drafts, tasks, starts or new audience matches. Test: only test campaigns move." },
  { key: "kill.recurring.drafting", area: "Kill switches", kind: "kill", name: "Recurring emails: drafting", description: "Off: no new issues are written. Test: only while Outreach is in test mode." },
  { key: "kill.ai", area: "Kill switches", kind: "kill", name: "AI openers", description: "Off: no AI calls at all (also stops the Anthropic cost). Test: only testers' requests." },
];

const DEFAULTS = {
  release: { staging: "on", production: "off" },
  kill: { staging: "on", production: "on" },
};
for (const f of FEATURES) f.defaults = f.defaults || { ...DEFAULTS[f.kind] };

const BY_KEY = Object.fromEntries(FEATURES.map((f) => [f.key, f]));

module.exports = { STATES, SITES, FEATURES, BY_KEY, DEFAULTS };
