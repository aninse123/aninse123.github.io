// teamAccess — Team & access tab (partners only, `access.manage`).
//
// Actions (request.data.action):
//   seed                        create the partners' team records and the default roles (never overwrites)
//   invite  { member }          add a person: email, name, key, roleId, endsAt?, startsAt?, notes?, ndaSigned?
//   update  { email, member }   change name / key / role / extra & removed permissions / dates / NDA / notes
//   suspend { email }           stop access now (sessions revoked, account disabled)
//   reactivate { email }        undo suspend (within dates)
//   end     { email }           end access (kept for history, removed from the login list)
//   saveRole { roleId?, role }  create / edit a role (Partner is locked)
//   deleteRole { roleId }       only when nobody has it
//
// Every change: team/{email} or roles/{id}, the person's claims refreshed
// (setCustomUserClaims), an accessAudit entry, and the public login hash list
// config/teamEmailHashes kept in step. teamExpiry (daily) ends access past
// its end date.

const crypto = require("crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const P = require("./perms");

const db = () => getFirestore();
const REGION = "us-central1";
const KEY_RE = /^[a-z][a-z0-9-]{1,19}$/;
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;

const fail = (code, reason, message) => { throw new HttpsError(code, message, { reason }); };
const norm = (e) => String(e || "").trim().toLowerCase();
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const tsOrNull = (v) => { if (!v) return null; const d = new Date(v); if (isNaN(d)) fail("invalid-argument", "bad_date", "A date isn't valid."); return Timestamp.fromDate(d); };

async function readRole(roleId) {
  if (roleId === "partner") return { id: "partner", ...P.DEFAULT_ROLES.partner };
  const s = await db().doc(`roles/${roleId}`).get();
  return s.exists ? { id: s.id, ...s.data() } : null;
}

async function audit(by, action, target, before, after) {
  await db().collection("accessAudit").add({ by, action, target, before: before ?? null, after: after ?? null, at: FieldValue.serverTimestamp() });
}

// Keep the public login list (hashes only) in step with who may sign in.
async function syncLoginHashes() {
  const snap = await db().collection("team").get();
  const now = new Date();
  const hashes = snap.docs.filter((d) => P.isActive(d.data(), now) || P.PARTNER_EMAILS.includes(d.id)).map((d) => sha256(d.id));
  await db().doc("config/teamEmailHashes").set({ hashes, updatedAt: FieldValue.serverTimestamp() });
}

// Push the person's current permissions onto their account (if they've signed in once).
async function refreshClaims(email) {
  const snap = await db().doc(`team/${email}`).get();
  const m = snap.exists ? snap.data() : null;
  if (!m?.uid) return false;
  const role = m.roleId ? await readRole(m.roleId) : null;
  const claims = P.claimsFor(email, m, role);
  const auth = getAuth();
  await auth.setCustomUserClaims(m.uid, claims);
  if (!P.isActive(m) && !P.PARTNER_EMAILS.includes(email)) {
    await auth.revokeRefreshTokens(m.uid).catch(() => {});
    await auth.updateUser(m.uid, { disabled: true }).catch(() => {});
  } else {
    await auth.updateUser(m.uid, { disabled: false }).catch(() => {});
  }
  return true;
}

function cleanMember(src, existing = {}) {
  const name = String(src.name ?? existing.name ?? "").trim().slice(0, 80);
  if (!name) fail("invalid-argument", "name_required", "Give the person a name.");
  const key = String(src.key ?? existing.key ?? "").trim().toLowerCase();
  if (!KEY_RE.test(key)) fail("invalid-argument", "bad_key", "The short name (key) must be 2–20 lowercase letters, digits or dashes, starting with a letter — e.g. \"maria\".");
  const out = {
    name, key,
    roleId: String(src.roleId ?? existing.roleId ?? ""),
    extraPerms: P.cleanList(src.extraPerms ?? existing.extraPerms),
    removedPerms: P.cleanList(src.removedPerms ?? existing.removedPerms),
    startsAt: "startsAt" in src ? tsOrNull(src.startsAt) : existing.startsAt ?? null,
    endsAt: "endsAt" in src ? tsOrNull(src.endsAt) : existing.endsAt ?? null,
    ndaSigned: "ndaSigned" in src ? !!src.ndaSigned : !!existing.ndaSigned,
    notes: String(src.notes ?? existing.notes ?? "").slice(0, 1000),
  };
  if (out.startsAt && out.endsAt && out.endsAt.toMillis() <= out.startsAt.toMillis()) fail("invalid-argument", "bad_dates", "The end date must be after the start date.");
  return out;
}

async function assertKeyFree(key, email) {
  const same = await db().collection("team").where("key", "==", key).get();
  if (same.docs.some((d) => d.id !== email)) fail("already-exists", "key_taken", `The short name "${key}" is already used by someone else.`);
}

async function seed(by) {
  let created = 0;
  for (const [id, r] of Object.entries(P.DEFAULT_ROLES)) {
    if (id === "partner") continue; // computed, not stored
    const ref = db().doc(`roles/${id}`);
    if (!(await ref.get()).exists) { await ref.set({ name: r.name, description: r.description, perms: r.perms, createdAt: FieldValue.serverTimestamp(), createdBy: by }); created++; }
  }
  const names = { andre: "André Rocha", antonio: "António Carvalho" };
  for (const email of P.PARTNER_EMAILS) {
    const ref = db().doc(`team/${email}`);
    if (!(await ref.get()).exists) {
      await ref.set({ email, name: names[P.PARTNER_KEYS[email]], key: P.PARTNER_KEYS[email], roleId: "partner", extraPerms: [], removedPerms: [], status: "active", startsAt: null, endsAt: null, ndaSigned: true, notes: "", invitedBy: "seed", invitedAt: FieldValue.serverTimestamp(), uid: null, lastSignInAt: null });
      created++;
    }
  }
  if (created) { await syncLoginHashes(); await audit(by, "seed", null, null, { created }); }
  return { created };
}

async function invite({ member }, by) {
  const email = norm(member?.email);
  if (!EMAIL_RE.test(email)) fail("invalid-argument", "bad_email", "Enter a valid email address.");
  const ref = db().doc(`team/${email}`);
  const cur = await ref.get();
  if (cur.exists && cur.data().status !== "ended") fail("already-exists", "exists", "This person is already on the team.");
  const fields = cleanMember(member);
  if (fields.roleId === "partner") fail("permission-denied", "partner_locked", "Partners are the two founders — choose another role.");
  if (!(await readRole(fields.roleId))) fail("invalid-argument", "bad_role", "Choose a role.");
  await assertKeyFree(fields.key, email);
  const doc = { email, ...fields, status: "invited", invitedBy: by, invitedAt: FieldValue.serverTimestamp(), uid: cur.exists ? cur.data().uid || null : null, lastSignInAt: cur.exists ? cur.data().lastSignInAt || null : null };
  await ref.set(doc);
  await syncLoginHashes();
  await refreshClaims(email);
  await audit(by, "invite", email, cur.exists ? { status: cur.data().status } : null, { roleId: fields.roleId, key: fields.key, endsAt: fields.endsAt });
  return { email };
}

async function update({ email: raw, member }, by) {
  const email = norm(raw);
  const ref = db().doc(`team/${email}`);
  const cur = await ref.get();
  if (!cur.exists) fail("not-found", "not_found", "Person not found.");
  const before = cur.data();
  const fields = cleanMember(member || {}, before);
  if (before.roleId === "partner" && fields.roleId !== "partner") fail("permission-denied", "partner_locked", "A partner's role can't be changed.");
  if (before.roleId !== "partner" && fields.roleId === "partner") fail("permission-denied", "partner_locked", "Partners are the two founders.");
  if (fields.roleId !== "partner" && !(await readRole(fields.roleId))) fail("invalid-argument", "bad_role", "Choose a role.");
  if (fields.key !== before.key) await assertKeyFree(fields.key, email);
  await ref.update({ ...fields, updatedAt: FieldValue.serverTimestamp(), updatedBy: by });
  await syncLoginHashes();
  await refreshClaims(email);
  const diff = Object.fromEntries(Object.keys(fields).filter((k) => JSON.stringify(fields[k]) !== JSON.stringify(before[k])).map((k) => [k, fields[k]]));
  await audit(by, "update", email, Object.fromEntries(Object.keys(diff).map((k) => [k, before[k] ?? null])), diff);
  return { email };
}

async function setStatus(email, status, by, action) {
  const ref = db().doc(`team/${email}`);
  const cur = await ref.get();
  if (!cur.exists) fail("not-found", "not_found", "Person not found.");
  if (P.PARTNER_EMAILS.includes(email) || cur.data().roleId === "partner") fail("permission-denied", "partner_locked", "A partner's access can't be suspended or ended.");
  await ref.update({ status, updatedAt: FieldValue.serverTimestamp(), updatedBy: by, ...(status === "ended" ? { endedAt: FieldValue.serverTimestamp() } : {}) });
  await syncLoginHashes();
  await refreshClaims(email);
  await audit(by, action, email, { status: cur.data().status }, { status });
  return { email, status };
}

async function saveRole({ roleId, role }, by) {
  if (roleId === "partner") fail("permission-denied", "partner_locked", "The Partner role can't be changed.");
  const name = String(role?.name || "").trim().slice(0, 40);
  if (!name) fail("invalid-argument", "name_required", "Give the role a name.");
  const perms = P.cleanList(role?.perms).filter((p) => p !== "access.manage"); // managing access stays with partners
  const data = { name, description: String(role?.description || "").slice(0, 300), perms, updatedAt: FieldValue.serverTimestamp(), updatedBy: by };
  const ref = roleId ? db().doc(`roles/${roleId}`) : db().collection("roles").doc();
  const before = roleId ? (await ref.get()).data() || null : null;
  if (roleId && !before) fail("not-found", "not_found", "Role not found.");
  await ref.set(before ? { ...before, ...data } : { ...data, createdAt: FieldValue.serverTimestamp(), createdBy: by });
  // Everyone with this role gets the new permissions now.
  const members = await db().collection("team").where("roleId", "==", ref.id).get();
  for (const m of members.docs) await refreshClaims(m.id);
  await audit(by, roleId ? "saveRole" : "createRole", `role:${ref.id}`, before ? { perms: before.perms, name: before.name } : null, { perms, name });
  return { roleId: ref.id, updated: members.size };
}

async function deleteRole({ roleId }, by) {
  if (!roleId || roleId === "partner") fail("permission-denied", "partner_locked", "The Partner role can't be deleted.");
  const members = await db().collection("team").where("roleId", "==", roleId).get();
  if (members.docs.some((d) => d.data().status !== "ended")) fail("failed-precondition", "role_in_use", "Someone still has this role — change their role first.");
  await db().doc(`roles/${roleId}`).delete();
  await audit(by, "deleteRole", `role:${roleId}`, null, null);
  return { ok: true };
}

exports.teamAccess = onCall({ region: REGION }, async (request) => {
  const by = P.requirePerm(request, "access.manage", "Only partners can manage team access.");
  const data = request.data || {};
  switch (data.action) {
    case "seed": return seed(by);
    case "invite": return invite(data, by);
    case "update": return update(data, by);
    case "suspend": return setStatus(norm(data.email), "suspended", by, "suspend");
    case "reactivate": return setStatus(norm(data.email), "active", by, "reactivate");
    case "end": return setStatus(norm(data.email), "ended", by, "end");
    case "saveRole": return saveRole(data, by);
    case "deleteRole": return deleteRole(data, by);
    default: fail("invalid-argument", "bad_action", `Unknown action "${data.action}".`);
  }
});

// Daily: end access for people past their end date.
async function runTeamExpiry(now = new Date()) {
  const snap = await db().collection("team").where("status", "in", ["invited", "active"]).get();
  let ended = 0;
  for (const d of snap.docs) {
    const m = d.data();
    if (P.PARTNER_EMAILS.includes(d.id) || m.roleId === "partner") continue;
    if (m.endsAt && m.endsAt.toMillis() <= now.getTime()) { await setStatus(d.id, "ended", "schedule", "expired"); ended++; }
  }
  return ended;
}
exports.teamExpiry = onSchedule({ region: REGION, schedule: "every day 02:00", timeZone: "Europe/Lisbon" }, async () => {
  const n = await runTeamExpiry();
  if (n) logger.info("teamExpiry: access ended", { n });
});

// Sign-in hook (functions/index.js): record the user id and sign-in time,
// return the claims. Returns null when the person isn't on the team.
async function onTeamSignIn(email, uid) {
  const e = norm(email);
  const ref = db().doc(`team/${e}`);
  const snap = await ref.get();
  if (!snap.exists && !P.PARTNER_EMAILS.includes(e)) return null;
  const m = snap.exists ? snap.data() : null;
  if (m && !P.isActive(m) && !P.PARTNER_EMAILS.includes(e)) return { allowed: false };
  const role = m?.roleId ? await readRole(m.roleId) : null;
  const claims = P.claimsFor(e, m, role);
  if (m) {
    const upd = { uid: uid || m.uid || null, lastSignInAt: FieldValue.serverTimestamp() };
    if (m.status === "invited") upd.status = "active";
    await ref.update(upd);
    await db().collection("accessAudit").add({ by: e, action: "signIn", target: e, before: null, after: null, at: FieldValue.serverTimestamp() });
  }
  return { allowed: true, claims };
}

exports.runTeamExpiry = runTeamExpiry;
exports.onTeamSignIn = onTeamSignIn;
exports.syncLoginHashes = syncLoginHashes;
