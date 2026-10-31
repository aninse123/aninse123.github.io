// Instance settings — who this portal belongs to (Phase 0 of the distribution
// plan, "Portal - Phase 0 Config Extraction Plan.md").
//
// Everything that used to be typed into the code as Douro's people, domains and
// branding lives in two Firestore documents instead, one pair per Firebase
// project (one project = one team):
//   instance/settings — server only (the admin catch-all in firestore.rules
//                       already closes it): admin emails, founders, portal
//                       origins, noreply sender, production hosts.
//   instance/public   — readable before sign-in: organisation name, logo,
//                       portal URL, who to contact.
//
// Fails closed: with no (or unreadable) settings nobody is an admin and
// `configured` is false. Callers decide what that means; sign-in refuses.

const { getFirestore } = require("firebase-admin/firestore");

const SETTINGS_PATH = "instance/settings";
const PUBLIC_PATH = "instance/public";
const TTL_MS = 60000;

const normEmail = (e) => String(e || "").trim().toLowerCase();
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const uniq = (list) => [...new Set(list)];
const strOr = (v, d = "") => (typeof v === "string" ? v.trim() : d);

// Short name used as the person's key everywhere (owner, sender owner, claims).
const isKey = (k) => /^[a-z][a-z0-9]{1,19}$/.test(k);

function cleanEmails(list) {
  return uniq((Array.isArray(list) ? list : []).map(normEmail).filter(isEmail));
}
function cleanFounders(list) {
  const seen = new Set();
  const out = [];
  for (const f of Array.isArray(list) ? list : []) {
    const email = normEmail(f?.email), key = strOr(f?.key).toLowerCase(), name = strOr(f?.name);
    if (!isEmail(email) || !isKey(key) || !name || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, key, name });
  }
  return out;
}
function cleanContacts(list) {
  return (Array.isArray(list) ? list : [])
    .map((c) => ({ name: strOr(c?.name), email: normEmail(c?.email) }))
    .filter((c) => c.name && isEmail(c.email));
}
function cleanHosts(list) {
  return uniq((Array.isArray(list) ? list : []).map((h) => strOr(h).toLowerCase()).filter(Boolean));
}
function cleanOrigins(list) {
  return uniq((Array.isArray(list) ? list : []).map((o) => strOr(o).replace(/\/+$/, "")).filter((o) => /^https?:\/\/[^\s/]+$/.test(o)));
}

// Turns the two raw documents into the one object the rest of the code uses.
// Pure: also used by the seed script to check a file before it is written.
function normalizeInstance(settings, pub) {
  const s = settings && typeof settings === "object" ? settings : {};
  const p = pub && typeof pub === "object" ? pub : {};
  const adminEmails = cleanEmails(s.adminEmails);
  const founders = cleanFounders(s.founders);
  return {
    configured: adminEmails.length > 0,
    adminEmails,
    founders,
    portalOrigins: cleanOrigins(s.portalOrigins),
    noreplyFrom: strOr(s.noreplyFrom),
    productionHosts: cleanHosts(s.productionHosts),
    orgName: strOr(p.orgName),
    logoUrl: strOr(p.logoUrl),
    portalUrl: strOr(p.portalUrl),
    contacts: cleanContacts(p.contacts),
  };
}

// Problems with a settings file, as readable strings (empty = fine).
function validateInstance(settings, pub) {
  const s = settings || {}, p = pub || {}, inst = normalizeInstance(s, p), out = [];
  if (!inst.adminEmails.length) out.push("settings.adminEmails needs at least one valid email");
  if ((s.adminEmails || []).length !== inst.adminEmails.length) out.push("settings.adminEmails has an invalid or duplicate entry");
  if ((s.founders || []).length !== inst.founders.length) out.push("settings.founders has an invalid or duplicate entry (each needs email, a short lowercase key and a name)");
  if (!inst.portalOrigins.length) out.push("settings.portalOrigins needs at least one https origin");
  if (!inst.productionHosts.length) out.push("settings.productionHosts needs at least one host");
  if (!inst.orgName) out.push("public.orgName is required");
  if (!inst.contacts.length) out.push("public.contacts needs at least one {name, email}");
  for (const e of inst.adminEmails) if (!inst.founders.some((f) => f.email === e)) out.push(`admin ${e} should also be listed in settings.founders (it needs a key and a name)`);
  return out;
}

const NOT_CONFIGURED = Object.freeze(normalizeInstance(null, null));

let cache = null, cachedAt = 0;

async function getInstance({ force = false } = {}) {
  if (!force && cache && Date.now() - cachedAt < TTL_MS) return cache;
  try {
    const db = getFirestore();
    const [s, p] = await Promise.all([db.doc(SETTINGS_PATH).get(), db.doc(PUBLIC_PATH).get()]);
    cache = normalizeInstance(s.exists ? s.data() : null, p.exists ? p.data() : null);
    if (!cache.configured) console.error("instance/settings is missing or has no admin emails: nobody is an admin until it is seeded");
  } catch (e) {
    console.error("instance settings unreadable", e?.message || e);
    cache = cache || NOT_CONFIGURED; // keep the last known good copy, else fail closed
  }
  cachedAt = Date.now();
  return cache;
}
function _reset() { cache = null; cachedAt = 0; }

// ── helpers over an instance object ──
const isAdminEmail = (inst, email) => inst.adminEmails.includes(normEmail(email));
const founderOf = (inst, email) => inst.founders.find((f) => f.email === normEmail(email)) || null;
const founderKey = (inst, email) => founderOf(inst, email)?.key || null;
const founderName = (inst, email) => founderOf(inst, email)?.name || null;
const founderEmails = (inst) => inst.founders.map((f) => f.email);

// "contact André (a@x.pt) or António (b@x.pt)" — for the sign-in refusal messages.
function contactLine(inst) {
  const parts = inst.contacts.map((c) => `${c.name} (${c.email})`);
  if (!parts.length) return "contact the portal administrator";
  return "contact " + (parts.length === 1 ? parts[0] : parts.slice(0, -1).join(", ") + " or " + parts[parts.length - 1]);
}

module.exports = {
  SETTINGS_PATH, PUBLIC_PATH, getInstance, _reset, normalizeInstance, validateInstance,
  isAdminEmail, founderOf, founderKey, founderName, founderEmails, contactLine,
};
