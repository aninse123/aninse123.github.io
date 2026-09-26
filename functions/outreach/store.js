// Outreach module — Firestore helpers shared by the send, webhook and admin
// functions (data model: spec §5).

const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { DEFAULT_SETTINGS } = require("./config");
const { utcDayKey, normEmail, domainOf } = require("./util");

const db = () => getFirestore();

async function getSettings() {
  const snap = await db().doc("outreachSettings/global").get();
  return { ...DEFAULT_SETTINGS, ...(snap.exists ? snap.data() : {}) };
}

// Account-wide Resend usage from the response headers (spec §7.6). Only send
// responses carry these headers (V7, 2026-09-24: no read-only endpoint does),
// so we also note how many portal emails today's counter held at that moment
// — the usage bar adds portal activity since then to Resend's last figure.
// Call after bumpDaily() for the same send.
async function recordQuota(quota, source) {
  if (!quota || (quota.daily == null && quota.monthly == null)) return;
  const day = utcDayKey();
  const daily = await db().doc(`outreachDaily/${day}`).get();
  const upd = { updatedAt: FieldValue.serverTimestamp(), source, portalTotalAtReading: (daily.exists && daily.data().total) || 0 };
  if (quota.daily != null) upd.resendDailyUsed = quota.daily;
  if (quota.monthly != null) upd.resendMonthlyUsed = quota.monthly;
  await db().doc(`outreachUsage/${day}`).set(upd, { merge: true });
}

async function getTodayUsage() {
  const snap = await db().doc(`outreachUsage/${utcDayKey()}`).get();
  return snap.exists ? snap.data() : {};
}

async function getTodayDaily() {
  const snap = await db().doc(`outreachDaily/${utcDayKey()}`).get();
  return snap.exists ? snap.data() : {};
}

// Map keys can't safely hold dots in every read path, so sender ids
// ("an.rocha@mail…") are flattened for the per-sender counters.
function senderKey(senderId) {
  return String(senderId || "").replace(/[.@]/g, "_");
}

// The portal's own breakdown of what it sent/received today. Everything else
// in Resend's daily figure is "other" (warm-up, investor emails). `extra`
// names further counters for the same email (e.g. "campaignSent", which the
// scheduler compares with the automations limit).
async function bumpDaily(field, { senderId, owner, extra = [] } = {}) {
  const inc = FieldValue.increment(1);
  const upd = { [field]: inc, total: inc, updatedAt: FieldValue.serverTimestamp() };
  for (const f of extra) upd[f] = inc;
  if (senderId) upd.bySender = { [senderKey(senderId)]: inc };
  if (owner) upd.byOwner = { [owner]: inc };
  await db().doc(`outreachDaily/${utcDayKey()}`).set(upd, { merge: true });
}

function suppressionIds(email) {
  const e = normEmail(email);
  return { addressId: e, domainId: "@" + domainOf(e) };
}

async function findSuppression(email) {
  const { addressId, domainId } = suppressionIds(email);
  const [a, d] = await Promise.all([
    db().doc(`outreachSuppression/${addressId}`).get(),
    db().doc(`outreachSuppression/${domainId}`).get(),
  ]);
  if (a.exists) return a.data();
  if (d.exists) return d.data();
  return null;
}

// Permanent until an admin removes it; applies to every sender (spec §10.5).
async function addSuppression(email, { reason, source, companyId = null, by = "system" }) {
  const e = normEmail(email);
  if (!e) return;
  await db().doc(`outreachSuppression/${e}`).set({
    email: e, domain: domainOf(e), scope: "address", reason, source, companyId, by,
    at: FieldValue.serverTimestamp(),
  }, { merge: true });
}

// Every email also becomes a searchActivities entry so the company's
// Activities tab keeps working. Outbound uses the existing "email" type (it
// counts as an outreach attempt, like today); inbound uses "email_received",
// which the Search CRM treats as a non-outreach touch. Test traffic uses
// "email_test" so the browser's recomputeActivityFields() never counts it as
// an outreach attempt on a real company.
// Campaign sends also carry campaignId / stepId / enrolmentId (Phase 2 §7).
async function writeActivity({ companyId, direction, subject, content, threadId, messageId, contactName = null, contactEmail = null, createdBy, isTest, campaignId = null, stepId = null, enrolmentId = null }) {
  if (!companyId) return null;
  const ref = await db().collection("searchActivities").add({
    companyId,
    type: isTest ? "email_test" : (direction === "out" ? "email" : "email_received"),
    date: Timestamp.now(),
    title: (isTest ? "[TEST] " : "") + (subject || ""),
    content: content || null,
    via: "email",
    direction,
    threadId,
    outreachMessageId: messageId,
    contactName,
    contactRole: null,
    recipientEmails: contactEmail ? [contactEmail] : [],
    responseCategory: null,
    status: null,
    isTest: !!isTest,
    campaignId: campaignId || null,
    stepId: stepId || null,
    enrolmentId: enrolmentId || null,
    channel: "email",
    createdAt: FieldValue.serverTimestamp(),
    createdBy,
  });
  return ref.id;
}

// Server-side counterpart of search.html's recomputeActivityFields() for the
// fields outreach changes. Test traffic never touches real company fields.
// `outreach` (default true for outgoing touches): also moves lastOutreachAt,
// which the campaign "contacted in the last N days" rule uses (Phase 3c).
async function touchCompany(companyId, { direction, isAutoReply = false, isTest, outreach = true }) {
  if (!companyId || isTest) return;
  const ref = db().doc(`searchCompanies/${companyId}`);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const c = snap.data();
    const now = Timestamp.now();
    const upd = { lastTouchAt: now, updatedAt: FieldValue.serverTimestamp() };
    if (direction === "out" && outreach) {
      upd.lastOutreachAt = now;
      upd.outreachAttempts = FieldValue.increment(1);
      if (!c.outreachStatus || c.outreachStatus === "none") upd.outreachStatus = "contacted";
    } else if (!isAutoReply) {
      upd.lastReplyAt = now;
      if (!["unsubscribed", "bounced"].includes(c.outreachStatus)) upd.outreachStatus = "replied";
    }
    tx.update(ref, upd);
  });
}

// Bounce / complaint / unsubscribe mark the company without counting as a touch.
async function setCompanyOutreachStatus(companyId, status, isTest) {
  if (!companyId || isTest) return;
  await db().doc(`searchCompanies/${companyId}`).update({ outreachStatus: status, updatedAt: FieldValue.serverTimestamp() }).catch(() => {});
}

module.exports = {
  db, FieldValue, Timestamp,
  getSettings, recordQuota, getTodayUsage, getTodayDaily, senderKey, bumpDaily,
  findSuppression, addSuppression, writeActivity, touchCompany, setCompanyOutreachStatus,
};
