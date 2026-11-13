// Claude connector — the checks on every call, the limits, the log.
//
// Order: connection (oauth.checkAccessToken) → release switch claude.connector
// (production setting: Claude's calls carry no portal origin) → team record active
// and inside its dates → NDA → the person's Claude access tick → limits → the
// tool's permission via effectivePerms. Nothing is cached except the switch
// (15 s, features/index.js) and the settings (60 s), so a role change, an untick
// or a Disconnect applies on the next call.

const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const U = require("./util");
const P = require("../access/perms");
const Feat = require("../features");
const Usage = require("../usage");

const AUDIT_DAYS = 90;
const FIXED_ROLES = ["admin"]; // the Admin needs no NDA tick (as access/team.js)

async function switchInfo() {
  const flags = await Feat.getFlags();
  return { state: Feat.stateOf(flags, U.FEATURE, "production"), testers: (flags?.[U.FEATURE]?.testers || []).map((e) => String(e).toLowerCase()) };
}

const MESSAGES = {
  switch_off: "The Douro connector is switched off at the moment.",
  not_tester: "The Douro connector is being tested and isn't open to you yet.",
  not_on_team: "This email isn't on the Douro team.",
  inactive: "Your Douro access isn't active (suspended, ended, or outside your dates).",
  nda: "Your NDA isn't recorded in Team & access yet, so Douro data can't be shared with you.",
  no_claude_access: "Claude access isn't turned on for you. Ask André to tick it in Team & access → Claude.",
};

// → { ok, reason?, message?, email, key, name, roleId, perms[], isAdmin }
async function personFor(email, { sw = null, now = new Date() } = {}) {
  await P.loadIdentity();
  const e = String(email || "").trim().toLowerCase();
  const s = sw || await switchInfo();
  const deny = (reason, extra = {}) => ({ ok: false, reason, message: MESSAGES[reason], email: e, ...extra });
  const snap = await U.db().doc(`team/${e}`).get();
  const m = snap.exists ? snap.data() : null;
  const isAdmin = P.isAdminEmail(e) || m?.roleId === "admin";
  if (s.state === "off") return deny("switch_off");
  if (s.state === "test" && !isAdmin && !s.testers.includes(e)) return deny("not_tester");
  if (!m) return deny("not_on_team");
  if (!P.isAdminEmail(e) && !P.isActive(m, now)) return deny("inactive");
  if (!m.ndaSigned && !FIXED_ROLES.includes(m.roleId) && !P.isAdminEmail(e)) return deny("nda");
  if (m.claudeAccess !== true) return deny("no_claude_access", { key: m.key, name: m.name });
  let role = null;
  if (!isAdmin && m.roleId) {
    const rs = await U.db().doc(`roles/${m.roleId}`).get();
    role = rs.exists ? rs.data() : null;
  }
  const perms = isAdmin ? P.ALL.slice() : P.effectivePerms(m, role);
  return { ok: true, email: e, key: m.key || e.split("@")[0], name: m.name || e, roleId: isAdmin ? "admin" : m.roleId, perms, isAdmin };
}

// "Partner and Admin" for `query`: the Admin, or the partner role.
const isPartnerOrAdmin = (who) => who.isAdmin || who.roleId === "partner";

// ── Limits ──
const usageRef = (key, now) => U.db().doc(`claudeUsage/${U.lisbonDay(now)}_${String(key).replace(/[^a-z0-9_-]/gi, "_")}`);
// → { ok: true, used } or { ok: false, message, which }
async function checkLimits(who, { now = new Date() } = {}) {
  const settings = await U.getSettings();
  const lim = U.limitsFor(settings, who);
  const cur = (await usageRef(who.key, now).get()).data() || {};
  const hour = U.lisbonHour(now);
  const inHour = cur.hours?.[hour] || 0, inDay = cur.calls || 0;
  if (inDay >= lim.day) return { ok: false, which: "day", limits: lim, message: `Daily limit reached (${lim.day} calls). It resets at 00:00 Lisbon time.` };
  if (inHour >= lim.hour) return { ok: false, which: "hour", limits: lim, message: `Hourly limit reached (${lim.hour} calls). It resets at ${U.nextHourLabel(now)} Lisbon time.` };
  return { ok: true, limits: lim, used: { hour: inHour, day: inDay } };
}

// After each tool call: the counters, the log, and the portal's read figures.
async function record(who, { tool, args, rows = 0, reads = 0, ms = 0, outcome = "ok", reason = null, connectionId = null }, { now = new Date() } = {}) {
  const hour = U.lisbonHour(now);
  const counted = outcome === "ok" || outcome === "error";
  const tasks = [];
  const usage = { updatedAt: FieldValue.serverTimestamp(), key: who.key || null, email: who.email || null, day: U.lisbonDay(now), reads: FieldValue.increment(reads) };
  if (counted) { usage.calls = FieldValue.increment(1); usage.hours = { [hour]: FieldValue.increment(1) }; usage.byTool = { [tool || "unknown"]: FieldValue.increment(1) }; }
  if (outcome === "denied") usage.denied = FieldValue.increment(1);
  if (outcome === "limit") usage.limitHits = FieldValue.increment(1);
  if (who.key) tasks.push(usageRef(who.key, now).set(usage, { merge: true }));
  tasks.push(U.db().collection("claudeAudit").add({
    at: Timestamp.fromDate(now), expireAt: Timestamp.fromMillis(now.getTime() + AUDIT_DAYS * 86400000),
    email: who.email || null, key: who.key || null, connectionId, tool: tool || null, args: shortArgs(args), rows, reads, ms, outcome, reason,
  }));
  // Connector reads count into the Usage tab's per-person figures (site "claude").
  if (reads > 0 && who.key) {
    tasks.push(U.db().doc(`dailyReadCounters/${Usage.pacificDay(now)}`).set({ count: FieldValue.increment(reads), byUser: { [who.key]: FieldValue.increment(reads) }, bySite: { claude: FieldValue.increment(reads) } }, { merge: true }));
  }
  await Promise.all(tasks.map((p) => p.catch(() => null)));
}
// The log keeps ids and filters, never content.
function shortArgs(args) {
  try {
    const s = JSON.stringify(args || {});
    return s.length > 400 ? s.slice(0, 400) + "…" : s;
  } catch (e) { return ""; }
}

module.exports = { switchInfo, personFor, isPartnerOrAdmin, checkLimits, record, MESSAGES, AUDIT_DAYS, shortArgs };
