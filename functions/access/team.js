// teamAccess — Team & access tab (partners only, `access.manage`).
//
// Actions (request.data.action):
//   seed                        create the partners' team records and the default roles (never overwrites)
//   invite  { member }          add a person: email, name, key, roleId, endsAt?, startsAt?, notes?, ndaSigned?, inviteLang?
//   sendInvite { email, lang? } the invitation email (pt or en) — only once the NDA is ticked (G2 / G3)
//   update  { email, member }   change name / key / role / extra & removed permissions / dates / NDA / notes
//   suspend { email }           stop access now (sessions revoked, account disabled)
//   reactivate { email }        undo suspend (within dates)
//   end     { email }           end access (kept for history, removed from the login list)
//   saveRole { roleId?, role }  create / edit a role (Partner is locked)
//   deleteRole { roleId }       only when nobody has it
//   refreshAll                  push everyone's current permissions to their account
//                               (after the Admin / Partner split, 30 Sep)
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
const Usage = require("../usage"); // Team & access → Usage (best-effort counters)

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

// Admin is the one fixed level (computed, never stored or edited). Partner
// is an ordinary stored role; if it isn't stored yet, its default applies.
const FIXED = ["admin"];
const isFixed = (roleId) => FIXED.includes(roleId);
async function readRole(roleId) {
  if (isFixed(roleId)) return { id: roleId, ...P.DEFAULT_ROLES[roleId] };
  const s = await db().doc(`roles/${roleId}`).get();
  if (s.exists) return { id: s.id, ...s.data() };
  return roleId === "partner" ? { id: "partner", ...P.DEFAULT_ROLES.partner } : null;
}

async function audit(by, action, target, before, after) {
  await db().collection("accessAudit").add({ by, action, target, before: before ?? null, after: after ?? null, at: FieldValue.serverTimestamp() });
}

// Keep the public login list (hashes only) and the team directory in step
// with the team. The directory (teamDirectory/{key}: key, name, active) is
// what every team member reads to show owners and task assignees — it holds
// no roles or permissions, and no sign-in email except a @douropartners.pt
// one used as the contact printed on letters (T4: contactPhone / contactEmail).
async function syncLoginHashes() {
  const snap = await db().collection("team").get();
  const now = new Date();
  const hashes = snap.docs.filter((d) => P.isActive(d.data(), now) || P.ADMIN_EMAILS.includes(d.id)).map((d) => sha256(d.id));
  await db().doc("config/teamEmailHashes").set({ hashes, updatedAt: FieldValue.serverTimestamp() });
  const dir = await db().collection("teamDirectory").get();
  const keys = new Set();
  const batch = db().batch();
  snap.docs.forEach((d) => {
    const m = d.data();
    if (!m.key) return;
    keys.add(m.key);
    batch.set(db().doc(`teamDirectory/${m.key}`), {
      key: m.key, name: m.name || m.key, partner: m.roleId === "admin" || m.roleId === "partner",
      contactPhone: m.contactPhone || null,
      contactEmail: m.contactEmail || (/@douropartners\.pt$/.test(d.id) ? d.id : null),
      active: P.ADMIN_EMAILS.includes(d.id) || P.isActive(m, now), updatedAt: FieldValue.serverTimestamp(),
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
  if (!P.isActive(m) && !P.ADMIN_EMAILS.includes(email)) {
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
    // G3: the invitation goes in one language, chosen when inviting.
    inviteLang: ["pt", "en"].includes(src.inviteLang) ? src.inviteLang : (existing.inviteLang || "pt"),
    notes: String(src.notes ?? existing.notes ?? "").slice(0, 1000),
    // T4: printed on letters / call scripts they sign ({{sender.phone}}, {{sender.email}}).
    contactPhone: String(src.contactPhone ?? existing.contactPhone ?? "").trim().slice(0, 30),
    contactEmail: String(src.contactEmail ?? existing.contactEmail ?? "").trim().toLowerCase().slice(0, 120),
  };
  if (out.contactPhone && !/^\+?[\d\s().-]{6,30}$/.test(out.contactPhone)) fail("invalid-argument", "bad_phone", "The phone number can have digits, spaces, + ( ) - only.");
  if (out.contactEmail && !EMAIL_RE.test(out.contactEmail)) fail("invalid-argument", "bad_contact_email", "The contact email isn't valid.");
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
    if (isFixed(id)) continue; // computed, not stored (Partner is stored like any role)
    const ref = db().doc(`roles/${id}`);
    if (!(await ref.get()).exists) { await ref.set({ name: r.name, description: r.description, perms: r.perms, createdAt: FieldValue.serverTimestamp(), createdBy: by }); created++; }
  }
  const names = { andre: "André Rocha", antonio: "António Carvalho" };
  for (const email of P.PARTNER_EMAILS) {
    const ref = db().doc(`team/${email}`);
    if (!(await ref.get()).exists) {
      await ref.set({ email, name: names[P.PARTNER_KEYS[email]], key: P.PARTNER_KEYS[email], roleId: P.isAdminEmail(email) ? "admin" : "partner", extraPerms: [], removedPerms: [], status: "active", startsAt: null, endsAt: null, ndaSigned: true, notes: "", invitedBy: "seed", invitedAt: FieldValue.serverTimestamp(), uid: null, lastSignInAt: null });
      created++;
    }
  }
  await syncLoginHashes(); // also (re)builds the team directory
  if (created) await audit(by, "seed", null, null, { created });
  return { created };
}

// "You've been given access" — from noreply@douropartners.pt, replies to the
// partner who invited. One language (G3: pt or en, chosen when inviting),
// and only once the NDA is recorded (G2) — partners excepted.
function inviteMessage(lang, { first, roleName, endsAt, url, email }) {
  const fmt = (loc) => (endsAt ? new Intl.DateTimeFormat(loc, { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Lisbon" }).format(endsAt.toDate()) : null);
  if (lang === "en") {
    const until = fmt("en-GB");
    return {
      subject: "Your access to the Douro Partners portal",
      message: [
        `Hi ${first},`,
        "",
        `You've been given access to the Douro Partners portal${roleName ? ` (role: ${roleName})` : ""}${until ? `, until ${until}` : ""}.`,
        "",
        `To sign in: open ${url}, enter this address (${email}) and follow the link we email you. No password needed.`,
        "",
        "Any questions, just reply to this email.",
      ].join("\n"),
    };
  }
  const until = fmt("pt-PT");
  return {
    subject: "Acesso ao portal Douro Partners",
    message: [
      `Olá ${first},`,
      "",
      `Já tens acesso ao portal da Douro Partners${roleName ? ` (função: ${roleName})` : ""}${until ? `, até ${until}` : ""}.`,
      "",
      `Para entrares: abre ${url}, escreve este endereço (${email}) e segue o link que vais receber por email. Não há palavra-passe.`,
      "",
      "Qualquer dúvida, responde a este email.",
    ].join("\n"),
  };
}

async function sendInvite(email, by, origin, lang) {
  const snap = await db().doc(`team/${email}`).get();
  if (!snap.exists) fail("not-found", "not_found", "Person not found.");
  const m = snap.data();
  if (!P.isActive(m)) fail("failed-precondition", "not_active", "This person's access isn't active.");
  if (!isFixed(m.roleId) && !P.ADMIN_EMAILS.includes(email) && !m.ndaSigned) fail("failed-precondition", "nda_missing", "Tick \"NDA signed\" first — the invitation can only be sent once the NDA is recorded.");
  const role = m.roleId ? await readRole(m.roleId) : null;
  const base = PORTAL_ORIGINS.includes(origin) ? origin : "https://douropartners.pt";
  const url = `${base}/portal/login.html`;
  const first = String(m.name || "").trim().split(/\s+/)[0] || "";
  const language = ["pt", "en"].includes(lang) ? lang : (m.inviteLang === "en" ? "en" : "pt");
  const { subject, message } = inviteMessage(language, { first, roleName: role?.name || "", endsAt: m.endsAt || null, url, email });
  const res = await sendEmail(RESEND_READ_KEY.value(), {
    from: "Douro Partners <noreply@douropartners.pt>",
    to: [email],
    reply_to: by,
    subject,
    text: message,
    html: buildOutreachHtml({ message }),
  });
  await db().doc(`team/${email}`).update({ invitationSentAt: FieldValue.serverTimestamp(), invitationSentBy: by, inviteLang: language });
  await audit(by, "inviteEmail", email, null, { to: email, url, lang: language });
  return { sent: true, id: res.data?.id || null };
}

async function invite({ member, sendEmail: withEmail, origin }, by) {
  const email = norm(member?.email);
  if (!EMAIL_RE.test(email)) fail("invalid-argument", "bad_email", "Enter a valid email address.");
  const ref = db().doc(`team/${email}`);
  const cur = await ref.get();
  if (cur.exists && cur.data().status !== "ended") fail("already-exists", "exists", "This person is already on the team.");
  const fields = cleanMember(member);
  if (isFixed(fields.roleId)) fail("permission-denied", "partner_locked", "The Admin level is fixed — choose another role.");
  if (!(await readRole(fields.roleId))) fail("invalid-argument", "bad_role", "Choose a role.");
  await assertKeyFree(fields.key, email);
  const doc = { email, ...fields, status: "invited", invitedBy: by, invitedAt: FieldValue.serverTimestamp(), uid: cur.exists ? cur.data().uid || null : null, lastSignInAt: cur.exists ? cur.data().lastSignInAt || null : null };
  await ref.set(doc);
  await syncLoginHashes();
  await refreshClaims(email);
  await audit(by, "invite", email, cur.exists ? { status: cur.data().status } : null, { roleId: fields.roleId, key: fields.key, endsAt: fields.endsAt });
  let emailed = false, emailError = null;
  if (withEmail) {
    try { emailed = (await sendInvite(email, by, origin, fields.inviteLang)).sent; } catch (e) { emailError = e.message || String(e); }
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
  if (isFixed(before.roleId) && fields.roleId !== before.roleId) fail("permission-denied", "partner_locked", "The Admin's role can't be changed.");
  if (!isFixed(before.roleId) && isFixed(fields.roleId)) fail("permission-denied", "partner_locked", "The Admin level is fixed.");
  if (!isFixed(fields.roleId) && !(await readRole(fields.roleId))) fail("invalid-argument", "bad_role", "Choose a role.");
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
  if (P.ADMIN_EMAILS.includes(email) || isFixed(cur.data().roleId)) fail("permission-denied", "partner_locked", "The Admin's access can't be suspended or ended.");
  await ref.update({ status, updatedAt: FieldValue.serverTimestamp(), updatedBy: by, ...(status === "ended" ? { endedAt: FieldValue.serverTimestamp() } : {}) });
  await syncLoginHashes();
  await refreshClaims(email);
  await audit(by, action, email, { status: cur.data().status }, { status });
  return { email, status };
}

async function saveRole({ roleId, role }, by) {
  if (isFixed(roleId)) fail("permission-denied", "partner_locked", "The Admin role can't be changed.");
  const name = String(role?.name || "").trim().slice(0, 40);
  if (!name) fail("invalid-argument", "name_required", "Give the role a name.");
  const perms = P.cleanList(role?.perms).filter((p) => !P.ADMIN_ONLY.includes(p)); // Admin-only stays with the Admin
  const data = { name, description: String(role?.description || "").slice(0, 300), perms, updatedAt: FieldValue.serverTimestamp(), updatedBy: by };
  const ref = roleId ? db().doc(`roles/${roleId}`) : db().collection("roles").doc();
  const before = roleId ? (await ref.get()).data() || null : null;
  if (roleId && !before && roleId !== "partner") fail("not-found", "not_found", "Role not found."); // Partner: its first Save stores it
  await ref.set(before ? { ...before, ...data } : { ...data, createdAt: FieldValue.serverTimestamp(), createdBy: by });
  // Everyone with this role gets the new permissions now.
  const members = await db().collection("team").where("roleId", "==", ref.id).get();
  for (const m of members.docs) await refreshClaims(m.id);
  await audit(by, roleId ? "saveRole" : "createRole", `role:${ref.id}`, before ? { perms: before.perms, name: before.name } : null, { perms, name });
  return { roleId: ref.id, updated: members.size };
}

// After a change to how permissions are worked out (e.g. the Admin / Partner
// split): the Admin's record says Admin, and everyone who has signed in gets
// their current permissions on their account. Stored roles lose Admin-only
// permissions.
async function refreshAll(by) {
  let refreshed = 0, rolesCleaned = 0;
  for (const email of P.ADMIN_EMAILS) {
    const ref = db().doc(`team/${email}`);
    const s = await ref.get();
    if (s.exists && s.data().roleId !== "admin") await ref.update({ roleId: "admin", updatedAt: FieldValue.serverTimestamp(), updatedBy: by });
  }
  // Partner is an ordinary role now: store it (once), and make the founders
  // who aren't Admin partners with their NDA recorded (staff like anyone else).
  const partnerRef = db().doc("roles/partner");
  if (!(await partnerRef.get()).exists) {
    const d = P.DEFAULT_ROLES.partner;
    await partnerRef.set({ name: d.name, description: d.description, perms: d.perms, createdAt: FieldValue.serverTimestamp(), createdBy: by });
  }
  for (const email of P.PARTNER_EMAILS.filter((x) => !P.ADMIN_EMAILS.includes(x))) {
    const ref = db().doc(`team/${email}`);
    const s = await ref.get();
    if (!s.exists) continue;
    const upd = {};
    if (!s.data().roleId || s.data().roleId === "partner") { if (s.data().roleId !== "partner") upd.roleId = "partner"; }
    if (!s.data().ndaSigned) upd.ndaSigned = true;
    if (!s.data().uid) { try { upd.uid = (await getAuth().getUserByEmail(email)).uid; } catch (e) { /* never signed in */ } }
    if (Object.keys(upd).length) await ref.update({ ...upd, updatedAt: FieldValue.serverTimestamp(), updatedBy: by });
  }
  for (const r of (await db().collection("roles").get()).docs) {
    const perms = P.cleanList(r.data().perms);
    const kept = perms.filter((p) => !P.ADMIN_ONLY.includes(p));
    if (kept.length !== perms.length) { await r.ref.update({ perms: kept, updatedAt: FieldValue.serverTimestamp(), updatedBy: by }); rolesCleaned++; }
  }
  for (const d of (await db().collection("team").get()).docs) if (await refreshClaims(d.id)) refreshed++;
  await syncLoginHashes();
  await audit(by, "refreshAll", null, null, { refreshed, rolesCleaned });
  return { refreshed, rolesCleaned };
}

async function deleteRole({ roleId }, by) {
  if (!roleId || isFixed(roleId)) fail("permission-denied", "partner_locked", "The Admin role can't be deleted.");
  const members = await db().collection("team").where("roleId", "==", roleId).get();
  if (members.docs.some((d) => d.data().status !== "ended")) fail("failed-precondition", "role_in_use", "Someone still has this role — change their role first.");
  await db().doc(`roles/${roleId}`).delete();
  await audit(by, "deleteRole", `role:${roleId}`, null, null);
  return { ok: true };
}

exports.teamAccess = onCall({ region: REGION, secrets: [RESEND_READ_KEY] }, async (request) => {
  const by = P.requirePerm(request, "access.manage", "Only the Admin can manage team access.");
  const data = request.data || {};
  switch (data.action) {
    case "seed": return seed(by);
    case "refreshAll": return refreshAll(by);
    case "invite": return invite(data, by);
    case "update": return update(data, by);
    case "suspend": return setStatus(norm(data.email), "suspended", by, "suspend");
    case "reactivate": return setStatus(norm(data.email), "active", by, "reactivate");
    case "end": return setStatus(norm(data.email), "ended", by, "end");
    case "saveRole": return saveRole(data, by);
    case "deleteRole": return deleteRole(data, by);
    case "sendInvite": return sendInvite(norm(data.email), by, data.origin, data.lang);
    default: fail("invalid-argument", "bad_action", `Unknown action "${data.action}".`);
  }
});

// Daily: end access for people past their end date.
async function runTeamExpiry(now = new Date()) {
  const snap = await db().collection("team").where("status", "in", ["invited", "active"]).get();
  let ended = 0;
  for (const d of snap.docs) {
    const m = d.data();
    if (P.ADMIN_EMAILS.includes(d.id) || isFixed(m.roleId)) continue;
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
  if (!snap.exists && !P.ADMIN_EMAILS.includes(e)) return null;
  const m = snap.exists ? snap.data() : null;
  if (m && !P.isActive(m) && !P.ADMIN_EMAILS.includes(e)) return { allowed: false };
  if (m && !m.ndaSigned && !isFixed(m.roleId) && !P.ADMIN_EMAILS.includes(e)) return { allowed: false, reason: "nda" };
  const role = m?.roleId ? await readRole(m.roleId) : null;
  const claims = P.claimsFor(e, m, role);
  if (m) {
    const upd = { uid: uid || m.uid || null, lastSignInAt: FieldValue.serverTimestamp() };
    if (m.status === "invited") upd.status = "active";
    await ref.update(upd);
    await db().collection("accessAudit").add({ by: e, action: "signIn", target: e, before: null, after: null, at: FieldValue.serverTimestamp() });
  }
  await Usage.countPerson("activity.signIns", e);
  return { allowed: true, claims };
}

exports.runTeamExpiry = runTeamExpiry;
exports.onTeamSignIn = onTeamSignIn;
exports.inviteMessage = inviteMessage;
exports.syncLoginHashes = syncLoginHashes;
