// outreachSend — manual sends and Inbox replies (spec §6). The checks,
// rendering and sending live in send_core.js, shared with the campaign
// scheduler. Callable, so Firebase verifies the caller's ID token: sending
// requires a signed-in team member with the right permission, and we record
// who pressed Send.
//
// Request data:
//   new thread : { companyId, senderId, to?, recipient?: { email }, templateId?, variantKey?, subject?, body?, confirmOverTarget?, requestId? }
//                (recipient = the company address, a contact or a linked person — Phase 3b;
//                 in test mode `to` is the approved test address)
//   reply      : { threadId, body, senderId?, confirmOverTarget?, requestId? }
// `to` defaults to the company's companyEmail (Phase 1 recipient, Q10).
// `requestId` (optional) becomes the message id, so a retried call is a no-op.
//
// Team access (Phase 2b): someone with `out.send` sends at once. Someone with
// only `out.draft` gets the same checks, but the email is saved as a MANUAL
// DRAFT in To approve ("written by …"); a partner (`out.approve`) then:
//   { action: "approveDraft", messageId, subject?, body? }  → sent now, from the chosen address,
//                                                            every check run again
//   { action: "returnDraft", messageId, note? }             → back to the writer with a note

const P = require("../access/perms"); // team access: who may call what
const { onCall } = require("firebase-functions/v2/https");
const { REGION, OWNER_BY_ADMIN, RESEND_SEND_KEY, RESEND_READ_KEY, UNSUBSCRIBE_SECRET } = require("./config");
const { normEmail } = require("./util");
const { prepareEmail, deliverEmail, fail } = require("./send_core");
const store = require("./store");

const { db, FieldValue } = store;

// The fields of a send request that a draft keeps, to send it later exactly as written.
function draftRequest(input, isReply) {
  return {
    threadId: input.threadId || null,
    companyId: isReply ? null : input.companyId || null,
    senderId: input.senderId || null,
    to: input.to || null,
    recipient: isReply ? null : input.recipient || null,
    templateId: isReply ? null : input.templateId || null,
    variantKey: input.variantKey || null,
    subject: isReply ? null : input.subject ?? null,
    body: input.body ?? null,
  };
}

async function send(request, callerEmail) {
  const input = request.data || {};
  const canSend = P.hasPerm(request, "out.send");
  if (!canSend && !P.hasPerm(request, "out.draft")) fail("permission-denied", "not_admin", "You don't have permission to send outreach email.");
  const settings = await store.getSettings();

  // ── Idempotency: a requestId that already produced a message returns it ──
  let messageRef;
  if (input.requestId != null) {
    if (!/^[A-Za-z0-9_-]{10,40}$/.test(String(input.requestId))) fail("invalid-argument", "bad_request_id", "Invalid requestId.");
    messageRef = db().doc(`outreachMessages/${input.requestId}`);
    const existing = await messageRef.get();
    if (existing.exists) {
      const m = existing.data();
      return { ok: m.status !== "failed", duplicate: true, messageId: messageRef.id, threadId: m.threadId, status: m.status, draft: m.status === "draft" };
    }
  } else {
    messageRef = db().collection("outreachMessages").doc();
  }

  // A manual reply's body is typed in the Inbox (the template picker only
  // inserts text there), so templates apply to new conversations only.
  const isReply = !!input.threadId;
  const req = draftRequest(input, isReply);
  const p = await prepareEmail({
    callerEmail, settings, messageRef,
    threadId: req.threadId,
    companyId: req.companyId, senderId: req.senderId, to: req.to,
    recipient: req.recipient,
    templateId: req.templateId, variantKey: req.variantKey,
    subject: req.subject, body: req.body,
    confirmOverTarget: !!input.confirmOverTarget,
  });

  if (!canSend) {
    // Written by someone who may not send: waits in To approve.
    await messageRef.set({
      threadId: p.isReply ? p.threadRef.id : null, companyId: p.companyId, companyName: p.company?.name || p.thread?.companyName || null,
      direction: "out", via: "portal", from: `${p.sender.displayName} <${p.senderId}>`, to: [p.to], cc: [],
      subject: p.subject, draftBody: p.bodyText, text: p.text, html: p.html, snippet: p.bodyText.slice(0, 500),
      templateId: p.templateId, variantKey: p.variantKey, senderId: p.senderId, source: "manual",
      redirectedFrom: p.redirectedFrom, isReply: p.isReply,
      recipient: p.isReply ? null : { email: p.redirectedFrom || p.to, name: p.contactName || "", kind: p.recipientKind, personal: !!p.personalAddress },
      request: req, writtenBy: callerEmail, writtenByKey: request.auth?.token?.key || null,
      status: "draft", events: [], attachments: [], isAutoReply: false, isTest: p.isTest,
      createdAt: FieldValue.serverTimestamp(), createdBy: callerEmail,
    });
    return { ok: true, draft: true, messageId: messageRef.id };
  }

  const res = await deliverEmail(p);
  return { ...res, sentBy: callerEmail, sentByOwner: request.auth?.token?.key || OWNER_BY_ADMIN[callerEmail] || null };
}

// A partner sends a manual draft: re-prepared as the approver (all checks
// again, their edits applied), sent as a new message; the draft records it.
async function approveDraft(request, callerEmail) {
  const { messageId, subject, body } = request.data || {};
  const draftRef = db().doc(`outreachMessages/${messageId || "_"}`);
  const draft = await db().runTransaction(async (tx) => {
    const s = await tx.get(draftRef);
    if (!s.exists || s.data().source !== "manual" || s.data().status !== "draft") fail("failed-precondition", "not_waiting", "This draft is no longer waiting.");
    tx.update(draftRef, { status: "approving", approvedBy: callerEmail, approvedAt: FieldValue.serverTimestamp() });
    return s.data();
  });
  try {
    const req = { ...draft.request };
    if (body != null) { if (!String(body).trim()) fail("invalid-argument", "bad_body", "The message can't be empty."); req.body = String(body); }
    if (subject != null && !req.threadId) { if (!String(subject).trim()) fail("invalid-argument", "bad_subject", "The subject can't be empty."); req.subject = String(subject); req.templateId = null; }
    if (body != null) req.templateId = null; // edited text replaces the template
    const settings = await store.getSettings();
    const sendRef = db().collection("outreachMessages").doc();
    const p = await prepareEmail({
      callerEmail, settings, messageRef: sendRef,
      threadId: req.threadId, companyId: req.companyId, senderId: req.senderId, to: req.to, recipient: req.recipient,
      templateId: req.templateId, variantKey: req.variantKey, subject: req.subject, body: req.body,
      confirmOverTarget: true,
    });
    const res = await deliverEmail(p);
    await sendRef.update({ writtenBy: draft.writtenBy, draftId: draftRef.id }).catch(() => {});
    // "draftSent", not "sent": the email itself is sendRef; this record only says it went out.
    await draftRef.update({ status: "draftSent", sentMessageId: sendRef.id, threadIdSent: res.threadId || null, edited: subject != null || body != null, lastError: null });
    return { ...res, sentBy: callerEmail, writtenBy: draft.writtenBy };
  } catch (e) {
    await draftRef.update({ status: "draft", lastError: e.message || String(e) }).catch(() => {});
    throw e;
  }
}

async function returnDraft(request, callerEmail) {
  const { messageId, note } = request.data || {};
  const ref = db().doc(`outreachMessages/${messageId || "_"}`);
  await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || s.data().source !== "manual" || s.data().status !== "draft") fail("failed-precondition", "not_waiting", "This draft is no longer waiting.");
    tx.update(ref, { status: "returned", returnedBy: callerEmail, returnedAt: FieldValue.serverTimestamp(), returnNote: String(note || "").trim().slice(0, 1000) });
  });
  return { ok: true };
}

exports.outreachSend = onCall({ region: REGION, secrets: [RESEND_SEND_KEY, RESEND_READ_KEY, UNSUBSCRIBE_SECRET] }, async (request) => {
  const callerEmail = normEmail(request.auth?.token?.email);
  const action = request.data?.action;
  if (action === "approveDraft" || action === "returnDraft") {
    if (!P.hasPerm(request, "out.approve")) fail("permission-denied", "not_admin", "You don't have permission to approve emails.");
    return action === "approveDraft" ? approveDraft(request, callerEmail) : returnDraft(request, callerEmail);
  }
  return send(request, callerEmail);
});
