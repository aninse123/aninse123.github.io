// One inbox (owner-aware outreach, Stage 1, 19 Oct 2026; switch
// "outreach.oneInbox"): the same address never gets two cold emails within
// the campaign's window, nor two first drafts on one day, whichever company it
// belongs to. Conversations remember every address; a reply written by hand
// can stop the company's campaign. Synthetic data only.
const F = require("./fake_firebase.js");
const dns = require("dns").promises;
dns.resolveMx = async (d) => [{ exchange: "mx." + d, priority: 10 }];
const calls = [];
global.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null });
  const hdrs = new Map([["x-resend-daily-quota", "5"], ["x-resend-monthly-quota", "50"]]);
  return { ok: true, status: 200, headers: { get: (h) => hdrs.get(h.toLowerCase()) ?? null }, text: async () => JSON.stringify({ id: "rs_" + calls.length }) };
};
const fns = require("../index.js");
const Feat = require("../features");
const { runScheduler } = require("../outreach/scheduler.js");
const { evaluateCompany } = require("../outreach/campaign_util.js");
const { matchThread } = require("../outreach/inbound.js");
const { isFreeMail } = require("../outreach/util.js");
const { store, Timestamp } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const send = async (data) => { try { return await fns.outreachSend({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const get = (p) => store.get(p);
const docs = (coll) => [...store.entries()].filter(([p]) => p.startsWith(coll + "/")).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));
const sends = () => calls.filter((c) => c.url.endsWith("/emails") && c.method === "POST");
const DAY = 86400000;
const TUE = "2026-09-29T10:30:00+01:00", WED = "2026-09-30T10:30:00+01:00";
const run = (iso) => runScheduler({ now: new Date(iso), gap: null, rand: () => 0 });
function flags(staging, production) {
  store.set("config/features", { flags: { "outreach.oneInbox": { staging, production } } });
  Feat._reset();
}

function seed() {
  store.clear(); calls.length = 0;
  store.set("outreachSettings/global", { testMode: false, dailyTarget: 100 });
  for (const [local, owner] of [["an.rocha", "andre"], ["a.rocha", "andre"], ["an.carvalho", "antonio"]]) {
    store.set(`outreachSenders/${local}@mail.douropartners-team.pt`, { email: `${local}@mail.douropartners-team.pt`, displayName: "André Rocha", owner, status: "active", dailyCap: 25, signature: "Assinatura" });
  }
  store.set("teamDirectory/andre", { key: "andre", name: "André Rocha", partner: true, active: true });
  store.set("outreachTemplates/t1", { name: "Intro", status: "active", variants: [{ key: "A", subject: "Olá {{company.shortName}}", body: "Corpo A" }] });
  const co = (id, email) => store.set(`searchCompanies/${id}`, { name: `EMPRESA ${id.toUpperCase()}, LDA`, stage: "universe", companyEmail: email, owner: "andre", contacts: [] });
  co("c1", "geral@grupo.pt"); co("c2", "geral@grupo.pt"); co("c3", "geral@dup.pt"); co("c4", "geral@dup.pt"); co("c5", "info@par.pt"); co("c6", "info@par.pt"); co("c7", "geral@sozinha.pt");
}
async function makeCampaign(campaign, ids, activate = true) {
  const { campaignId } = await camp({ action: "save", campaign });
  if (ids) await camp({ action: "enrol", campaignId, companyIds: ids });
  if (activate) { const r = await camp({ action: "setStatus", campaignId, status: "active" }); if (r.err) throw r.err; }
  return campaignId;
}

(async () => {
  // ── The enrolment rule itself ──
  const ex = { contactedWithinDays: 30, allowedStages: ["universe"], requireEmail: true, ownerFilter: null };
  const base = { campaignId: "k", exclusions: ex, firstChannel: "email", recipientPolicy: "company", suppressed: new Set(), now: Date.now() };
  const map = new Map([["geral@grupo.pt", [{ companyId: "c1", companyName: "EMPRESA C1, LDA", at: Date.now() - 5 * DAY }]]]);
  const company = { name: "X", stage: "universe", companyEmail: "geral@grupo.pt" };
  const r1 = evaluateCompany(company, { ...base, companyId: "c2", inboxRecent: map });
  ok("same address, another company emailed 5 days ago → left out as same_inbox, naming it", r1.reason === "same_inbox" && r1.inbox.companyName === "EMPRESA C1, LDA");
  ok("the company's own conversation doesn't count (that's 'contacted recently')", evaluateCompany(company, { ...base, companyId: "c1", inboxRecent: map }).ok);
  ok("switch off (no map) → today's behaviour", evaluateCompany(company, { ...base, companyId: "c2" }).ok);
  ok("window 0 → no check", evaluateCompany(company, { ...base, exclusions: { ...ex, contactedWithinDays: 0 }, companyId: "c2", inboxRecent: map }).ok);
  ok("first step a call → no check", evaluateCompany(company, { ...base, firstChannel: "call", companyId: "c2", inboxRecent: map }).ok);
  ok("provider mailboxes count as personal addresses", isFreeMail("netmadeira.com") && isFreeMail("net.sapo.pt"));

  // ── Add-to-campaign preview and enrol ──
  seed(); flags("on", "off");
  store.set("outreachThreads/old1", { companyId: "c1", companyName: "EMPRESA C1, LDA", contactEmail: "geral@grupo.pt", senderId: "an.rocha@mail.douropartners-team.pt", lastMessageAt: Timestamp.fromMillis(Date.now() - 5 * DAY), lastDirection: "out", campaignId: "outra", isTest: false });
  const k1 = await makeCampaign({ name: "Grupo", approvalDefault: "approval", steps: [{ templateId: "t1" }] }, null, false);
  let pv = await camp({ action: "preview", campaignId: k1, companyIds: ["c2", "c7"] });
  const sm = (pv.excludedSample || []).find((x) => x.companyId === "c2");
  ok("preview: c2 left out (same address as c1, emailed 5 days ago), c7 fine", pv.eligible === 1 && pv.excluded.same_inbox === 1 && sm?.reason === "same_inbox" && sm.inbox.companyName === "EMPRESA C1, LDA" && sm.inbox.email === "geral@grupo.pt");
  let en = await camp({ action: "enrol", campaignId: k1, companyIds: ["c2", "c7"] });
  ok("enrol: c2 skipped as same_inbox, c7 enrolled", en.enrolled === 1 && en.skipped.same_inbox === 1 && !get(`outreachEnrolments/${k1}_c2`));
  store.set("outreachThreads/old1", { ...get("outreachThreads/old1"), lastMessageAt: Timestamp.fromMillis(Date.now() - 40 * DAY) });
  pv = await camp({ action: "preview", campaignId: k1, companyIds: ["c2"] });
  ok("a conversation older than the window doesn't count", pv.eligible === 1);
  store.set("outreachThreads/old1", { ...get("outreachThreads/old1"), lastMessageAt: Timestamp.fromMillis(Date.now() - 5 * DAY), isTest: true });
  pv = await camp({ action: "preview", campaignId: k1, companyIds: ["c2"] });
  ok("a test conversation doesn't hold a real campaign", pv.eligible === 1);
  store.set("outreachThreads/old1", { companyId: "c1", companyName: "EMPRESA C1, LDA", contactEmail: "teste@douropartners.pt", addresses: ["geral@grupo.pt"], lastMessageAt: Timestamp.fromMillis(Date.now() - 2 * DAY), isTest: false });
  pv = await camp({ action: "preview", campaignId: k1, companyIds: ["c2"] });
  ok("found through the conversation's other addresses too", pv.excluded.same_inbox === 1);
  flags("off", "off");
  pv = await camp({ action: "preview", campaignId: k1, companyIds: ["c2"] });
  ok("switch Off on this site → added as today", pv.eligible === 1 && !pv.excluded.same_inbox);

  // ── Scheduler: first drafts ──
  seed(); flags("on", "on");
  const kD = await makeCampaign({ name: "Dup", approvalDefault: "approval", steps: [{ templateId: "t1" }] }, ["c3", "c4", "c7"]);
  const d1 = await run(TUE);
  const e3 = get(`outreachEnrolments/${kD}_c3`), e4 = get(`outreachEnrolments/${kD}_c4`);
  ok("run 1: one first draft per address — c3 drafted, c4 held, c7 drafted", d1.drafts === 2 && d1.inboxHeld === 1 && e3.status === "awaiting_approval" && e4.status === "active" && e4.holdKind === "same_inbox");
  ok("…held until the next sending day, with who and why", e4.nextActionAt.toMillis() > new Date(TUE).getTime() && e4.holdReason.companyName === "EMPRESA C3, LDA" && e4.holdReason.why === "run" && /geral@dup\.pt is also the address of EMPRESA C3, LDA/.test(e4.lastError));
  const holds = () => docs("searchActivities").filter((a) => a.type === "outreach_hold" && a.companyId === "c4");
  ok("…one activity on the held company", holds().length === 1 && /Tries again/.test(holds()[0].content));
  const d2 = await run(WED);
  const e4b = get(`outreachEnrolments/${kD}_c4`);
  ok("run 2 (next day): c3's draft still waiting → c4 waits again (why: draft), no second activity", d2.inboxHeld === 1 && e4b.holdReason.why === "draft" && holds().length === 1);
  flags("on", "off");
  store.set(`outreachEnrolments/${kD}_c4`, { ...get(`outreachEnrolments/${kD}_c4`), nextActionAt: Timestamp.fromDate(new Date(WED)) });
  const d3 = await run(WED);
  ok("production switch Off → the scheduler drafts as today (and clears the hold)", d3.drafts === 1 && get(`outreachEnrolments/${kD}_c4`).status === "awaiting_approval" && !get(`outreachEnrolments/${kD}_c4`).holdKind);

  // ── Scheduler: sent emails, the 30-day wait ──
  seed(); flags("on", "on");
  const kS = await makeCampaign({ name: "Auto", approvalDefault: "auto", steps: [{ templateId: "t1" }] }, ["c5", "c6"]);
  const s1 = await run(TUE);
  ok("run 1 (automatic): c5 sent, c6 held the same run", s1.sent === 1 && sends().length === 1 && get(`outreachEnrolments/${kS}_c6`).holdReason.why === "run");
  const th = docs("outreachThreads").find((t) => t.companyId === "c5");
  ok("the new conversation remembers its address", JSON.stringify(th.addresses) === '["info@par.pt"]');
  const s2 = await run(WED);
  const e6 = get(`outreachEnrolments/${kS}_c6`);
  ok("run 2: c6 waits until 30 days after c5's email (why: recent)", s2.sent === 0 && e6.holdReason.why === "recent" && e6.nextActionAt.toMillis() >= th.lastMessageAt.toMillis() + 30 * DAY - 1000);

  // ── Replies: addresses remembered, Stop the campaign ──
  seed(); flags("on", "off");
  const kR = await makeCampaign({ name: "Resposta", approvalDefault: "auto", steps: [{ templateId: "t1" }, { templateId: "t1", wait: { days: 3 } }] }, ["c7"]);
  await run(TUE);
  const th7 = docs("outreachThreads").find((t) => t.companyId === "c7");
  store.set("outreachMessages/in7", { threadId: th7.id, direction: "in", from: "Recepção <geral@sozinha.pt>", to: ["an.rocha@abc.resend.app"], cc: [], status: "received", isAutoReply: true, createdAt: new Date() });
  let rp = await send({ threadId: th7.id, body: "Olá João.", replyTo: ["joao@sozinha.pt"], requestId: "reqinbox0000001" });
  ok("reply to João without the box: sent, the campaign keeps running", rp.ok && !rp.stoppedCampaigns && get(`outreachEnrolments/${kR}_c7`).status === "active");
  ok("…and the conversation now remembers joao@ too", get(`outreachThreads/${th7.id}`).addresses.includes("joao@sozinha.pt") && get(`outreachThreads/${th7.id}`).addresses.includes("geral@sozinha.pt"));
  rp = await send({ threadId: th7.id, body: "Olá outra vez.", replyTo: ["joao@sozinha.pt"], stopCampaign: true, requestId: "reqinbox0000002" });
  const e7 = get(`outreachEnrolments/${kR}_c7`);
  ok("reply with 'Stop the campaign for this company' ticked → the company's campaign stops, saying who", rp.ok && rp.stoppedCampaigns === 1 && e7.status === "stopped" && /replied by hand/.test(e7.stopReason) && /andre\.rocha/.test(e7.stopReason));
  flags("off", "off");
  store.set("outreachEnrolments/k2_c7", { campaignId: "k2", campaignName: "Resposta 2", companyId: "c7", status: "active", currentStep: 0 });
  rp = await send({ threadId: th7.id, body: "Só isto.", replyTo: ["joao@sozinha.pt"], stopCampaign: true, requestId: "reqinbox0000003" });
  ok("switch Off on this site → the box does nothing", rp.ok && !rp.stoppedCampaigns && get("outreachEnrolments/k2_c7").status === "active");

  // ── Inbound: a fresh email from João finds the conversation ──
  const m1 = await matchThread({ refIds: [], fromEmail: "joao@sozinha.pt", senderId: th7.senderId, byAddresses: true, testMode: false });
  ok("inbound from joao@ (no reply headers) → matched to the conversation by its addresses", m1?.rule === "addresses" && m1.ref.path === `outreachThreads/${th7.id}`);
  const m2 = await matchThread({ refIds: [], fromEmail: "joao@sozinha.pt", senderId: th7.senderId, byAddresses: false, testMode: false });
  ok("switch Off → not matched by addresses (falls back to the company domain, as today)", m2?.rule !== "addresses");

  console.log(fail ? `${fail} one-inbox test(s) FAILED` : "all one-inbox tests passed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
