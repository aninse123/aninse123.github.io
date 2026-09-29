// featureAdmin — partners change feature switches (Team & access → Features).
// Every change is recorded in accessAudit (Team → Activity).
//   set        { key, site: "staging"|"production", state: "off"|"test"|"on" }
//   setTesters { key, testers: [emails] }   extra testers for one switch
//   setNote    { key, note }

const P = require("../access/perms");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { STATES, SITES, BY_KEY } = require("./catalog");
const F = require("./index");

const REGION = "us-central1";
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;
const db = () => getFirestore();
const fail = (code, reason, message) => { throw new HttpsError(code, message, { reason }); };

async function change(key, by, mutate) {
  if (!BY_KEY[key]) fail("invalid-argument", "bad_key", "Unknown feature.");
  const ref = db().doc("config/features");
  const res = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const flags = snap.exists ? { ...(snap.data().flags || {}) } : {};
    const before = { ...(flags[key] || {}) };
    const after = mutate({ ...before });
    after.updatedBy = by; after.updatedAt = Timestamp.now();
    flags[key] = after;
    tx.set(ref, { flags, updatedAt: FieldValue.serverTimestamp() });
    return { before, after };
  });
  await db().collection("accessAudit").add({ by, action: "feature", target: key, before: res.before, after: res.after, at: FieldValue.serverTimestamp() });
  F._reset(); // this instance sees the change at once; others within the cache time
  return { ok: true, key, flag: { ...res.after, updatedAt: res.after.updatedAt.toMillis(), onSince: res.after.onSince?.toMillis ? res.after.onSince.toMillis() : res.after.onSince ?? null } };
}

exports.featureAdmin = onCall({ region: REGION }, async (request) => {
  const by = P.requirePerm(request, "access.manage", "Only partners change feature switches.");
  const d = request.data || {};
  switch (d.action) {
    case "set": {
      if (!SITES.includes(d.site) || !STATES.includes(d.state)) fail("invalid-argument", "bad_state", "Choose staging or production, and Off, Test or On.");
      const f = BY_KEY[d.key];
      return change(d.key, by, (x) => {
        const wasOn = x.production === "on";
        x[d.site] = d.state;
        // "Ready to remove": since when a release switch is On in production.
        if (d.site === "production" && f?.kind === "release") x.onSince = d.state === "on" ? (wasOn && x.onSince ? x.onSince : Timestamp.now()) : null;
        return x;
      });
    }
    case "setTesters": {
      const list = [...new Set((Array.isArray(d.testers) ? d.testers : []).map((e) => String(e || "").trim().toLowerCase()).filter(Boolean))];
      if (list.length > 20) fail("invalid-argument", "too_many", "Up to 20 extra testers.");
      if (list.some((e) => !EMAIL_RE.test(e))) fail("invalid-argument", "bad_email", "One of the testers isn't a valid email.");
      return change(d.key, by, (x) => ({ ...x, testers: list }));
    }
    case "setNote":
      return change(d.key, by, (x) => ({ ...x, note: String(d.note || "").trim().slice(0, 300) }));
    default:
      fail("invalid-argument", "bad_action", "Unknown action.");
  }
});
