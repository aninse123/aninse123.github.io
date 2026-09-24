// resendWebhook — the single Resend webhook endpoint (free plan: 1 endpoint),
// routing every event type (spec §6).
//
// Events are account-wide: investor notifications and Instantly warm-up
// (while it runs) arrive here too. Anything that isn't ours is dropped after
// one lookup, without writing.

const { onRequest } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { REGION, RESEND_WEBHOOK_SECRET, RESEND_READ_KEY } = require("./config");
const { verifySvixSignature, tagValue, normEmail, stripQuoted, htmlToText } = require("./util");
const { getEmail } = require("./resend");
const { handleReceived } = require("./inbound");
const store = require("./store");

const { db, FieldValue, Timestamp } = store;

// Status never moves backwards (a late "delivered" can't undo a "bounced").
const STATUS_RANK = { queued: 0, sent: 1, delayed: 2, delivered: 3, failed: 9, suppressed: 9, bounced: 9, complained: 10 };
const STATUS_BY_EVENT = {
  "email.sent": "sent",
  "email.delivery_delayed": "delayed",
  "email.delivered": "delivered",
  "email.failed": "failed",
  "email.suppressed": "suppressed",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

async function findOurMessage(data) {
  const om = tagValue(data.tags, "om");
  if (om) {
    const snap = await db().doc(`outreachMessages/${om}`).get();
    if (snap.exists) return snap;
  }
  if (data.email_id) {
    const q = await db().collection("outreachMessages").where("resendId", "==", data.email_id).limit(1).get();
    if (!q.empty) return q.docs[0];
  }
  return null;
}

// A reply sent from Gmail "Send as" (SMTP via Resend) shows up only as an
// email.sent for an id we don't know. File it on the thread when it comes from
// an active outreach address to someone we already have a thread with (spec §3.3).
async function maybeRecordGmailReply(data) {
  const fromEmail = normEmail(data.from);
  const senderSnap = await db().doc(`outreachSenders/${fromEmail}`).get();
  if (!senderSnap.exists || ["warming", "retired"].includes(senderSnap.data().status)) return false;
  const to = normEmail((data.to || [])[0]);
  if (!to) return false;

  const tq = await db().collection("outreachThreads")
    .where("contactEmail", "==", to).where("senderId", "==", fromEmail)
    .orderBy("lastMessageAt", "desc").limit(1).get();
  const threadDoc = tq.empty ? null : tq.docs[0];
  const thread = threadDoc ? threadDoc.data() : null;

  let full = {};
  try {
    ({ data: full } = await getEmail(RESEND_READ_KEY.value(), data.email_id));
  } catch (e) {
    logger.warn("webhook: couldn't fetch Gmail-sent email body", { emailId: data.email_id, message: e.message });
  }
  const text = full.text || htmlToText(full.html);
  const isTest = thread ? !!thread.isTest : !!(await store.getSettings()).testMode;
  const now = Timestamp.now();
  const messageRef = db().collection("outreachMessages").doc();
  await messageRef.set({
    threadId: threadDoc ? threadDoc.id : null, direction: "out", via: "gmail",
    resendId: data.email_id, rfcMessageId: data.message_id || null, inReplyTo: null, references: null,
    from: data.from, to: data.to || [], cc: data.cc || [], subject: data.subject || full.subject || "",
    text: text || null, html: full.html || null, snippet: stripQuoted(text || "").slice(0, 500),
    templateId: null, variantKey: null, senderId: fromEmail, sentBy: null, source: "gmail",
    status: "sent", events: [{ type: "sent", at: now }], attachments: [], isAutoReply: false,
    unmatched: !threadDoc, isTest, createdAt: FieldValue.serverTimestamp(),
  });
  if (threadDoc) {
    await threadDoc.ref.update({
      lastMessageAt: now, lastDirection: "out", status: "waiting", unread: false,
      ...(data.message_id ? { rfcIds: FieldValue.arrayUnion(data.message_id) } : {}),
    });
    await store.writeActivity({
      companyId: thread.companyId, direction: "out", subject: data.subject, content: stripQuoted(text || ""),
      threadId: threadDoc.id, messageId: messageRef.id, contactEmail: to, createdBy: "gmail", isTest,
    });
    await store.touchCompany(thread.companyId, { direction: "out", isTest });
  }
  await store.bumpDaily("repliesSent", { senderId: fromEmail, owner: senderSnap.data().owner || null });
  return true;
}

async function handleDeliveryEvent(type, data) {
  const msgSnap = await findOurMessage(data);
  if (!msgSnap) {
    if (type === "email.sent") return maybeRecordGmailReply(data);
    return false; // investor notification, warm-up, etc. — not ours
  }
  const msg = msgSnap.data();
  const at = data.created_at ? Timestamp.fromDate(new Date(data.created_at)) : Timestamp.now();
  const short = type.replace(/^email\./, "");
  const upd = { events: FieldValue.arrayUnion({ type: short, at, detail: data.bounce?.subType || null }) };

  const newStatus = STATUS_BY_EVENT[type];
  // A temporary bounce is logged but isn't a hard bounce.
  const permanentBounce = type === "email.bounced" && (data.bounce?.type || "Permanent") === "Permanent";
  if (newStatus && (type !== "email.bounced" || permanentBounce)) {
    if ((STATUS_RANK[newStatus] ?? 0) >= (STATUS_RANK[msg.status] ?? 0)) upd.status = newStatus;
  }

  // Bot filter for tracking: opens/clicks within 10 s of sending are scanners.
  const sentMs = msg.sentAt?.toMillis?.() || 0;
  const plausibleHuman = !sentMs || at.toMillis() - sentMs > 10000;
  if (type === "email.opened" && plausibleHuman && !msg.firstOpenedAt) upd.firstOpenedAt = at;
  if (type === "email.clicked" && plausibleHuman && !msg.firstClickedAt) upd.firstClickedAt = at;

  // Resend's real Message-ID, in case it replaced ours (V1): keep threading working.
  if (data.message_id && data.message_id !== msg.rfcMessageId) upd.resendMessageId = data.message_id;
  await msgSnap.ref.update(upd);

  const threadRef = msg.threadId ? db().doc(`outreachThreads/${msg.threadId}`) : null;
  const thread = threadRef ? (await threadRef.get()).data() : null;
  if (threadRef && data.message_id && data.message_id !== msg.rfcMessageId) {
    await threadRef.update({ rfcIds: FieldValue.arrayUnion(data.message_id) });
  }

  const recipient = normEmail((msg.to || [])[0]);
  const companyId = thread?.companyId || null;
  const isTest = !!msg.isTest;
  if (permanentBounce) {
    await store.addSuppression(recipient, { reason: "hard_bounce", source: "webhook", companyId });
    if (threadRef) await threadRef.update({ status: "bounced" });
    await store.setCompanyOutreachStatus(companyId, "bounced", isTest);
  } else if (type === "email.complained") {
    await store.addSuppression(recipient, { reason: "complaint", source: "webhook", companyId });
    if (threadRef) await threadRef.update({ status: "closed" });
    await store.setCompanyOutreachStatus(companyId, "unsubscribed", isTest);
  } else if (type === "email.suppressed") {
    await store.addSuppression(recipient, { reason: "provider_suppressed", source: "webhook", companyId });
    if (threadRef) await threadRef.update({ status: "bounced" });
  }
  return true;
}

exports.resendWebhook = onRequest({ region: REGION, secrets: [RESEND_WEBHOOK_SECRET, RESEND_READ_KEY] }, async (req, res) => {
  if (req.method !== "POST") { res.status(405).send("Method not allowed"); return; }
  if (!verifySvixSignature(req.rawBody, req.headers, RESEND_WEBHOOK_SECRET.value())) {
    logger.warn("resendWebhook: rejected unsigned/stale request");
    res.status(401).send("Invalid signature");
    return;
  }

  let evt;
  try { evt = JSON.parse(req.rawBody.toString("utf8")); } catch (e) { res.status(400).send("Bad JSON"); return; }
  const type = evt.type || "";
  const data = evt.data || {};
  const svixId = req.headers["svix-id"];

  try {
    // Svix retries until it gets a 2xx; a marker per handled event id keeps a
    // retry from being applied twice. Written only for events we acted on.
    const marker = db().doc(`outreachWebhookEvents/${svixId}`);
    if ((await marker.get()).exists) { res.status(200).send("duplicate"); return; }

    let handled = false;
    if (type === "email.received") {
      await handleReceived(data);
      handled = true;
    } else if (type.startsWith("email.")) {
      handled = await handleDeliveryEvent(type, data);
    }
    if (handled) await marker.set({ type, emailId: data.email_id || null, at: FieldValue.serverTimestamp() });
    res.status(200).send(handled ? "ok" : "ignored");
  } catch (e) {
    // Non-2xx makes Resend retry later — right for transient failures.
    logger.error("resendWebhook: handler failed", { type, emailId: data.email_id, message: e.message, stack: e.stack });
    res.status(500).send("Handler error");
  }
});
