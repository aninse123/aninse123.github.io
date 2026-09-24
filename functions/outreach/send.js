// outreachSend — the one path every portal outreach email goes through
// (spec §6). Callable, so Firebase verifies the caller's ID token: sending
// requires a signed-in admin, not a shared secret, and we record who pressed
// Send.
//
// Request data:
//   new thread : { companyId, senderId, to?, templateId?, variantKey?, subject?, body?, confirmOverTarget?, requestId? }
//   reply      : { threadId, body, senderId?, confirmOverTarget?, requestId? }
// `to` defaults to the company's companyEmail (Phase 1 recipient, Q10).
// `requestId` (optional) becomes the message id, so a retried call is a no-op.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const {
  REGION, ADMIN_EMAILS, OWNER_BY_ADMIN, RESEND_SEND_KEY, UNSUBSCRIBE_SECRET,
  UNSUBSCRIBE_BASE_URL, DEFAULT_SENDER_CAP,
} = require("./config");
const { normEmail, domainOf, isFreeMail, isValidEmail, isTestRecipient, checkMx, makeUnsubToken, parseAddress } = require("./util");
const { buildContext, renderTemplate, buildPlainEmail, buildQuote, replySubject, TEST_FOOTER } = require("./render");
const { sendEmail, ResendError } = require("./resend");
const store = require("./store");

const { db, FieldValue, Timestamp } = store;

function fail(code, reason, message, extra = {}) {
  throw new HttpsError(code, message, { reason, ...extra });
}

exports.outreachSend = onCall({ region: REGION, secrets: [RESEND_SEND_KEY, UNSUBSCRIBE_SECRET] }, async (request) => {
  const callerEmail = normEmail(request.auth?.token?.email);
  if (!ADMIN_EMAILS.includes(callerEmail)) fail("permission-denied", "not_admin", "Only Douro admins can send outreach email.");

  const input = request.data || {};
  const isReply = !!input.threadId;
  const settings = await store.getSettings();
  const isTest = !!settings.testMode;

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
  const messageId = messageRef.id;

  // ── Thread (reply) or company (new) ──
  let thread = null, threadRef, company = null, companyId;
  if (isReply) {
    threadRef = db().doc(`outreachThreads/${input.threadId}`);
    const t = await threadRef.get();
    if (!t.exists) fail("not-found", "thread_not_found", "Thread not found.");
    thread = t.data();
    companyId = thread.companyId || null;
  } else {
    companyId = String(input.companyId || "") || null;
    // Test sends may skip the company (pure delivery tests); real ones never.
    if (!companyId && !isTest) fail("invalid-argument", "company_required", "Choose a company.");
    threadRef = db().collection("outreachThreads").doc();
  }
  if (companyId) {
    const c = await db().doc(`searchCompanies/${companyId}`).get();
    if (!c.exists) fail("not-found", "company_not_found", "Company not found.");
    company = c.data();
  }

  // ── Sender ──
  const senderId = normEmail(input.senderId || thread?.senderId);
  if (!senderId) fail("invalid-argument", "sender_required", "Choose a sender address.");
  const senderSnap = await db().doc(`outreachSenders/${senderId}`).get();
  if (!senderSnap.exists) fail("not-found", "sender_not_found", `Sender ${senderId} is not registered.`);
  const sender = senderSnap.data();
  // New outreach needs an active address (warm-up stopped + Resend forward in
  // place, spec §3.1). A reply may still go out from a paused one.
  if (!isReply && sender.status !== "active") fail("failed-precondition", "sender_not_active", `${senderId} is ${sender.status} — only active addresses can start new outreach.`);
  if (isReply && ["warming", "retired"].includes(sender.status)) fail("failed-precondition", "sender_not_usable", `${senderId} is ${sender.status}.`);

  // ── Recipient checks ──
  const to = normEmail(isReply ? thread.contactEmail : (input.to || company?.companyEmail));
  if (!isValidEmail(to)) fail("invalid-argument", "bad_recipient", to ? `"${to}" is not a valid email address.` : "This company has no email address.");
  const toDomain = domainOf(to);
  const testAllowed = isTestRecipient(to, settings.testRecipients);
  if (isTest && !testAllowed) fail("failed-precondition", "test_mode", `Test mode is on: only approved test addresses can receive email (not ${to}).`);

  const suppressed = await store.findSuppression(to);
  if (suppressed) fail("failed-precondition", "suppressed", `${to} is on the suppression list (${suppressed.reason}).`);

  if (settings.blockPersonalDomains && isFreeMail(toDomain) && !testAllowed) {
    fail("failed-precondition", "personal_domain", `${toDomain} is a personal email domain — blocked while personal domains are off (legal rule for natural persons).`);
  }

  const mx = await checkMx(toDomain);
  if (!mx.ok) {
    if (mx.reason === "no_mx") fail("failed-precondition", "no_mx", `${toDomain} can't receive email (no mail servers found).`);
    fail("unavailable", "dns_error", `Couldn't check ${toDomain}'s mail servers — try again in a moment.`);
  }

  // ── Budget (spec §7.6): per-address cap for new outreach; soft account target ──
  const [usage, daily] = await Promise.all([store.getTodayUsage(), store.getTodayDaily()]);
  const cap = sender.dailyCap || DEFAULT_SENDER_CAP;
  const sentFromSender = daily.bySender?.[store.senderKey(senderId)] || 0;
  if (!isReply && sentFromSender >= cap) fail("resource-exhausted", "sender_cap", `${senderId} already sent ${sentFromSender} today (limit ${cap}). Use another address.`);
  const used = usage.resendDailyUsed ?? 0;
  if (used >= settings.dailyTarget && !input.confirmOverTarget) {
    fail("failed-precondition", "over_target", `The Resend account has already sent/received ${used} emails today (target ${settings.dailyTarget}). Confirm to send anyway.`, { used, target: settings.dailyTarget });
  }

  // ── Content ──
  const unsubscribeUrl = UNSUBSCRIBE_BASE_URL + makeUnsubToken(messageId, UNSUBSCRIBE_SECRET.value());
  const ctx = buildContext({ company: company || {}, contactName: "", sender, unsubscribeUrl });

  let subjectSrc, bodySrc, templateId = null, variantKey = null;
  if (isReply) {
    subjectSrc = replySubject(thread.subject);
    bodySrc = input.body;
  } else if (input.templateId) {
    const tSnap = await db().doc(`outreachTemplates/${input.templateId}`).get();
    if (!tSnap.exists) fail("not-found", "template_not_found", "Template not found.");
    const variants = tSnap.data().variants || [];
    const variant = variants.find((v) => v.key === input.variantKey) || variants[0];
    if (!variant) fail("failed-precondition", "template_empty", "This template has no variants.");
    templateId = tSnap.id;
    variantKey = variant.key;
    subjectSrc = input.subject || variant.subject;
    bodySrc = input.body || variant.body;
  } else {
    subjectSrc = input.subject;
    bodySrc = input.body;
  }
  if (!String(subjectSrc || "").trim() || !String(bodySrc || "").trim()) fail("invalid-argument", "content_required", "Subject and message are required.");

  const subject = renderTemplate(subjectSrc, ctx);
  const body = renderTemplate(bodySrc, ctx);
  const missing = [...new Set([...subject.missing, ...body.missing])];
  if (missing.length) fail("invalid-argument", "missing_variables", `These fields are empty for this company: ${missing.join(", ")}. Add a fallback, e.g. {{${missing[0]}|…}}.`, { missing });

  let footerSrc = null;
  if (settings.complianceBlockId) {
    const cSnap = await db().doc(`outreachCompliance/${settings.complianceBlockId}`).get();
    if (cSnap.exists) footerSrc = [cSnap.data().legalEntityLine, cSnap.data().footerText].filter(Boolean).join("\n");
  }
  if (!footerSrc) {
    if (!isTest) fail("failed-precondition", "compliance_missing", "The legal footer isn't configured yet — required before sending to real companies.");
    footerSrc = TEST_FOOTER;
  }
  const footer = renderTemplate(footerSrc, ctx).text;

  // A reply quotes the last message in the thread (normally the prospect's),
  // so the context survives forwarding and clients that don't group threads.
  let quote = null;
  if (isReply) {
    const prev = await db().collection("outreachMessages").where("threadId", "==", threadRef.id).orderBy("createdAt", "asc").get();
    const last = prev.docs.map((d) => d.data()).filter((m) => m.status !== "failed" && (m.text || m.snippet)).pop();
    if (last) {
      const who = last.direction === "in" ? parseAddress(last.from) : { name: sender.displayName, email: senderId };
      // Our own earlier emails are quoted without their legal footer.
      const prevText = last.direction === "in" ? (last.text || last.snippet) : String(last.text || "").split(/\n--\n/)[0];
      quote = buildQuote({ date: last.createdAt?.toDate?.() || new Date(), fromName: who.name, fromEmail: who.email, text: prevText });
    }
  }
  const { text, html } = buildPlainEmail({ bodyText: body.text, signature: sender.signature, footerText: footer, unsubscribeUrl, quote });

  // ── Headers: threading on replies, one-click unsubscribe ──
  // No custom Message-ID: Resend silently replaces it with its own (V1,
  // 2026-09-24). The real ID arrives with the delivery webhook, which stores it
  // on the message and the thread so replies still match by header.
  const headers = {
    "List-Unsubscribe": `<${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
  if (isReply) {
    const chain = (thread.rfcIds || []).slice(-10);
    const lastInbound = thread.lastInboundRfcId || chain[chain.length - 1];
    if (lastInbound) headers["In-Reply-To"] = lastInbound;
    if (chain.length) headers["References"] = chain.join(" ");
  }

  // ── Write queued state first, so a crash mid-send leaves a visible record ──
  const owner = sender.owner || null;
  const now = FieldValue.serverTimestamp();
  const batch = db().batch();
  if (!isReply) {
    batch.set(threadRef, {
      companyId, companyName: company?.name || null, contactEmail: to, contactDomain: toDomain, contactName: "",
      senderId, owner, subject: subject.text, status: "open", unread: false, unmatched: false,
      lastMessageAt: now, lastDirection: "out", rfcIds: [], lastInboundRfcId: null,
      templateId, variantKey, campaignId: null, firstTouchAt: now, repliedAt: null,
      responseCategory: null, isTest, createdAt: now, createdBy: callerEmail,
    });
  }
  batch.set(messageRef, {
    threadId: threadRef.id, companyId, companyName: company?.name || thread?.companyName || null,
    direction: "out", via: "portal", resendId: null, rfcMessageId: null,
    inReplyTo: headers["In-Reply-To"] || null, references: headers["References"] || null,
    from: `${sender.displayName} <${senderId}>`, to: [to], cc: [],
    subject: subject.text, text, html, snippet: body.text.slice(0, 500),
    templateId, variantKey, senderId, sentBy: callerEmail, source: "manual",
    status: "queued", events: [], attachments: [], isAutoReply: false, isTest, createdAt: now,
  });
  await batch.commit();

  // ── Send ──
  let result;
  try {
    result = await sendEmail(RESEND_SEND_KEY.value(), {
      from: `${sender.displayName} <${senderId}>`,
      to: [to],
      subject: subject.text,
      text,
      html,
      headers,
      tags: [{ name: "om", value: messageId }],
    }, messageId);
  } catch (e) {
    const quotaHit = e instanceof ResendError && e.resendName === "daily_quota_exceeded";
    await messageRef.update({ status: "failed", error: e.message, events: FieldValue.arrayUnion({ type: "failed", at: Timestamp.now(), detail: e.resendName || null }) });
    if (!isReply) await threadRef.update({ status: "failed" });
    if (e instanceof ResendError) await store.recordQuota(e.quota, "send");
    logger.error("outreachSend: Resend refused", { messageId, status: e.status, name: e.resendName, message: e.message });
    if (quotaHit) fail("resource-exhausted", "daily_quota_exceeded", "Resend's daily quota is used up — the email wasn't sent. It can be sent again after 00:00 UTC.");
    fail("internal", "resend_error", `Resend refused the email: ${e.message}`);
  }

  // ── Record success ──
  const resendId = result.data?.id || null;
  const sentAt = Timestamp.now();
  await messageRef.update({
    status: "sent", resendId, sentAt, events: FieldValue.arrayUnion({ type: "sent", at: sentAt }),
  });
  await threadRef.update({
    lastMessageAt: sentAt, lastDirection: "out",
    status: isReply ? "waiting" : "open",
    ...(isReply ? { unread: false } : {}),
  });
  await store.writeActivity({
    companyId, direction: "out", subject: subject.text, content: body.text, threadId: threadRef.id,
    messageId, contactEmail: to, createdBy: callerEmail, isTest,
  });
  await store.touchCompany(companyId, { direction: "out", isTest });
  await store.bumpDaily(isReply ? "repliesSent" : "outreachSent", { senderId, owner });
  await store.recordQuota(result.quota, "send");

  const warnings = [];
  const after = result.quota?.daily;
  if (after != null && after >= settings.dailyTarget) warnings.push(`The account is at ${after}/${settings.dailyTarget} emails today.`);

  return {
    ok: true, messageId, threadId: threadRef.id, resendId,
    usage: { daily: result.quota?.daily ?? null, monthly: result.quota?.monthly ?? null },
    sentBy: callerEmail, sentByOwner: OWNER_BY_ADMIN[callerEmail] || null, isTest, warnings,
  };
});
