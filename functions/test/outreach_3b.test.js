// Phase 3b — sending to a person: recipient list (company address, contacts,
// linked People), the send path's checks, {{contact.firstName}}, test-mode
// redirect, and the campaign "Send to" policy.
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
const { companyRecipients, pickByPolicy, rankPerson } = require("../outreach/recipients.js");
const U = require("../outreach/campaign_util.js");
const { runScheduler } = require("../outreach/scheduler.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const send = async (data) => { try { return await fns.outreachSend({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const get = (p) => store.get(p);
const docs = (coll) => [...store.entries()].filter(([p]) => p.startsWith(coll + "/")).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));
const SENDER = "an.rocha@mail.douropartners-team.pt";

function seed({ real = true } = {}) {
  store.clear(); sends.length = 0;
  store.set(`outreachSenders/${SENDER}`, { email: SENDER, displayName: "André Rocha", owner: "andre", status: "active", dailyCap: 25, signature: "André" });
  store.set("outreachTemplates/t1", { name: "Intro", status: "active", variants: [{ key: "A", subject: "Olá {{company.shortName}}", body: "{{contact.firstName|Bom dia}}, escrevo sobre a {{company.shortName}}." }] });
  store.set("outreachTemplates/t2", { name: "Follow", status: "active", variants: [{ key: "A", subject: "x", body: "Seguimento, {{contact.firstName|olá}}." }] });
  if (real) {
    store.set("outreachSettings/global", { testMode: false, complianceBlockId: "cb" });
    store.set("outreachCompliance/cb", { legalEntityLine: "Douro Partners, Lda", footerText: "Remover: {{unsubscribeUrl}}" });
  }
  store.set("searchCompanies/co1", {
    name: "METALURGICA SILVA, LDA", stage: "universe", owner: "andre", companyEmail: "geral@silva.pt",
    contacts: [{ name: "Rita Costa", role: "Financeira", email: "rita@silva.pt" }, { name: "Sem email", role: "x", email: "" }, { name: "Duplicado", email: "GERAL@silva.pt" }],
  });
  store.set("searchCompanies/co2", { name: "FAMILIA LOPES, LDA", stage: "universe", owner: "andre", companyEmail: "lopes.geral@gmail.com", contacts: [] });
  store.set("searchCompanies/co3", { name: "SEM GERAL, LDA", stage: "universe", owner: "andre", companyEmail: null, contacts: [{ name: "Carlos Dias", email: "carlos.dias@semgeral.pt", isPrimary: true }] });
  // People linked to co1
  store.set("searchPeople/p1", { name: "João Silva", email: "joao.silva@gmail.com", phone: "912345678" });
  store.set("searchPeople/p2", { name: "Maria Silva", orbisEmails: ["velho@silva.pt", "maria@silva.pt"] }); // Orbis list, newest last
  store.set("searchPeople/p3", { name: "Antigo Gerente", orbisEmail: "antigo@silva.pt" }); // older single field
  store.set("searchPersonLinks/l1", { companyId: "co1", personId: "p1", personName: "João Silva", mgmtRoles: ["Sócio-Gerente"], mgmtCurrent: true, shTotalPct: 60 });
  store.set("searchPersonLinks/l2", { companyId: "co1", personId: "p2", personName: "Maria Silva", mgmtRoles: [], shTotalPct: 40 });
  store.set("searchPersonLinks/l3", { companyId: "co1", personId: "p3", personName: "Antigo", mgmtRoles: ["Gerente"], mgmtCurrent: false });
}

(async () => {
  // ── Recipient list ──
  seed();
  const list = await companyRecipients("co1", get("searchCompanies/co1"));
  ok("list: company address, contacts with email, linked People with email (typed or Orbis) — deduped", list.map((r) => r.email).join() === "geral@silva.pt,rita@silva.pt,joao.silva@gmail.com,maria@silva.pt,velho@silva.pt,antigo@silva.pt");
  const { personEmails } = require("../outreach/recipients.js");
  ok("person emails: typed first, then Orbis newest-first; legacy single field only as last resort", personEmails({ email: "a@x.pt", orbisEmails: ["o1@x.pt", "o2@x.pt"], orbisEmail: "old@x.pt" }).join() === "a@x.pt,o2@x.pt,o1@x.pt" && personEmails({ orbisEmail: "old@x.pt" }).join() === "old@x.pt");
  ok("People ranked: current sócio-gerente first, then 40% shareholder, former manager last", [...new Set(list.filter((r) => r.kind === "person").map((r) => r.name))].join() === "João Silva,Maria Silva,Antigo Gerente");
  ok("personal address flagged", list.find((r) => r.email === "joao.silva@gmail.com").personal === true && !list.find((r) => r.email === "rita@silva.pt").personal);
  ok("rank: top role beats big shareholder beats plain manager", rankPerson({ mgmtRoles: ["Gerente"], mgmtCurrent: true }) > rankPerson({ shTotalPct: 70 }) && rankPerson({ shTotalPct: 70 }) > rankPerson({ mgmtRoles: ["Director de vendas"], mgmtCurrent: true }));
  ok("policy: best person = the sócio-gerente; primary contact = first contact; company = generic", pickByPolicy(list, "best_person").name === "João Silva" && pickByPolicy(list, "primary_contact").email === "rita@silva.pt" && pickByPolicy(list, "company").email === "geral@silva.pt");
  ok("policy falls back to the company address", pickByPolicy([{ kind: "company", email: "g@x.pt" }], "primary_contact").email === "g@x.pt");

  // ── Manual send (real mode) ──
  const r1 = await send({ companyId: "co1", senderId: SENDER, recipient: { email: "joao.silva@gmail.com" }, templateId: "t1" });
  ok("send to a linked person on gmail is allowed (R3)", !r1.err && sends.slice(-1)[0].to[0] === "joao.silva@gmail.com");
  ok("{{contact.firstName}} filled from the person", /^João, escrevo sobre a Metalurgica Silva\./.test(sends.slice(-1)[0].text));
  const th = get(`outreachThreads/${r1.threadId}`);
  ok("thread records the person, kind and personal flag", th.contactName === "João Silva" && th.recipientKind === "person" && th.personalAddress === true);
  const r2 = await send({ companyId: "co1", senderId: SENDER, recipient: { email: "someone@gmail.com" }, subject: "x", body: "y" });
  ok("an address that isn't the company's is refused", r2.err?.details?.reason === "recipient_not_found");
  const r3 = await send({ companyId: "co2", senderId: SENDER, subject: "x", body: "y" });
  ok("company address on gmail still follows the personal-domain setting", r3.err?.details?.reason === "personal_domain");
  const r4 = await send({ companyId: "co1", senderId: SENDER, recipient: { email: "geral@silva.pt" }, templateId: "t1" });
  ok("company address as recipient: no first name, fallback used", !r4.err && /^Bom dia, escrevo/.test(sends.slice(-1)[0].text));

  // A prospect who wrote to us from gmail can be answered from the Inbox
  store.set("outreachThreads/inb1", { companyId: "co2", companyName: "FAMILIA LOPES, LDA", contactEmail: "lopes.geral@gmail.com", contactName: "Rui Lopes", senderId: SENDER, subject: "Pedido de informação", status: "replied", rfcIds: ["<in1@gmail.com>"], lastInboundRfcId: "<in1@gmail.com>", isTest: false });
  const r6 = await send({ threadId: "inb1", body: "Obrigado pelo contacto, {{contact.firstName|olá}}." });
  ok("typed reply to a gmail sender is allowed and uses their name", !r6.err && sends.slice(-1)[0].to[0] === "lopes.geral@gmail.com" && /^Obrigado pelo contacto, Rui\./.test(sends.slice(-1)[0].text));

  // ── Test mode: wording from the person, email to the test address ──
  seed({ real: false });
  const r5 = await send({ companyId: "co1", senderId: SENDER, to: "andrenorocha@gmail.com", recipient: { email: "rita@silva.pt" }, templateId: "t1" });
  const m5 = get(`outreachMessages/${r5.messageId}`);
  ok("test mode: goes to the test address, person recorded as redirectedFrom, wording uses her name", sends.slice(-1)[0].to[0] === "andrenorocha@gmail.com" && m5.redirectedFrom === "rita@silva.pt" && /^Rita, escrevo/.test(sends.slice(-1)[0].text));

  // ── Campaign "Send to" ──
  seed({ real: true });
  const cid = (await camp({ action: "save", campaign: { name: "Pessoas", approvalDefault: "auto", recipientPolicy: "best_person", steps: [{ templateId: "t1" }, { templateId: "t2", wait: { days: 0 } }] } })).campaignId;
  ok("policy saved on the campaign", get(`outreachCampaigns/${cid}`).recipientPolicy === "best_person");
  const pv = await camp({ action: "preview", campaignId: cid, companyIds: ["co1", "co3"] });
  ok("exclusions follow the policy: a company without a generic address is reachable through a person", pv.eligible === 2);
  const cc = (await camp({ action: "save", campaign: { name: "Geral", steps: [{ templateId: "t1" }] } })).campaignId;
  ok("…but not with 'company email'", (await camp({ action: "preview", campaignId: cc, companyIds: ["co3"] })).excluded.no_email === 1);
  await camp({ action: "enrol", campaignId: cid, companyIds: ["co1"] });
  await camp({ action: "setStatus", campaignId: cid, status: "active" });
  sends.length = 0;
  await runScheduler({ now: new Date("2026-09-29T10:30:00+01:00"), gap: null, rand: () => 0 });
  const e = get(`outreachEnrolments/${cid}_co1`);
  ok("first email goes to the best person, kept on the enrolment", sends[0]?.to[0] === "joao.silva@gmail.com" && e.recipient?.email === "joao.silva@gmail.com" && /^João,/.test(sends[0].text));
  await runScheduler({ now: new Date("2026-09-29T10:40:00+01:00"), gap: null, rand: () => 0 });
  ok("follow-up replies in the same conversation to the same person", sends[1]?.to[0] === "joao.silva@gmail.com" && /^Seguimento, João\./.test(sends[1].text) && sends[1].subject.startsWith("Re:"));

  // normalizeCampaign default
  ok("default policy is the company address", U.normalizeCampaign({ name: "x" }).recipientPolicy === "company");

  console.log(fail ? `\n${fail} FAILED` : "\nall 3b tests passed");
  process.exit(fail ? 1 : 0);
})();
