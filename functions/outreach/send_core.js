// Outreach — the one send path, shared by the outreachSend callable (manual
// sends and replies) and the campaign scheduler (Phase 2). Split in two so a
// campaign step that needs approval can stop after rendering:
//
//   prepareEmail(opts) → every check (sender, recipient, test mode,
//                        suppression, personal domain, MX, caps, target) and
//                        the fully rendered email. Writes nothing.
//   deliverEmail(p)    → records it as queued, sends through Resend, records
//                        the result (message, thread, activity, company, usage).
//   saveDraft(p)       → stores the rendered email as a draft message for the
//                        "To approve" queue (Phase 2 spec §5.3).
//
// Checks fail with HttpsError(code, message, { reason }) — the callable passes
// them to the browser; the scheduler decides per reason what to do.

const { HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { RESEND_SEND_KEY, RESEND_READ_KEY, UNSUBSCRIBE_SECRET, UNSUBSCRIBE_BASE_URL, DEFAULT_SENDER_CAP, SENDER_DOMAIN } = require("./config");
const { normEmail, domainOf, isFreeMail, isValidEmail, isTestRecipient, checkMx, makeUnsubToken, parseAddress } = require("./util");
const { buildContext, renderTemplate, buildPlainEmail, buildQuote, replySubject, TEST_FOOTER } = require("./render");
const { sendEmail, ResendError } = require("./resend");
const store = require("./store");
const { companyRecipients } = require("./recipients");

const { db, FieldValue, Timestamp } = store;

function fail(code, reason, message, extra = {}) {
  throw new HttpsError(code, message, { reason, ...extra });
}

// opts:
//   callerEmail, settings, messageRef
//   threadId                 → reply in that conversation; otherwise a new one
//   companyId, senderId, to  → new conversation (`to` defaults to companyEmail)
//   templateId, variantKey   → content from a template variant (new or reply)
//   subject, body            → explicit content (overrides the template)
//   confirmOverTarget        → send even above the account's daily target
//   countsAsOutreach         → apply the per-address cap (default: new conversations);
//                              campaign follow-ups set it although they are replies
//   redirectTo               → test mode only: campaign emails go to this approved
//                              address instead of the company (C10 rehearsal)
//   person                   → Phase 5: { email, name, org, refs } — a person, not a company
//                              (investor, broker, journalist…). No company; {{company.*}} uses
//                              the organisation; logged on the person's CRM / Network record.
//   recipient                → Phase 3b: { email } of the person to write to (the company
//                              address, a contact or a linked person). Checked against the
//                              company's own list; fills {{contact.firstName}}. In test mode
//                              the email still goes to the test address (`to` / redirectTo).
async function prepareEmail(opts) {
  const { callerEmail, settings, messageRef } = opts;
  const isReply = !!opts.threadId;
  const isTest = !!settings.testMode;
  const messageId = messageRef.id;
  const countsAsOutreach = opts.countsAsOutreach ?? !isReply;

  // ── Thread (reply) or company (new) ──
  let thread = null, threadRef, company = null, companyId;
  if (isReply) {
    threadRef = db().doc(`outreachThreads/${opts.threadId}`);
    const t = await threadRef.get();
    if (!t.exists) fail("not-found", "thread_not_found", "Thread not found.");
    thread = t.data();
    companyId = thread.companyId || null;
  } else {
    companyId = opts.person ? null : (String(opts.companyId || "") || null);
    // Test sends may skip the company (pure delivery tests); real ones never —
    // unless the email is to a person (Phase 5).
    if (!companyId && !isTest && !opts.person) fail("invalid-argument", "company_required", "Choose a company.");
    threadRef = db().collection("outreachThreads").doc();
  }
  if (companyId) {
    const c = await db().doc(`searchCompanies/${companyId}`).get();
    if (!c.exists) fail("not-found", "company_not_found", "Company not found.");
    company = c.data();
    // Phase 2 §10: a company marked "do not contact" gets no new outreach.
    // A reply you type in an existing conversation is still allowed (they wrote
    // to us); campaign follow-ups count as outreach and are blocked.
    if (company.doNotContact?.on && countsAsOutreach) fail("failed-precondition", "do_not_contact", `${company.name || "This company"} is marked do not contact${company.doNotContact.reason ? ` (${company.doNotContact.reason})` : ""}.`);
  }

  // ── Sender ──
  const senderId = normEmail(opts.senderId || thread?.senderId);
  if (!senderId) fail("invalid-argument", "sender_required", "Choose a sender address.");
  const senderSnap = await db().doc(`outreachSenders/${senderId}`).get();
  if (!senderSnap.exists) fail("not-found", "sender_not_found", `Sender ${senderId} is not registered.`);
  const sender = senderSnap.data();
  // New outreach needs an active address (warm-up stopped + Resend forward in
  // place, spec §3.1). A reply may still go out from a paused one.
  if (countsAsOutreach && sender.status !== "active") fail("failed-precondition", "sender_not_active", `${senderId} is ${sender.status} — only active addresses can start new outreach.`);
  if (["warming", "retired"].includes(sender.status)) fail("failed-precondition", "sender_not_usable", `${senderId} is ${sender.status}.`);

  // ── Who (Phase 3b): the chosen recipient must be the company's address,
  // one of its contacts or a person linked to it — so the personal-domain
  // rule can't be skipped by labelling any address a "contact".
  let recipient = null;
  if (!isReply && opts.recipient?.email && company) {
    const want = normEmail(opts.recipient.email);
    recipient = (await companyRecipients(companyId, company)).find((r) => r.email === want) || null;
    if (!recipient) fail("invalid-argument", "recipient_not_found", `${want} isn't this company's address, one of its contacts or a person linked to it.`);
  }
  const person = !isReply && opts.person?.email ? { email: normEmail(opts.person.email), name: String(opts.person.name || ""), org: String(opts.person.org || ""), refs: Array.isArray(opts.person.refs) ? opts.person.refs.slice(0, 10) : [] } : null;
  const contactName = isReply ? (thread.contactName || "") : person ? person.name : (recipient?.kind !== "company" ? (recipient?.name || "") : "");

  // ── Recipient checks ──
  const redirect = isTest && opts.redirectTo ? normEmail(opts.redirectTo) : null;
  const intended = normEmail(isReply ? thread.contactEmail : person ? person.email : (recipient ? recipient.email : (opts.to || company?.companyEmail)));
  // Test mode: the email goes to the approved test address; the intended
  // recipient is only used for the wording and recorded as redirectedFrom.
  const to = normEmail(isReply ? thread.contactEmail : (redirect || (isTest && (recipient || person) ? (opts.to || intended) : intended)));
  if (!isValidEmail(to)) fail("invalid-argument", "bad_recipient", to ? `"${to}" is not a valid email address.` : "This company has no email address.");
  const toDomain = domainOf(to);
  const testAllowed = isTestRecipient(to, settings.testRecipients);
  if (isTest && !testAllowed) fail("failed-precondition", "test_mode", `Test mode is on: only approved test addresses can receive email (not ${to}).`);

  const suppressed = await store.findSuppression(to);
  if (suppressed) fail("failed-precondition", "suppressed", `${to} is on the suppression list (${suppressed.reason}).`);

  // Person-level recipients may use any address (André, 2026-09-26: R3 — flag
  // recorded for CCSL); the company address keeps the personal-domain setting.
  // A reply keeps the conversation's recipient kind; a reply you type (not a
  // campaign follow-up) answers someone who wrote to us, so it isn't blocked.
  const personLevel = person ? true : recipient ? recipient.kind !== "company"
    : isReply && (["contact", "person", "people"].includes(thread.recipientKind) || !countsAsOutreach);
  const personalAddress = isFreeMail(domainOf(intended));
  if (settings.blockPersonalDomains && isFreeMail(toDomain) && !testAllowed && !personLevel) {
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
  if (countsAsOutreach && sentFromSender >= cap) fail("resource-exhausted", "sender_cap", `${senderId} already sent ${sentFromSender} today (limit ${cap}). Use another address.`);
  // Resend's last reported count + portal activity since (received replies included).
  const used = (usage.resendDailyUsed ?? 0) + Math.max(0, (daily.total || 0) - (usage.portalTotalAtReading || 0));
  if (used >= settings.dailyTarget && !opts.confirmOverTarget) {
    fail("failed-precondition", "over_target", `The Resend account has already sent/received ${used} emails today (target ${settings.dailyTarget}). Confirm to send anyway.`, { used, target: settings.dailyTarget });
  }

  // ── Content ──
  const unsubscribeUrl = UNSUBSCRIBE_BASE_URL + makeUnsubToken(messageId, UNSUBSCRIBE_SECRET.value());
  // A person's organisation stands in for the company in {{company.*}}.
  const ctxCompany = company || (person ? { name: person.org, emailName: person.org } : (isReply && thread.companyName ? { name: thread.companyName } : {}));
  const ctx = buildContext({ company: ctxCompany, contactName, sender, unsubscribeUrl, aiOpener: opts.aiOpener || "" });

  let subjectSrc = opts.subject, bodySrc = opts.body, templateId = null, variantKey = null;
  if (opts.templateId) {
    const tSnap = await db().doc(`outreachTemplates/${opts.templateId}`).get();
    if (!tSnap.exists) fail("not-found", "template_not_found", "Template not found.");
    const variants = tSnap.data().variants || [];
    const variant = variants.find((v) => v.key === opts.variantKey) || variants[0];
    if (!variant) fail("failed-precondition", "template_empty", "This template has no variants.");
    templateId = tSnap.id;
    variantKey = variant.key;
    if (!isReply) subjectSrc = opts.subject || variant.subject;
    bodySrc = opts.body || variant.body;
  }
  // A reply keeps the conversation's subject ("Re: …").
  if (isReply) subjectSrc = replySubject(thread.subject);
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

  // A reply quotes the last message in the thread (normally the prospect's;
  // for a campaign follow-up, our previous email), so the context survives
  // forwarding and clients that don't group threads.
  let quote = null;
  if (isReply) {
    const prev = await db().collection("outreachMessages").where("threadId", "==", threadRef.id).orderBy("createdAt", "asc").get();
    const last = prev.docs.map((d) => d.data()).filter((m) => !["failed", "draft"].includes(m.status) && (m.text || m.snippet)).pop();
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

  return {
    callerEmail, settings, isReply, isTest, messageRef, messageId, threadRef, thread, companyId, company,
    senderId, sender, to, toDomain, subject: subject.text, bodyText: body.text, text, html, headers,
    templateId, variantKey, countsAsOutreach,
    redirectedFrom: isTest && intended && intended !== to ? intended : null,
    contactName, recipientKind: isReply ? (thread.recipientKind || null) : person ? "people" : (recipient?.kind || "company"),
    person,
    recipientPersonId: recipient?.personId || null, personalAddress: !isReply && personalAddress,
  };
}

// campaign: { campaignId, enrolmentId, stepId } for scheduler sends (null for manual).
async function deliverEmail(p, { campaign = null } = {}) {
  const { isReply, isTest, messageRef, messageId, threadRef, thread, companyId, company, senderId, sender, to, toDomain, headers } = p;
  const owner = sender.owner || null;
  const source = campaign ? "campaign" : "manual";
  const now = FieldValue.serverTimestamp();

  // ── Write queued state first, so a crash mid-send leaves a visible record ──
  const batch = db().batch();
  if (!isReply) {
    batch.set(threadRef, {
      companyId, companyName: company?.name || p.person?.org || null, contactEmail: to, contactDomain: toDomain, contactName: p.contactName || "",
      personRefs: p.person?.refs || null, personEmail: p.person?.email || null,
      recipientKind: p.recipientKind, recipientPersonId: p.recipientPersonId, personalAddress: !!p.personalAddress,
      senderId, owner, subject: p.subject, status: "open", unread: false, unmatched: false,
      lastMessageAt: now, lastDirection: "out", rfcIds: [], lastInboundRfcId: null,
      templateId: p.templateId, variantKey: p.variantKey,
      campaignId: campaign?.campaignId || null, enrolmentId: campaign?.enrolmentId || null,
      firstTouchAt: now, repliedAt: null,
      responseCategory: null, isTest, createdAt: now, createdBy: p.callerEmail,
    });
  }
  batch.set(messageRef, {
    threadId: threadRef.id, companyId, companyName: company?.name || thread?.companyName || null,
    direction: "out", via: "portal", resendId: null, rfcMessageId: null,
    inReplyTo: headers["In-Reply-To"] || null, references: headers["References"] || null,
    from: `${sender.displayName} <${senderId}>`, to: [to], cc: [],
    subject: p.subject, text: p.text, html: p.html, snippet: p.bodyText.slice(0, 500),
    templateId: p.templateId, variantKey: p.variantKey, senderId, sentBy: p.callerEmail, source,
    campaignId: campaign?.campaignId || null, enrolmentId: campaign?.enrolmentId || null, stepId: campaign?.stepId || null,
    redirectedFrom: p.redirectedFrom, approvedBy: campaign?.approvedBy || null,
    recipientKind: p.recipientKind, personalAddress: !!p.personalAddress,
    status: "queued", events: [], attachments: [], isAutoReply: false, isTest, createdAt: now,
  });
  await batch.commit();

  // ── Send ──
  let result;
  try {
    // The sending key only covers the outreach subdomain; @douropartners.pt
    // (relationship senders, Phase 5) goes out with the full-access key.
    const sendKey = sender.kind === "relationship" || domainOf(senderId) !== SENDER_DOMAIN ? RESEND_READ_KEY.value() : RESEND_SEND_KEY.value();
    result = await sendEmail(sendKey, {
      from: `${sender.displayName} <${senderId}>`,
      to: [to],
      subject: p.subject,
      text: p.text,
      html: p.html,
      headers,
      tags: [{ name: "om", value: messageId }],
    }, messageId);
  } catch (e) {
    const quotaHit = e instanceof ResendError && e.resendName === "daily_quota_exceeded";
    await messageRef.update({ status: "failed", error: e.message, events: FieldValue.arrayUnion({ type: "failed", at: Timestamp.now(), detail: e.resendName || null }) });
    if (!isReply) await threadRef.update({ status: "failed" });
    if (e instanceof ResendError) await store.recordQuota(e.quota, "send");
    logger.error("outreach send: Resend refused", { messageId, source, status: e.status, name: e.resendName, message: e.message });
    if (quotaHit) fail("resource-exhausted", "daily_quota_exceeded", "Resend's daily quota is used up — the email wasn't sent. It can be sent again after 00:00 UTC.");
    fail("internal", "resend_error", `Resend refused the email: ${e.message}`);
  }

  // ── Record success ──
  const resendId = result.data?.id || null;
  const sentAt = Timestamp.now();
  // The webhook may already have recorded delivered/bounced for this message
  // (Resend's events can beat this line); only a still-queued message becomes "sent".
  await db().runTransaction(async (tx) => {
    const cur = (await tx.get(messageRef)).data() || {};
    tx.update(messageRef, {
      resendId, sentAt, events: FieldValue.arrayUnion({ type: "sent", at: sentAt }),
      ...(cur.status === "queued" ? { status: "sent" } : {}),
    });
  });
  // A campaign follow-up is a reply in the thread, but we're still waiting
  // for the prospect — it doesn't close an unread inbound message.
  await threadRef.update({
    lastMessageAt: sentAt, lastDirection: "out",
    status: isReply && !campaign ? "waiting" : "open",
    ...(isReply && !campaign ? { unread: false } : {}),
  });
  await store.writeActivity({
    companyId, direction: "out", subject: p.subject, content: p.bodyText, threadId: threadRef.id,
    messageId, contactEmail: to, createdBy: p.callerEmail, isTest,
    campaignId: campaign?.campaignId, stepId: campaign?.stepId, enrolmentId: campaign?.enrolmentId,
  });
  await store.touchCompany(companyId, { direction: "out", isTest });
  if (p.person) await store.logPersonSend({ refs: p.person.refs, email: p.person.email, subject: p.subject, content: p.bodyText, messageId, threadId: threadRef.id, campaignId: campaign?.campaignId || null, createdBy: p.callerEmail, isTest });
  await store.bumpDaily(p.countsAsOutreach ? "outreachSent" : "repliesSent", { senderId, owner, extra: campaign ? ["campaignSent"] : [] });
  await store.recordQuota(result.quota, "send");

  const warnings = [];
  const after = result.quota?.daily;
  if (after != null && after >= p.settings.dailyTarget) warnings.push(`The account is at ${after}/${p.settings.dailyTarget} emails today.`);

  return {
    ok: true, messageId, threadId: threadRef.id, resendId,
    usage: { daily: result.quota?.daily ?? null, monthly: result.quota?.monthly ?? null },
    isTest, warnings,
  };
}

// The rendered email waits in "To approve"; approving re-runs prepareEmail
// with the draft's subject/body on the same message id (so every check runs
// again at send time) and then deliverEmail.
async function saveDraft(p, { campaign }) {
  await p.messageRef.set({
    threadId: p.isReply ? p.threadRef.id : null, companyId: p.companyId, companyName: p.company?.name || null,
    direction: "out", via: "portal", from: `${p.sender.displayName} <${p.senderId}>`, to: [p.to], cc: [],
    subject: p.subject, draftBody: p.bodyText, text: p.text, html: p.html, snippet: p.bodyText.slice(0, 500),
    templateId: p.templateId, variantKey: p.variantKey, senderId: p.senderId, source: "campaign",
    campaignId: campaign.campaignId, enrolmentId: campaign.enrolmentId, stepId: campaign.stepId,
    redirectedFrom: p.redirectedFrom, isReply: p.isReply,
    recipient: p.isReply ? null : { email: p.redirectedFrom || p.to, name: p.contactName || "", kind: p.recipientKind, personal: !!p.personalAddress },
    status: "draft", events: [], attachments: [], isAutoReply: false, isTest: p.isTest,
    createdAt: FieldValue.serverTimestamp(), createdBy: p.callerEmail,
  });
  return { messageId: p.messageId };
}

module.exports = { prepareEmail, deliverEmail, saveDraft, fail };
