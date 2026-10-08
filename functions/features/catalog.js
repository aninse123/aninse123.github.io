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
  // ── Other areas ──
  { key: "investorview", area: "Investor portal", kind: "release", name: "Investor view", description: "\"View the portal as\" a chosen investor, read only." },
  { key: "search.tier", area: "Search CRM", kind: "release", name: "Target tier & contactable", description: "Target tier (rules and per company), contactable, their filters and bulk actions, and the campaign option to include not-contactable companies." },
  { key: "search.contactableRules", area: "Search CRM", kind: "release", name: "Contactable rules & owner data", description: "Owner size, listing and country on the company page (from the Orbis owner columns); later the contactable rules panel, its preview and the reason on each company." },
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
