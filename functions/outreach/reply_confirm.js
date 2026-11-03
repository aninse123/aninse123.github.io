// A reply confirms the address it came from (30 Oct 2026, switch contacts.trustLabels, André's decision d3):
// someone answered from it, so it reaches a person. Called by the inbound handler for a real reply (not an
// out-of-office, not a test). The address is the company's general one, or one of a person's at that company.
// Returns "company" | "person" | "none".

const { companyRecipients } = require("./recipients");
const store = require("./store");
const { getInstance } = require("../instance");
const { normEmail } = require("./util");

const { db, FieldValue, Timestamp } = store;
const newId = () => "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// via: "reply" (it came from this address) or "answered" (a reply came back to an email we sent to it, from another address).
async function confirmRepliedAddress(companyId, email, { now = Timestamp.now(), via = "reply", answeredFrom = null } = {}) {
  const e = normEmail(email);
  if (!companyId || !e) return "none";
  const ref = db().doc(`searchCompanies/${companyId}`);
  const snap = await ref.get();
  if (!snap.exists) return "none";
  const company = snap.data();

  // The company's general address
  if (normEmail(company.companyEmail) === e) {
    if (company.companyEmailConfirmedAt && normEmail(company.companyEmailConfirmedFor) === e) return "company"; // already confirmed
    await ref.update({ companyEmailConfirmedAt: now, companyEmailConfirmedBy: via, companyEmailConfirmedFor: e, companyEmailConfirmedVia: via, companyEmailConfirmedNote: answeredFrom ? `answered from ${answeredFrom}` : null, updatedAt: FieldValue.serverTimestamp() });
    return "company";
  }

  // One of the company's other general addresses (searchCompanies.reach)
  const own = Array.isArray(company.reach) ? company.reach.slice() : [];
  const ce = own.find((x) => x && x.type === "email" && normEmail(x.value) === e);
  if (ce) {
    if (!ce.confirmedAt) {
      Object.assign(ce, { confirmedAt: now, confirmedBy: via, confirmedVia: via, ...(answeredFrom ? { confirmedNote: `answered from ${answeredFrom}` } : {}) });
      await ref.update({ reach: own, updatedAt: FieldValue.serverTimestamp() });
    }
    return "company";
  }

  // A person's address at this company (the Search CRM list only re-reads people whose updatedAt changed)
  const r = (await companyRecipients(companyId, company, { usePeople: true, trust: { on: true } })).find((x) => x.email === e && x.kind === "person" && x.personId);
  if (!r) return "none";
  const pref = db().doc(`searchPeople/${r.personId}`);
  const psnap = await pref.get();
  if (!psnap.exists) return "none";
  const reach = Array.isArray(psnap.data().reach) ? psnap.data().reach.slice() : [];
  const entry = reach.find((x) => x && x.type === "email" && normEmail(x.value) === e);
  if (entry) {
    if (entry.confirmedAt) return "person";
    Object.assign(entry, { confirmedAt: now, confirmedBy: via, confirmedVia: via, ...(answeredFrom ? { confirmedNote: `answered from ${answeredFrom}` } : {}) });
  } else if (r.trust === "confirmed") {
    return "person"; // typed by the team: confirmed already
  } else {
    // an Orbis value has no entry of its own: make one, marked as from the database and confirmed by the reply
    reach.push({ id: newId(), type: "email", value: e, note: "Replied from this address", source: "reply", status: "ok", primary: false, addedBy: "reply", addedAt: new Date().toISOString(), origin: "database", confirmedAt: now, confirmedBy: "reply", confirmedVia: "reply" });
  }
  // reachEmails is the index the Search CRM uses to warn about an email already in use
  const reachEmails = [...new Set(reach.filter((x) => x && x.type === "email").map((x) => normEmail(x.value)))];
  await pref.update({ reach, reachEmails, updatedAt: FieldValue.serverTimestamp() });
  return "person";
}

// 3 Nov: a reply in the conversation also proves the address WE wrote to: it received the email (here it was forwarded, and the answer came
// from another address). Confirms the addresses of the last email we sent in the thread (and the conversation's first address), except the
// one the reply came from (confirmRepliedAddress already did that) and our own addresses. Returns the addresses confirmed.
// Our own addresses: the domain of every sending address and of the team's emails (instance settings), and Resend's inbound domain.
async function ownAddressTest() {
  const doms = new Set();
  const add = (a) => { const d = String(a || "").split("@")[1]; if (d) doms.add(d.toLowerCase()); };
  (await db().collection("outreachSenders").get()).docs.forEach((d) => add(d.id));
  try { ((await getInstance()).founders || []).forEach((f) => add(f.email)); } catch (e) { /* the sending addresses are enough */ }
  return (a) => { const d = String(a || "").split("@")[1] || ""; return doms.has(d.toLowerCase()) || /\.resend\.app$/i.test(d); };
}
async function confirmAnsweredAddresses(companyId, thread, fromEmail, opts = {}) {
  const from = normEmail(fromEmail);
  const msgs = (await db().collection("outreachMessages").where("threadId", "==", thread.id).where("direction", "==", "out").get()).docs
    .map((d) => d.data()).filter((m) => m.status !== "failed" && m.status !== "queued")
    .sort((a, b) => (b.createdAt?.toMillis ? b.createdAt.toMillis() : 0) - (a.createdAt?.toMillis ? a.createdAt.toMillis() : 0));
  const last = msgs[0], isOurs = await ownAddressTest();
  const sent = [...new Set([thread.contactEmail, ...[].concat(last?.to || []), ...[].concat(last?.cc || [])].map(normEmail).filter(Boolean))]
    .filter((a) => a !== from && !isOurs(a));
  const done = [];
  for (const a of sent) { if ((await confirmRepliedAddress(companyId, a, { ...opts, via: "answered", answeredFrom: from })) !== "none") done.push(a); }
  return done;
}

module.exports = { confirmRepliedAddress, confirmAnsweredAddresses };
