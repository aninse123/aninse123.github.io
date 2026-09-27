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
const { lisbonDate } = require("../outreach/recurring");
const { sendEmail } = require("../outreach/resend");
const { RESEND_READ_KEY } = require("../outreach/config");
const { buildOutreachHtml } = require("../outreach/branded");

// Where an invitation may point people to sign in (the page that invited them).
const PORTAL_ORIGINS = ["https://douropartners.pt", "https://www.douropartners.pt", "https://staging--douro-partners.netlify.app"];

const db = () => getFirestore();
const REGION = "us-central1";
const KEY_RE = /^[a-z][a-z0-9-]{1,19}$/;
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;

const fail = (code, reason, message) => { throw new HttpsError(code, message, { reason }); };
const norm = (e) => String(e || "").trim().toLowerCase();
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
// A date from the form ("YYYY-MM-DD") means that day in Lisbon: start = 00:00,
// end = 23:59:59 (summer time handled). Full timestamps are taken as given.
function tsOrNull(v, edge = "start") {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
  const d = m ? lisbonDate(+m[1], +m[2], +m[3], edge === "end" ? "23:59" : "00:00") : new Date(v);
  if (isNaN(d)) fail("invalid-argument", "bad_date", "A date isn't valid.");
  if (m && edge === "end") d.setSeconds(59);
  return Timestamp.fromDate(d);
}

async function readRole(roleId) {
  if (roleId === "partner") return { id: "partner", ...P.DEFAULT_ROLES.partner };
  const s = await db().doc(`roles/${roleId}`).get();
  return s.exists ? { id: s.id, ...s.data() } : null;
}

async function audit(by, action, target, before, after) {
  await db().collection("accessAudit").add({ by, action, target, before: before ?? null, after: after ?? null, at: FieldValue.serverTimestamp() });
}

// Keep the public login list (hashes only) and the team directory in step
// with the team. The directory (teamDirectory/{key}: key, name, active) is
// what every team member reads to show owners and task assignees — it holds
// no emails, roles or permissions.
async function syncLoginHashes() {
  const snap = await db().collection("team").get();
  const now = new Date();
  const hashes = snap.docs.filter((d) => P.isActive(d.data(), now) || P.PARTNER_EMAILS.includes(d.id)).map((d) => sha256(d.id));
  await db().doc("config/teamEmailHashes").set({ hashes, updatedAt: FieldValue.serverTimestamp() });
  const dir = await db().collection("teamDirectory").get();
  const keys = new Set();
  const batch = db().batch();
  snap.docs.forEach((d) => {
    const m = d.data();
    if (!m.key) return;
    keys.add(m.key);
    batch.set(db().doc(`teamDirectory/${m.key}`), {
      key: m.key, name: m.name || m.key, partner: m.roleId === "partner",
      active: P.PARTNER_EMAILS.includes(d.id) || P.isActive(m, now), updatedAt: FieldValue.serverTimestamp(),
    });
  });
  dir.docs.forEach((d) => { if (!keys.has(d.id)) batch.delete(d.ref); });
  await batch.commit();
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
    startsAt: "startsAt" in src ? tsOrNull(src.startsAt, "start") : existing.startsAt ?? null,
    endsAt: "endsAt" in src ? tsOrNull(src.endsAt, "end") : existing.endsAt ?? null,
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
  await syncLoginHashes(); // also (re)builds the team directory
  if (created) await audit(by, "seed", null, null, { created });
  return { created };
}

// "You've been given access" — from noreply@douropartners.pt, replies to the
// partner who invited. Portuguese first, English below.
async function sendInvite(email, by, origin) {
  const snap = await db().doc(`team/${email}`).get();
  if (!snap.exists) fail("not-found", "not_found", "Person not found.");
  const m = snap.data();
  if (!P.isActive(m)) fail("failed-precondition", "not_active", "This person's access isn't active.");
  const role = m.roleId ? await readRole(m.roleId) : null;
  const base = PORTAL_ORIGINS.includes(origin) ? origin : "https://douropartners.pt";
  const url = `${base}/portal/login.html`;
  const first = String(m.name || "").trim().split(/\s+/)[0] || "";
  const until = m.endsAt ? new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Lisbon" }).format(m.endsAt.toDate()) : null;
  const untilEn = m.endsAt ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Lisbon" }).format(m.endsAt.toDate()) : null;
  const message = [
    `Olá ${first},`,
    "",
    `Foi-lhe dado acesso ao portal da Douro Partners${role?.name ? ` (função: ${role.name})` : ""}${until ? `, até ${until}` : ""}.`,
    "",
    `Para entrar: abra ${url}, escreva este endereço (${email}) e siga o link que recebe por email. Não há palavra-passe.`,
    "",
    "Qualquer questão, responda a este email.",
    "",
    "—",
    "",
    `Hi ${first}, you've been given access to the Douro Partners portal${role?.name ? ` (role: ${role.name})` : ""}${untilEn ? ` until ${untilEn}` : ""}. To sign in, open ${url}, enter this address and follow the link we email you. No password needed.`,
  ].join("\n");
  const res = await sendEmail(RESEND_READ_KEY.value(), {
    from: "Douro Partners <noreply@douropartners.pt>",
    to: [email],
    reply_to: by,
    subject: "Acesso ao portal Douro Partners",
    text: message,
    html: buildOutreachHtml({ message }),
  });
  await db().doc(`team/${email}`).update({ invitationSentAt: FieldValue.serverTimestamp(), invitationSentBy: by });
  await audit(by, "inviteEmail", email, null, { to: email, url });
  return { sent: true, id: res.data?.id || null };
}

async function invite({ member, sendEmail: withEmail, origin }, by) {
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
  let emailed = false, emailError = null;
  if (withEmail) {
    try { emailed = (await sendInvite(email, by, origin)).sent; } catch (e) { emailError = e.message || String(e); }
  }
  return { email, emailed, emailError };
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

exports.teamAccess = onCall({ region: REGION, secrets: [RESEND_READ_KEY] }, async (request) => {
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
    case "sendInvite": return sendInvite(norm(data.email), by, data.origin);
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
