// A company whose only general address is one of its extra ones (searchCompanies.reach) is reachable when contacts.trustLabels is on
// (30 Oct 2026). Synthetic data only.
const { evaluateCompany } = require("../outreach/campaign_util.js");
let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const company = { name: "X, LDA", reach: [{ id: "r1", type: "email", value: "contas@x.pt", status: "ok" }] };
const base = { exclusions: { requireEmail: true, allowedStages: ["universe"], contactedWithinDays: 0 }, firstChannel: "email", suppressed: new Set(), alreadyEnrolled: false, companyId: "c1", recipientPolicy: "company" };
ok("switch off: no general address, not reachable (as before)", evaluateCompany(company, { ...base, trust: false }).reason === "no_email");
ok("switch on: the extra address makes it reachable", evaluateCompany(company, { ...base, trust: true }).ok === true);
ok("a bounced extra address does not", evaluateCompany({ ...company, reach: [{ ...company.reach[0], status: "bounced" }] }, { ...base, trust: true }).reason === "no_email");
console.log(fail ? `\n${fail} FAILED` : "\nAll passed");
process.exit(fail ? 1 : 0);
