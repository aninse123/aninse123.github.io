// {{recipient.greeting}} (20 Nov 2026, switch outreach.recipientGreeting): "Exmo. Senhor José Silva" / "Exma. Senhora Maria José Santos" —
// the name as used in emails (Owners in emails, else first given name(s) + last surname; Maria / Ana keep the second given name; compound
// surnames whole), empty when the gender is unknown so the template's fallback applies. The scheduler fills it by the production setting
// (Test = test campaigns only), so live campaigns don't change until it is On. Synthetic data only.
const F = require("./fake_firebase.js");
const dns = require("dns").promises;
dns.resolveMx = async (d) => [{ exchange: "mx." + d, priority: 10 }];
const sends = [];
global.fetch = async (url, opts = {}) => {
  if (String(url).endsWith("/emails") && opts.method === "POST") sends.push(JSON.parse(opts.body));
  const hdrs = new Map([["x-resend-daily-quota", "5"], ["x-resend-monthly-quota", "50"]]);
  return { ok: true, status: 200, headers: { get: (h) => hdrs.get(h.toLowerCase()) ?? null }, text: async () => JSON.stringify({ id: "rs_" + sends.length }) };
};
const fns = require("../index.js");
const Feat = require("../features");
const RF = require("../outreach/recipient_fields.js");
const { buildContext, renderTemplate } = require("../outreach/render.js");
const { runScheduler } = require("../outreach/scheduler.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const get = (p) => store.get(p);
const SENDER = "an.rocha@mail.douropartners-team.pt";
const G = (name, owners = [], stored = null) => RF.greetingOf({ name, owners, stored });
const TPL = "{{recipient.greeting|Bom dia, {{recipient.firstName}}}},\n\nTexto.";

function seed(state, { name = "José Manuel da Silva", owners = [] } = {}) {
  store.clear(); sends.length = 0;
  store.set("config/features", { flags: { "outreach.recipientGreeting": { staging: "on", production: state } } }); Feat._reset();
  store.set(`outreachSenders/${SENDER}`, { email: SENDER, displayName: "André Rocha", owner: "andre", status: "active", dailyCap: 25, signature: "André" });
  store.set("outreachTemplates/t1", { name: "E1 v04", status: "active", variants: [{ key: "A", subject: "Olá", body: TPL }] });
  store.set("outreachSettings/global", { testMode: false, complianceBlockId: "cb" });
  store.set("outreachCompliance/cb", { legalEntityLine: "Douro Partners, Lda", footerText: "Remover: {{unsubscribeUrl}}" });
  store.set("searchCompanies/co1", { name: "METALURGICA SILVA, LDA", stage: "universe", owner: "andre", companyEmail: "geral@silva.pt", contacts: [], emailOwners: owners });
  store.set("searchPeople/p1", { name, email: "jose.silva@silva.pt" });
  store.set("searchPersonLinks/l1", { companyId: "co1", personId: "p1", personName: name, mgmtRoles: ["Sócio-Gerente"], mgmtCurrent: true, shTotalPct: 60 });
}
async function firstEmail(isTest = false) {
  const cid = (await camp({ action: "save", campaign: { name: "Pessoas", approvalDefault: "auto", recipientPolicy: "best_person", steps: [{ templateId: "t1" }], ...(isTest ? { isTest: true } : {}) } })).campaignId;
  if (isTest) store.set(`outreachCampaigns/${cid}`, { ...get(`outreachCampaigns/${cid}`), isTest: true, testRecipient: "andre.rocha@douropartners.pt" });
  await camp({ action: "enrol", campaignId: cid, companyIds: ["co1"] });
  await camp({ action: "setStatus", campaignId: cid, status: "active" });
  await runScheduler({ now: new Date("2026-09-29T10:30:00+01:00"), gap: null, rand: () => 0 });
  return sends[0]?.text || "";
}

(async () => {
  // ── The name as used in emails ──
  ok("CRM name in capitals: first given name + last surname, accented", G("JOSE MANUEL DA SILVA") === "Exmo. Senhor José Silva");
  ok("Maria keeps her second given name", G("MARIA JOSE SANTOS PEREIRA") === "Exma. Senhora Maria José Pereira");
  ok("Ana too; a particle before the surname is dropped", G("ANA MARIA DA COSTA") === "Exma. Senhora Ana Maria Costa");
  ok("Maria de Fátima stays whole", G("MARIA DE FATIMA RODRIGUES") === "Exma. Senhora Maria de Fátima Rodrigues");
  ok("a compound surname is never cut: Castelo Branco, Silva e Costa, Sousa-Tavares", G("JOAO PEDRO CASTELO BRANCO") === "Exmo. Senhor João Castelo Branco" && G("ANTONIO SILVA E COSTA") === "Exmo. Senhor António Silva e Costa" && G("RUI SOUSA-TAVARES") === "Exmo. Senhor Rui Sousa-Tavares");
  ok("a name typed with its own capitals is kept as typed", G("Rui de Sousa McLeod") === "Exmo. Senhor Rui McLeod");
  ok("the person is in Owners in emails: that name and gender", G("JOSE MANUEL DA SILVA", [{ name: "José Manuel Silva", gender: "M" }]) === "Exmo. Senhor José Manuel Silva");
  ok("…an owner with another surname is someone else", G("JOSE MANUEL DA SILVA", [{ name: "José Costa", gender: "M" }]) === "Exmo. Senhor José Silva");
  ok("gender unknown: empty (the template's fallback)", G("KIM LEE") === "" && G("ARIEL COSTA") === "");
  ok("a gender typed on the person wins", G("ARIEL COSTA", [], { gender: "F", source: "typed" }) === "Exma. Senhora Ariel Costa");
  ok("a general address: empty", G("") === "");

  // ── The field in the context ──
  const ctx = (greeting) => buildContext({ company: {}, contactName: "Maria José Santos Pereira", greeting });
  ok("off for this send: empty, the template says \"Bom dia, Maria,\"", renderTemplate(TPL, ctx(false)).text.startsWith("Bom dia, Maria,"));
  ok("on: \"Exma. Senhora Maria José Pereira,\"", renderTemplate(TPL, ctx(true)).text.startsWith("Exma. Senhora Maria José Pereira,"));

  // ── The scheduler follows the production setting ──
  seed("off");
  ok("production Off: a real campaign's email 1 keeps \"Bom dia, José,\"", (await firstEmail()).startsWith("Bom dia, José,"));
  seed("test");
  ok("production Test: a real campaign is unchanged", (await firstEmail()).startsWith("Bom dia, José,"));
  seed("test");
  ok("production Test: a test campaign gets \"Exmo. Senhor José Silva,\"", (await firstEmail(true)).startsWith("Exmo. Senhor José Silva,"));
  seed("on", { owners: [{ name: "José Manuel Silva", gender: "M" }] });
  ok("production On: the real campaign gets it, with the Owners in emails name", (await firstEmail()).startsWith("Exmo. Senhor José Manuel Silva,"));
  seed("on", { name: "Kim Lee" });
  ok("On, gender unknown: the fallback \"Bom dia, Kim,\"", (await firstEmail()).startsWith("Bom dia, Kim,"));

  console.log(fail ? `\n${fail} FAILED` : "\nAll passed");
  process.exit(fail ? 1 : 0);
})();
