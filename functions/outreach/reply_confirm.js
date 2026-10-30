// A reply confirms the address it came from (30 Oct 2026, switch contacts.trustLabels, André's decision d3):
// someone answered from it, so it reaches a person. Called by the inbound handler for a real reply (not an
// out-of-office, not a test). The address is the company's general one, or one of a person's at that company.
// Returns "company" | "person" | "none".

const { companyRecipients } = require("./recipients");
const store = require("./store");
const { normEmail } = require("./util");

const { db, FieldValue, Timestamp } = store;
const newId = () => "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function confirmRepliedAddress(companyId, email, { now = Timestamp.now() } = {}) {
  const e = normEmail(email);
  if (!companyId || !e) return "none";
  const ref = db().doc(`searchCompanies/${companyId}`);
  const snap = await ref.get();
  if (!snap.exists) return "none";
  const company = snap.data();

  // The company's general address
  if (normEmail(company.companyEmail) === e) {
    if (company.companyEmailConfirmedAt && normEmail(company.companyEmailConfirmedFor) === e) return "company"; // already confirmed
    await ref.update({ companyEmailConfirmedAt: now, companyEmailConfirmedBy: "reply", companyEmailConfirmedFor: e, companyEmailConfirmedVia: "reply", updatedAt: FieldValue.serverTimestamp() });
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
    Object.assign(entry, { confirmedAt: now, confirmedBy: "reply", confirmedVia: "reply" });
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

module.exports = { confirmRepliedAddress };
