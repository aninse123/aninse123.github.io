// Email fields for the formal templates (9 Oct 2026): owners in emails
// ({{owner.of}} / {{owner.with}} / {{owner.names}}), {{company.inCity}},
// {{campaign.sector}}, {{sender.bookingLink}}, the "only if" field
// {{?field|text}} and templates that sign themselves. Real sends through
// outreachSend and the scheduler; the booking link through teamAccess.
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
const P = require("../outreach/places.js");
const { normalizeCampaign } = require("../outreach/campaign_util.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const send = async (data) => { try { return await fns.outreachSend({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const team = async (data) => { try { return await fns.teamAccess({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const last = () => sends[sends.length - 1];
let n = 0; const rid = () => `reqEMAILFIELDS${String(++n).padStart(6, "0")}`;
const SENDER = "an.rocha@mail.douropartners-team.pt";
const SIG = "André Rocha\nDouro Partners";

function seed({ booking = "", owners = null, concelho = "Cinfaes" } = {}) {
  store.clear(); sends.length = 0;
  store.set("outreachSettings/global", { testMode: false });
  store.set(`outreachSenders/${SENDER}`, { email: SENDER, displayName: "André Rocha", owner: "andre", status: "active", dailyCap: 25, signature: SIG, signatures: [{ name: "Curta", text: "André" }] });
  store.set("teamDirectory/andre", { key: "andre", name: "André Rocha", partner: true, active: true, contactPhone: "+351 917 995 784", bookingLink: booking || null });
  store.set("teamDirectory/antonio", { key: "antonio", name: "António Carvalho", partner: true, active: true });
  store.set("searchCompanies/co1", { name: "HANDLE - EMPRESA DE TRABALHO TEMPORARIO, LDA", emailName: "Handle", stage: "universe", owner: "andre", companyEmail: "geral@handle.pt", contacts: [], concelho, ...(owners ? { emailOwners: owners } : {}) });
}
const body = (text, extra = {}) => send({ companyId: "co1", senderId: SENDER, subject: "Confidencial | Douro Partners", body: text, requestId: rid(), ...extra });

(async () => {
  console.log("=== helpers ===");
  ok("joinOu: 'A', 'A ou B', 'A, B ou C'", R.joinOu(["A"]) === "A" && R.joinOu(["A", "B"]) === "A ou B" && R.joinOu(["A", "B", "C"]) === "A, B ou C" && R.joinOu([]) === "");
  const o = R.ownerContext({ emailOwners: [{ name: "Carlos Cabaça", gender: "M" }, { name: " Ana  Dias ", gender: "F" }, { name: "Pemchhiri Sherpa", gender: "" }, { name: "Quarto", gender: "M" }] });
  ok("owner.of: Senhor / Senhora / no title, joined with ou, max 3", o.of === "do Senhor Carlos Cabaça, da Senhora Ana Dias ou de Pemchhiri Sherpa");
  ok("owner.with and owner.names", o.with === "o Senhor Carlos Cabaça, a Senhora Ana Dias ou Pemchhiri Sherpa" && o.names === "Carlos Cabaça, Ana Dias ou Pemchhiri Sherpa");
  const none = R.ownerContext({});
  ok("no owners: empty fields (the template's fallback is used)", none.of === "" && none.with === "" && none.names === "");
  ok("inCity: preposition + accents; any spelling of the concelho", P.inCityOf("Cinfaes") === "em Cinfães" && P.inCityOf("PORTO") === "no Porto" && P.inCityOf("Setúbal") === "em Setúbal" && P.inCityOf("figueira da  foz") === "na Figueira da Foz" && P.inCityOf("Maia") === "na Maia");
  ok("inCity: a municipality not validated yet → empty", P.inCityOf("Caldas da Rainha") === "" && P.inCityOf("") === "");
  ok("the campaign's 39 municipalities are listed", Object.keys(P.IN_CITY).length === 39);

  console.log("=== only-if field {{?x|text}} ===");
  const ctxB = R.buildContext({ company: {}, sender: { displayName: "André Rocha", bookingLink: "https://cal.com/andre" } });
  const ctxN = R.buildContext({ company: {}, sender: { displayName: "André Rocha" } });
  const tpl = "Ligue{{?sender.bookingLink| ou marque em {{sender.bookingLink}}}}.";
  ok("with a value: the text, fields inside filled", R.renderTemplate(tpl, ctxB).text === "Ligue ou marque em https://cal.com/andre." && !R.renderTemplate(tpl, ctxB).missing.length);
  ok("without: nothing, and not counted as missing", R.renderTemplate(tpl, ctxN).text === "Ligue." && !R.renderTemplate(tpl, ctxN).missing.length);
  ok("a plain empty field is still missing", R.renderTemplate("{{sender.bookingLink}}", ctxN).missing[0] === "sender.bookingLink");

  console.log("=== real sends ===");
  const FORMAL = "Agradecemos que faça chegar esta mensagem à atenção {{owner.of|da gerência}}. Gostaríamos de conversar com {{owner.with|a gerência}}. Teríamos todo o gosto em reunir pessoalmente {{company.inCity|nas vossas instalações}}. Poderá ligar para {{sender.phone}}{{?sender.bookingLink| ou agendar via: {{sender.bookingLink}}}}.";
  seed({ owners: [{ name: "Carlos Cabaça", gender: "M" }, { name: "Bruno Cabaça", gender: "M" }], booking: "https://cal.com/andre-rocha" });
  let r = await body(FORMAL);
  ok("owners, municipality and booking link filled", r.ok && last().text.startsWith("Agradecemos que faça chegar esta mensagem à atenção do Senhor Carlos Cabaça ou do Senhor Bruno Cabaça. Gostaríamos de conversar com o Senhor Carlos Cabaça ou o Senhor Bruno Cabaça. Teríamos todo o gosto em reunir pessoalmente em Cinfães. Poderá ligar para +351 917 995 784 ou agendar via: https://cal.com/andre-rocha."));
  seed({ concelho: "Caldas da Rainha" });
  r = await body(FORMAL);
  ok("no owners / municipality / booking link: fallbacks, sentence without the link", r.ok && last().text.startsWith("Agradecemos que faça chegar esta mensagem à atenção da gerência. Gostaríamos de conversar com a gerência. Teríamos todo o gosto em reunir pessoalmente nas vossas instalações. Poderá ligar para +351 917 995 784."));
  r = await body("No setor {{campaign.sector|em que a {{company.shortName}} atua}}.");
  ok("Compose (no campaign): campaign.sector uses the fallback", r.ok && last().text.startsWith("No setor em que a Handle atua."));
  r = await body("{{owner.of}}");
  ok("owner.of without a fallback and no owners: refused as missing", r.err?.details?.reason === "missing_variables");

  console.log("=== the template signs ===");
  seed();
  store.set("outreachTemplates/tSigns", { name: "Formal", status: "active", signs: true, variants: [{ key: "A", subject: "Confidencial", body: "Texto.\n\nCom os melhores cumprimentos,\n{{team.andre.fullName}} & {{team.antonio.fullName}}\nDouro Partners" }] });
  store.set("outreachTemplates/tPlain", { name: "Plain", status: "active", variants: [{ key: "A", subject: "Olá", body: "Texto." }] });
  r = await send({ companyId: "co1", senderId: SENDER, templateId: "tSigns", variantKey: "A", requestId: rid() });
  ok("signs: the template's sign-off, no address signature", r.ok && last().text.includes("André Rocha & António Carvalho\nDouro Partners") && !last().text.includes(SIG));
  r = await send({ companyId: "co1", senderId: SENDER, templateId: "tPlain", variantKey: "A", requestId: rid() });
  ok("a template that doesn't sign: the address signature as before", r.ok && last().text.includes(SIG));
  r = await send({ companyId: "co1", senderId: SENDER, templateId: "tSigns", variantKey: "A", signatureName: "Curta", requestId: rid() });
  ok("signs, but a signature picked in Compose: that one is added", r.ok && /\n\nAndré(\n|$)/.test(last().text));

  console.log("=== campaign sector ===");
  const c0 = normalizeCampaign({ name: "X", sector: "  do trabalho   temporário " });
  ok("sector saved, spaces tidied", c0.sector === "do trabalho temporário");
  ok("a save without the sector keeps the stored one", normalizeCampaign({ name: "X2" }, { ...c0 }).sector === "do trabalho temporário" && normalizeCampaign({ name: "X3" }).sector === "");
  const { runScheduler } = require("../outreach/scheduler.js");
  seed({ owners: [{ name: "Maria Patriarca", gender: "F" }] });
  store.set("outreachTemplates/t1", { name: "Intro", status: "active", signs: true, variants: [{ key: "A", subject: "Confidencial | Douro Partners", body: "Empresas no setor {{campaign.sector|em que a {{company.shortName}} atua}}, ao cuidado {{owner.of|da gerência}}.\n\n{{sender.fullName}}" }] });
  const cid = (await camp({ action: "save", campaign: { name: "78.20", sector: "do trabalho temporário", approvalDefault: "auto", steps: [{ templateId: "t1" }] } })).campaignId;
  await camp({ action: "enrol", campaignId: cid, companyIds: ["co1"] });
  await camp({ action: "setStatus", campaignId: cid, status: "active" });
  await runScheduler({ now: new Date("2026-09-29T10:30:00+01:00"), gap: null, rand: () => 0 });
  ok("scheduler: campaign.sector + owner.of, template signs (no address signature)", sends.length === 1 && last().text.startsWith("Empresas no setor do trabalho temporário, ao cuidado da Senhora Maria Patriarca.\n\nAndré Rocha") && !last().text.includes("Douro Partners"));

  console.log("=== Team: booking link ===");
  store.clear();
  await team({ action: "seed" });
  let t = await team({ action: "update", email: "andre.rocha@douropartners.pt", member: { bookingLink: "https://cal.com/andre-rocha" } });
  ok("saved on the person and copied to the directory", !t.err && store.get("team/andre.rocha@douropartners.pt").bookingLink === "https://cal.com/andre-rocha" && store.get("teamDirectory/andre")?.bookingLink === "https://cal.com/andre-rocha");
  t = await team({ action: "update", email: "andre.rocha@douropartners.pt", member: { contactPhone: "+351 917 995 784" } });
  ok("another change keeps the link", !t.err && store.get("team/andre.rocha@douropartners.pt").bookingLink === "https://cal.com/andre-rocha");
  t = await team({ action: "update", email: "andre.rocha@douropartners.pt", member: { bookingLink: "cal.com/andre" } });
  ok("not https:// → refused", t.err?.details?.reason === "bad_booking_link");
  t = await team({ action: "update", email: "andre.rocha@douropartners.pt", member: { bookingLink: "" } });
  ok("cleared", !t.err && !store.get("teamDirectory/andre")?.bookingLink);

  if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
  console.log("\nALL PASSED");
})();
