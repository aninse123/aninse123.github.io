// CCSL (9 Oct 2026): the email footer is optional and off by default — per
// email, else the conversation's first email / the campaign, else Settings.
// One-to-one emails (Investor CRM / Network) may carry the entity line and the
// privacy mention, never the removal link. Real sends no longer need a footer.
const F = require("./fake_firebase.js");
const dns = require("dns").promises;
dns.resolveMx = async (d) => [{ exchange: "mx." + d, priority: 10 }];
const sends = [], batches = [];
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  let out = { id: "rs_" + (sends.length + 1) };
  if (u.endsWith("/emails/batch")) { const emails = JSON.parse(opts.body); batches.push(emails); out = { data: emails.map((_, i) => ({ id: `rb_${batches.length}_${i}` })) }; }
  else if (u.endsWith("/emails") && opts.method === "POST") sends.push(JSON.parse(opts.body));
  const hdrs = new Map([["x-resend-daily-quota", "5"], ["x-resend-monthly-quota", "50"]]);
  return { ok: true, status: 200, headers: { get: (h) => hdrs.get(h.toLowerCase()) ?? null }, text: async () => JSON.stringify(out) };
};

const fns = require("../index.js");
const R = require("../outreach/render.js");
const U = require("../outreach/campaign_util.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const send = async (data) => { try { return await fns.outreachSend({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const people = async (data) => { try { return await fns.outreachPeopleSend({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const SENDER = "an.rocha@mail.douropartners-team.pt";
const last = () => sends[sends.length - 1];
let n = 0;
const rid = () => `reqFOOTER${String(++n).padStart(8, "0")}`;

function seed(settings = {}, block = { legalEntityLine: "Valesintemporais, Lda · NIPC 517000000", footerText: "Remover: {{unsubscribeUrl}}" }) {
  store.clear(); sends.length = 0; batches.length = 0;
  store.set(`outreachSenders/${SENDER}`, { email: SENDER, displayName: "André Rocha", owner: "andre", status: "active", dailyCap: 25, signature: "André" });
  store.set("outreachSettings/global", { testMode: false, ...settings });
  if (block) store.set("outreachCompliance/default", block);
  store.set("searchCompanies/co1", { name: "METALURGICA SILVA, LDA", stage: "universe", owner: "andre", companyEmail: "geral@silva.pt", contacts: [] });
}
const newEmail = (extra = {}) => send({ companyId: "co1", senderId: SENDER, subject: "Olá", body: "Texto.", requestId: rid(), ...extra });

(async () => {
  console.log("=== helpers ===");
  ok("wantsFooter: the email's choice wins, then the inherited one, then the default (off unless true)",
    R.wantsFooter(true, false, false) === true && R.wantsFooter(null, true, false) === true && R.wantsFooter(undefined, undefined, true) === true && R.wantsFooter(undefined, undefined, undefined) === false && R.wantsFooter(false, true, true) === false);
  ok("footerSource: entity line + text; [___] placeholder lines left out",
    R.footerSource({ legalEntityLine: "Douro Partners, Lda. · NIPC [___] · [morada]", footerText: "Remover: x" }) === "Remover: x");
  ok("footerSource: privacy mention only when ticked; one-to-one never gets the removal text",
    R.footerSource({ legalEntityLine: "E", footerText: "Remover", mentionPrivacy: true }, { oneToOne: true }) === "E\n" + R.PRIVACY_LINE && !R.footerSource({ legalEntityLine: "E" }).includes("privacidade"));
  ok("campaigns keep true / false / null (= Settings default)",
    U.normalizeCampaign({ name: "x", footer: true }).footer === true && U.normalizeCampaign({ name: "x", footer: false }).footer === false && U.normalizeCampaign({ name: "x", footer: "yes" }).footer === null);

  console.log("=== company emails ===");
  seed({}, null);
  let r = await newEmail();
  ok("a real send works with no footer saved at all (no more compliance_missing)", r.ok === true && !last().text.includes("\n--\n") && !last().text.includes("[TESTE]"));
  ok("…and still carries Gmail's hidden one-click unsubscribe", /douropartners\.pt\/u\//.test(last().headers["List-Unsubscribe"]));

  seed();
  r = await newEmail();
  ok("default off: no footer even when one is saved", r.ok && !last().text.includes("Valesintemporais"));
  ok("message and conversation remember 'no footer'", store.get(`outreachMessages/${r.messageId}`).footer === false && store.get(`outreachThreads/${r.threadId}`).footer === false);

  r = await newEmail({ footer: true });
  ok("ticked for this email: entity line + removal link", last().text.includes("\n--\nValesintemporais, Lda · NIPC 517000000\nRemover: https://douropartners.pt/u/") && store.get(`outreachThreads/${r.threadId}`).footer === true);
  const t1 = r.threadId;
  r = await send({ threadId: t1, body: "Resposta." });
  ok("a reply follows its conversation (footer on)", r.ok && last().text.includes("Valesintemporais"));
  r = await send({ threadId: t1, body: "Outra.", footer: false });
  ok("…unless unticked for that reply", r.ok && !last().text.includes("Valesintemporais"));

  seed({ footerDefaults: { company: true, oneToOne: false } });
  r = await newEmail();
  ok("Settings default on: footer added", r.ok && last().text.includes("Remover: https://douropartners.pt/u/"));
  r = await newEmail({ footer: false });
  ok("…and unticked for one email: none", r.ok && !last().text.includes("Remover:"));

  seed({ footerDefaults: { company: true } }, { legalEntityLine: "Douro Partners, Lda. · NIPC [___] · [morada]", footerText: "Remover: {{unsubscribeUrl}}", mentionPrivacy: true });
  r = await newEmail();
  ok("the draft entity line with [___] never goes out; privacy mention added when ticked", r.ok && !last().text.includes("[___]") && last().text.includes("Remover:") && last().text.includes(R.PRIVACY_LINE));

  console.log("=== drafts keep the choice ===");
  seed();
  const WRITER = { auth: { token: { email: "ines@douropartners.pt", key: "ines", perms: ["out.draft"] } } };
  let d; try { d = await fns.outreachSend({ ...WRITER, data: { companyId: "co1", senderId: SENDER, subject: "Olá", body: "Texto.", requestId: rid(), footer: true } }); } catch (e) { d = { err: e }; }
  ok("a writer's draft stores the footer choice", d.draft === true && store.get(`outreachMessages/${d.messageId}`).request.footer === true);
  if (d.draft) {
    r = await send({ action: "approveDraft", messageId: d.messageId });
    ok("approved draft goes out with the footer", r.ok === true && last().text.includes("Valesintemporais"));
  }

  console.log("=== campaigns ===");
  const { runScheduler } = require("../outreach/scheduler.js");
  const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
  for (const [label, footer, dflt, expect] of [["campaign ticked, Settings off", true, false, true], ["campaign unticked, Settings on", false, true, false], ["campaign follows Settings (on)", null, true, true]]) {
    seed({ footerDefaults: { company: dflt } });
    store.set("outreachTemplates/t1", { name: "Intro", status: "active", variants: [{ key: "A", subject: "Olá {{company.shortName}}", body: "Escrevo sobre a {{company.shortName}}." }] });
    const cid = (await camp({ action: "save", campaign: { name: "C " + label, approvalDefault: "auto", footer, steps: [{ templateId: "t1" }] } })).campaignId;
    await camp({ action: "enrol", campaignId: cid, companyIds: ["co1"] });
    await camp({ action: "setStatus", campaignId: cid, status: "active" });
    await runScheduler({ now: new Date("2026-09-29T10:30:00+01:00"), gap: null, rand: () => 0 });
    ok(`${label}: ${expect ? "footer" : "no footer"}`, sends.length === 1 && last().text.includes("Valesintemporais") === expect);
  }

  console.log("=== one-to-one (Investor CRM / Network) ===");
  seed({}, { legalEntityLine: "Valesintemporais, Lda", footerText: "Remover: {{unsubscribeUrl}}", mentionPrivacy: true });
  let p = await people({ kind: "outreach", from: "andre", recipients: [{ email: "ana@fundo.pt", name: "Ana" }], subject: "Olá", message: "Texto" });
  ok("default off: no entity line", p.sent === 1 && !batches[0][0].html.includes("Valesintemporais"));
  p = await people({ kind: "outreach", from: "andre", recipients: [{ email: "ana@fundo.pt", name: "Ana" }], subject: "Olá", message: "Texto", footer: true });
  const h = batches[1][0].html;
  ok("ticked: entity line + privacy mention, never the removal link", h.includes("Valesintemporais, Lda") && h.includes("douropartners.pt/privacidade") && !h.includes("Remover"));
  seed({ footerDefaults: { oneToOne: true } }, { legalEntityLine: "Valesintemporais, Lda" });
  p = await people({ kind: "outreach", from: "andre", recipients: [{ email: "ana@fundo.pt" }], subject: "Olá", message: "Texto" });
  ok("one-to-one default on: entity line added", batches[0][0].html.includes("Valesintemporais, Lda"));
  p = await people({ recipients: [{ email: "ana@fundo.pt", name: "Fundo" }], subject: "Doc", message: "Texto", footer: true, docName: "R" });
  ok("investor notices (not relationship emails) are unchanged", !batches[1][0].html.includes("Valesintemporais"));

  if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
  console.log("\nALL PASSED");
})();
