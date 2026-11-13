// Claude connector — the claudeConnect callable.
//
// For the sign-in page (portal/claude-connect.html), any signed-in team member:
//   describe { r }   what is asking and whether this person may connect
//   allow    { r }   → { redirect } back to Claude with a one-time code
//   deny     { r }   → { redirect } back to Claude with access_denied
// For the Claude tab in Team & access (Admin only, access.manage):
//   overview                         people + Claude access, connections, settings, log
//   setAccess   { email, on }        the per-person Claude access tick (untick ends their connections)
//   disconnect  { connectionId }     end one connection;  disconnectAll
//   saveSettings { settings }        sign-in days and limits
//   buildIndex                       rebuild the company index now

const { HttpsError } = require("firebase-functions/v2/https");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const U = require("./util");
const O = require("./oauth");
const G = require("./gate");
const IX = require("./index_companies");
const P = require("../access/perms");

const fail = (code, reason, message) => { throw new HttpsError(code, message, { reason }); };

async function loadRequest(raw, now = Date.now()) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(String(raw || ""))) fail("invalid-argument", "bad_request", "This sign-in link isn't valid. Start again from Claude.");
  const ref = U.db().doc(`claudeTokens/${U.sha256(raw)}`);
  const s = await ref.get();
  const r = s.exists ? s.data() : null;
  if (!r || r.type !== "request") fail("not-found", "no_request", "This sign-in request wasn't found. Start again from Claude.");
  if (r.usedAt) fail("failed-precondition", "used", "This sign-in request was already answered. Start again from Claude if needed.");
  if ((U.ms(r.expiresAt) || 0) <= now) fail("deadline-exceeded", "expired", "This sign-in request expired (10 minutes). Start again from Claude.");
  return { ref, r };
}

async function forPage(action, data, email) {
  const now = Date.now();
  const { ref, r } = await loadRequest(data?.r, now);
  const who = await G.personFor(email);
  const loopback = O.isLoopback(r.redirectUri);
  const info = { clientName: r.clientName || "Claude", surface: O.surfaceOf(r.clientName, r.redirectUri), redirectHost: new URL(r.redirectUri).host, loopback };
  if (action === "describe") {
    return { ...info, ok: who.ok, message: who.ok ? null : who.message, person: { name: who.name || email, email, role: who.roleId || null } };
  }
  if (action === "deny") {
    await ref.update({ usedAt: Timestamp.fromMillis(now), answer: "deny", email });
    return { redirect: O.denyRedirect(r) };
  }
  // allow
  if (!who.ok) fail("permission-denied", who.reason, who.message);
  await ref.update({ usedAt: Timestamp.fromMillis(now), answer: "allow", email });
  const out = await O.issueCode(r, { email: who.email, key: who.key }, { now });
  await U.db().collection("accessAudit").add({ by: who.email, action: "claudeConnect", target: who.email, before: null, after: { client: info.clientName, surface: info.surface }, at: FieldValue.serverTimestamp() }).catch(() => null);
  return { redirect: out.redirect };
}

// ── Admin ──
const dayKey = (d) => U.lisbonDay(d);
async function overview() {
  const now = Date.now();
  const sw = await G.switchInfo();
  const settings = await U.getSettings({ force: true });
  const team = (await U.db().collection("team").get()).docs.map((d) => ({ email: d.id, ...d.data() }));
  const people = team.filter((m) => m.status !== "ended").map((m) => ({ email: m.email, name: m.name || m.email, key: m.key || null, roleId: m.roleId || null, status: m.status || null, ndaSigned: !!m.ndaSigned, claudeAccess: m.claudeAccess === true }));
  people.sort((a, b) => a.name.localeCompare(b.name));
  const conns = (await U.db().collection("claudeConnections").orderBy("lastUsedAt", "desc").limit(200).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const connections = conns.filter((c) => c.exchangedAt || c.revokedAt).map((c) => ({
    id: c.id, email: c.email, key: c.key, clientName: c.clientName, surface: c.surface, createdAt: U.ms(c.createdAt), lastUsedAt: U.ms(c.lastUsedAt), expiresAt: U.ms(c.expiresAt),
    live: O.connectionLive(c, now), revokedAt: U.ms(c.revokedAt), revokeReason: c.revokeReason || null,
  }));
  const since = dayKey(new Date(now - 13 * 86400000));
  const usage = (await U.db().collection("claudeUsage").where("day", ">=", since).get()).docs.map((d) => {
    const u = d.data();
    return { day: u.day, key: u.key, email: u.email, calls: u.calls || 0, reads: u.reads || 0, denied: u.denied || 0, limitHits: u.limitHits || 0, byTool: u.byTool || {} };
  });
  const latest = (await U.db().collection("claudeAudit").orderBy("at", "desc").limit(100).get()).docs.map((d) => {
    const a = d.data();
    return { at: U.ms(a.at), key: a.key, email: a.email, tool: a.tool, args: a.args, rows: a.rows, reads: a.reads, ms: a.ms, outcome: a.outcome, reason: a.reason };
  });
  let index = null;
  try { const m = await IX.load(); index = m ? { builtAt: m.builtAt, companies: m.rows.size } : null; } catch (e) { index = null; }
  return { switch: sw, settings, people, connections, usage, latest, index, address: U.BASE };
}
async function setAccess({ email, on }, by) {
  const e = String(email || "").trim().toLowerCase();
  const ref = U.db().doc(`team/${e}`);
  const s = await ref.get();
  if (!s.exists) fail("not-found", "not_found", "Person not found in Team & access.");
  const before = s.data().claudeAccess === true;
  await ref.update({ claudeAccess: !!on, updatedAt: FieldValue.serverTimestamp(), updatedBy: by });
  let ended = 0;
  if (!on) {
    const conns = await U.db().collection("claudeConnections").where("email", "==", e).get();
    for (const d of conns.docs) if (await O.revokeConnection(d.id, "access_removed", by)) ended++;
  }
  await U.db().collection("accessAudit").add({ by, action: "claudeAccess", target: e, before: { claudeAccess: before }, after: { claudeAccess: !!on }, at: FieldValue.serverTimestamp() });
  return { email: e, claudeAccess: !!on, ended };
}
async function saveSettings({ settings }, by) {
  const clean = U.normalizeSettings(settings);
  await U.db().doc("claudeSettings/main").set({ ...clean, updatedAt: FieldValue.serverTimestamp(), updatedBy: by });
  U._resetSettings();
  await U.db().collection("accessAudit").add({ by, action: "claudeSettings", target: "claudeSettings/main", before: null, after: clean, at: FieldValue.serverTimestamp() });
  return { settings: clean };
}

async function handleConnect(request) {
  if (!request.auth?.token?.email) fail("unauthenticated", "unauthenticated", "Sign in first.");
  await P.loadIdentity();
  const email = P.callerOf(request);
  const action = request.data?.action;
  if (["describe", "allow", "deny"].includes(action)) return forPage(action, request.data, email);
  if (!P.hasPerm(request, "access.manage")) fail("permission-denied", "no_permission", "Only the Admin can manage Claude access.");
  if (action === "overview") return overview();
  if (action === "setAccess") return setAccess(request.data, email);
  if (action === "disconnect") { const ok = await O.revokeConnection(String(request.data?.connectionId || ""), "disconnect", email); return { ok }; }
  if (action === "disconnectAll") {
    const conns = await U.db().collection("claudeConnections").where("revokedAt", "==", null).get();
    let n = 0; for (const d of conns.docs) if (await O.revokeConnection(d.id, "disconnect", email)) n++;
    return { ended: n };
  }
  if (action === "saveSettings") return saveSettings(request.data, email);
  if (action === "buildIndex") return IX.build();
  fail("invalid-argument", "bad_action", "Unknown action.");
}

// ── Daily job: company index, then tidy up (log kept 90 days) ──
async function dailyJob({ now = new Date() } = {}) {
  const sw = await G.switchInfo();
  const out = { index: null, audit: 0, tokens: 0, usage: 0 };
  if (sw.state !== "off") out.index = await IX.build({ now: now.getTime() });
  const del = async (q) => { let n = 0; for (;;) { const s = await q.limit(400).get(); if (!s.size) break; const b = U.db().batch(); s.docs.forEach((d) => b.delete(d.ref)); await b.commit(); n += s.size; if (s.size < 400) break; } return n; };
  out.audit = await del(U.db().collection("claudeAudit").where("expireAt", "<", Timestamp.fromDate(now)));
  out.tokens = await del(U.db().collection("claudeTokens").where("expiresAt", "<", Timestamp.fromMillis(now.getTime() - 86400000)));
  out.usage = await del(U.db().collection("claudeUsage").where("day", "<", dayKey(new Date(now.getTime() - G.AUDIT_DAYS * 86400000))));
  return out;
}

module.exports = { handleConnect, forPage, overview, setAccess, saveSettings, dailyJob, loadRequest };
