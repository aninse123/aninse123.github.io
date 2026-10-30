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
    locked,
    companyName: e.companyName || cs.data().name || "",
    list: sorted.map((r) => ({
      email: r.email, name: r.name || "", role: r.role || "", kind: r.kind, personId: r.personId || null,
      trust: r.trust || "confirmed", blocked: !!r.blocked, domain: states[domainOfEmail(r.email)] || "unknown",
      selected: order.includes(r.email),
    })),
  };
}

// emails: the chosen addresses, in order (empty = back to the campaign's policy).
async function setRecipients({ enrolmentId, emails }, caller, { deps } = {}) {
  if (!Array.isArray(emails) || emails.length > MAX_LIST) fail("invalid-argument", "bad_list", `Choose up to ${MAX_LIST} addresses.`);
  const ref = db().doc(`outreachEnrolments/${enrolmentId}`);
  const cur = await recipientsFor({ enrolmentId }, { deps });
  if (cur.locked) fail("failed-precondition", "already_started", "The first email has already gone out; its address can no longer change.");
  const want = [...new Set(emails.map(normEmail).filter(Boolean))];
  const byEmail = new Map(cur.list.map((r) => [r.email, r]));
  for (const em of want) {
    const r = byEmail.get(em);
    if (!r) fail("invalid-argument", "unknown_address", `${em} is not one of this company's addresses.`);
    if (r.blocked) fail("failed-precondition", "blocked_address", `${em} is not verified and this campaign does not use unverified addresses.`);
    if (r.trust === "bounced") fail("failed-precondition", "bounced_address", `${em} has bounced.`);
  }
  if (!want.length) { await ref.update({ recipient: null, recipientList: null, recipientListBy: caller, recipientListAt: FieldValue.serverTimestamp() }); return { ok: true, list: [] }; }
  const first = byEmail.get(want[0]);
  const recipient = { email: first.email, name: first.name || "", kind: first.kind };
  await ref.update({ recipient, recipientList: want, recipientListBy: caller, recipientListAt: FieldValue.serverTimestamp() });
  return { ok: true, list: want, recipient };
}

module.exports = { recipientsFor, setRecipients, MAX_LIST };
