// outreachAdmin — one-off admin actions, triggered from the portal (never
// from outside the app):
//   { action: "seed" }          creates outreachSettings/global and the sender
//                               registry if missing; never overwrites.
//   { action: "clearTestData" } deletes every thread, message and activity
//                               created while testMode was on, plus their
//                               Storage files (go-live checklist, spec §13.3),
//                               and every campaign/enrolment created in test
//                               mode (releasing the companies they held).

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getStorage } = require("firebase-admin/storage");
const { REGION, ADMIN_EMAILS, DEFAULT_SETTINGS, DEFAULT_SENDER_CAP, SEED_SENDERS, SENDER_DOMAIN } = require("./config");
const { normEmail } = require("./util");
const store = require("./store");
const { endEnrolment } = require("./campaigns");

const { db, FieldValue } = store;

async function seed(callerEmail) {
  const created = [];
  const settingsRef = db().doc("outreachSettings/global");
  if (!(await settingsRef.get()).exists) {
    await settingsRef.set({ ...DEFAULT_SETTINGS, updatedAt: FieldValue.serverTimestamp(), updatedBy: callerEmail });
    created.push("outreachSettings/global");
  }
  for (const s of SEED_SENDERS) {
    const email = `${s.local}@${SENDER_DOMAIN}`;
    const ref = db().doc(`outreachSenders/${email}`);
    if ((await ref.get()).exists) continue;
    await ref.set({
      email, displayName: s.displayName, owner: s.owner, domain: SENDER_DOMAIN,
      status: s.status, dailyCap: DEFAULT_SENDER_CAP, inboundAlias: s.local,
      signature: `${s.displayName}\nDouro Partners`, notes: "",
      updatedAt: FieldValue.serverTimestamp(), updatedBy: callerEmail,
    });
    created.push(`outreachSenders/${email}`);
  }
  return { created };
}

async function deleteQuery(q) {
  let n = 0;
  for (;;) {
    const snap = await q.limit(400).get();
    if (snap.empty) return n;
    const batch = db().batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    n += snap.size;
  }
}

async function clearTestData() {
  const threads = await db().collection("outreachThreads").where("isTest", "==", true).get();
  const bucket = getStorage().bucket();
  for (const t of threads.docs) {
    await bucket.deleteFiles({ prefix: `outreach/${t.id}/` }).catch(() => {});
  }
  const messages = await deleteQuery(db().collection("outreachMessages").where("isTest", "==", true));
  const activities = await deleteQuery(db().collection("searchActivities").where("isTest", "==", true));
  const threadCount = await deleteQuery(db().collection("outreachThreads").where("isTest", "==", true));
  // Test campaigns ran on real companies (C10 rehearsal): free their campaign
  // slot before deleting, so real campaigns can enrol them after go-live.
  const testEnrols = await db().collection("outreachEnrolments").where("isTest", "==", true).get();
  for (const d of testEnrols.docs) await endEnrolment(d.ref, "removed", "Test data cleared");
  const enrolments = await deleteQuery(db().collection("outreachEnrolments").where("isTest", "==", true));
  const campaigns = await deleteQuery(db().collection("outreachCampaigns").where("isTest", "==", true));
  return { threads: threadCount, messages, activities, campaigns, enrolments };
}

exports.outreachAdmin = onCall({ region: REGION }, async (request) => {
  const callerEmail = normEmail(request.auth?.token?.email);
  if (!ADMIN_EMAILS.includes(callerEmail)) throw new HttpsError("permission-denied", "Only Douro admins can do this.");
  const action = request.data?.action;
  if (action === "seed") return seed(callerEmail);
  if (action === "clearTestData") return clearTestData();
  throw new HttpsError("invalid-argument", `Unknown action "${action}".`);
});
