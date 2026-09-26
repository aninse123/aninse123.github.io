// Phase 5b — recurring emails: schedule maths (Lisbon, summer time), issue
// drafts written by the scheduler, approve → paced send through a hidden
// people campaign, unsubscribe from that recurring email only.
const F = require("./fake_firebase.js");
const dns = require("dns").promises;
dns.resolveMx = async (d) => [{ exchange: "mx." + d, priority: 10 }];
const sends = [];
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.endsWith("/emails") && opts.method === "POST") sends.push({ body: JSON.parse(opts.body), auth: opts.headers.Authorization });
  const hdrs = new Map([["x-resend-daily-quota", "5"], ["x-resend-monthly-quota", "50"]]);
  return { ok: true, status: 200, headers: { get: (h) => hdrs.get(h.toLowerCase()) ?? null }, text: async () => JSON.stringify({ id: "rs_" + sends.length }) };
};

const fns = require("../index.js");
const R = require("../outreach/recurring.js");
const { runScheduler } = require("../outreach/scheduler.js");
const { store } = F;
const { Timestamp } = require("firebase-admin/firestore");

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const rec = async (data) => { try { return await fns.outreachRecurring({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const get = (p) => store.get(p);
const docs = (coll) => [...store.entries()].filter(([p]) => p.startsWith(coll + "/") && p.split("/").length === coll.split("/").length + 1).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));
const run = (iso) => runScheduler({ now: new Date(iso), gap: null, rand: () => 0 });
const iso = (d) => d.toISOString();
function makeRes() { const r = {}; return { r, res: { status(c) { r.code = c; return this; }, send(b) { r.body = b; return this; }, set() { return this; } } }; }

(async () => {
  // Schedule maths
  const after = new Date("2026-09-26T12:00:00Z");
  ok("monthly day 1 at 09:30 → 1 Oct 09:30 Lisbon (summer time, 08:30Z)", iso(R.nextOccurrence({ freq: "monthly", day: 1, time: "09:30" }, after)) === "2026-10-01T08:30:00.000Z");
  ok("monthly in winter time → 1 Nov 09:30Z", iso(R.nextOccurrence({ freq: "monthly", day: 1, time: "09:30" }, new Date("2026-10-02T00:00:00Z"))) === "2026-11-01T09:30:00.000Z");
  ok("quarterly Jan/Apr/Jul/Oct → 1 Oct; Feb/May/Aug/Nov → 1 Nov", iso(R.nextOccurrence({ freq: "quarterly", day: 1, startMonth: 1, time: "09:30" }, after)) === "2026-10-01T08:30:00.000Z" && iso(R.nextOccurrence({ freq: "quarterly", day: 1, startMonth: 2, time: "09:30" }, after)) === "2026-11-01T09:30:00.000Z");
  ok("weekly Monday 09:30 from Saturday → Mon 28 Sep", iso(R.nextOccurrence({ freq: "weekly", weekday: 1, time: "09:30" }, after)) === "2026-09-28T08:30:00.000Z");
  ok("exactly on the date → the following one", iso(R.nextOccurrence({ freq: "weekly", weekday: 1, time: "09:30" }, new Date("2026-09-28T08:30:00Z"))) === "2026-10-05T08:30:00.000Z");
  ok("bad input → monthly, day 1, 09:30", JSON.stringify(R.normalizeSchedule({ freq: "daily", day: 31, time: "25:00" })) === JSON.stringify({ freq: "monthly", time: "09:30", weekday: 1, day: 1, startMonth: 1 }));

  // Setup
  store.set("outreachSettings/global", { testMode: false, complianceBlockId: "cb" });
  store.set("outreachCompliance/cb", { legalEntityLine: "Douro Partners, Lda", footerText: "Remover: {{unsubscribeUrl}}" });
  await fns.outreachAdmin({ ...ADMIN, data: { action: "seed" } });
  store.set("outreachTemplates/upd", { name: "Investor update", status: "active", variants: [{ key: "A", subject: "Atualização mensal", body: "{{contact.firstName|Caro investidor}}, a atualização deste mês." }] });
  store.set("outreachLists/L1", { name: "Investidores", count: 3 });
  [["ana@alfa.pt", "Ana Pinto", "Fundo Alfa", [{ source: "crm", id: "inv1" }]], ["rui@beta.pt", "Rui Costa", "Beta", []], ["eva@gama.pt", "Eva Lima", "Gama", []]]
    .forEach(([email, name, org, refs]) => store.set(`outreachLists/L1/members/${email.replace(/[^a-z0-9]/g, "_")}`, { email, name, org, refs }));
  store.set("crmInvestors/inv1", { name: "Fundo Alfa", contacts: [{ name: "Ana Pinto", email: "ana@alfa.pt" }] });

  // Save
  ok("needs a list", (await rec({ action: "save", recurring: { name: "Update", templateId: "upd", senderId: "andre.rocha@douropartners.pt" } })).err?.details?.reason === "list_required");
  const s = await rec({ action: "save", recurring: { name: "Atualização mensal a investidores", listId: "L1", templateId: "upd", senderId: "andre.rocha@douropartners.pt", schedule: { freq: "monthly", day: 1, time: "09:30" }, maxPerDay: 2 } });
  const rid = s.recurringId;
  ok("saved active with its next date and names copied", get(`outreachRecurring/${rid}`).status === "active" && !!s.nextIssueAt && get(`outreachRecurring/${rid}`).listName === "Investidores" && get(`outreachRecurring/${rid}`).maxPerDay === 2);

  // Scheduler writes the issue on its date, once
  store.set(`outreachRecurring/${rid}`, { ...get(`outreachRecurring/${rid}`), nextIssueAt: Timestamp.fromDate(new Date("2026-10-01T08:30:00Z")) });
  let rep = await run("2026-10-01T08:00:00Z");
  ok("before the date: no issue", !docs("outreachIssues").length && !rep.issues);
  rep = await run("2026-10-01T08:31:00Z");
  const i1 = docs("outreachIssues")[0];
  ok("on the date: issue #1 drafted from the template", rep.issues === 1 && i1?.status === "draft" && i1.number === 1 && i1.subject === "Atualização mensal" && i1.listId === "L1");
  ok("next date moved to 1 Nov", iso(get(`outreachRecurring/${rid}`).nextIssueAt.toDate()) === "2026-11-01T09:30:00.000Z");
  await run("2026-10-01T08:41:00Z");
  ok("a later run the same day doesn't write it again", docs("outreachIssues").length === 1);

  // Off-schedule issue supersedes the waiting one
  const n2 = await rec({ action: "issueNow", recurringId: rid });
  ok("issue now: #2 drafted, #1 replaced", n2.number === 2 && get(`outreachIssues/${i1.id}`).status === "cancelled" && get(`outreachIssues/${n2.issueId}`).status === "draft");

  // Approve (edited) → hidden people campaign, paced send
  const ap = await rec({ action: "approveIssue", issueId: n2.issueId, subject: "Atualização de outubro", body: "{{contact.firstName|Caro investidor}}, os números de outubro." });
  const camp = get(`outreachCampaigns/${ap.campaignId}`);
  ok("approve: campaign for this issue, all 3 on the list, 2 sending days at 2/day", ap.enrolled === 3 && ap.days === 2 && camp.kind === "issue" && camp.recurringId === rid && camp.status === "active" && camp.approvalDefault === "auto" && camp.pacing.maxPerDay === 2);
  ok("issue → sending, edits kept, hidden template", get(`outreachIssues/${n2.issueId}`).status === "sending" && get(`outreachIssues/${n2.issueId}`).subject === "Atualização de outubro" && get(`outreachTemplates/${camp.steps[0].templateId}`).hidden === true);
  ok("can't approve twice", (await rec({ action: "approveIssue", issueId: n2.issueId })).err?.details?.reason === "not_waiting");

  await run("2026-10-06T10:30:00+01:00"); await run("2026-10-06T10:40:00+01:00"); await run("2026-10-06T10:50:00+01:00");
  ok("first day: 2 sent (max per day), edited subject, from andre.rocha@douropartners.pt", sends.length === 2 && sends.every((x) => x.body.subject === "Atualização de outubro" && /andre\.rocha@douropartners\.pt/.test(x.body.from)));
  ok("personalised body", /^Ana, os números de outubro\./.test(sends.find((x) => x.body.to[0] === "ana@alfa.pt")?.body.text || ""));
  ok("logged on the Investor CRM record", docs("crmActivities").some((a) => a.investorId === "inv1"));

  // Unsubscribe from this recurring email only
  const toRui = sends.find((x) => x.body.to[0] === "rui@beta.pt") || sends[1];
  const who = toRui.body.to[0];
  const token = toRui.body.headers["List-Unsubscribe"].slice(1, -1).split("/u/")[1];
  const m = makeRes();
  await fns.outreachUnsubscribe({ method: "POST", path: "/" + token, rawBody: Buffer.from("List-Unsubscribe=One-Click") }, m.res);
  ok("opt-out recorded for this recurring email, not the global list", m.r.code === 200 && /Atualização mensal a investidores/.test(m.r.body) && docs("outreachOptOuts").some((o) => o.campaignId === rid && o.email === who) && !get(`outreachSuppression/${who}`));

  // Next issue skips the person who left
  const n3 = await rec({ action: "issueNow", recurringId: rid });
  const ap3 = await rec({ action: "approveIssue", issueId: n3.issueId });
  ok("next issue: the person who unsubscribed is left out", ap3.enrolled === 2 && ap3.skipped.unsubscribed === 1);

  // Skip, pause, delete
  const n4 = await rec({ action: "issueNow", recurringId: rid });
  ok("skip an issue", (await rec({ action: "skipIssue", issueId: n4.issueId })).ok && get(`outreachIssues/${n4.issueId}`).status === "skipped");
  await rec({ action: "setStatus", recurringId: rid, status: "paused" });
  store.set(`outreachRecurring/${rid}`, { ...get(`outreachRecurring/${rid}`), nextIssueAt: Timestamp.fromDate(new Date("2026-11-01T09:30:00Z")) });
  const before = docs("outreachIssues").length;
  await run("2026-11-02T10:00:00Z");
  ok("paused: no issue written", docs("outreachIssues").length === before);
  const n5 = await rec({ action: "issueNow", recurringId: rid });
  await rec({ action: "delete", recurringId: rid });
  ok("delete: gone, waiting draft cancelled, sent issues kept", !get(`outreachRecurring/${rid}`) && get(`outreachIssues/${n5.issueId}`).status === "cancelled" && get(`outreachIssues/${n2.issueId}`).status === "sending");
  ok("empty list → approve refused, issue stays a draft", await (async () => {
    store.set("outreachLists/L2", { name: "Vazia", count: 0 });
    const r2 = (await rec({ action: "save", recurring: { name: "Vazia", listId: "L2", templateId: "upd", senderId: "andre.rocha@douropartners.pt" } })).recurringId;
    const n = await rec({ action: "issueNow", recurringId: r2 });
    const r = await rec({ action: "approveIssue", issueId: n.issueId });
    return r.err?.details?.reason === "list_empty" && get(`outreachIssues/${n.issueId}`).status === "draft";
  })());

  // Clear test data (go-live): test issues, their templates and campaigns go; lists and recurring emails stay
  store.set("outreachSettings/global", { testMode: true, complianceBlockId: "cb", campaignTestRecipient: "andrenorocha@gmail.com" });
  const rT = (await rec({ action: "save", recurring: { name: "Teste", listId: "L1", templateId: "upd", senderId: "andre.rocha@douropartners.pt" } })).recurringId;
  const nT = await rec({ action: "issueNow", recurringId: rT });
  const apT = await rec({ action: "approveIssue", issueId: nT.issueId });
  const tplT = get(`outreachCampaigns/${apT.campaignId}`).steps[0].templateId;
  ok("test-mode issue and its template are marked as test", get(`outreachIssues/${nT.issueId}`).isTest === true && get(`outreachTemplates/${tplT}`).isTest === true);
  const cl = await fns.outreachAdmin({ ...ADMIN, data: { action: "clearTestData" } });
  ok("clear test data: issue, template and issue campaign removed", cl.issues >= 1 && cl.issueTemplates >= 1 && !get(`outreachIssues/${nT.issueId}`) && !get(`outreachTemplates/${tplT}`) && !get(`outreachCampaigns/${apT.campaignId}`));
  ok("clear test data: lists, recurring emails and real issues stay", !!get("outreachLists/L1") && !!get(`outreachRecurring/${rT}`) && !!get(`outreachIssues/${n2.issueId}`));

  console.log(fail ? `\n${fail} FAILED` : "\nall 5b tests passed");
  process.exit(fail ? 1 : 0);
})();
