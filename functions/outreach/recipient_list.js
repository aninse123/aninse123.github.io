// Recipient list per company (30 Oct 2026, plan step 3, switch contacts.trustLabels).
// For one enrolment: every address Outreach could write to, in the order chosen (else the campaign's policy order),
// with its trust and an advisory mail-domain flag. The first selected address is the one the first email goes to
// (enrolment.recipient, which the scheduler already honours); the whole order is kept in enrolment.recipientList.
// Only before the first email: afterwards the conversation owns the address.

const { HttpsError } = require("firebase-functions/v2/https");
const store = require("./store");
const { companyRecipients, pickByPolicy } = require("./recipients");
const { domainStates } = require("./mail_domain");
const { normEmail } = require("./util");

const { db, FieldValue } = store;
const MAX_LIST = 10;
const Tracks = require("./tracks"); // several recipients (30 Oct, switch outreach.multiRecipient)

const fail = (code, reason, message) => { throw new HttpsError(code, message, { reason }); };
const domainOfEmail = (e) => String(e || "").split("@")[1] || "";

// Candidates for the enrolment, flagged. `deps` lets a test replace the DNS lookup.
async function recipientsFor({ enrolmentId }, { deps } = {}) {
  if (!enrolmentId || typeof enrolmentId !== "string") fail("invalid-argument", "enrolment_required", "Choose a company in the campaign.");
  const es = await db().doc(`outreachEnrolments/${enrolmentId}`).get();
  if (!es.exists) fail("not-found", "enrolment_not_found", "Enrolment not found.");
  const e = es.data();
  if (!e.companyId) fail("failed-precondition", "not_a_company", "This is not a company enrolment.");
  const [cs, camp] = await Promise.all([db().doc(`searchCompanies/${e.companyId}`).get(), db().doc(`outreachCampaigns/${e.campaignId}`).get()]);
  if (!cs.exists) fail("not-found", "company_not_found", "Company not found.");
  const campaign = camp.exists ? camp.data() : {};
  // Everything is listed; an address the campaign may not use (not verified) is shown as blocked, with the reason.
  const all = await companyRecipients(e.companyId, cs.data(), { usePeople: true, trust: { on: true, includeUnverified: !!campaign.useUnverified } });
  const saved = Array.isArray(e.recipientList) ? e.recipientList.map(normEmail) : [];
  const policyPick = !saved.length ? pickByPolicy(all, campaign.recipientPolicy || "company") : null;
  const order = saved.length ? saved : policyPick ? [normEmail(policyPick.email)] : [];
  const rank = (r) => { const i = order.indexOf(r.email); return i < 0 ? 1e6 - (r.rank || 0) : i; };
  const sorted = all.slice().sort((a, b) => rank(a) - rank(b));
  const states = await domainStates(sorted.map((r) => domainOfEmail(r.email)), { deps });
  const locked = !!(e.threadId || (e.currentStep || 0) > 0);
  return {
    locked, all: !!e.multiRecipient, isTrack: !!e.trackOf,
    companyName: e.companyName || cs.data().name || "",
    list: sorted.map((r) => ({
      email: r.email, name: r.name || "", role: r.role || "", kind: r.kind, personId: r.personId || null,
      trust: r.trust || "confirmed", blocked: !!r.blocked, domain: states[domainOfEmail(r.email)] || "unknown",
      selected: order.includes(r.email),
    })),
  };
}

// emails: the chosen addresses, in order (empty = back to the campaign's policy).
// all (switch outreach.multiRecipient, opts.multi): every ticked address gets its own email, up to MAX_TRACKS; otherwise only the
// first does and the others are kept as fallbacks for a bounce. After email 1 only the extra addresses can change.
async function setRecipients({ enrolmentId, emails, all }, caller, { deps, multi = false } = {}) {
  if (!Array.isArray(emails) || emails.length > MAX_LIST) fail("invalid-argument", "bad_list", `Choose up to ${MAX_LIST} addresses.`);
  if (all && !multi) fail("failed-precondition", "multi_off", "Writing to several addresses is not switched on.");
  const ref = db().doc(`outreachEnrolments/${enrolmentId}`);
  const cur = await recipientsFor({ enrolmentId }, { deps });
  const e = (await ref.get()).data();
  if (e.trackOf) fail("failed-precondition", "is_track", "Change the company's first address instead.");
  const want = [...new Set(emails.map(normEmail).filter(Boolean))];
  if (all && want.length > Tracks.MAX_TRACKS) fail("invalid-argument", "too_many_tracks", `At most ${Tracks.MAX_TRACKS} addresses can each get an email.`);
  const byEmail = new Map(cur.list.map((r) => [r.email, r]));
  for (const em of want) {
    const r = byEmail.get(em);
    if (!r) fail("invalid-argument", "unknown_address", `${em} is not one of this company's addresses.`);
    if (r.blocked) fail("failed-precondition", "blocked_address", `${em} is not verified and this campaign does not use unverified addresses.`);
    if (r.trust === "bounced") fail("failed-precondition", "bounced_address", `${em} has bounced.`);
  }
  const extras = (list) => list.slice(1).map((x) => ({ email: x, name: byEmail.get(x).name, kind: byEmail.get(x).kind, personId: byEmail.get(x).personId || null }));
  if (cur.locked) {
    if (!all || !want.length || want[0] !== normEmail(e.recipient?.email)) fail("failed-precondition", "already_started", "The first email has already gone out; its address can no longer change.");
    const r = await Tracks.syncTracks(enrolmentId, extras(want), caller, { late: true });
    await ref.update({ recipientList: want, recipientListBy: caller, recipientListAt: FieldValue.serverTimestamp() });
    return { ok: true, list: want, ...r };
  }
  if (!want.length) { await Tracks.syncTracks(enrolmentId, [], caller); await ref.update({ recipient: null, recipientList: null, recipientListBy: caller, recipientListAt: FieldValue.serverTimestamp() }); return { ok: true, list: [] }; }
  const first = byEmail.get(want[0]);
  const recipient = { email: first.email, name: first.name || "", kind: first.kind, ...(first.personId ? { personId: first.personId } : {}) };
  await ref.update({ recipient, recipientList: want, recipientListBy: caller, recipientListAt: FieldValue.serverTimestamp() });
  const r = await Tracks.syncTracks(enrolmentId, all ? extras(want) : [], caller);
  return { ok: true, list: want, recipient, ...r };
}

// What one address would receive: the campaign's first email filled in for them. Read only: nothing is created or sent.
async function previewRecipient({ enrolmentId, email }, { prepare } = {}) {
  const es = await db().doc(`outreachEnrolments/${enrolmentId}`).get();
  if (!es.exists) fail("not-found", "enrolment_not_found", "Enrolment not found.");
  const e = es.data();
  const camp = (await db().doc(`outreachCampaigns/${e.campaignId}`).get()).data() || {};
  const step = (camp.steps || []).filter((s) => (s.pathId || "else") === (e.pathId || "else") || !e.pathId).find((s) => (s.channel || "email") === "email") || (camp.steps || [])[0];
  if (!step || !step.templateId) return { ok: false, error: "This campaign has no email step with a template yet." };
  const settings = await store.getSettings();
  let senderId = e.senderId;
  if (!senderId) { const ss = await db().collection("outreachSenders").get(); const s = ss.docs.find((d) => d.data().status === "active"); senderId = s ? s.id : null; }
  if (!senderId) return { ok: false, error: "No active sender address to preview with." };
  try {
    const fn = prepare || require("./send_core").prepareEmail;
    const p = await fn({ callerEmail: "preview", settings, messageRef: db().collection("outreachMessages").doc(), companyId: e.companyId, senderId, recipient: { email: normEmail(email) }, templateId: step.templateId, footer: camp.footer, campaignFields: { sector: camp.sector || "" } });
    return { ok: true, to: normEmail(email), subject: p.subject, text: p.bodyText, sender: p.senderId, note: "Variant A of the first email. Wording can differ by variant." };
  } catch (err) { return { ok: false, error: err.message || String(err) }; }
}

module.exports = { recipientsFor, setRecipients, previewRecipient, MAX_LIST };
