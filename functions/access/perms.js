// Team access (Phase 1, "Portal - Team Access & Roles Plan.md") — the
// permission catalog, default roles and the checks shared by the sign-in
// blocking functions, the teamAccess callable and every other callable.
//
// A person = team/{email}: one role + optional extra / removed permissions,
// status and dates. Their effective permissions travel as custom claims on
// the sign-in token ({ role, perms, key }), so Firestore rules check
// request.auth.token.perms without extra reads. Partners (the two founders)
// always have everything, also by email as a fallback.
//
// Keep in sync with portal/access.js (tests/portal/access_parity test).

const { HttpsError } = require("firebase-functions/v2/https");

const PARTNER_EMAILS = ["andre.rocha@douropartners.pt", "antonio.carvalho@douropartners.pt"];
const PARTNER_KEYS = { "andre.rocha@douropartners.pt": "andre", "antonio.carvalho@douropartners.pt": "antonio" };

// [code, tab, label] — the tab groups them in the Team & access matrix.
const PERMS = [
  ["search.view", "Search CRM", "See companies, people and activities"],
  ["search.edit", "Search CRM", "Edit companies, contacts, deal; add activities (edit/delete own)"],
  ["search.delete", "Search CRM", "Delete companies and any activity"],
  ["search.import", "Search CRM", "Import companies and people"],
  ["search.export", "Search CRM", "Export CSV (hides the button — not a lock)"],
  ["search.admin", "Search CRM", "Settings, fit criteria, brokers, maintenance"],
  ["out.view", "Outreach", "See Inbox, Sent, Metrics, campaigns, tasks"],
  ["out.draft", "Outreach", "Write emails that wait in To approve (Phase 2)"],
  ["out.send", "Outreach", "Send and reply directly"],
  ["out.approve", "Outreach", "Approve drafts and issues"],
  ["out.tasks", "Outreach", "Do tasks (calls, LinkedIn, letters…)"],
  ["out.campaigns", "Outreach", "Create and run campaigns, lists, recurring emails"],
  ["out.admin", "Outreach", "Addresses, templates, legal footer, suppression, go live"],
  ["net.view", "Network", "See contacts and firms"],
  ["net.edit", "Network", "Edit contacts and firms; add activities (edit/delete own)"],
  ["net.email", "Network", "Send emails to contacts"],
  ["net.delete", "Network", "Delete contacts, firms and any activity"],
  ["net.export", "Network", "Export CSV (hides the button — not a lock)"],
  ["icrm.view", "Investor CRM", "See investors, contacts, commitments"],
  ["icrm.edit", "Investor CRM", "Edit investors, contacts, commitments; add activities (edit/delete own)"],
  ["icrm.email", "Investor CRM", "Send emails to investors"],
  ["icrm.delete", "Investor CRM", "Delete investors and any activity"],
  ["icrm.export", "Investor CRM", "Import / export CSV"],
  ["portal.admin", "Admin", "Investor portal: documents, investors & access, messages, notify"],
  ["portal.viewas", "Admin", "Investor view (\"View as\")"],
  ["budget.view", "Budget", "See the budget"],
  ["budget.edit", "Budget", "Edit the budget"],
  ["log.view", "Activity Log", "See the portal activity log"],
  ["access.manage", "Team & access", "Manage people, roles and access"],
];
const ALL = PERMS.map((p) => p[0]);
const IS_PERM = new Set(ALL);

// Default roles (editable in Team & access, except Partner).
const DEFAULT_ROLES = {
  partner: { name: "Partner", locked: true, perms: ALL, description: "Founders — everything, always." },
  analyst: {
    name: "Analyst",
    perms: ["search.view", "search.edit", "search.import", "search.export", "out.view", "out.draft", "out.tasks", "out.campaigns", "net.view", "net.edit", "icrm.view"],
    description: "Full-time team member: research, imports, campaigns prepared for approval.",
  },
  intern: {
    name: "Intern",
    perms: ["search.view", "search.edit", "out.view", "out.tasks", "net.view"],
    description: "Research companies, add notes and activities, do assigned tasks. No sending, deleting, importing or exporting.",
  },
  viewer: {
    name: "Viewer",
    perms: ["search.view", "out.view", "net.view"],
    description: "Read-only.",
  },
};

const cleanList = (v) => [...new Set((Array.isArray(v) ? v : []).map(String).filter((p) => IS_PERM.has(p)))];

// role perms + extra − removed. Partner = everything (computed, so new
// permissions apply to partners automatically).
function effectivePerms(member, role) {
  if (!member) return [];
  if (member.roleId === "partner" || role?.locked) return ALL.slice();
  const set = new Set(cleanList(role?.perms));
  cleanList(member.extraPerms).forEach((p) => set.add(p));
  cleanList(member.removedPerms).forEach((p) => set.delete(p));
  return ALL.filter((p) => set.has(p));
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

// Custom claims for a sign-in token. Partners by email always get everything.
function claimsFor(email, member, role) {
  const e = String(email || "").trim().toLowerCase();
  if (PARTNER_EMAILS.includes(e)) return { role: "partner", perms: ALL.slice(), key: member?.key || PARTNER_KEYS[e] };
  if (!isActive(member)) return { role: null, perms: [], key: null };
  return { role: member.roleId || null, perms: effectivePerms(member, role), key: member.key || null };
}

// For callables: the caller's email and whether they hold `perm`.
function callerOf(request) {
  return String(request.auth?.token?.email || "").trim().toLowerCase();
}
function hasPerm(request, perm) {
  const email = callerOf(request);
  if (PARTNER_EMAILS.includes(email)) return true;
  const perms = request.auth?.token?.perms;
  return Array.isArray(perms) && perms.includes(perm);
}
// Throws permission-denied unless the caller holds one of `perms`.
function requirePerm(request, perms, message = "You don't have permission to do this.") {
  const list = Array.isArray(perms) ? perms : [perms];
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.", { reason: "unauthenticated" });
  if (!list.some((p) => hasPerm(request, p))) throw new HttpsError("permission-denied", message, { reason: "no_permission", needs: list });
  return callerOf(request);
}

module.exports = { PARTNER_EMAILS, PARTNER_KEYS, PERMS, ALL, DEFAULT_ROLES, cleanList, effectivePerms, isActive, claimsFor, callerOf, hasPerm, requirePerm };
