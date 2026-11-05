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
//   reply      : { threadId, body, senderId?, replyTo?: [email], replyCc?: [email], confirmOverTarget?, requestId? }
//                (replyTo / replyCc, 12 Oct: Reply / Reply all / edited recipients; without them
//                 the reply goes to the conversation's address)
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
const { REGION, RESEND_SEND_KEY, RESEND_READ_KEY, UNSUBSCRIBE_SECRET, orgName } = require("./config");
const { normEmail } = require("./util");
const { prepareEmail, deliverEmail, fail } = require("./send_core");
const Files = require("./files"); // 3 Nov: attachments
const Invites = require("./invites"); // 5 Nov: calendar invites as objects (update / cancel / answers)
const store = require("./store");
const Usage = require("../usage"); // Team & access → Usage (best-effort counters)

const { db, FieldValue, Timestamp } = store;
const { sendEmail } = require("./resend");

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
    signatureName: typeof input.signatureName === "string" ? input.signatureName.slice(0, 60) : null,
    footer: typeof input.footer === "boolean" ? input.footer : null, // CCSL: optional footer
    replyTo: isReply && Array.isArray(input.replyTo) ? input.replyTo.slice(0, 20).map(String) : null,
    replyCc: isReply && Array.isArray(input.replyCc) ? input.replyCc.slice(0, 20).map(String) : null,
    // 19 Oct (one inbox): "Stop the campaign for this company", ticked by default on a manual reply.
    stopCampaign: isReply && input.stopCampaign === true,
    attachments: Array.isArray(input.attachments) ? input.attachments.slice(0, 10).map(String) : null, // 3 Nov: ids of files in outreachFiles
  };
}

async function send(request, callerEmail) {
  const input = request.data || {};
  // asDraft: the page asks for a draft (a writer, or a partner previewing a
  // writer's role) — saved for approval even if the caller may send.
  const canSend = P.hasPerm(request, "out.send") && !input.asDraft;
  if (!canSend && !P.hasPerm(request, "out.draft") && !P.hasPerm(request, "out.send")) fail("permission-denied", "not_admin", "You don't have permission to send outreach email.");
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
    subject: req.subject, body: req.body, signatureName: req.signatureName, footer: req.footer,
    replyTo: req.replyTo, replyCc: req.replyCc,
    confirmOverTarget: !!input.confirmOverTarget,
    attachments: req.attachments,
  });

  if (!canSend) {
    // Written by someone who may not send: waits in To approve.
    await messageRef.set({
      threadId: p.isReply ? p.threadRef.id : null, companyId: p.companyId, companyName: p.company?.name || p.thread?.companyName || null,
      direction: "out", via: "portal", from: `${p.sender.displayName} <${p.senderId}>`, to: p.toList || [p.to], cc: p.ccList || [],
      subject: p.subject, draftBody: p.bodyText, text: p.text, html: p.html, snippet: p.bodyText.slice(0, 500),
      templateId: p.templateId, variantKey: p.variantKey, senderId: p.senderId, source: "manual",
      redirectedFrom: p.redirectedFrom, isReply: p.isReply,
      recipient: p.isReply ? null : { email: p.redirectedFrom || p.to, name: p.contactName || "", kind: p.recipientKind, personal: !!p.personalAddress },
      request: req, writtenBy: callerEmail, writtenByKey: request.auth?.token?.key || null,
      status: "draft", events: [], attachments: Files.describe(p.attachments), isAutoReply: false, isTest: p.isTest,
      createdAt: FieldValue.serverTimestamp(), createdBy: callerEmail,
    });
    await Usage.countPerson("email.written", callerEmail);
    return { ok: true, draft: true, messageId: messageRef.id };
  }

  const res = await deliverEmail(p);
  await Invites.registerSent({ p, res, callerEmail }); // 5 Nov: an invite in this email is registered (best effort)
  const stoppedCampaigns = await stopAfterReply(request, req, p, callerEmail);
  await P.loadIdentity();
  return { ...res, stoppedCampaigns, sentBy: callerEmail, sentByOwner: request.auth?.token?.key || P.keyOf(callerEmail) || null };
}

// 19 Oct (one inbox, 1-manual): a reply written by hand can stop the
// company's running campaign, like a reply from them does — so a follow-up
// doesn't go to geral@ after the conversation moved to a person.
async function stopAfterReply(request, req, p, callerEmail) {
  if (!req.stopCampaign || !p.isReply || !p.thread?.companyId) return 0;
  if (!(await Feat.isOnFor(request, "outreach.oneInbox"))) return 0;
  const { stopCompanyEnrolments } = require("./campaigns");
  return stopCompanyEnrolments(p.thread.companyId, `Stopped: ${callerEmail} replied by hand`);
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
      templateId: req.templateId, variantKey: req.variantKey, subject: req.subject, body: req.body, signatureName: req.signatureName || null,
      footer: req.footer ?? null, replyTo: req.replyTo || null, replyCc: req.replyCc || null, confirmOverTarget: true,
      attachments: req.attachments || null, // 3 Nov
    });
    const res = await deliverEmail(p);
    await Invites.registerSent({ p, res, callerEmail });
    const stoppedCampaigns = await stopAfterReply(request, req, p, draft.writtenBy || callerEmail).catch(() => 0);
    await sendRef.update({ writtenBy: draft.writtenBy, draftId: draftRef.id }).catch(() => {});
    // "draftSent", not "sent": the email itself is sendRef; this record only says it went out.
    await draftRef.update({ status: "draftSent", sentMessageId: sendRef.id, threadIdSent: res.threadId || null, edited: subject != null || body != null, lastError: null });
    await Usage.countPerson("email.approved", callerEmail);
    return { ...res, stoppedCampaigns, sentBy: callerEmail, writtenBy: draft.writtenBy };
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

// I15 (8 Oct): forward a conversation to a team member (or yourself) — the
// whole conversation as plain text with a note on top. Internal only: the
// address must be a team member's (Team directory) or the caller's own; in
// test mode an approved test address too. Sent from the conversation's own
// outreach address; the conversation records who forwarded it to whom.
const NOT_SENT = ["draft", "approved", "approving", "cancelled", "returned", "draftSent"];
async function forwardThread(request, callerEmail) {
  const { threadId, to, note, includeFiles } = request.data || {};
  const want = normEmail(to);
  if (!threadId || typeof threadId !== "string") fail("invalid-argument", "thread_required", "Choose a conversation.");
  const ref = db().doc(`outreachThreads/${threadId}`);
  const snap = await ref.get();
  if (!snap.exists) fail("not-found", "thread_not_found", "Conversation not found.");
  const th = snap.data();
  const settings = await store.getSettings();
  const team = (await db().collection("teamDirectory").get()).docs.flatMap((d) => [d.data().contactEmail, d.data().email]).map(normEmail).filter(Boolean);
  const allowed = new Set([callerEmail, ...team, ...(settings.testMode ? (settings.testRecipients || []).map(normEmail) : [])]);
  if (!want || !allowed.has(want)) fail("invalid-argument", "not_team", "Forward only to a team member's address (or your own).");
  const msgs = (await db().collection("outreachMessages").where("threadId", "==", threadId).get()).docs.map((d) => d.data())
    .filter((m) => !NOT_SENT.includes(m.status)).sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  const fmt = (t) => (ms(t) ? new Date(ms(t)).toLocaleString("pt-PT", { timeZone: "Europe/Lisbon" }) : "");
  const parts = msgs.map((m) => `— ${fmt(m.createdAt)} · ${m.direction === "in" ? `From ${m.from || ""}` : `To ${(m.to || []).join(", ")}`}\nSubject: ${m.subject || ""}\n\n${String(m.text || m.snippet || "").trim()}`);
  const text = `${String(note || "").trim() ? String(note).trim().slice(0, 2000) + "\n\n" : ""}Forwarded from the ${orgName()} Outreach inbox by ${callerEmail}.\nCompany: ${th.companyName || "—"} · Contact: ${th.contactEmail || "—"}\n\n${parts.join("\n\n") || "(no messages)"}\n`;
  const sender = (await db().doc(`outreachSenders/${th.senderId || "_"}`).get()).data();
  if (!sender) fail("failed-precondition", "sender_missing", "The conversation's sending address is no longer set up.");
  // 3 Nov (outreach.attachments): the attachments received in the conversation can go along (internal forward: any copied file, up to the limits)
  const files = includeFiles === true ? await Files.payload(Files.fromReceived(msgs), { lenient: true }) : [];
  await sendEmail(RESEND_SEND_KEY.value(), { from: `${sender.displayName || orgName()} <${th.senderId}>`, to: [want], subject: `Fwd: ${th.subject || ""}`.slice(0, 300), text, ...(files.length ? { attachments: files } : {}) }, `fwd_${threadId}_${Date.now()}`);
  await ref.update({ forwards: FieldValue.arrayUnion({ to: want, by: callerEmail, at: Timestamp.now() }) });
  return { ok: true, to: want, messages: msgs.length, files: files.length };
}
// 5 Nov (switch outreach.inviteManage): update or cancel an invite that was sent. A new .ics with the SAME UID and SEQUENCE + 1 (METHOD:REQUEST for
// an update, METHOD:CANCEL for a cancellation) goes as a reply in the same conversation to the same people as the original (To and Cc), and to
// whoever sends it (so the organiser's partner has it in their own calendar). The visit task and the meeting on the company follow.
// Request: { uid, note?, cc?: [email] }  and for an update { title, start (ISO), minutes, where, link, notes, guests: [{ email, name }] }.
async function inviteChange(request, callerEmail, cancel) {
  if (!P.hasPerm(request, "out.send")) fail("permission-denied", "not_admin", "You don't have permission to send outreach email.");
  await Feat.requireFeature(request, "outreach.inviteManage");
  const d = request.data || {};
  const ref = db().doc(`outreachInvites/${Invites.idOf(d.uid)}`), snap = await ref.get();
  if (!snap.exists) fail("not-found", "invite_not_found", "This invite is not registered, so it cannot be changed from here.");
  const inv = snap.data();
  if (inv.status !== "active") fail("failed-precondition", "invite_closed", "This meeting was already cancelled.");
  const isEmail = (e) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[A-Za-z]{2,}$/.test(String(e || "").trim());
  let start = inv.start.toDate(), end = inv.end.toDate(), title = inv.title, where = inv.location || "", link = inv.link || "", notes = inv.notes || "", guests = inv.guests || [];
  if (!cancel) {
    start = new Date(d.start); const minutes = Number(d.minutes);
    if (isNaN(start) || !(minutes >= 5 && minutes <= 720)) fail("invalid-argument", "bad_time", "Give the new day and time, and an end within 12 hours of the start.");
    end = new Date(start.getTime() + minutes * 60000);
    title = String(d.title || "").replace(/\s+/g, " ").trim().slice(0, 200) || inv.title;
    where = String(d.where ?? "").trim().slice(0, 300); link = String(d.link ?? "").trim().slice(0, 500); notes = String(d.notes ?? "").trim().slice(0, 2000);
    if (link && !/^https?:\/\/\S+$/i.test(link)) fail("invalid-argument", "bad_link", "The meeting link must start with https://");
    const seen = new Set();
    guests = (Array.isArray(d.guests) ? d.guests : []).map((g) => ({ email: normEmail(g?.email), name: String(g?.name || "").slice(0, 80) })).filter((g) => isEmail(g.email) && !seen.has(g.email) && seen.add(g.email));
    if (!guests.length) fail("invalid-argument", "no_guests", "A meeting needs at least one guest.");
  }
  const seq = (inv.sequence || 0) + 1;
  const ics = Invites.buildIcs({ method: cancel ? "CANCEL" : "REQUEST", uid: inv.uid, sequence: seq, title, start, end, location: where, description: notes, link, organizer: inv.organizer, attendees: guests });
  // the file, like one uploaded from the page (outreachFiles + Storage)
  const fileRef = db().collection("outreachFiles").doc();
  const path = `outreach/files/${fileRef.id}/convite.ics`, ctype = `text/calendar; method=${cancel ? "CANCEL" : "REQUEST"}; charset=UTF-8`;
  await require("firebase-admin/storage").getStorage().bucket().file(path).save(Buffer.from(ics, "utf8"), { contentType: ctype, resumable: false });
  await fileRef.set({ name: "convite.ics", filename: "convite.ics", storagePath: path, contentType: ctype, size: Buffer.byteLength(ics), library: false, source: "invite", createdAt: FieldValue.serverTimestamp(), createdBy: callerEmail });
  // who: the original To and Cc, whoever sends, and any guest the sender ticked
  const to = (inv.to || []).map(normEmail).filter(Boolean), have = new Set(to);
  const cc = [];
  for (const e of [...(inv.cc || []), callerEmail, ...(Array.isArray(d.cc) ? d.cc : [])].map(normEmail)) if (e && !have.has(e)) { have.add(e); cc.push(e); }
  const when = new Intl.DateTimeFormat("pt-PT", { dateStyle: "full", timeStyle: "short", timeZone: "Europe/Lisbon" }).format(start);
  const body = String(d.note || "").trim() || (cancel
    ? `Bom dia,\n\nLamentamos, mas tivemos de cancelar a reunião "${title}" prevista para ${when}. Entraremos em contacto para remarcar.\n\nCumprimentos,`
    : `Bom dia,\n\nAtualizámos o convite da reunião "${title}": ${when}${where ? ", " + where : ""}. O convite em anexo substitui o anterior.\n\nCumprimentos,`);
  const res = await send({ ...request, data: { threadId: inv.threadId, body, replyTo: to, replyCc: cc, attachments: [fileRef.id] } }, callerEmail);
  if (!res || res.ok === false) fail("internal", "send_failed", "The email could not be sent.");
  // the invite, the meeting on the company and the visit task follow
  await ref.update({
    sequence: seq, status: cancel ? "cancelled" : "active", updatedAt: FieldValue.serverTimestamp(), updatedBy: callerEmail, lastMessageId: res.messageId || null,
    ...(cancel ? { cancelledAt: FieldValue.serverTimestamp(), cancelledBy: callerEmail } : {
      title, start: Timestamp.fromDate(start), end: Timestamp.fromDate(end), location: where, link, notes,
      guests: guests.map((g) => ({ ...g, status: "NEEDS-ACTION" })), cc: [...new Set([...(inv.cc || []), ...cc])],
    }),
  });
  const taskLine = [`${title}${where ? " — " + where : ""}`, link ? `Link: ${link}` : "", `Guests: ${guests.map((g) => g.email).join(", ")}`].filter(Boolean).join("\n");
  if (inv.taskId) await db().doc(`outreachTasks/${inv.taskId}`).update(cancel ? { status: "cancelled", cancelledReason: `Meeting cancelled by ${callerEmail}` } : { dueAt: Timestamp.fromDate(start), instructions: taskLine }).catch(() => {});
  if (inv.meetingActivityId) await db().doc(`searchActivities/${inv.meetingActivityId}`).update(cancel ? { status: "cancelled", closedAt: FieldValue.serverTimestamp(), closedBy: callerEmail } : { date: Timestamp.fromDate(start), content: taskLine }).catch(() => {});
  return { ok: true, sequence: seq, messageId: res.messageId || null, to, cc, cancelled: !!cancel };
}

function ms(t) {
  if (!t) return 0;
  if (typeof t.toMillis === "function") return t.toMillis();
  if (typeof t._seconds === "number") return t._seconds * 1000;
  if (typeof t.seconds === "number") return t.seconds * 1000;
  const n = Date.parse(t); return isNaN(n) ? 0 : n;
}

const Feat = require("../features"); // feature switches (Team & access → Features)
exports.outreachSend = onCall({ region: REGION, memory: "1GiB", timeoutSeconds: 120, secrets: [RESEND_SEND_KEY, RESEND_READ_KEY, UNSUBSCRIBE_SECRET] }, async (request) => { // 3 Nov: 1 GiB — attachments (up to 20 MB, read from Storage and sent base64) are held in memory
  await Feat.requireFeature(request, "outreach");
  const callerEmail = normEmail(request.auth?.token?.email);
  const action = request.data?.action;
  if (action === "approveDraft" || action === "returnDraft") {
    if (!P.hasPerm(request, "out.approve")) fail("permission-denied", "not_admin", "You don't have permission to approve emails.");
    return action === "approveDraft" ? approveDraft(request, callerEmail) : returnDraft(request, callerEmail);
  }
  if (action === "inviteUpdate" || action === "inviteCancel") return inviteChange(request, callerEmail, action === "inviteCancel");
  if (action === "forward") {
    if (!P.hasPerm(request, "out.send") && !P.hasPerm(request, "out.draft")) fail("permission-denied", "not_admin", "You don't have permission to forward emails.");
    return forwardThread(request, callerEmail);
  }
  return send(request, callerEmail);
});
