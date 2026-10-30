// How far a contact detail (email, phone, LinkedIn…) can be trusted (30 Oct 2026, switch contacts.trustLabels).
// One status at a time: confirmed / tool / unverified / bounced. Three facts are stored apart on a detail
// (searchPeople.reach[]) and the status is worked out from them:
//   origin      who supplied it: "team" (typed by us), "person" (the company or person gave it),
//               "database" (Orbis), "enrichment" (a tool found it; the tool's name stays out of the label)
//   toolStatus  what the tool said: "verified" | "unconfirmed" | null
//   confirmedAt / confirmedBy   a person checked it
// "bounced" (status on the detail) replaces every other status. A detail with no origin is an old one typed
// by the team, so it counts as confirmed. LinkedIn and mobile numbers from a tool are never "tool": a tool's
// "Success" only means it returned something. The page twin is portal/contact-trust.js: keep them identical.

const STATUS = {
  confirmed: "Confirmed",
  tool: "Tool-verified",
  unverified: "Not verified",
  bounced: "Bounced",
};

// entry: a reach entry, or { origin: "database" | "team", type } for a value that has no entry
// (Orbis values, the typed fields on a person, company contacts).
function trustOf(entry) {
  const e = entry || {};
  if (e.status === "bounced") return "bounced";
  if (e.confirmedAt) return "confirmed";
  const origin = e.origin || "team";
  if (origin === "team" || origin === "person") return "confirmed";
  if (origin === "database") return "tool";
  // enrichment: only an email can be tool-verified; LinkedIn and phones never are
  return e.type === "email" && e.toolStatus === "verified" ? "tool" : "unverified";
}

// Usable for sending: confirmed and tool-verified by default; not verified only when the campaign allows it.
const usable = (key, includeUnverified = false) => key === "confirmed" || key === "tool" || (key === "unverified" && !!includeUnverified);

module.exports = { STATUS, trustOf, usable };
