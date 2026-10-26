// Email name check (26 Oct 2026, switch "search.emailNameCheck"): the rule that
// flags a wrong-looking name in emails, the suggestion, "Add companies", the
// action that fixes / keeps a name, the flag on drafts, and the short-name fix
// ("SOUSA, LDA" no longer loses its "SA"). Synthetic data only.
const F = require("./fake_firebase.js");
const dns = require("dns").promises;
dns.resolveMx = async (d) => [{ exchange: "mx." + d, priority: 10 }];
global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ id: "rs_1" }) });
const fns = require("../index.js");
const Feat = require("../features");
const EN = require("../outreach/email_name_check.js");
const { shortCompanyName } = require("../outreach/render.js");
const { runScheduler } = require("../outreach/scheduler.js");
const { store, Timestamp } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data, who = ADMIN) => { try { return await fns.outreachCampaign({ ...who, data }); } catch (e) { return { err: e }; } };
const get = (p) => store.get(p);
const docs = (coll) => [...store.entries()].filter(([p]) => p.startsWith(coll + "/")).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));
function flags(state) { store.set("config/features", { flags: { "search.emailNameCheck": { staging: state, production: state } } }); Feat._reset(); }

function seed() {
  store.clear();
  store.set("outreachSettings/global", { testMode: false, dailyTarget: 100 });
  store.set("outreachSenders/an.rocha@mail.douropartners-team.pt", { email: "an.rocha@mail.douropartners-team.pt", displayName: "André Rocha", owner: "andre", status: "active", dailyCap: 25, signature: "A" });
  store.set("teamDirectory/andre", { key: "andre", name: "André Rocha", partner: true, active: true });
  store.set("outreachTemplates/t1", { name: "Intro", status: "active", variants: [{ key: "A", subject: "Olá {{company.shortName}}", body: "Sobre a {{company.shortName}}. Corpo." }] });
  const co = (id, data) => store.set(`searchCompanies/${id}`, { stage: "universe", companyEmail: `geral@${id}.pt`, owner: "andre", contacts: [], ownGraphAt: Timestamp.now(), ownGroupSize: 1, ownSubs: 0, ownParents: 0, ownOwnerOther: 0, ...data });
  co("cafe", { name: "PAIVA & SILVA, LDA", akaName: "CAFE TONY", caeCode: "47300" });
  co("pv", { name: "PORTUGAL CAPITAL VENTURES - SOCIEDADE DE CAPITAL DE RISCO, S.A.", emailName: "Pv", caeCode: "64992" });
  co("ok", { name: "TN - TRANSPORTES, S.A.", emailName: "TN", caeCode: "49410" });
  co("rest", { name: "O SINO - EXPLORACAO DE RESTAURANTES, S.A.", emailName: "Restaurante o Sino", caeCode: "56101" });
}

(async () => {
  // ── The rule ──
  const c = (d) => ({ name: "X, LDA", caeCode: "", ...d });
  const kinds = (d) => EN.nameIssues(c(d)).map((i) => i.kind).join(",");
  ok("a trade name naming another activity than the CAE: 'Café Tony' for a fuel station → 'names a café'", kinds({ name: "PAIVA & SILVA, LDA", akaName: "CAFE TONY", caeCode: "47300" }) === "activity" && /names a café — the company's CAE is 47300/.test(EN.nameIssues(c({ name: "PAIVA & SILVA, LDA", akaName: "CAFE TONY", caeCode: "47300" }))[0].text));
  ok("…not when the CAE matches (a restaurant called Restaurante) or the legal name has the word", kinds({ emailName: "Restaurante o Sino", caeCode: "56101" }) === "" && kinds({ name: "CAFE CENTRAL, LDA", emailName: "Café Central", caeCode: "47300" }) === "");
  ok("legal-form words, a short name not in the legal name, capitals, extra spaces", kinds({ emailName: "Endutex SGPS" }) === "legalform" && kinds({ name: "PORTUGAL CAPITAL VENTURES, S.A.", emailName: "Pv" }) === "acronym" && kinds({ emailName: "CASA NOVA SILVA" }) === "caps" && kinds({ emailName: "Casa  Nova" }) === "spaces");
  ok("not flagged: an acronym that starts the legal name ('TN' for 'TN - TRANSPORTES'), or 'S.A.C.L.' for 'S.A.C.L. SERVICOS…'", kinds({ name: "TN - TRANSPORTES, S.A.", emailName: "TN" }) === "" && kinds({ name: "S.A.C.L. SERVICOS DE AR CONDICIONADO, LDA", emailName: "S.A.C.L." }) === "");
  ok("a long name is a note (info), never a warning", EN.nameIssues(c({ emailName: "Santa Casa da Misericórdia de Figueiró dos Vinhos e Arredores" }))[0]?.level === "info" && !EN.hasWarning(c({ emailName: "Santa Casa da Misericórdia de Figueiró dos Vinhos e Arredores" })));
  ok("a name someone kept is never flagged again — until it changes", kinds({ emailName: "Pv", name: "PORTUGAL CAPITAL VENTURES, S.A.", emailNameChecked: { name: "Pv" } }) === "" && kinds({ emailName: "PV2", name: "PORTUGAL CAPITAL VENTURES, S.A.", emailNameChecked: { name: "Pv" } }) === "acronym");
  ok("suggestion: the legal name's short form with accents ('Construções Durão', 'Endutex', 'Teatro Nacional de São João')", EN.suggestedName({ name: "CONSTRUCOES DURAO, S.A." }) === "Construções Durão" && EN.suggestedName({ name: "ENDUTEX SOCIEDADE GESTORA DE PARTICIPACOES SOCIAIS (SGPS),S.A" }) === "Endutex" && EN.suggestedName({ name: "TEATRO NACIONAL DE SAO JOAO, E.P.E." }) === "Teatro Nacional de São João");
  ok("short-name fix: 'SONIA SILVA & SOUSA, LDA' keeps 'Sousa'; 'EQ+, UNIPESSOAL LDA' → 'EQ+'", shortCompanyName("SONIA SILVA & SOUSA, LDA") === "Sonia Silva & Sousa" && shortCompanyName("EQ+, UNIPESSOAL LDA") === "EQ+" && shortCompanyName("VALDEMAR MORAIS DE MELO, SOCIEDADE UNIPESSOAL, LDA") === "Valdemar Morais de Melo");
  ok("where the name comes from: typed / Orbis trade name / legal name", EN.nameSource({ emailName: "A" }) === "typed" && EN.nameSource({ akaName: "B" }) === "trade" && EN.nameSource({ name: "C, LDA" }) === "legal");

  // ── Add companies ──
  seed(); flags("on");
  const { campaignId: k1 } = await camp({ action: "save", campaign: { name: "Teste", approvalDefault: "approval", steps: [{ templateId: "t1" }] } });
  let pv = await camp({ action: "preview", campaignId: k1, companyIds: ["cafe", "pv", "ok", "rest"] });
  const ids = (pv.nameCheck || []).map((x) => x.companyId).sort().join(",");
  ok("preview lists the flagged companies (Café Tony, Pv) with the name, where it comes from, why and the suggestion", ids === "cafe,pv" && pv.nameCheck.find((x) => x.companyId === "cafe").suggestion === "Paiva & Silva" && pv.nameCheck.find((x) => x.companyId === "cafe").source === "trade");
  flags("off");
  pv = await camp({ action: "preview", campaignId: k1, companyIds: ["cafe", "pv"] });
  ok("switch Off: no list", pv.nameCheck === null);

  // ── The action ──
  let r = await camp({ action: "emailName", companyId: "cafe", op: "use" });
  ok("switch Off: the action is refused", r.err?.details?.reason === "feature_off");
  flags("on");
  r = await camp({ action: "emailName", companyId: "cafe", op: "use" });
  const cafe = get("searchCompanies/cafe");
  ok("'Use the legal name' → emailName 'Paiva & Silva', its words searchable, logged", r.emailName === "Paiva & Silva" && cafe.emailName === "Paiva & Silva" && (cafe.nameTokens || []).includes("PAIVA") && (cafe.namePrefixes || []).includes("PAI") && docs("searchActivities").some((a) => a.companyId === "cafe" && /Email name changed: "Cafe Tony" → "Paiva & Silva" \(the legal name\)/.test(a.content)));
  r = await camp({ action: "emailName", companyId: "pv", op: "set", name: "  Portugal   Ventures " });
  ok("a typed name is saved tidy and counts as checked", r.emailName === "Portugal Ventures" && get("searchCompanies/pv").emailNameChecked?.name === "Portugal Ventures" && !EN.hasWarning(get("searchCompanies/pv")));
  store.set("searchCompanies/pv", { ...get("searchCompanies/pv"), emailName: "Pv", emailNameChecked: null });
  r = await camp({ action: "emailName", companyId: "pv", op: "keep" });
  ok("'Keep' marks today's name as checked and logs it; not flagged any more", r.kept === true && get("searchCompanies/pv").emailNameChecked?.name === "Pv" && !EN.hasWarning({ id: "pv", ...get("searchCompanies/pv") }) && docs("searchActivities").some((a) => a.companyId === "pv" && /Email name "Pv" checked and kept/.test(a.content)));
  r = await camp({ action: "emailName", companyId: "pv", op: "set", name: "   " });
  ok("an empty typed name is refused", r.err?.details?.reason === "name_required");
  r = await camp({ action: "emailName", companyId: "pv", op: "keep" }, { auth: { token: { email: "nobody@example.com" } } });
  ok("someone without company edit rights is refused", !!r.err);

  // ── On the draft to approve ──
  seed(); flags("on");
  const { campaignId: k2 } = await camp({ action: "save", campaign: { name: "Drafts", approvalDefault: "approval", steps: [{ templateId: "t1" }] } });
  await camp({ action: "enrol", campaignId: k2, companyIds: ["rest", "pv"] });
  await camp({ action: "setStatus", campaignId: k2, status: "active" });
  await runScheduler({ now: new Date("2026-09-29T10:30:00+01:00"), gap: null, rand: () => 0 });
  const dPv = docs("outreachMessages").find((m) => m.companyId === "pv" && m.status === "draft");
  const dRest = docs("outreachMessages").find((m) => m.companyId === "rest" && m.status === "draft");
  ok("the draft for 'Pv' carries the warning (name, why, suggestion); the fine one doesn't", dPv?.nameCheck?.emailName === "Pv" && /short name/.test(dPv.nameCheck.issues[0]) && dPv.nameCheck.suggestion === "Portugal Capital Ventures" && dRest && !dRest.nameCheck);

  console.log(fail ? `${fail} email-name test(s) FAILED` : "all email-name tests passed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
