// outreachAdmin — one-off admin actions, triggered from the portal (never
// from outside the app):
//   { action: "seed" }          creates outreachSettings/global and the sender
//                               registry if missing; never overwrites.
//   { action: "setTracking", on } Phase 3d: switches open + click tracking on
//                               or off for the outreach domain in Resend (it
//                               can't be set per email) and records it in
//                               outreachSettings/global.trackOpensClicks.
//   { action: "clearTestData" } deletes every thread, message and activity
//                               created while testMode was on, plus their
//                               Storage files (go-live checklist, spec §13.3),
//                               and every campaign/enrolment created in test
//                               mode (releasing the companies they held).

const P = require("../access/perms"); // team access: who may call what
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getStorage } = require("firebase-admin/storage");
const { REGION, DEFAULT_SETTINGS, DEFAULT_SENDER_CAP, SEED_SENDERS, SENDER_DOMAIN, RESEND_READ_KEY, RELATIONSHIP_DOMAIN, RELATIONSHIP_SENDERS, RELATIONSHIP_SENDER_CAP } = require("./config");
const { listDomains, updateDomain } = require("./resend");
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
      signature: `${s.displayName}\nDouro Partners\nwww.douropartners.pt`, notes: "",
      updatedAt: FieldValue.serverTimestamp(), updatedBy: callerEmail,
    });
    created.push(`outreachSenders/${email}`);
  }
  // Phase 5: relationship senders (@douropartners.pt) — active from the start.
  for (const r of RELATIONSHIP_SENDERS) {
    const ref = db().doc(`outreachSenders/${r.email}`);
    if ((await ref.get()).exists) continue;
    await ref.set({
      email: r.email, displayName: r.displayName, owner: r.owner, domain: RELATIONSHIP_DOMAIN, kind: "relationship",
      status: "active", dailyCap: RELATIONSHIP_SENDER_CAP, inboundAlias: null,
      signature: r.owner ? `${r.displayName}\nDouro Partners` : "Douro Partners", notes: "Replies go to Gmail",
      updatedAt: FieldValue.serverTimestamp(), updatedBy: callerEmail,
    });
    created.push(`outreachSenders/${r.email}`);
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
  const tasks = await deleteQuery(db().collection("outreachTasks").where("isTest", "==", true));
  // Phase 5: test issues of recurring emails, their one-off templates, the
  // relationship-send log and opt-outs recorded from test emails. Lists,
  // recurring emails and Network contacts are set-up / records and stay.
  const testIssues = await db().collection("outreachIssues").where("isTest", "==", true).get();
  const issueIds = testIssues.docs.map((d) => d.id);
  let issueTemplates = await deleteQuery(db().collection("outreachTemplates").where("purpose", "==", "issue").where("isTest", "==", true));
  for (let i = 0; i < issueIds.length; i += 30) {
    issueTemplates += await deleteQuery(db().collection("outreachTemplates").where("issueId", "in", issueIds.slice(i, i + 30)));
  }
  const issues = await deleteQuery(db().collection("outreachIssues").where("isTest", "==", true));
  const peopleSends = await deleteQuery(db().collection("outreachPeopleSends").where("isTest", "==", true));
  const optOuts = await deleteQuery(db().collection("outreachOptOuts").where("isTest", "==", true));
  return { threads: threadCount, messages, activities, campaigns, enrolments, tasks, issues, issueTemplates, peopleSends, optOuts };
}

async function setTracking(on, callerEmail) {
  const key = RESEND_READ_KEY.value();
  const { data } = await listDomains(key);
  const dom = (data?.data || []).find((d) => d.name === SENDER_DOMAIN);
  if (!dom) throw new HttpsError("not-found", `The outreach domain ${SENDER_DOMAIN} isn't in this Resend account.`, { reason: "domain_not_found" });
  await updateDomain(key, dom.id, { open_tracking: !!on, click_tracking: !!on });
  await db().doc("outreachSettings/global").set({ trackOpensClicks: !!on, trackingUpdatedAt: FieldValue.serverTimestamp(), trackingUpdatedBy: callerEmail }, { merge: true });
  return { ok: true, on: !!on, domain: SENDER_DOMAIN };
}

// 28 Oct (plan "Decision-Maker Roles", R5): redo the "Related companies" box on
// the drafts waiting in To approve (draft / approved) with the current rule — after
// a change to who counts as a decision-maker. The box is removed when nothing is
// related any more. Returns how many drafts had a box before and after.
async function refreshOwnerPanels() {
  const { ownerPanelOnDraft } = require("./scheduler");
  const snap = await db().collection("outreachMessages").where("status", "in", ["draft", "approved"]).get();
  let before = 0, after = 0, checked = 0;
  const camps = new Map();
  for (const d of snap.docs) {
    const m = d.data();
    if (!m.companyId || !m.campaignId || !m.enrolmentId) continue;
    checked++;
    if (m.ownerPanel?.related?.length) before++;
    if (!camps.has(m.campaignId)) { const c = await db().doc(`outreachCampaigns/${m.campaignId}`).get(); camps.set(m.campaignId, c.exists ? { id: c.id, ...c.data() } : null); }
    const campaign = camps.get(m.campaignId);
    const e = await db().doc(`outreachEnrolments/${m.enrolmentId}`).get();
    if (!campaign || !e.exists) continue;
    await d.ref.update({ ownerPanel: FieldValue.delete(), checkMention: FieldValue.delete() });
    await ownerPanelOnDraft(d.ref, e.data(), campaign, m.draftBody || m.text || "");
    if ((await d.ref.get()).data()?.ownerPanel?.related?.length) after++;
  }
  return { ok: true, checked, before, after };
}

const Feat = require("../features"); // feature switches (Team & access → Features)
exports.outreachAdmin = onCall({ region: REGION, secrets: [RESEND_READ_KEY] }, async (request) => {
  await Feat.requireFeature(request, "outreach");
  const callerEmail = normEmail(request.auth?.token?.email);
  if (!P.hasPerm(request, "out.admin")) throw new HttpsError("permission-denied", "You don't have permission to change Outreach settings.");
  const action = request.data?.action;
  if (action === "seed") return seed(callerEmail);
  if (action === "clearTestData") return clearTestData();
  if (action === "setTracking") return setTracking(!!request.data?.on, callerEmail);
  if (action === "refreshOwnerPanels") return refreshOwnerPanels();
  throw new HttpsError("invalid-argument", `Unknown action "${action}".`);
});
