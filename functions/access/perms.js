// Team access (Phase 1, "Portal - Team Access & Roles Plan.md") — the
// permission catalog, default roles and the checks shared by the sign-in
// blocking functions, the teamAccess callable and every other callable.
//
// A person = team/{email}: one role + optional extra / removed permissions,
// status and dates. Their effective permissions travel as custom claims on
// the sign-in token ({ role, perms, key }), so Firestore rules check
// request.auth.token.perms without extra reads.
//
// Admin / Partner (30 Sep): the Admin (André, by email) has everything and is
// fixed. Partner is an ordinary, editable role (starts with everything except
// the Admin-only permissions); partners are staff like anyone else. Nobody
// but the Admin — no role, no extra permission — can hold an Admin-only
// permission. The founders list keeps only its business meaning (the founders:
// approvers list, default signer…), never permissions.
//
// Keep in sync with portal/access.js (tests/portal/access_parity test).

const { HttpsError } = require("firebase-functions/v2/https");


// Who the admin and the founders are comes from the instance settings
// (functions/instance.js), not from this file: one codebase, one project per
// team. Async entry points call `await loadIdentity()` once; everything below
// then reads the primed copy synchronously.
//
// TEMPORARY (Phase 0, removed in WP10): until instance/settings has been
// seeded, the Douro project falls back to its old built-in lists so no deploy
// order can lock anyone out. Any other project fails closed (nobody is an
// admin by email; the admin's token claim still works).
const I = require("../instance");
const LEGACY = I.normalizeInstance(
  {
    adminEmails: ["andre.rocha@douropartners.pt"],
    founders: [
      { email: "andre.rocha@douropartners.pt", key: "andre", name: "André Rocha" },
      { email: "antonio.carvalho@douropartners.pt", key: "antonio", name: "António Carvalho" },
    ],
  },
  { orgName: "Douro Partners", contacts: [{ name: "André", email: "andre.rocha@douropartners.pt" }, { name: "António", email: "antonio.carvalho@douropartners.pt" }] },
);
const legacyAllowed = () => { const proj = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || ""; return !proj || proj === "douro-partners"; };

let primed = null, warned = false;
function identity() {
  if (primed && primed.configured) return primed;
  if (legacyAllowed()) {
    if (!warned) { warned = true; console.warn("instance/settings not seeded: using the built-in Douro lists (temporary)"); }
    return LEGACY;
  }
  return primed || I.normalizeInstance(null, null);
}
async function loadIdentity(opts) { primed = await I.getInstance(opts); return identity(); }
function _resetIdentity() { primed = null; warned = false; I._reset(); }
const adminEmails = () => identity().adminEmails;
const partnerEmails = () => I.founderEmails(identity());
const keyOf = (email) => I.founderKey(identity(), email);
const nameOf = (email) => I.founderName(identity(), email);
const contactLine = () => I.contactLine(identity());

// [code, tab, label] — the tab groups them in the Team & access matrix.
const PERMS = [
  ["search.view", "Search CRM", "See companies, people and activities"],
  ["search.edit", "Search CRM", "Edit companies they own (details, contacts, ownership, add-ons)"],
  ["search.editall", "Search CRM", "Edit any company (details, contacts, ownership, add-ons, owner)"],
  ["search.activity", "Search CRM", "Add notes and activities, close meetings (any company; never edited or deleted)"],
  ["search.deal", "Search CRM", "Edit deal info and stage"],
  ["search.flags", "Search CRM", "Set Do not contact, contactable and tier"],
  ["search.reach", "Search CRM", "Add and edit people’s emails, phones and LinkedIn, and contact people (any person)"],
  ["search.stats", "Search CRM", "See Company / People statistics"],
  ["search.delete", "Search CRM", "Delete companies and any activity"],
  ["search.import", "Search CRM", "Import companies and people (Admin)"],
  ["search.export", "Search CRM", "Export CSV (hides the button — not a lock)"],
  ["search.admin", "Search CRM", "Settings, fit criteria, brokers, maintenance"],
  ["out.view", "Outreach", "See Inbox, Sent, Metrics, campaigns, tasks"],
  ["out.draft", "Outreach", "Write emails that wait in To approve (Phase 2)"],
  ["out.send", "Outreach", "Send and reply directly"],
  ["out.approve", "Outreach", "Approve drafts and issues"],
  ["out.tasks", "Outreach", "Do tasks (calls, LinkedIn, letters…)"],
  ["out.campaigns", "Outreach", "Create and run campaigns, lists, recurring emails"],
  ["out.templates", "Outreach", "Edit templates; add to the suppression list"],
  ["out.admin", "Outreach", "Outreach settings: sending addresses, limits, sending window, test mode and go live, AI, legal footer; remove from the suppression list (Admin)"],
  ["net.view", "Network", "See contacts and firms"],
  ["net.edit", "Network", "Edit contacts and firms; add activities (never edited or deleted)"],
  ["net.categories", "Network", "Manage Network categories"],
  ["net.email", "Network", "Send emails to contacts"],
  ["net.delete", "Network", "Delete contacts, firms and any activity"],
  ["net.export", "Network", "Export CSV (hides the button — not a lock)"],
  ["icrm.view", "Investor CRM", "See investors, contacts, commitments"],
  ["icrm.edit", "Investor CRM", "Edit investors, contacts, commitments; add activities (never edited or deleted)"],
  ["icrm.email", "Investor CRM", "Send emails to investors"],
  ["icrm.delete", "Investor CRM", "Delete investors and any activity"],
  ["icrm.export", "Investor CRM", "Import / export CSV"],
  ["portal.admin", "Admin", "Investor portal: documents, investors & access, messages, notify"],
  ["portal.viewas", "Admin", "Investor view: see the portal as any investor, incl. their documents (read only)"],
  ["budget.view", "Budget", "See the budget"],
  ["budget.edit", "Budget", "Edit the budget"],
  ["log.view", "Activity Log", "See the portal activity log"],
  ["features.test", "Team & access", "Test features before release (sees features switched to Test) (Admin)"],
  ["features.manage", "Team & access", "Manage feature switches: Off / Test / On, testers, kill switches (Admin)"],
  ["usage.view", "Team & access", "See usage (database, emails, activity) and usage alerts (Admin)"],
  ["access.manage", "Team & access", "Manage people, roles and access (Admin)"],
];
const ALL = PERMS.map((p) => p[0]);
const IS_PERM = new Set(ALL);
// Only the Admin holds these (never a Partner, a role or an extra permission).
const ADMIN_ONLY = ["access.manage", "features.manage", "usage.view", "features.test", "out.admin", "search.import"];
const PARTNER_PERMS = ALL.filter((p) => !ADMIN_ONLY.includes(p));
const withoutAdminOnly = (list) => list.filter((p) => !ADMIN_ONLY.includes(p));

// Default roles (editable in Team & access, except Admin and Partner).
const DEFAULT_ROLES = {
  admin: { name: "Admin", locked: true, perms: ALL, description: "André — everything, always." },
  partner: { name: "Partner", perms: PARTNER_PERMS, description: "Partners — everything except the Admin-only permissions (editable by the Admin)." },
  analyst: {
    name: "Analyst",
    perms: ["search.view", "search.edit", "search.editall", "search.reach", "search.activity", "search.deal", "search.stats", "search.export", "out.view", "out.draft", "out.tasks", "out.campaigns", "net.view", "net.edit", "icrm.view"],
    description: "Full-time team member: research, campaigns prepared for approval.",
  },
  intern: {
    name: "Intern",
    perms: ["search.view", "search.edit", "search.reach", "search.activity", "out.view", "out.draft", "out.tasks", "out.campaigns", "net.view", "net.edit"],
    description: "Research companies: edit the companies they own, add notes and activities on any company; edit Network contacts; do assigned tasks; write emails and prepare campaigns that a partner approves. No deal info, flags, direct sending, deleting, importing or exporting.",
  },
  viewer: {
    name: "Viewer",
    perms: ["search.view", "out.view", "net.view"],
    description: "Read-only.",
  },
};

const cleanList = (v) => [...new Set((Array.isArray(v) ? v : []).map(String).filter((p) => IS_PERM.has(p)))];

// role perms + extra − removed, never Admin-only. Admin = everything
// (computed, so new permissions apply automatically). A missing Partner role
// falls back to its default.
function effectivePerms(member, role) {
  if (!member) return [];
  if (member.roleId === "admin") return ALL.slice();
  const base = role ? role.perms : member.roleId === "partner" ? DEFAULT_ROLES.partner.perms : [];
  const set = new Set(cleanList(base));
  cleanList(member.extraPerms).forEach((p) => set.add(p));
  cleanList(member.removedPerms).forEach((p) => set.delete(p));
  return withoutAdminOnly(ALL.filter((p) => set.has(p)));
}

// Active and inside its dates?
function isActive(member, now = new Date()) {
  if (!member || member.status !== "active" && member.status !== "invited") return false;
  const ms = (t) => (t && t.toMillis ? t.toMillis() : t ? new Date(t).getTime() : null);
  const start = ms(member.startsAt), end = ms(member.endsAt);
  if (start && now.getTime() < start) return false;
  if (end && now.getTime() >= end) return false;
  return true;
}

// Custom claims for a sign-in token. The Admin (by email) gets everything;
// everyone else — partners included — what their team record and role give.
function claimsFor(email, member, role) {
  const e = String(email || "").trim().toLowerCase();
  if (isAdminEmail(e)) return { role: "admin", perms: ALL.slice(), key: member?.key || keyOf(e) };
  if (!isActive(member)) return { role: null, perms: [], key: null };
  return { role: member.roleId || null, perms: effectivePerms(member, role), key: member.key || null };
}

// For callables: the caller's email and whether they hold `perm`.
function callerOf(request) {
  return String(request.auth?.token?.email || "").trim().toLowerCase();
}
function hasPerm(request, perm) {
  const email = callerOf(request);
  // The Admin: the "admin" role on the sign-in token (set only by the sign-in functions), or their email.
  if (request.auth?.token?.role === "admin" || isAdminEmail(email)) return true;
  if (ADMIN_ONLY.includes(perm)) return false; // whatever an old token says
  const perms = request.auth?.token?.perms;
  return Array.isArray(perms) && perms.includes(perm);
}
function isAdminEmail(email) { return adminEmails().includes(String(email || "").trim().toLowerCase()); }
// Throws permission-denied unless the caller holds one of `perms`.
function requirePerm(request, perms, message = "You don't have permission to do this.") {
  const list = Array.isArray(perms) ? perms : [perms];
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.", { reason: "unauthenticated" });
  if (!list.some((p) => hasPerm(request, p))) throw new HttpsError("permission-denied", message, { reason: "no_permission", needs: list });
  return callerOf(request);
}

module.exports = { loadIdentity, identity, _resetIdentity, adminEmails, partnerEmails, keyOf, nameOf, contactLine, ADMIN_ONLY, PARTNER_PERMS, isAdminEmail, PERMS, ALL, DEFAULT_ROLES, cleanList, effectivePerms, isActive, claimsFor, callerOf, hasPerm, requirePerm };
