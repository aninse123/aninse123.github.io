// outreachSend — manual sends and Inbox replies (spec §6). The checks,
// rendering and sending live in send_core.js, shared with the campaign
// scheduler. Callable, so Firebase verifies the caller's ID token: sending
// requires a signed-in admin, not a shared secret, and we record who pressed
// Send.
//
// Request data:
//   new thread : { companyId, senderId, to?, recipient?: { email }, templateId?, variantKey?, subject?, body?, confirmOverTarget?, requestId? }
//                (recipient = the company address, a contact or a linked person — Phase 3b;
//                 in test mode `to` is the approved test address)
//   reply      : { threadId, body, senderId?, confirmOverTarget?, requestId? }
// `to` defaults to the company's companyEmail (Phase 1 recipient, Q10).
// `requestId` (optional) becomes the message id, so a retried call is a no-op.

const { onCall } = require("firebase-functions/v2/https");
const { REGION, ADMIN_EMAILS, OWNER_BY_ADMIN, RESEND_SEND_KEY, RESEND_READ_KEY, UNSUBSCRIBE_SECRET } = require("./config");
const { normEmail } = require("./util");
const { prepareEmail, deliverEmail, fail } = require("./send_core");
const store = require("./store");

const { db } = store;

exports.outreachSend = onCall({ region: REGION, secrets: [RESEND_SEND_KEY, RESEND_READ_KEY, UNSUBSCRIBE_SECRET] }, async (request) => {
  const callerEmail = normEmail(request.auth?.token?.email);
  if (!ADMIN_EMAILS.includes(callerEmail)) fail("permission-denied", "not_admin", "Only Douro admins can send outreach email.");

  const input = request.data || {};
  const settings = await store.getSettings();

  // ── Idempotency: a requestId that already produced a message returns it ──
  let messageRef;
  if (input.requestId != null) {
    if (!/^[A-Za-z0-9_-]{10,40}$/.test(String(input.requestId))) fail("invalid-argument", "bad_request_id", "Invalid requestId.");
    messageRef = db().doc(`outreachMessages/${input.requestId}`);
    const existing = await messageRef.get();
    if (existing.exists) {
      const m = existing.data();
      return { ok: m.status !== "failed", duplicate: true, messageId: messageRef.id, threadId: m.threadId, status: m.status };
    }
  } else {
    messageRef = db().collection("outreachMessages").doc();
  }

  // A manual reply's body is typed in the Inbox (the template picker only
  // inserts text there), so templates apply to new conversations only.
  const isReply = !!input.threadId;
  const p = await prepareEmail({
    callerEmail, settings, messageRef,
    threadId: input.threadId || null,
    companyId: input.companyId, senderId: input.senderId, to: input.to,
    recipient: isReply ? null : (input.recipient || null),
    templateId: isReply ? null : input.templateId, variantKey: input.variantKey,
    subject: isReply ? null : input.subject, body: input.body,
    confirmOverTarget: !!input.confirmOverTarget,
  });
  const res = await deliverEmail(p);
  return { ...res, sentBy: callerEmail, sentByOwner: OWNER_BY_ADMIN[callerEmail] || null };
});
