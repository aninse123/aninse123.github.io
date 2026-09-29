// F1 — people campaigns with every step type: a manual step becomes a task
// for the PERSON (name, organisation, their records); the outcome is logged on
// their Investor CRM / Network record (never in test mode) and the sequence
// moves on, stops on a reply, or follows a rule — as for companies.
const F = require("./fake_firebase.js");
const dns = require("dns").promises;
dns.resolveMx = async (d) => [{ exchange: "mx." + d, priority: 10 }];
global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ id: "rs_1" }) });
const fns = require("../index.js");
const { runScheduler } = require("../outreach/scheduler.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const docs = (coll) => [...store.entries()].filter(([p]) => p.startsWith(coll + "/")).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));
const run = (iso) => runScheduler({ now: new Date(iso), gap: null, rand: () => 0 });
const TUE = "2026-09-29T10:30:00+01:00", WED = "2026-09-30T10:30:00+01:00";

(async () => {
  store.set("outreachSettings/global", { testMode: false, complianceBlockId: "cb" });
  store.set("outreachCompliance/cb", { legalEntityLine: "Douro Partners, Lda", footerText: "Remover: {{unsubscribeUrl}}" });
  store.set("outreachTemplates/S", { name: "Guião", status: "active", kind: "script", variants: [{ key: "A", subject: "", body: "Bom dia" }] });
  store.set("outreachTemplates/L", { name: "Carta", status: "active", kind: "letter", variants: [{ key: "A", subject: "", body: "Carta" }] });
  store.set("networkContacts/n1", { name: "Rui Broker", email: "rui@firm.pt" });
  store.set("crmInvestors/i1", { name: "Fundo X" });

  const { campaignId } = await camp({ action: "save", campaign: { name: "Brokers — ligar", audienceType: "people", steps: [
    { channel: "call", templateId: "S" }, { channel: "letter", templateId: "L", wait: { days: 1, unit: "calendar" } }, { channel: "linkedin", wait: { days: 1, unit: "calendar" } },
  ] } });
  ok("a people campaign with only manual steps needs no sending address to start", !(await camp({ action: "setStatus", campaignId, status: "active" })).err);
  await camp({ action: "enrolPeople", campaignId, people: [
    { email: "rui@firm.pt", name: "Rui Broker", org: "Firm Lda", refs: [{ source: "network", id: "n1" }, { source: "crm", id: "i1" }] },
    { email: "ana@firm.pt", name: "Ana Silva", org: "Firm Lda", refs: [{ source: "network", id: "n1" }] },
  ] });

  await run(TUE);
  const tasks = docs("outreachTasks");
  const t = tasks.find((x) => x.personEmail === "rui@firm.pt");
  ok("scheduler: one call task per person, with name / organisation / records, no company", tasks.length === 2 && t && t.channel === "call" && t.personName === "Rui Broker" && t.org === "Firm Lda" && t.refs.length === 2 && t.companyId === null);

  const r = await camp({ action: "completeTask", taskId: t.id, outcome: "no_answer", notes: "Tentei às 10h" });
  const na = docs("networkActivities"), ca = docs("crmActivities");
  ok("outcome logged on the person's Network AND Investor CRM records (type call, via call)", !r.err && na.length === 1 && ca.length === 1 && na[0].type === "call" && na[0].via === "call" && na[0].contactId === "n1" && ca[0].investorId === "i1" && /Tentei às 10h/.test(na[0].content || "") && na[0].outreachTaskId === t.id);
  ok("no Search CRM activity for a person", !docs("searchActivities").length);
  ok("the person's record is touched", !!store.get("networkContacts/n1").lastTouchAt);
  const e = docs("outreachEnrolments").find((x) => x.personEmail === "rui@firm.pt");
  ok("the sequence moves on to the letter step", e.status === "active" && e.currentStep === 1);

  // The wait is counted from the real clock; pin it to the simulated day.
  store.set(`outreachEnrolments/${e.id}`, { ...store.get(`outreachEnrolments/${e.id}`), nextActionAt: F.Timestamp.fromDate(new Date("2026-09-30T09:00:00+01:00")) });
  await run(WED);
  const letter = docs("outreachTasks").find((x) => x.personEmail === "rui@firm.pt" && x.channel === "letter");
  ok("next step: a letter task for the person", !!letter && letter.personName === "Rui Broker");

  // A reply stops the sequence
  const ta = docs("outreachTasks").find((x) => x.personEmail === "ana@firm.pt" && x.channel === "call");
  const rr = await camp({ action: "completeTask", taskId: ta.id, outcome: "connected", notes: "Falámos" });
  ok("connected (a reply) ends the person's enrolment as replied", !rr.err && docs("outreachEnrolments").find((x) => x.personEmail === "ana@firm.pt").status === "replied");

  // Test mode never logs on real records
  store.set(`outreachTasks/${letter.id}`, { ...store.get(`outreachTasks/${letter.id}`), isTest: true });
  const before = docs("networkActivities").length;
  await camp({ action: "completeTask", taskId: letter.id, outcome: "posted" });
  ok("test tasks leave no trace on the person's records", docs("networkActivities").length === before);

  console.log(fail ? `\n${fail} FAILED` : "\nall people-task tests passed");
  process.exit(fail ? 1 : 0);
})();
