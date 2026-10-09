// Team fields in emails (9 Oct 2026): {{sender.fullName}}, {{partner.*}} (the one
// other partner), {{partners.*}} (every partner except the sender) and
// {{team.<key>.*}} (a named person, whoever sends). Real sends through outreachSend.
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
const R = require("../outreach/render.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const send = async (data) => { try { return await fns.outreachSend({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const last = () => sends[sends.length - 1];
let n = 0; const rid = () => `reqTEAMFIELDS${String(++n).padStart(6, "0")}`;
const S = { andre: "an.rocha@mail.douropartners-team.pt", antonio: "an.carvalho@mail.douropartners-team.pt", ines: "ines.silva@mail.douropartners-team.pt" };

function seed(extraPartner = false) {
  store.clear(); sends.length = 0;
  store.set("outreachSettings/global", { testMode: false });
  store.set(`outreachSenders/${S.andre}`, { email: S.andre, displayName: "André Rocha", owner: "andre", status: "active", dailyCap: 25 });
  store.set(`outreachSenders/${S.antonio}`, { email: S.antonio, displayName: "António Carvalho", owner: "antonio", status: "active", dailyCap: 25 });
  store.set(`outreachSenders/${S.ines}`, { email: S.ines, displayName: "Inês Silva", owner: "ines", status: "active", dailyCap: 25 });
  store.set("teamDirectory/andre", { key: "andre", name: "André Rocha", partner: true, active: true });
  store.set("teamDirectory/antonio", { key: "antonio", name: "António Carvalho", partner: true, active: true });
  store.set("teamDirectory/ines", { key: "ines", name: "Inês Silva", partner: false, active: true });
  store.set("teamDirectory/teste", { key: "teste", name: "Teste Intern", partner: false, active: false });
  if (extraPartner) store.set("teamDirectory/maria", { key: "maria", name: "Maria Silva", partner: true, active: true });
  store.set("searchCompanies/co1", { name: "METALURGICA SILVA, LDA", emailName: "Metalúrgica Silva", stage: "universe", owner: "andre", companyEmail: "geral@silva.pt", contacts: [] });
}
const body = (who, text) => send({ companyId: "co1", senderId: S[who], subject: "Olá", body: text, requestId: rid() });

(async () => {
  console.log("=== helper ===");
  ok("joinPt: 'A', 'A e B', 'A, B e C'", R.joinPt(["A"]) === "A" && R.joinPt(["A", "B"]) === "A e B" && R.joinPt(["A", "B", "C"]) === "A, B e C");


  console.log("=== two partners ===");
  seed();
  let r = await body("andre", "O meu nome é {{sender.firstName}} ({{sender.fullName}}) e, com o meu sócio {{partner.fullName}}, lidero a Douro Partners. {{partners.firstNames}}.");
  ok("André sends: partner = António Carvalho; sender.fullName = André Rocha", r.ok && last().text.startsWith("O meu nome é André (André Rocha) e, com o meu sócio António Carvalho, lidero a Douro Partners. António."));
  r = await body("antonio", "Com o meu sócio {{partner.firstName}} ({{partner.fullName}}).");
  ok("António sends: partner = André Rocha", r.ok && last().text.startsWith("Com o meu sócio André (André Rocha)."));
  r = await body("andre", "Assinado {{sender.name}}.");
  ok("{{sender.name}} still works (older templates)", r.ok && last().text.startsWith("Assinado André Rocha."));

  console.log("=== the intern sends ===");
  r = await body("ines", "Escrevo em nome dos sócios {{partners.fullNames}} ({{partners.firstNames}}); {{team.andre.fullName}} e {{team.antonio.firstName}}.");
  ok("partners.* = André Rocha e António Carvalho; team.* named people work", r.ok && last().text.startsWith("Escrevo em nome dos sócios André Rocha e António Carvalho (André e António); André Rocha e António."));
  r = await body("ines", "Com o meu sócio {{partner.fullName}}.");
  ok("partner.* refused for a non-partner sender, with the reason", r.err?.details?.reason === "missing_variables" && /exactly one other partner/.test(r.err.message) && /partners\.fullNames/.test(r.err.message));
  r = await body("ines", "{{partner.fullName|Os sócios}} cumprimentam.");
  ok("…unless a fallback is given", r.ok && last().text.startsWith("Os sócios cumprimentam."));
  r = await body("ines", "{{team.teste.fullName}}");
  ok("someone who left Team isn't a field (refused, no fallback)", r.err?.details?.reason === "missing_variables");

  console.log("=== three partners ===");
  seed(true);
  const realNow = Date.now; Date.now = () => realNow() + 6 * 60 * 1000; // the server re-reads Team after 5 minutes
  r = await body("andre", "Com os meus sócios {{partners.fullNames}}.");
  ok("André sends: partners.* = António Carvalho e Maria Silva", r.ok && last().text.startsWith("Com os meus sócios António Carvalho e Maria Silva."));
  r = await body("andre", "Com o meu sócio {{partner.fullName}}.");
  ok("partner.* refused with two other partners", r.err?.details?.reason === "missing_variables");
  const c3 = R.teamContext([{ key: "andre", name: "André Rocha", partner: true }, { key: "antonio", name: "António Carvalho", partner: true }, { key: "maria", name: "Maria Silva", partner: true }, { key: "ines", name: "Inês Silva" }], "ines");
  ok("intern with three partners: partners.fullNames lists all three, André first", c3.partners.fullNames === "André Rocha, António Carvalho e Maria Silva" && c3.partner.fullName === "");
  Date.now = realNow;

  if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
  console.log("\nALL PASSED");
})();
