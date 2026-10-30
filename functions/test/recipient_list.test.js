// Recipient list per company (30 Oct 2026, switch contacts.trustLabels): the addresses Outreach could write to for one
// company, in the order chosen, each with its status and an advisory mail-domain flag. Synthetic data only.
const F = require("./fake_firebase.js");
const { lookupDomain, domainStates } = require("../outreach/mail_domain.js");
const RL = require("../outreach/recipient_list.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const err = (code) => Object.assign(new Error(code), { code });
const dnsFor = (map) => ({
  resolveMx: async (d) => { const v = map[d]; if (v === "timeout") throw err("ETIMEOUT"); if (v === "ok") return [{ exchange: "mx." + d, priority: 10 }]; if (v === "nomx") throw err("ENODATA"); throw err("ENOTFOUND"); },
  resolve4: async (d) => { if (map[d] === "a") return ["1.2.3.4"]; if (map[d] === "timeout") throw err("ETIMEOUT"); throw err("ENODATA"); },
  resolve6: async () => { throw err("ENODATA"); },
});

(async () => {
  // ── The domain flag ──
  const dns = dnsFor({ "empresa.pt": "ok", "semmx.pt": "a", "morto.pt": "none", "lento.pt": "timeout" });
  ok("a domain with a mail server: ok", (await lookupDomain("empresa.pt", dns)) === "ok");
  ok("no mail server but the domain exists: still ok (mail falls back to its address)", (await lookupDomain("semmx.pt", dns)) === "ok");
  ok("a domain that does not exist: none", (await lookupDomain("morto.pt", dns)) === "none");
  ok("a timeout is unknown, never none", (await lookupDomain("lento.pt", dns)) === "unknown");
  let tries = 0;
  const flaky = { resolveMx: async () => { if (tries++ === 0) throw err("ETIMEOUT"); return [{ exchange: "mx", priority: 1 }]; }, resolve4: async () => [], resolve6: async () => [] };
  ok("one retry: a first failure then an answer is ok", (await lookupDomain("empresa.pt", flaky)) === "ok" && tries === 2);
  ok("nonsense is unknown", (await lookupDomain("", dns)) === "unknown" && (await lookupDomain("semponto", dns)) === "unknown");

  store.clear();
  const now = Date.now();
  const first = await domainStates(["empresa.pt", "morto.pt", "lento.pt"], { deps: dns, now });
  ok("states for several domains", first["empresa.pt"] === "ok" && first["morto.pt"] === "none" && first["lento.pt"] === "unknown");
  ok("ok and none are cached; a timeout is not", !!store.get("outreachDomainCache/empresa.pt") && !!store.get("outreachDomainCache/morto.pt") && !store.get("outreachDomainCache/lento.pt"));
  const boom = { resolveMx: async () => { throw new Error("should not ask"); }, resolve4: async () => [], resolve6: async () => [] };
  ok("a fresh cache answer is used without asking", (await domainStates(["empresa.pt"], { deps: boom, now: now + 1000 }))["empresa.pt"] === "ok");
  ok("a none is asked again after a day", (await domainStates(["morto.pt"], { deps: dnsFor({ "morto.pt": "ok" }), now: now + 25 * 3600 * 1000 }))["morto.pt"] === "ok");
  ok("an ok is still cached after a week", (await domainStates(["empresa.pt"], { deps: boom, now: now + 7 * 24 * 3600 * 1000 }))["empresa.pt"] === "ok");

  // ── The list for one enrolment ──
  store.clear();
  store.set("searchCompanies/co1", { name: "EMPRESA, LDA", companyEmail: "geral@empresa.pt", reach: [{ id: "x1", type: "email", value: "contas@empresa.pt", status: "ok", origin: "team", note: "accounting" }], contacts: [] });
  store.set("searchPeople/u_1", { name: "João Silva", reach: [
    { id: "r1", type: "email", value: "joao@empresa.pt", status: "ok", primary: true, origin: "enrichment", toolStatus: "verified" },
    { id: "r2", type: "email", value: "joao.guess@morto.pt", status: "ok", origin: "enrichment", toolStatus: "unconfirmed" }] });
  store.set("searchPersonLinks/u_1__co1", { personId: "u_1", companyId: "co1", personName: "João Silva", personEntityType: "person", shCurrent: true, shDirectPct: 60, mgmtCurrent: true, mgmtRoles: ["Administrador"] });
  store.set("outreachCampaigns/cmp1", { name: "C", recipientPolicy: "best_person", status: "draft" });
  store.set("outreachEnrolments/en1", { campaignId: "cmp1", companyId: "co1", companyName: "EMPRESA, LDA", status: "active", currentStep: 0 });
  const d2 = dnsFor({ "empresa.pt": "ok", "morto.pt": "none" });

  const r = await RL.recipientsFor({ enrolmentId: "en1" }, { deps: d2 });
  const get = (e) => r.list.find((x) => x.email === e);
  ok("lists the person's addresses and the company's, with status and domain flag", r.list.length === 4 && get("joao@empresa.pt").trust === "tool" && get("geral@empresa.pt").kind === "company" && get("contas@empresa.pt").kind === "company");
  ok("the policy's pick comes first and is selected (best person)", r.list[0].email === "joao@empresa.pt" && r.list[0].selected && r.list.filter((x) => x.selected).length === 1);
  ok("a not-verified address is shown as blocked; the dead domain is flagged", get("joao.guess@morto.pt").blocked === true && get("joao.guess@morto.pt").domain === "none" && get("joao@empresa.pt").domain === "ok");
  ok("not locked before the first email", r.locked === false);

  // ── Choosing ──
  const s = await RL.setRecipients({ enrolmentId: "en1", emails: ["joao@empresa.pt", "geral@empresa.pt"] }, "andre", { deps: d2 });
  const en = store.get("outreachEnrolments/en1");
  ok("saves the order and makes the first the address of the first email", s.ok && en.recipientList.join() === "joao@empresa.pt,geral@empresa.pt" && en.recipient.email === "joao@empresa.pt" && en.recipient.kind === "person");
  const r2 = await RL.recipientsFor({ enrolmentId: "en1" }, { deps: d2 });
  ok("the chosen order comes first, both selected", r2.list[0].email === "joao@empresa.pt" && r2.list[1].email === "geral@empresa.pt" && r2.list[0].selected && r2.list[1].selected && !r2.list[2].selected);
  await RL.setRecipients({ enrolmentId: "en1", emails: ["geral@empresa.pt", "joao@empresa.pt"] }, "andre", { deps: d2 });
  ok("reordering changes which one the first email goes to", store.get("outreachEnrolments/en1").recipient.email === "geral@empresa.pt" && store.get("outreachEnrolments/en1").recipient.kind === "company");

  const bad = async (emails) => { try { await RL.setRecipients({ enrolmentId: "en1", emails }, "andre", { deps: d2 }); return null; } catch (e) { return e.details?.reason || e.message; } };
  ok("an unknown address is refused", (await bad(["outro@x.pt"])) === "unknown_address");
  ok("a blocked (not verified) address is refused", (await bad(["joao.guess@morto.pt"])) === "blocked_address");
  ok("too many is refused", (await bad(Array.from({ length: 11 }, (_, i) => `a${i}@empresa.pt`))) === "bad_list");
  ok("a domain flag never blocks the choice (advisory): a verified address on an unknown domain is accepted", !(await bad(["contas@empresa.pt"])));

  await RL.setRecipients({ enrolmentId: "en1", emails: [] }, "andre", { deps: d2 });
  ok("an empty choice goes back to the campaign's policy", store.get("outreachEnrolments/en1").recipient === null && store.get("outreachEnrolments/en1").recipientList === null);

  store.set("outreachEnrolments/en1", { ...store.get("outreachEnrolments/en1"), threadId: "t1", currentStep: 1 });
  ok("after the first email it can no longer change", (await bad(["geral@empresa.pt"])) === "already_started" && (await RL.recipientsFor({ enrolmentId: "en1" }, { deps: d2 })).locked === true);

  console.log(fail ? `\n${fail} FAILED` : "\nAll passed");
  process.exit(fail ? 1 : 0);
})();
