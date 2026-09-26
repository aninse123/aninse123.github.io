// Phase 5a — campaigns to people (investors, brokers, journalists…): enrol
// and preview, relationship senders (@douropartners.pt, full-access key),
// logging on CRM / Network records, per-campaign daily limit, stop rules.
const F = require("./fake_firebase.js");
const dns = require("dns").promises;
const crypto = require("crypto");
dns.resolveMx = async (d) => [{ exchange: "mx." + d, priority: 10 }];
const sends = [];
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.endsWith("/emails") && opts.method === "POST") sends.push({ body: JSON.parse(opts.body), auth: opts.headers.Authorization });
  const hdrs = new Map([["x-resend-daily-quota", "5"], ["x-resend-monthly-quota", "50"]]);
  return { ok: true, status: 200, headers: { get: (h) => hdrs.get(h.toLowerCase()) ?? null }, text: async () => JSON.stringify({ id: "rs_" + sends.length }) };
};

const fns = require("../index.js");
const U = require("../outreach/campaign_util.js");
const { runScheduler, stepMessageId } = require("../outreach/scheduler.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const get = (p) => store.get(p);
const docs = (coll) => [...store.entries()].filter(([p]) => p.startsWith(coll + "/")).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));
const run = (iso) => runScheduler({ now: new Date(iso), gap: null, rand: () => 0 });
const HOOK_KEY = Buffer.from("hook-key");
async function webhook(evt) {
  const body = JSON.stringify(evt), id = "msg_" + crypto.randomBytes(4).toString("hex"), t = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac("sha256", HOOK_KEY).update(`${id}.${t}.${body}`).digest("base64");
  await fns.resendWebhook({ method: "POST", rawBody: Buffer.from(body), headers: { "svix-id": id, "svix-timestamp": t, "svix-signature": `v1,${sig}` } }, { status() { return this; }, send() { return this; }, set() { return this; } });
}

(async () => {
  store.set("outreachSettings/global", { testMode: false, complianceBlockId: "cb" });
  store.set("outreachCompliance/cb", { legalEntityLine: "Douro Partners, Lda", footerText: "Remover: {{unsubscribeUrl}}" });
  await fns.outreachAdmin({ ...ADMIN, data: { action: "seed" } });
  const rel = get("outreachSenders/andre.rocha@douropartners.pt");
  ok("seed: relationship senders on douropartners.pt, active, no inbound alias", rel.kind === "relationship" && rel.status === "active" && rel.domain === "douropartners.pt" && rel.inboundAlias === null);
  store.set("outreachSenders/an.rocha@mail.douropartners-team.pt", { ...get("outreachSenders/an.rocha@mail.douropartners-team.pt"), status: "active" });
  store.set("outreachTemplates/upd", { name: "Update", status: "active", variants: [{ key: "A", subject: "Atualização Douro Partners", body: "{{contact.firstName|Caro investidor}}, uma atualização para a {{company.shortName|sua equipa}}." }] });
  store.set("outreachTemplates/f2", { name: "Follow", status: "active", variants: [{ key: "A", subject: "x", body: "Seguimento." }] });
  store.set("crmInvestors/inv1", { name: "Fundo Alfa", contacts: [{ name: "Ana Pinto", email: "ana@alfa.pt" }] });
  store.set("networkContacts/nc1", { name: "Rui Jornalista", email: "rui@jornal.pt", categories: ["journalist"] });

  // Guards
  ok("people campaigns: email steps only for now", (await camp({ action: "save", campaign: { name: "x", audienceType: "people", steps: [{ channel: "call" }] } })).err?.details?.reason === "people_email_only");
  const cid = (await camp({ action: "save", campaign: { name: "Atualização investidores", audienceType: "people", approvalDefault: "auto", pacing: { maxPerDay: 2 }, steps: [{ templateId: "upd" }, { templateId: "f2", wait: { days: 0 } }] } })).campaignId;
  ok("saved as a people campaign with its own daily limit", get(`outreachCampaigns/${cid}`).audienceType === "people" && get(`outreachCampaigns/${cid}`).pacing.maxPerDay === 2);
  ok("companies can't be added to a people campaign", (await camp({ action: "enrol", campaignId: cid, companyIds: ["x"] })).err?.details?.reason === "not_companies");
  const people = [
    { email: "Ana@Alfa.pt", name: "Ana Pinto", org: "Fundo Alfa", refs: [{ source: "crm", id: "inv1" }] },
    { email: "rui@jornal.pt", name: "Rui Jornalista", org: "Jornal", refs: [{ source: "network", id: "nc1" }] },
    { email: "ana@alfa.pt", name: "Ana", refs: [{ source: "portal", id: "pi1" }] },      // same person, another record → merged
    { email: "not-an-email", name: "X" },
    { email: "bloq@x.pt", name: "Bloqueado" },
    { email: "c@x.pt", name: "C" }, { email: "d@x.pt", name: "D" },
  ];
  store.set("outreachSuppression/bloq@x.pt", { reason: "unsubscribed" });
  const pv = await camp({ action: "previewPeople", campaignId: cid, people });
  ok("preview: deduped by email, invalid and suppressed excluded, days at 2/day", pv.requested === 6 && pv.eligible === 4 && pv.excluded.no_email === 1 && pv.excluded.suppressed === 1 && pv.daysToStart === 2);
  const en = await camp({ action: "enrolPeople", campaignId: cid, people, source: { type: "manual", label: "Investidores + imprensa" } });
  ok("enrol: 4 people", en.enrolled === 4 && en.skippedTotal === 2);
  const ea = get(`outreachEnrolments/${U.personEnrolmentId(cid, "ana@alfa.pt")}`);
  ok("enrolment keyed by email, both records kept, no company slot", ea.personEmail === "ana@alfa.pt" && ea.refs.length === 2 && ea.companyId === null && ea.sourceLabel === "Investidores + imprensa");
  ok("adding the same person again is skipped", (await camp({ action: "enrolPeople", campaignId: cid, people: [{ email: "ANA@alfa.pt" }] })).skipped.already_in_campaign === 1);
  ok("can't start without choosing the sender", /Choose who sends it/.test((await camp({ action: "setStatus", campaignId: cid, status: "active" })).err?.message || ""));
  await camp({ action: "save", campaignId: cid, campaign: { senderPolicy: { mode: "fixed", senderIds: ["andre.rocha@douropartners.pt"] } } });
  ok("starts once the sender is set", (await camp({ action: "setStatus", campaignId: cid, status: "active" })).status === "active");

  // Sending: max 2 per day for this campaign
  const r1 = await run("2026-09-29T10:30:00+01:00");
  ok("first run: one email (one per address per run)", r1.sent === 1 && sends.length === 1);
  await run("2026-09-29T10:40:00+01:00");
  const r3 = await run("2026-09-29T10:50:00+01:00");
  ok("the campaign's own limit (2/day) holds the rest", sends.length === 2 && r3.campaignCap >= 1);
  const s0 = sends[0];
  ok("sent from andre.rocha@douropartners.pt with the full-access key", /andre\.rocha@douropartners\.pt/.test(s0.body.from) && s0.auth === "Bearer secret-RESEND_READ_KEY");
  ok("person's first name and organisation fill the template", /^Ana, uma atualização para a Fundo Alfa\./.test(sends.find((s) => s.body.to[0] === "ana@alfa.pt").body.text));
  const acts = docs("crmActivities");
  ok("logged on the Investor CRM record (+ portal log for the same person)", acts.length === 1 && acts[0].investorId === "inv1" && acts[0].recipientEmails[0] === "ana@alfa.pt" && docs("activityLog").some((a) => a.type === "email_sent" && a.investorId === "pi1") && !!get("crmInvestors/inv1").lastTouchAt);
  const th = get(`outreachThreads/${get(`outreachEnrolments/${U.personEnrolmentId(cid, "ana@alfa.pt")}`).threadId}`);
  ok("conversation: person, no company, organisation as name", th.companyId === null && th.personEmail === "ana@alfa.pt" && th.recipientKind === "people" && th.companyName === "Fundo Alfa");

  // Next day: the rest + follow-ups (same thread)
  await run("2026-09-30T10:30:00+01:00"); await run("2026-09-30T10:40:00+01:00");
  ok("next day: 2 more (limit per day again)", sends.length === 4);
  ok("logged on the Network record once the journalist got it", docs("networkActivities").some((a) => a.contactId === "nc1" && a.recipientEmails[0] === "rui@jornal.pt") && !!get("networkContacts/nc1").lastTouchAt);
  ok("company-campaign rotation never picks relationship senders", require("../outreach/schedule_util.js").pickSender({ policy: { mode: "owner_rotation" }, owner: "andre", senders: [{ id: "andre.rocha@douropartners.pt", owner: "andre", status: "active", kind: "relationship" }], sentToday: {}, usedThisRun: new Set(), defaultCap: 25 }) === null);

  // Bounce on a people conversation stops that person's enrolment
  const rui = get(`outreachEnrolments/${U.personEnrolmentId(cid, "rui@jornal.pt")}`);
  await webhook({ type: "email.bounced", data: { email_id: "x", tags: { om: stepMessageId(rui ? U.personEnrolmentId(cid, "rui@jornal.pt") : "", "s1") }, bounce: { type: "Permanent" } } });
  ok("bounce → that person stopped", get(`outreachEnrolments/${U.personEnrolmentId(cid, "rui@jornal.pt")}`).status === "stopped");

  // Investor emails sent outside the portal from douropartners.pt aren't filed as replies
  const before = docs("outreachMessages").length;
  await webhook({ type: "email.sent", data: { email_id: "ext_1", from: "André Rocha <andre.rocha@douropartners.pt>", to: ["investidor@fundo.pt"], subject: "Documento" } });
  ok("an investor email from douropartners.pt (outside the portal) isn't recorded", docs("outreachMessages").length === before);

  // Company campaign guard: a people campaign can't switch type once people are in
  ok("audience type locked once people are in", (await camp({ action: "save", campaignId: cid, campaign: { audienceType: "companies" } })).err?.details?.reason === "audience_locked");

  // "Emailed in the last N days" for people: off by default; counts portal conversations and relationship sends
  const { Timestamp: TS } = require("firebase-admin/firestore");
  store.set("outreachPeopleSends/ps1", { recipients: ["vip@fundo.pt"], at: TS.fromDate(new Date(Date.now() - 3 * 86400000)) });
  store.set("outreachPeopleSends/ps2", { recipients: ["old@fundo.pt"], at: TS.fromDate(new Date(Date.now() - 90 * 86400000)) });
  const cOff = (await camp({ action: "save", campaign: { name: "Sem exclusão", audienceType: "people", steps: [{ templateId: "upd" }] } })).campaignId;
  const trio = [{ email: "ana@alfa.pt" }, { email: "vip@fundo.pt" }, { email: "old@fundo.pt" }];
  ok("default: nobody skipped for recent contact", (await camp({ action: "previewPeople", campaignId: cOff, people: trio })).eligible === 3 && get(`outreachCampaigns/${cOff}`).exclusions.peopleContactedWithinDays === 0);
  const cOn = (await camp({ action: "save", campaign: { name: "Com exclusão", audienceType: "people", exclusions: { peopleContactedWithinDays: 30 }, steps: [{ templateId: "upd" }] } })).campaignId;
  const pvR = await camp({ action: "previewPeople", campaignId: cOn, people: trio });
  ok("30 days: Ana (campaign email) and the relationship send 3 days ago skipped; 90 days ago kept", pvR.eligible === 1 && pvR.excluded.contacted_recently === 2);

  console.log(fail ? `\n${fail} FAILED` : "\nall 5a tests passed");
  process.exit(fail ? 1 : 0);
})();
