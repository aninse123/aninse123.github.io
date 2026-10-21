// Owner-aware outreach, Stage 3 (22 Oct 2026, switch "outreach.ownerAware"):
// the related-companies lookup, the flags for a company about to be contacted,
// the default choice and the companies to mention. Synthetic data only.
const F = require("./fake_firebase.js");
const R = require("../outreach/related.js");
const { store, Timestamp } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const DAY = 86400000, NOW = Date.parse("2026-10-22T10:00:00Z");

(async () => {
  store.clear();
  const co = (id, data) => store.set(`searchCompanies/${id}`, { name: id.toUpperCase() + ", LDA", companyEmail: `geral@${id}.pt`, ownGraphAt: Timestamp.now(), ...data });
  co("a", { ownParents: 1, ownOwnerOther: 1, computedRevenue: 2e6 });            // held by P, owner Alfredo also in C
  co("p", { ownSubs: 1, computedRevenue: 9e6, activeCampaignId: "k2", activeCampaignName: "Serviços Q4", lastOutreachAt: Timestamp.fromMillis(NOW - 5 * DAY) });
  co("c", { ownOwnerOther: 1, lastReplyAt: Timestamp.fromMillis(NOW - 3 * DAY) });
  co("g1", { ownGroupKey: "PT1", ownGroupSize: 2 });
  co("g2", { ownGroupKey: "PT1", ownGroupSize: 2, doNotContact: { on: true } });
  co("e", { sameEmailLinks: [{ companyId: "solo" }] });
  co("solo", { ownGroupSize: 1, ownSubs: 0, ownParents: 0, ownOwnerOther: 0 });   // nothing related by Orbis
  co("bank", { ownOwnerOther: 1 });
  const link = (id, d) => store.set(`searchPersonLinks/${id}`, d);
  link("p__a", { personId: "n_P", companyId: "a", personEntityType: "entity", personMatchedCompanyId: "p", shCurrent: true, shDirectPct: 93.75, personName: "P, SA" });
  link("alf__a", { personId: "u_ALF", companyId: "a", personEntityType: "person", shCurrent: true, shDirectPct: 6.25, personName: "Alfredo Cunha" });
  link("alf__c", { personId: "u_ALF", companyId: "c", personEntityType: "person", mgmtCurrent: true, mgmtRoles: ["Gerente"], personName: "Alfredo Cunha" });
  link("roc__a", { personId: "u_ROC", companyId: "a", personEntityType: "person", mgmtCurrent: true, mgmtRoles: ["Revisor Oficial de Contas"], personName: "ROC" });
  link("roc__solo", { personId: "u_ROC", companyId: "solo", personEntityType: "person", mgmtCurrent: true, mgmtRoles: ["Revisor Oficial de Contas"], personName: "ROC" });
  // A manager in 45 companies (bank, big holding): never followed.
  for (let i = 0; i < 45; i++) link(`big__x${i}`, { personId: "u_BIG", companyId: i ? `x${i}` : "bank", personEntityType: "person", mgmtCurrent: true, mgmtRoles: ["Administrador"], personName: "Big" });
  store.set("outreachThreads/t1", { companyId: "c", responseCategory: "not_interested", isTest: false });

  const m = await R.relatedFor(["a", "g1", "e", "solo", "bank"]);
  const a = m.get("a");
  const ids = (e) => e.related.map((r) => r.companyId).sort().join(",");
  ok("A: the parent P (93.75%) and C through the shared owner Alfredo Cunha (any %); the ROC is left out", ids(a) === "c,p");
  ok("…why: \"parent 93.75%\" and \"same owner: Alfredo Cunha (Gerente there)\"", a.related.find((r) => r.companyId === "p").why[0] === "parent 93.75%" && a.related.find((r) => r.companyId === "c").why[0] === "same owner: Alfredo Cunha (Gerente there)");
  ok("…the parent comes first and is the suggested lead", a.related[0].companyId === "p" && a.lead.companyId === "p" && a.lead.why === "parent");
  ok("…P carries its campaign and last outreach; C its reply and \"said no\"", a.related[0].campaignName === "Serviços Q4" && a.related[0].lastOutreachAt > 0 && a.related[1].lastReplyAt > 0 && a.related[1].saidNo);
  ok("same ultimate owner: G1 → G2 (with do not contact)", ids(m.get("g1")) === "g2" && m.get("g1").related[0].doNotContact);
  ok("a confirmed same-email link counts (E → SOLO), even with nothing in Orbis", ids(m.get("e")) === "solo" && m.get("e").related[0].why[0] === "same email (confirmed)");
  ok("SOLO: nothing related → skipped without queries, empty list, no lead", m.get("solo").related.length === 0 && m.get("solo").lead === null);
  ok("a manager in more than 40 companies is not followed (BANK has no related)", m.get("bank").related.length === 0);

  const flags = R.flagsFor(a, { campaignId: "k1", windowDays: 30, now: NOW, batch: new Set(["a", "c"]), selfId: "a" });
  const kinds = flags.map((f) => f.kind).sort().join(",");
  ok("flags for A in campaign k1: P contacted 5 days ago + in another campaign; C in conversation, said no, in the same batch", kinds === "group_contacted,in_conversation,other_campaign,said_no,same_batch");
  ok("…texts name the company and date", flags.some((f) => f.text === "in conversation via C, LDA (reply 2026-10-19)") && flags.some((f) => f.text.startsWith("group contacted via P, LDA (2026-10-17)")));
  ok("default choice: Skip for now when a related company said no; else Proceed", R.defaultChoice(flags) === "skip" && R.defaultChoice([{ kind: "group_contacted" }]) === "proceed");
  const men = R.mentionFrom(a, flags);
  ok("mention: the companies the conversation can lean on (contacted / in conversation / in a campaign), at most two, by email name", men.length === 2 && men.map((x) => x.companyId).sort().join(",") === "c,p" && men.every((x) => x.name));
  ok("mention with nothing contacted: the parent", R.mentionFrom(a, []).map((x) => x.companyId).join() === "p");
  ok("flags outside the window: no \"group contacted\"", !R.flagsFor(a, { campaignId: "k2", windowDays: 3, now: NOW }).some((f) => f.kind === "group_contacted" || f.kind === "other_campaign"));

  console.log(fail ? `${fail} owner-related test(s) FAILED` : "all owner-related tests passed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
