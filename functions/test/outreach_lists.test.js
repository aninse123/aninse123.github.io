// Phase 5 — dynamic lists: the filter a list was built from is re-applied each
// time it's used (Investor CRM stage, portal access group, Network categories /
// phases / owner, brokers), and a recurring issue goes to whoever matches then.
const F = require("./fake_firebase.js");
const dns = require("dns").promises;
dns.resolveMx = async (d) => [{ exchange: "mx." + d, priority: 10 }];
global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ id: "x" }) });
const fns = require("../index.js");
const L = require("../outreach/lists.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const rec = async (data) => { try { return await fns.outreachRecurring({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const emails = (ps) => ps.map((p) => p.email).sort().join(",");

(async () => {
  store.set("crmInvestors/i1", { name: "Fundo A", stage: "dd", contacts: [{ name: "Ana", email: "ana@a.pt" }, { name: "Sem email" }] });
  store.set("crmInvestors/i2", { name: "Fundo B", stage: "pass", contacts: [{ name: "Bia", email: "bia@b.pt" }] });
  store.set("investors/p1", { name: "Fundo A", emails: ["ana@a.pt", "ops@a.pt"] });
  store.set("investors/p2", { name: "Fundo C", emails: ["c@c.pt"] });
  store.set("accessGroups/g1", { name: "LPs", investorIds: ["p1"] });
  store.set("networkFirms/f1", { name: "Jornal X" });
  store.set("networkContacts/n1", { name: "Rui", email: "rui@x.pt", firmId: "f1", categories: ["journalist"], phases: ["fundraising"], owner: "andre" });
  store.set("networkContacts/n2", { name: "Eva", email: "eva@y.pt", categories: ["lawyer"], phases: [], owner: "antonio" });
  store.set("searchBrokers/b1", { name: "Broker Z", contacts: [{ name: "Zé", email: "ze@z.pt" }] });

  ok("Investor CRM by stage", emails(await L.resolveDynamic({ mode: "crm", stages: ["dd"] })) === "ana@a.pt");
  ok("Investor CRM, every stage", emails(await L.resolveDynamic({ mode: "crm" })) === "ana@a.pt,bia@b.pt");
  const pg = await L.resolveDynamic({ mode: "portal", groupId: "g1" });
  ok("portal by access group; the organisation isn't a person's name", emails(pg) === "ana@a.pt,ops@a.pt" && pg[0].name === "" && pg[0].org === "Fundo A");
  const nw = await L.resolveDynamic({ mode: "network", categories: ["journalist"], owner: "andre" });
  ok("Network by category + owner, organisation from the firm", emails(nw) === "rui@x.pt" && nw[0].org === "Jornal X" && nw[0].refs[0].source === "network");
  ok("Network by phase", emails(await L.resolveDynamic({ mode: "network", phases: ["fundraising"] })) === "rui@x.pt");
  ok("brokers", emails(await L.resolveDynamic({ mode: "brokers" })) === "ze@z.pt");
  ok("unknown mode → nobody", (await L.resolveDynamic({ mode: "x" })).length === 0 && L.cleanDynamic({ mode: "x" }) === null);

  // A recurring issue to a dynamic list goes to whoever matches on the day
  store.set("outreachSettings/global", { testMode: false, complianceBlockId: "cb" });
  store.set("outreachCompliance/cb", { legalEntityLine: "Douro Partners, Lda", footerText: "Remover: {{unsubscribeUrl}}" });
  await fns.outreachAdmin({ ...ADMIN, data: { action: "seed" } });
  store.set("outreachTemplates/t", { name: "Upd", status: "active", variants: [{ key: "A", subject: "Olá", body: "{{contact.firstName|Olá}}." }] });
  store.set("outreachLists/D", { name: "Jornalistas", count: 1, dynamic: { mode: "network", categories: ["journalist"] } });
  const rid = (await rec({ action: "save", recurring: { name: "Imprensa", listId: "D", templateId: "t", senderId: "andre.rocha@douropartners.pt" } })).recurringId;
  store.set("networkContacts/n3", { name: "Nova", email: "nova@jornal.pt", categories: ["journalist"] }); // joins after the list was made
  const n = await rec({ action: "issueNow", recurringId: rid });
  const ap = await rec({ action: "approveIssue", issueId: n.issueId });
  ok("issue to a dynamic list: the new journalist is included, count refreshed", ap.enrolled === 2 && store.get("outreachLists/D").count === 2);

  console.log(fail ? `\n${fail} FAILED` : "\nall list tests passed");
  process.exit(fail ? 1 : 0);
})();
