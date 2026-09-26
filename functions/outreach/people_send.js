// outreachPeopleSend — one-to-one and small-group relationship emails (Phase
// 5c, "Outreach Phase 5 - People Campaigns & Recurring Emails Spec.md" §6).
// Replaces the Netlify notify function: the Investor CRM and Network "Send
// email" buttons and the admin "notify investors" / "send update" emails.
//
// Same payload and the same branded templates as before, but:
//   - admin sign-in instead of a shared secret kept in Firestore;
//   - the full-access Resend key from Secret Manager (sends from douropartners.pt);
//   - suppressed addresses are skipped (outreach: any suppression; investor
//     notices: bounces and complaints only — an outreach unsubscribe doesn't
//     stop document notices to a registered investor);
//   - test mode sends everything to the test address;
//   - each call is logged in outreachPeopleSends and feeds the usage bar.
// The pages keep writing their own activity entries (crmActivities, …).
//
// data: { recipients: [{ email, name }], subject, message, from: "andre"|"antonio"|"noreply",
//         kind: "outreach"|undefined, combined?, docName?, docCategory?, docDescription?, docUrl? }

const P = require("../access/perms"); // team access: who may call what
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { REGION, ADMIN_EMAILS, RESEND_READ_KEY } = require("./config");
const { normEmail, isValidEmail } = require("./util");
const store = require("./store");
const resend = require("./resend");
const { buildHtml, buildOutreachHtml } = require("./branded");

const { db, FieldValue } = store;
const MAX_RECIPIENTS = 250;
const BATCH = 100; // Resend batch limit
// Server-side allow-list: the page sends a key, never an address.
const SENDERS = {
  andre: { email: "andre.rocha@douropartners.pt", name: "André Rocha" },
  antonio: { email: "antonio.carvalho@douropartners.pt", name: "António Carvalho" },
  noreply: { email: "noreply@douropartners.pt", name: "Douro Partners" },
};
const NOTICE_BLOCKING = ["hard_bounce", "complaint", "provider_suppressed"];

function fail(code, reason, message) { throw new HttpsError(code, message, { reason }); }

async function peopleSend(data, caller) {
  const { recipients, subject, message, from, kind, combined, docName, docCategory, docDescription, docUrl } = data || {};
  if (!Array.isArray(recipients) || !recipients.length || !String(subject || "").trim() || !String(message || "").trim()) fail("invalid-argument", "missing_fields", "Recipients, subject and message are required.");
  if (recipients.length > MAX_RECIPIENTS) fail("invalid-argument", "too_many", `Too many recipients (max ${MAX_RECIPIENTS}).`);
  const bad = recipients.find((r) => !isValidEmail(normEmail(r?.email)));
  if (bad) fail("invalid-argument", "bad_email", `Invalid recipient email: ${bad?.email || "(missing)"}`);

  const isOutreach = kind === "outreach";
  const sender = SENDERS[from] || SENDERS.noreply;
  const other = isOutreach ? (from === "andre" ? SENDERS.antonio : from === "antonio" ? SENDERS.andre : null) : null;
  const doc = { docName, docCategory, docDescription, docUrl };
  const subj = String(subject).trim(), msg = String(message).trim();

  // Suppression (deduped by address).
  const seen = new Set(), list = [], skipped = [];
  for (const r of recipients) {
    const email = normEmail(r.email);
    if (seen.has(email)) continue;
    seen.add(email);
    const sup = await store.findSuppression(email);
    if (sup && (isOutreach || NOTICE_BLOCKING.includes(sup.reason))) { skipped.push({ email, reason: sup.reason }); continue; }
    list.push({ email, name: String(r.name || "").slice(0, 160) });
  }
  if (!list.length) return { sent: 0, skipped };

  const settings = await store.getSettings();
  const redirect = settings.testMode ? normEmail(settings.campaignTestRecipient || (settings.testRecipients || [])[0]) : null;
  if (settings.testMode && !redirect) fail("failed-precondition", "no_test_address", "Test mode is on but no test address is set (Outreach → Settings).");
  const to = (addrs) => (redirect ? [redirect] : addrs);
  const tag = (addrs) => (redirect ? `[TEST → ${addrs.join(", ")}] ${subj}` : subj);
  const base = { from: `${sender.name} <${sender.email}>`, ...(other && !redirect ? { cc: [`${other.name} <${other.email}>`] } : {}) };

  const emails = combined
    ? [{ ...base, to: to(list.map((r) => r.email)), subject: tag(list.map((r) => r.email)), html: buildOutreachHtml({ message: msg, ...doc }) }]
    : list.map((r) => ({
      ...base, to: to([r.email]), subject: tag([r.email]),
      html: isOutreach ? buildOutreachHtml({ message: msg, ...doc })
        : buildHtml({ investorName: r.name, message: msg, docName: docName || "", docCategory: docCategory || "Document", docDescription: docDescription || "" }),
    }));

  const logRef = db().collection("outreachPeopleSends").doc();
  const ids = [];
  let quota = null;
  for (let i = 0; i < emails.length; i += BATCH) {
    const res = await resend.sendBatch(RESEND_READ_KEY.value(), emails.slice(i, i + BATCH), `${logRef.id}-${i / BATCH}`);
    (res.data?.data || []).forEach((x) => ids.push(x.id));
    quota = res.quota;
  }
  await store.recordQuota(quota, "people_send");
  await logRef.set({
    kind: isOutreach ? "outreach" : "notice", from: sender.email, subject: subj, combined: !!combined,
    recipients: list.map((r) => r.email), sent: emails.length, skipped, resendIds: ids,
    isTest: !!redirect, redirectedTo: redirect, docName: docName || null, by: caller, at: FieldValue.serverTimestamp(),
  });
  return { sent: emails.length, skipped, isTest: !!redirect };
}

exports.outreachPeopleSend = onCall({ region: REGION, secrets: [RESEND_READ_KEY], timeoutSeconds: 120 }, async (request) => {
  const caller = normEmail(request.auth?.token?.email);
  // Which page is sending decides the permission (Investor CRM, Network, or the admin notices).
  const need = { crm: "icrm.email", network: "net.email", portal: "portal.admin" }[request.data?.context] || "portal.admin";
  if (!P.hasPerm(request, need)) fail("permission-denied", "not_admin", "You don't have permission to send these emails.");
  try { return await peopleSend(request.data, caller); }
  catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error("outreachPeopleSend failed", { message: e.message, resendName: e.resendName });
    throw new HttpsError("internal", `Send failed: ${e.message}`, { reason: e.resendName || "send_failed" });
  }
});
