// Outreach module — storing a received reply (webhook `email.received`).
//
// Path of a reply (verified 2026-09-23): prospect → ImprovMX alias
// (an.rocha@mail.douropartners-team.pt) → second destination
// an.rocha@<id>.resend.app → Resend → this code. The resend.app local part
// names the outreach address, so we know the sender even if a header is lost.

const { getStorage } = require("firebase-admin/storage");
const { logger } = require("firebase-functions");
const { RESEND_READ_KEY, MATCH_WINDOW_DAYS, MAX_ATTACHMENT_BYTES, MAX_INLINE_HTML_BYTES, RISKY_EXTENSIONS } = require("./config");
const {
  parseAddress, normEmail, domainOf, localOf, isFreeMail, headerValue, extractMessageIds,
  isAutoReply, looksLikeUnsubscribe, stripQuoted, htmlToText, sanitizeFilename, extensionOf,
} = require("./util");
const { getReceivedEmail, listReceivedAttachments } = require("./resend");
const store = require("./store");

const { db, FieldValue, Timestamp } = store;

async function findSenderByAlias(toList) {
  for (const raw of toList || []) {
    const addr = normEmail(raw);
    if (!domainOf(addr).endsWith(".resend.app")) continue;
    const snap = await db().collection("outreachSenders").where("inboundAlias", "==", localOf(addr)).limit(1).get();
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }
  return null;
}

// Thread matching, in order (spec §7.3).
async function matchThread({ refIds, fromEmail, senderId }) {
  // 1. Reply headers point at a Message-ID we sent or stored.
  if (refIds.length) {
    const snap = await db().collection("outreachThreads").where("rfcIds", "array-contains-any", refIds.slice(-10)).limit(1).get();
    if (!snap.empty) return { ref: snap.docs[0].ref, data: snap.docs[0].data(), rule: "headers" };
  }
  // 2. Same address we emailed from this sender in the last 90 days.
  if (fromEmail) {
    let q = db().collection("outreachThreads").where("contactEmail", "==", fromEmail);
    if (senderId) q = q.where("senderId", "==", senderId);
    const snap = await q.orderBy("lastMessageAt", "desc").limit(1).get();
    if (!snap.empty) {
      const t = snap.docs[0].data();
      const last = t.lastMessageAt?.toDate?.();
      if (!last || Date.now() - last.getTime() <= MATCH_WINDOW_DAYS * 86400000) {
        return { ref: snap.docs[0].ref, data: t, rule: "address" };
      }
    }
  }
  // 3. Someone else at a company we wrote to (never on free-mail domains).
  const domain = domainOf(fromEmail);
  if (domain && !isFreeMail(domain)) {
    const snap = await db().collection("outreachThreads").where("contactDomain", "==", domain).orderBy("lastMessageAt", "desc").limit(1).get();
    if (!snap.empty) return { ref: null, data: snap.docs[0].data(), rule: "domain" };
  }
  return null;
}

async function saveAttachments(emailId, threadId, messageId) {
  let list;
  try {
    ({ data: list } = await listReceivedAttachments(RESEND_READ_KEY.value(), emailId));
  } catch (e) {
    logger.warn("inbound: couldn't list attachments", { emailId, message: e.message });
    return [];
  }
  const bucket = getStorage().bucket();
  const out = [];
  for (const a of list?.data || []) {
    const filename = sanitizeFilename(a.filename);
    const meta = {
      filename, contentType: a.content_type || "application/octet-stream", size: a.size || null,
      inline: a.content_disposition === "inline", contentId: a.content_id || null,
      flagged: RISKY_EXTENSIONS.has(extensionOf(filename)), storagePath: null, skippedReason: null,
    };
    if (a.size && a.size > MAX_ATTACHMENT_BYTES) {
      meta.skippedReason = "too_large"; // stays in douropartners.team@gmail.com (spec §7.8)
    } else if (!a.download_url) {
      meta.skippedReason = "no_download_url";
    } else {
      try {
        const res = await fetch(a.download_url);
        if (!res.ok) throw new Error(`download ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_ATTACHMENT_BYTES) {
          meta.skippedReason = "too_large";
        } else {
          const path = `outreach/${threadId}/${messageId}/${a.id || ""}-${filename}`;
          await bucket.file(path).save(buf, { contentType: meta.contentType, resumable: false });
          meta.storagePath = path;
          meta.size = buf.length;
        }
      } catch (e) {
        meta.skippedReason = "download_failed";
        logger.warn("inbound: attachment download failed", { emailId, filename, message: e.message });
      }
    }
    out.push(meta);
  }
  return out;
}

async function handleReceived(data) {
  const emailId = data.email_id;
  if (!emailId) return;

  // Resend may deliver the same event twice; one message per received email.
  const dup = await db().collection("outreachMessages").where("resendId", "==", emailId).limit(1).get();
  if (!dup.empty) return;

  const [sender, settings, full] = await Promise.all([
    findSenderByAlias(data.to),
    store.getSettings(),
    getReceivedEmail(RESEND_READ_KEY.value(), emailId).then((r) => r.data),
  ]);
  const headers = full.headers || {};
  const fromHeader = headerValue(headers, "from") || full.from || data.from;
  const from = parseAddress(fromHeader);
  if (!from.email) from.email = normEmail(full.from || data.from);
  const subject = full.subject || data.subject || "";
  const rfcMessageId = full.message_id || data.message_id || null;
  const inReplyTo = headerValue(headers, "in-reply-to") || null;
  const references = headerValue(headers, "references") || null;
  const refIds = [...new Set([...extractMessageIds(references), ...extractMessageIds(inReplyTo)])];

  const text = full.text || htmlToText(full.html);
  const snippet = stripQuoted(text).slice(0, 2000);
  const autoReply = isAutoReply(headers, subject);

  const match = await matchThread({ refIds, fromEmail: from.email, senderId: sender?.id || null });

  let threadRef, thread;
  const now = FieldValue.serverTimestamp();
  if (match?.ref) {
    threadRef = match.ref;
    thread = match.data;
  } else {
    // Rule 3 (same company, new thread) or unmatched (manual assignment).
    threadRef = db().collection("outreachThreads").doc();
    thread = {
      companyId: match?.data?.companyId || null, companyName: match?.data?.companyName || null,
      contactEmail: from.email, contactDomain: domainOf(from.email), contactName: from.name || "",
      senderId: sender?.id || match?.data?.senderId || null,
      owner: sender?.owner || match?.data?.owner || null,
      subject, status: "open", unread: true, unmatched: !match,
      lastMessageAt: now, lastDirection: "in", rfcIds: [], lastInboundRfcId: null,
      templateId: null, variantKey: null, campaignId: null, firstTouchAt: null, repliedAt: null,
      responseCategory: null, isTest: match?.data?.isTest ?? !!settings.testMode,
      createdAt: now, createdBy: "resend-webhook",
    };
    await threadRef.set(thread);
  }

  const messageRef = db().collection("outreachMessages").doc();
  let html = full.html || null;
  let htmlStoragePath = null;
  if (html && Buffer.byteLength(html, "utf8") > MAX_INLINE_HTML_BYTES) {
    htmlStoragePath = `outreach/${threadRef.id}/${messageRef.id}/body.html`;
    await getStorage().bucket().file(htmlStoragePath).save(html, { contentType: "text/html; charset=utf-8", resumable: false });
    html = null;
  }
  const hasAttachments = (full.attachments && full.attachments.length) || (data.attachments && data.attachments.length);
  const attachments = hasAttachments ? await saveAttachments(emailId, threadRef.id, messageRef.id) : [];

  await messageRef.set({
    threadId: threadRef.id, companyId: thread.companyId || null, companyName: thread.companyName || null,
    direction: "in", via: "email", resendId: emailId, rfcMessageId,
    inReplyTo, references,
    from: fromHeader, to: data.to || [], cc: data.cc || [], deliveredTo: headerValue(headers, "to") || null,
    subject, text, html, htmlStoragePath, snippet,
    templateId: null, variantKey: null, senderId: thread.senderId || null, sentBy: null, source: "inbound",
    status: "received", events: [{ type: "received", at: Timestamp.now() }], attachments,
    isAutoReply: autoReply, suggestUnsubscribe: looksLikeUnsubscribe(snippet), matchRule: match?.rule || "none",
    isTest: !!thread.isTest, createdAt: now,
  });

  const threadUpd = {
    lastMessageAt: Timestamp.now(), lastDirection: "in", unread: true,
    ...(rfcMessageId ? { rfcIds: FieldValue.arrayUnion(rfcMessageId), lastInboundRfcId: rfcMessageId } : {}),
  };
  if (!autoReply) {
    threadUpd.status = "replied";
    if (!thread.repliedAt) threadUpd.repliedAt = Timestamp.now();
  }
  await threadRef.update(threadUpd);

  await store.writeActivity({
    companyId: thread.companyId, direction: "in", subject, content: snippet, threadId: threadRef.id,
    messageId: messageRef.id, contactName: from.name || null, contactEmail: from.email,
    createdBy: "resend-webhook", isTest: thread.isTest,
  });
  await store.touchCompany(thread.companyId, { direction: "in", isAutoReply: autoReply, isTest: thread.isTest });
  // Received mail costs quota but must not eat into a sender's send cap, so no senderId here.
  await store.bumpDaily("received", { owner: thread.owner });
}

module.exports = { handleReceived, matchThread };
