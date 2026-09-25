// Phase 2a step 2 — scheduler (schedule_util.js, scheduler.js) and the stop
// rules, against the in-memory Firestore fake. Resend and DNS are mocked.
const F = require("./fake_firebase.js");
const dns = require("dns").promises;
const crypto = require("crypto");
const S = require("../outreach/schedule_util.js");

dns.resolveMx = async (d) => [{ exchange: "mx." + d, priority: 10 }];

const calls = [];
let sendError = null; // { status, name, message }
let quotaDaily = 10;
const receivedEmails = {};
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const body = opts.body ? JSON.parse(opts.body) : null;
  calls.push({ url: u, method: opts.method || "GET", body });
  const hdrs = new Map([["x-resend-daily-quota", String(quotaDaily)], ["x-resend-monthly-quota", String(500 + quotaDaily)]]);
  const resp = (status, obj) => ({ ok: status < 300, status, headers: { get: (h) => hdrs.get(h.toLowerCase()) ?? null }, text: async () => JSON.stringify(obj), arrayBuffer: async () => Buffer.alloc(10) });
  if (u.endsWith("/emails") && opts.method === "POST") {
    if (sendError) { const e = sendError; sendError = null; return resp(e.status, { name: e.name, message: e.message }); }
    quotaDaily++;
    return resp(200, { id: "rs_" + calls.length });
  }
  let m;
  if ((m = u.match(/\/emails\/receiving\/([^/?]+)\/attachments/))) return resp(200, { object: "list", data: [] });
  if ((m = u.match(/\/emails\/receiving\/([^/?]+)$/))) return resp(200, receivedEmails[m[1]]);
  return resp(404, { message: "not mocked " + u });
};

const fns = require("../index.js");
const { runScheduler, stepMessageId } = require("../outreach/scheduler.js");
const { store, Timestamp } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const get = (p) => store.get(p);
const docs = (coll) => [...store.entries()].filter(([p]) => p.startsWith(coll + "/")).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));
const sends = () => calls.filter((c) => c.url.endsWith("/emails") && c.method === "POST");
const lisbon = (iso) => new Date(iso); // ISO strings below carry their UTC offset
const run = (iso, extra = {}) => runScheduler({ now: lisbon(iso), gap: null, rand: () => 0, ...extra });
const dayKey = () => new Date().toISOString().slice(0, 10);

const HOOK_KEY = Buffer.from("hook-key");
async function webhook(evt) {
  const body = JSON.stringify(evt);
  const id = "msg_" + crypto.randomBytes(4).toString("hex");
  const tsSec = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac("sha256", HOOK_KEY).update(`${id}.${tsSec}.${body}`).digest("base64");
  const r = { code: 200 };
  const res = { status(c) { r.code = c; return this; }, send() { return this; }, set() { return this; } };
  await fns.resendWebhook({ method: "POST", rawBody: Buffer.from(body), headers: { "svix-id": id, "svix-timestamp": tsSec, "svix-signature": `v1,${sig}` } }, res);
  return r;
}

function seedBase() {
  store.clear();
  calls.length = 0;
  const sender = (local, owner, status = "active") => store.set(`outreachSenders/${local}@mail.douropartners-team.pt`, {
    email: `${local}@mail.douropartners-team.pt`, displayName: owner === "andre" ? "André Rocha" : "António Carvalho", owner, status, dailyCap: 25, inboundAlias: local, signature: "Assinatura",
  });
  sender("an.rocha", "andre"); sender("a.rocha", "andre"); sender("an.carvalho", "antonio"); sender("andre.rocha", "andre", "warming");
  store.set("outreachTemplates/t1", { name: "Intro", status: "active", variants: [{ key: "A", subject: "Olá {{company.shortName}}", body: "Corpo A" }, { key: "B", subject: "Bom dia {{company.shortName}}", body: "Corpo B" }] });
  store.set("outreachTemplates/t2", { name: "Follow-up", status: "active", variants: [{ key: "A", subject: "ignorado", body: "Seguimento" }] });
  for (let i = 1; i <= 6; i++) store.set(`searchCompanies/c${i}`, { name: `EMPRESA ${i}, LDA`, stage: "universe", companyEmail: `geral@empresa${i}.pt`, owner: i <= 5 ? "andre" : "antonio" });
}

async function makeCampaign(campaign, companyIds, { activate = true } = {}) {
  const { campaignId } = await camp({ action: "save", campaign });
  await camp({ action: "enrol", campaignId, companyIds });
  if (activate) { const r = await camp({ action: "setStatus", campaignId, status: "active" }); if (r.err) throw r.err; }
  return campaignId;
}

// Tuesday 29 Sept 2026, 10:30 in Lisbon (UTC+1).
const TUE = "2026-09-29T10:30:00+01:00";

(async () => {
  // ── schedule_util ──
  ok("Easter 2026 = 5 April", new Date(S.easter(2026)).toISOString().slice(0, 10) === "2026-04-05");
  const h26 = S.nationalHolidays(2026);
  ok("2026 holidays include Good Friday 3 Apr, Corpus Christi 4 Jun, 5 Oct, 8 Dec", ["04-03", "06-04", "10-05", "12-08", "04-25"].every((d) => h26.has(d)) && h26.size === 13);
  const W = { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00" };
  ok("window open Tue 10:30 Lisbon", S.isWindowOpen(lisbon(TUE), W));
  ok("window closed 08:59 and at 18:00", !S.isWindowOpen(lisbon("2026-09-29T08:59:00+01:00"), W) && !S.isWindowOpen(lisbon("2026-09-29T18:00:00+01:00"), W));
  ok("window closed Saturday", !S.isWindowOpen(lisbon("2026-10-03T11:00:00+01:00"), W));
  ok("window closed on 5 Oct (holiday, Monday)", !S.isWindowOpen(lisbon("2026-10-05T11:00:00+01:00"), W));
  ok("window uses Lisbon time in winter (UTC+0)", S.isWindowOpen(lisbon("2026-11-03T09:05:00Z"), W) && !S.isWindowOpen(lisbon("2026-11-03T08:55:00Z"), W));
  const fri = lisbon("2026-10-02T10:00:00+01:00");
  ok("1 working day after Fri 2 Oct = Tue 6 Oct (weekend + holiday)", S.lisbonParts(S.addWait(fri, { days: 1, unit: "working" })).dayKey === "2026-10-06");
  ok("3 calendar days after Fri 2 Oct = Mon 5 Oct", S.lisbonParts(S.addWait(fri, { days: 3, unit: "calendar" })).dayKey === "2026-10-05");
  ok("wait 0 = now", S.addWait(fri, { days: 0 }).getTime() === fri.getTime());
  ok("variant by weight (rand 0 → A, 0.7 → B with 60/40)", S.pickVariant([{ key: "A", weight: 60 }, { key: "B", weight: 40 }], [{ key: "A" }, { key: "B" }], 0) === "A" && S.pickVariant([{ key: "A", weight: 60 }, { key: "B", weight: 40 }], [{ key: "A" }, { key: "B" }], 0.7) === "B");
  ok("no step variants → template's, equal weights", S.pickVariant([], [{ key: "A" }, { key: "B" }], 0.6) === "B");
  ok("step variant missing from template ignored", S.pickVariant([{ key: "C", weight: 100 }], [{ key: "A" }], 0.5) === "A");
  const senders = [{ id: "x1", owner: "andre", status: "active" }, { id: "x2", owner: "andre", status: "active" }, { id: "y1", owner: "antonio", status: "active" }, { id: "x3", owner: "andre", status: "paused" }];
  const pick = (o) => S.pickSender({ policy: { mode: "owner_rotation" }, owner: "andre", senders, sentToday: {}, usedThisRun: new Set(), defaultCap: 25, ...o })?.id;
  ok("sender: owner's least used active address", pick({ sentToday: { x1: 3, x2: 1 } }) === "x2");
  ok("sender: skips used-this-run and full addresses", pick({ usedThisRun: new Set(["x1"]), sentToday: { x2: 25 } }) === undefined);
  ok("sender: no owner → any active address", pick({ owner: null, sentToday: { x1: 1, x2: 1 } }) === "y1");
  ok("sender: fixed policy", pick({ policy: { mode: "fixed", senderIds: ["y1"] } }) === "y1");

  // ── Scheduler: nothing to do ──
  seedBase();
  ok("no active campaigns → nothing", (await run(TUE)).campaigns === 0);

  // ── Automatic campaign, test mode ──
  seedBase();
  const cA = await makeCampaign({ name: "Metalurgia", approvalDefault: "auto", pacing: { newPerDay: 3 }, steps: [{ templateId: "t1" }, { templateId: "t2", wait: { days: 2 } }] }, ["c1", "c2", "c3", "c4", "c5"]);
  const sat = await run("2026-10-03T11:00:00+01:00");
  ok("outside the window: nothing starts", sat.open === 0 && docs("outreachEnrolments").every((e) => e.status === "pending"));

  const r1 = await run(TUE);
  ok("run 1: pace starts 3 of 5", r1.started === 3 && docs("outreachEnrolments").filter((e) => e.status === "active").length === 3 && get(`outreachCampaigns/${cA}`).startedToday.count === 3);
  ok("run 1: one email per address per run (André has 2 active)", r1.sent === 2 && sends().length === 2 && new Set(sends().map((c) => c.body.from)).size === 2);
  const s1 = sends()[0].body;
  ok("test mode: sent to the campaign test address, company used for variables", s1.to[0] === "andrenorocha@gmail.com" && s1.subject === "Olá Empresa 1");
  const e1 = get(`outreachEnrolments/${cA}_c1`);
  const m1 = get(`outreachMessages/${stepMessageId(`${cA}_c1`, "s1")}`);
  ok("message: campaign fields, redirect recorded, deterministic id", m1.source === "campaign" && m1.campaignId === cA && m1.stepId === "s1" && m1.enrolmentId === `${cA}_c1` && m1.redirectedFrom === "geral@empresa1.pt" && m1.status === "sent");
  const th1 = get(`outreachThreads/${e1.threadId}`);
  ok("thread: tied to the campaign, test", th1.campaignId === cA && th1.enrolmentId === `${cA}_c1` && th1.isTest === true);
  ok("enrolment: next step, due in 2 working days (Thu 1 Oct), history, variant", e1.currentStep === 1 && S.lisbonParts(e1.nextActionAt.toDate()).dayKey === "2026-10-01" && e1.history.length === 1 && e1.variants.s1 === "A" && e1.senderId && e1.lockUntil === null);
  const act = docs("searchActivities").find((a) => a.outreachMessageId === m1 && false) || docs("searchActivities").find((a) => a.campaignId === cA);
  ok("activity: test type, campaign / step / channel", act && act.type === "email_test" && act.stepId === "s1" && act.channel === "email");
  ok("campaign: step s1 locked, 2 sent", get(`outreachCampaigns/${cA}`).lockedStepIds.includes("s1") && get(`outreachCampaigns/${cA}`).stats.sent === 2);
  ok("daily counter: campaignSent 2", get(`outreachDaily/${dayKey()}`).campaignSent === 2);
  ok("locked step can't be removed now", (await camp({ action: "save", campaignId: cA, campaign: { steps: [{ templateId: "t2" }] } })).err?.details?.reason === "step_locked");

  const r2 = await run("2026-09-29T10:40:00+01:00");
  ok("run 2: no new starts today, the third company is sent", r2.started === 0 && r2.sent === 1 && sends().length === 3);
  ok("run 3: nothing due", (await run("2026-09-29T10:50:00+01:00")).sent === 0);

  // Follow-up in the same conversation
  store.set(`outreachThreads/${e1.threadId}`, { ...get(`outreachThreads/${e1.threadId}`), rfcIds: ["<first-c1@resend.dev>"] });
  const beforeFu = sends().length;
  const r4 = await run("2026-10-01T11:00:00+01:00");
  const fu = sends().slice(beforeFu).find((c) => c.body.subject === "Re: Olá Empresa 1");
  ok("follow-up: reply in the same thread, threading headers, template body", r4.sent >= 1 && fu && fu.body.headers["In-Reply-To"] === "<first-c1@resend.dev>" && /Seguimento/.test(fu.body.text) && /escreveu:/.test(fu.body.text));
  const e1b = get(`outreachEnrolments/${cA}_c1`);
  ok("follow-up: same address, same thread, now in the final grace period", e1b.currentStep === 2 && e1b.threadId === e1.threadId && e1b.senderId === e1.senderId && e1b.status === "active");
  ok("follow-up keeps the thread open (still waiting for them)", get(`outreachThreads/${e1.threadId}`).status === "open");

  // Grace over → completed, no reply
  const r5 = await run("2026-10-09T11:00:00+01:00");
  ok("after the grace period: completed and company released", r5.completed >= 1 && get(`outreachEnrolments/${cA}_c1`).status === "completed" && get("searchCompanies/c1").activeCampaignId === undefined);

  // Reply stop rule (through the real webhook path)
  const e3 = get(`outreachEnrolments/${cA}_c3`);
  store.set(`outreachThreads/${e3.threadId}`, { ...get(`outreachThreads/${e3.threadId}`), rfcIds: ["<first-c3@resend.dev>"] });
  receivedEmails.r3 = { from: "andrenorocha@gmail.com", subject: "Re: Olá Empresa 3", message_id: "<reply-c3@gmail.com>", text: "Interessa, falamos?", headers: { "in-reply-to": "<first-c3@resend.dev>" } };
  await webhook({ type: "email.received", data: { email_id: "r3", from: "andrenorocha@gmail.com", to: ["an.rocha@teniokarau.resend.app"] } });
  ok("human reply → enrolment replied, company released", get(`outreachEnrolments/${cA}_c3`).status === "replied" && get("searchCompanies/c3").activeCampaignId === undefined);

  // Out-of-office doesn't stop
  const e2 = get(`outreachEnrolments/${cA}_c2`);
  store.set(`outreachThreads/${e2.threadId}`, { ...get(`outreachThreads/${e2.threadId}`), rfcIds: ["<first-c2@resend.dev>"] });
  receivedEmails.r2 = { from: "andrenorocha@gmail.com", subject: "Ausente", message_id: "<ooo@gmail.com>", text: "Estou ausente", headers: { "in-reply-to": "<first-c2@resend.dev>", "auto-submitted": "auto-replied" } };
  await webhook({ type: "email.received", data: { email_id: "r2", from: "andrenorocha@gmail.com", to: ["an.rocha@teniokarau.resend.app"] } });
  ok("auto-reply doesn't stop the sequence", ["active", "completed"].includes(get(`outreachEnrolments/${cA}_c2`).status) && get(`outreachEnrolments/${cA}_c2`).status !== "replied");

  // Bounce stop rule
  seedBase();
  const cB = await makeCampaign({ name: "Bounce", approvalDefault: "auto", steps: [{ templateId: "t1" }, { templateId: "t2" }] }, ["c1"]);
  await run(TUE);
  const mB = stepMessageId(`${cB}_c1`, "s1");
  await webhook({ type: "email.bounced", data: { email_id: "x", tags: { om: mB }, bounce: { type: "Permanent" } } });
  ok("hard bounce → enrolment stopped, company released", get(`outreachEnrolments/${cB}_c1`).status === "stopped" && get(`outreachEnrolments/${cB}_c1`).stopReason === "Email bounced" && get("searchCompanies/c1").activeCampaignId === undefined);

  // ── Approval campaign: drafts ──
  seedBase();
  const cD = await makeCampaign({ name: "Aprovação", approvalDefault: "approval", steps: [{ templateId: "t1" }] }, ["c1", "c2", "c3"]);
  const rd = await run(TUE);
  const dMsg = get(`outreachMessages/${stepMessageId(`${cD}_c1`, "s1")}`);
  ok("approval: drafts for all due (no per-address limit), nothing sent", rd.drafts === 3 && rd.sent === 0 && sends().length === 0);
  ok("draft: rendered, awaiting approval, no quota used", dMsg.status === "draft" && dMsg.subject === "Olá Empresa 1" && dMsg.draftBody === "Corpo A" && get(`outreachEnrolments/${cD}_c1`).status === "awaiting_approval" && get(`outreachEnrolments/${cD}_c1`).draftMessageId === stepMessageId(`${cD}_c1`, "s1") && !get(`outreachDaily/${dayKey()}`)?.campaignSent);
  ok("next run doesn't redraft", (await run("2026-09-29T10:40:00+01:00")).drafts === 0 && docs("outreachMessages").length === 3);
  await camp({ action: "enrolment", enrolmentId: `${cD}_c2`, op: "remove" });
  ok("removing the company cancels its draft", get(`outreachMessages/${stepMessageId(`${cD}_c2`, "s1")}`).status === "cancelled");
  // Step override: automatic step inside an approval campaign
  seedBase();
  const cO = await makeCampaign({ name: "Mista", approvalDefault: "approval", steps: [{ templateId: "t1", approval: "auto" }] }, ["c1"]);
  ok("step override 'auto' sends inside an approval campaign", (await run(TUE)).sent === 1);

  // ── Limits ──
  seedBase();
  store.set("outreachSettings/global", { automationBudget: 1 });
  await makeCampaign({ name: "Limite", approvalDefault: "auto", steps: [{ templateId: "t1" }] }, ["c1", "c2"]);
  const rl = await run(TUE);
  ok("automations limit: 1 sent, the other carried over", rl.sent === 1 && rl.deferred === 1);
  ok("limit reached: next run sends nothing", (await run("2026-09-29T10:40:00+01:00")).sent === 0);

  seedBase();
  store.set(`outreachUsage/${dayKey()}`, { resendDailyUsed: 100, portalTotalAtReading: 0 });
  const cT = await makeCampaign({ name: "Alvo", approvalDefault: "auto", steps: [{ templateId: "t1" }] }, ["c1"]);
  const rt = await run(TUE);
  ok("account over its daily target: sending stops, nothing lost", rt.stoppedSends === "over_target" && rt.sent === 0 && get(`outreachEnrolments/${cT}_c1`).currentStep === 0 && get(`outreachEnrolments/${cT}_c1`).lockUntil === null);

  seedBase();
  store.set(`outreachUsage/${dayKey()}`, { resendDailyUsed: 100, portalTotalAtReading: 0 });
  const cT2 = await makeCampaign({ name: "Alvo rascunho", approvalDefault: "approval", steps: [{ templateId: "t1" }] }, ["c1"]);
  ok("over the target, approval steps still get their draft", (await run(TUE)).drafts === 1 && get(`outreachEnrolments/${cT2}_c1`).status === "awaiting_approval");

  // Priority (C9)
  seedBase();
  store.set("outreachSettings/global", { automationBudget: 1 });
  const cLow = await makeCampaign({ name: "Baixa", priority: 3, approvalDefault: "auto", steps: [{ templateId: "t1" }] }, ["c1"]);
  const cHigh = await makeCampaign({ name: "Alta", priority: 1, approvalDefault: "auto", steps: [{ templateId: "t1" }] }, ["c2"]);
  await run(TUE);
  ok("priority 1 campaign goes first when the limit is tight", get(`outreachEnrolments/${cHigh}_c2`).currentStep === 1 && get(`outreachEnrolments/${cLow}_c1`).currentStep === 0);

  // ── Failures ──
  seedBase();
  const cM = await makeCampaign({ name: "Sem template", approvalDefault: "auto", steps: [{ templateId: "t1" }] }, ["c1"]);
  store.delete("outreachTemplates/t1");
  const rm = await run(TUE);
  ok("template deleted → campaign paused with the reason", rm.paused === 1 && get(`outreachCampaigns/${cM}`).status === "paused" && /Template not found/.test(get(`outreachCampaigns/${cM}`).pauseReason));

  seedBase();
  store.set("outreachTemplates/t3", { name: "Cidade", status: "active", variants: [{ key: "A", subject: "Olá", body: "Em {{company.city}}" }] });
  const cV = await makeCampaign({ name: "Variáveis", approvalDefault: "auto", steps: [{ templateId: "t3" }] }, ["c1"]);
  await run(TUE);
  ok("empty variable → that company paused with the reason", get(`outreachEnrolments/${cV}_c1`).status === "paused" && /company.city/.test(get(`outreachEnrolments/${cV}_c1`).lastError));

  seedBase();
  store.set("outreachSettings/global", { campaignTestRecipient: "someone@empresa9.pt" });
  const cX = await makeCampaign({ name: "Teste errado", approvalDefault: "auto", steps: [{ templateId: "t1" }] }, ["c1"]);
  await run(TUE);
  ok("test address not approved → campaign paused, company kept", get(`outreachCampaigns/${cX}`).status === "paused" && get(`outreachEnrolments/${cX}_c1`).status === "active" && sends().length === 0);

  seedBase();
  const cR = await makeCampaign({ name: "Resend falha", approvalDefault: "auto", steps: [{ templateId: "t1" }] }, ["c1"]);
  sendError = { status: 500, name: "application_error", message: "boom" };
  const rr = await run(TUE);
  const eR = get(`outreachEnrolments/${cR}_c1`);
  ok("Resend error → retry in 1 h, message marked failed", rr.retried === 1 && eR.attempts === 1 && eR.nextActionAt.toMillis() === lisbon(TUE).getTime() + 3600000 && get(`outreachMessages/${stepMessageId(`${cR}_c1`, "s1")}`).status === "failed");
  await run("2026-09-29T11:31:00+01:00");
  ok("retry succeeds on the same message id", get(`outreachMessages/${stepMessageId(`${cR}_c1`, "s1")}`).status === "sent" && get(`outreachEnrolments/${cR}_c1`).currentStep === 1 && get(`outreachEnrolments/${cR}_c1`).attempts === 0);

  // Crash after sending, before the enrolment was updated
  seedBase();
  const cC = await makeCampaign({ name: "Crash", approvalDefault: "auto", steps: [{ templateId: "t1" }, { templateId: "t2" }] }, ["c1"]);
  await camp({ action: "setStatus", campaignId: cC, status: "paused" });
  await run(TUE);
  await camp({ action: "setStatus", campaignId: cC, status: "active" });
  store.set(`outreachEnrolments/${cC}_c1`, { ...get(`outreachEnrolments/${cC}_c1`), status: "active", currentStep: 0, nextActionAt: Timestamp.fromDate(lisbon(TUE)) });
  store.set(`outreachMessages/${stepMessageId(`${cC}_c1`, "s1")}`, { status: "sent", threadId: "thX", senderId: "an.rocha@mail.douropartners-team.pt", variantKey: "B" });
  await run(TUE);
  ok("already-sent step isn't sent twice", sends().length === 0 && get(`outreachEnrolments/${cC}_c1`).currentStep === 1 && get(`outreachEnrolments/${cC}_c1`).threadId === "thX");

  // Lease: an enrolment claimed by an overlapping run is skipped
  seedBase();
  const cL = await makeCampaign({ name: "Lock", approvalDefault: "auto", steps: [{ templateId: "t1" }] }, ["c1"]);
  await camp({ action: "setStatus", campaignId: cL, status: "paused" });
  await camp({ action: "setStatus", campaignId: cL, status: "active" });
  store.set(`outreachEnrolments/${cL}_c1`, { ...get(`outreachEnrolments/${cL}_c1`), status: "active", currentStep: 0, nextActionAt: Timestamp.fromDate(lisbon(TUE)), lockUntil: Timestamp.fromDate(new Date(lisbon(TUE).getTime() + 60000)) });
  ok("locked enrolment skipped", (await run(TUE)).sent === 0 && sends().length === 0);

  // Real mode (test mode off): the company's own address, suppression stops
  seedBase();
  store.set("outreachSettings/global", { testMode: false, complianceBlockId: "cb1" });
  store.set("outreachCompliance/cb1", { legalEntityLine: "Douro Partners, Lda", footerText: "Remover: {{unsubscribeUrl}}" });
  const cReal = await makeCampaign({ name: "Real", approvalDefault: "auto", steps: [{ templateId: "t1" }] }, ["c1", "c2"]);
  store.set("outreachSuppression/geral@empresa2.pt", { reason: "unsubscribed" });
  const rReal = await run(TUE);
  ok("real mode: sent to the company's own address", sends().length === 1 && sends()[0].body.to[0] === "geral@empresa1.pt" && get(`outreachThreads/${get(`outreachEnrolments/${cReal}_c1`).threadId}`).isTest === false);
  ok("real mode: company suppressed after enrolling → stopped", rReal.stopped === 1 && get(`outreachEnrolments/${cReal}_c2`).status === "stopped" && get("searchCompanies/c2").activeCampaignId === undefined);
  ok("real mode: activity is a real outreach email", docs("searchActivities").some((a) => a.type === "email" && a.campaignId === cReal));

  console.log(fail ? `\n${fail} FAILED` : "\nall scheduler tests passed");
  process.exit(fail ? 1 : 0);
})();
