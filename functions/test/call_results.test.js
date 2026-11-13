// Call results (13 Nov 2026, switch "outreach.callResults"; plan "Call Results Plan" v3): an answered call (WhatsApp, LinkedIn, visit,
// Task or activity) gets a result (the Inbox categories) and a sequence choice for every address of the company (continue / pause until /
// stop), with reminders (Awaiting reply, Not now, Referred); the number used goes first next time. Also B1, whatever the switch says: an
// answer from a task ends every address of the company, never a real campaign from a test task. Synthetic data, in-memory Firestore.
const F = require("./fake_firebase.js");
const dns = require("dns").promises;
dns.resolveMx = async (d) => [{ exchange: "mx." + d, priority: 10 }];
const calls = [];
global.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method || "GET" });
  const hdrs = new Map([["x-resend-daily-quota", "5"], ["x-resend-monthly-quota", "50"]]);
  return { ok: true, status: 200, headers: { get: (h) => hdrs.get(h.toLowerCase()) ?? null }, text: async () => JSON.stringify({ id: "rs_" + calls.length }) };
};
const fns = require("../index.js");
const Feat = require("../features");
const { runScheduler } = require("../outreach/scheduler.js");
const C = require("../outreach/campaigns.js");
const TU = require("../outreach/task_util.js");
const { stepTaskId } = TU;
const { store, Timestamp } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const get = (p) => store.get(p);
const docs = (coll) => [...store.entries()].filter(([p]) => p.startsWith(coll + "/")).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));
const ms = (t) => (t?.toMillis ? t.toMillis() : t ? new Date(t).getTime() : 0);
const run = (iso) => runScheduler({ now: new Date(iso), gap: null, rand: () => 0 });
const RealDate = Date; let fakeNow = null;
global.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fakeNow ?? RealDate.now()])); } static now() { return fakeNow ?? RealDate.now(); } };
const setNow = (iso) => { fakeNow = iso ? RealDate.parse(iso) : null; };
const TUE = "2026-09-29T10:30:00+01:00"; // Tuesday
const flags = (state) => { store.set("config/features", { flags: { "outreach.callResults": { staging: state, production: state }, "outreach.taskContact": { staging: "on", production: "on" }, "outreach.multiRecipient": { staging: "on", production: "on" } } }); Feat._reset(); };

function seed(state = "on") {
  store.clear(); calls.length = 0; setNow(null);
  store.set("outreachSettings/global", { testMode: false, complianceBlockId: "cb" });
  store.set("outreachCompliance/cb", { legalEntityLine: "Douro Partners, Lda", footerText: "Remover: {{unsubscribeUrl}}" });
  store.set("outreachSenders/an.rocha@mail.douropartners-team.pt", { email: "an.rocha@mail.douropartners-team.pt", displayName: "André Rocha", owner: "andre", status: "active", dailyCap: 25, signature: "A" });
  store.set("outreachTemplates/t1", { name: "Intro", status: "active", variants: [{ key: "A", subject: "Olá", body: "Corpo" }] });
  for (let i = 1; i <= 4; i++) store.set(`searchCompanies/c${i}`, { name: `EMPRESA ${i}, LDA`, stage: "universe", companyEmail: `geral@empresa${i}.pt`, owner: "andre", companyPhone: "+351 222 000 00" + i });
  flags(state);
}
// A call first, then an email two working days later, sent by itself (approval "auto").
async function callCampaign(ids, extra = {}) {
  const { campaignId } = await camp({ action: "save", campaign: { name: "Chamadas", approvalDefault: "auto", steps: [{ channel: "call", wait: { days: 0 } }, { templateId: "t1", wait: { days: 2 } }], ...extra } });
  await camp({ action: "enrol", campaignId, companyIds: ids });
  const a = await camp({ action: "setStatus", campaignId, status: "active" });
  if (a.err) throw a.err;
  return campaignId;
}
// A second address of the company (a track), active and waiting for its next email.
function addTrack(cid, companyId, isTest = false) {
  const id = `${cid}_${companyId}__t1`;
  store.set(`outreachEnrolments/${id}`, { campaignId: cid, campaignName: "Chamadas", companyId, companyName: "", status: "active", currentStep: 1, isExtra: true, trackOf: `${cid}_${companyId}`, isTest, nextActionAt: Timestamp.fromDate(new RealDate("2026-12-01T09:00:00Z")), history: [], recipient: { email: `sofia@empresa.pt` } });
  return id;
}

(async () => {
  // ── Pure: the defaults of the plan's table ──
  const { answerPlan, workingDaysAt } = C._callResults;
  const fri = new RealDate("2026-10-02T11:00:00+01:00"); // Friday
  const aw = answerPlan(TU.findResult("wait_for_response"), {}, { now: fri });
  ok("Awaiting reply: pause, reminder by call in 3 working days at 10:00 (Fri → Thu: Mon 5 Oct is a holiday)", aw.mode === "pause" && aw.reminder.kind === "awaiting_reply" && aw.reminder.channel === "call" && aw.reminder.at.toISOString() === "2026-10-08T09:00:00.000Z");
  ok("…the pause lasts until the reminder", aw.until.getTime() === aw.reminder.at.getTime());
  ok("working days skip a national holiday (Mon 5 Oct, Implantação da República)", workingDaysAt(fri, 1, null, true).toISOString() === "2026-10-06T09:00:00.000Z");
  const nn = answerPlan(TU.findResult("not_now"), {}, { now: fri });
  ok("Not now: stop, follow-up in 6 months", nn.mode === "stop" && nn.reminder.kind === "follow_up" && nn.reminder.at.toISOString().slice(0, 10) === "2027-04-02");
  ok("Interested: stop, no reminder", answerPlan(TU.findResult("interested"), {}, { now: fri }).mode === "stop" && !answerPlan(TU.findResult("interested"), {}, { now: fri }).reminder);
  ok("Wrong contact: continue", answerPlan(TU.findResult("wrong_contact"), {}, { now: fri }).mode === "continue");
  ok("Referred: pause + a task to contact the person they pointed to (next working day)", (() => { const r = answerPlan(TU.findResult("referred"), {}, { now: fri }); return r.mode === "pause" && r.reminder.kind === "referred" && r.reminder.at.toISOString() === "2026-10-06T09:00:00.000Z"; })());
  const thr = (fn) => { try { fn(); return null; } catch (e) { return e.reason || e.details?.reason || e.message; } };
  ok("Call back at… needs a day and time", thr(() => answerPlan(TU.findResult("callback_later"), {}, { now: fri })) !== null);
  ok("a pause longer than 4 months is refused (use Not now)", /4 months|pause_too_long/.test(String(thr(() => answerPlan(TU.findResult("wait_for_response"), { sequence: { mode: "pause", until: "2027-06-01" } }, { now: fri })))));
  ok("the choice can be changed: Interested + Pause until", answerPlan(TU.findResult("interested"), { sequence: { mode: "pause", until: "2026-10-09T09:00:00Z" } }, { now: fri }).until.toISOString() === "2026-10-09T09:00:00.000Z");
  ok("phoneKey: +351 / 00351 / spaces are the same number", TU.reachKey("+351 912 345 678") === "912345678" && TU.reachKey("00351912345678") === "912345678" && TU.reachKey("912 345 678") === "912345678");
  ok("a foreign number keeps its own key", TU.reachKey("+44 20 7946 0958") === "x442079460958");
  ok("answer line: Answered by phone: name · number", TU.answerLine("call", { name: "Sofia Soares", number: "+351 912 345 678" }) === "Answered by phone: Sofia Soares · +351 912 345 678");

  // ── B1 (switch Off): Connected ends every address of the company, not only the task's ──
  seed("off");
  let cid = await callCampaign(["c1", "c2"]);
  await run(TUE);
  const tB = stepTaskId(`${cid}_c1`, "s1");
  ok("the call step made a task", get(`outreachTasks/${tB}`)?.status === "open");
  const trB = addTrack(cid, "c1");
  // a test campaign's enrolment of the same company: never touched by a real task (and the other way round)
  store.set("outreachEnrolments/testOne_c1", { campaignId: "testOne", companyId: "c1", status: "active", currentStep: 0, isTest: true, nextActionAt: Timestamp.fromDate(new RealDate("2026-12-01T09:00:00Z")) });
  setNow("2026-09-29T11:00:00+01:00");
  let r = await camp({ action: "completeTask", taskId: tB, outcome: "connected" });
  ok("Connected saved", r.ok && r.sequence === "stopped");
  ok("…the task's own address ended as replied", get(`outreachEnrolments/${cid}_c1`).status === "replied");
  ok("…and the company's other address too (it kept going before the fix)", get(`outreachEnrolments/${trB}`).status === "replied");
  ok("…a test campaign's enrolment of the same company is left alone", get("outreachEnrolments/testOne_c1").status === "active");
  ok("…another company is not touched", ["active", "awaiting_task"].includes(get(`outreachEnrolments/${cid}_c2`).status));
  ok("with the switch Off, Answered + a result is refused", (await camp({ action: "completeTask", taskId: stepTaskId(`${cid}_c2`, "s1"), outcome: "answered", result: "interested" })).err?.details?.feature === "outreach.callResults");
  // Pause company from the card pauses every address
  const trB2 = addTrack(cid, "c2");
  r = await camp({ action: "enrolment", enrolmentId: `${cid}_c2`, op: "pause", wholeCompany: true });
  ok("Pause company (from a task card) pauses every address of the company", r.ok && r.paused === 2 && get(`outreachEnrolments/${cid}_c2`).status === "paused" && get(`outreachEnrolments/${trB2}`).status === "paused");

  // ── Awaiting reply: pause every address until the reminder; the reminder closes when the company writes ──
  seed("on");
  cid = await callCampaign(["c1", "c2"]);
  await run(TUE);
  const t1 = stepTaskId(`${cid}_c1`, "s1");
  const tr1 = addTrack(cid, "c1");
  store.set("outreachThreads/th1", { companyId: "c1", campaignId: cid, status: "open", isTest: false, contactEmail: "geral@empresa1.pt" });
  setNow("2026-09-29T11:00:00+01:00");
  ok("Answered needs a result", (await camp({ action: "completeTask", taskId: t1, outcome: "answered" })).err?.details?.reason === "result_required");
  ok("No answer can't carry a result", (await camp({ action: "completeTask", taskId: t1, outcome: "no_answer", result: "interested" })).err?.details?.reason === "result_needs_answer");
  r = await camp({ action: "completeTask", taskId: t1, outcome: "answered", result: "wait_for_response", notes: "Vai falar com o sócio", contact: { name: "Sofia Soares", number: "+351 912 345 678", personId: "p1" } });
  ok("Awaiting reply saved: both addresses paused, a reminder", r.ok && r.sequence === "paused" && r.paused === 2 && !!r.reminderTaskId);
  const e1 = get(`outreachEnrolments/${cid}_c1`);
  ok("…the call step is done: the sequence moved on to the email, then paused", e1.status === "paused" && e1.currentStep === 1 && e1.pausedFrom === "active");
  ok("…paused until the reminder's day (Fri 2 Oct, 10:00)", ms(e1.pausedUntil) === RealDate.parse("2026-10-02T10:00:00+01:00") && ms(get(`outreachEnrolments/${tr1}`).pausedUntil) === ms(e1.pausedUntil));
  ok("…the enrolment says who answered and the result", e1.answer?.category === "wait_for_response" && e1.answer.line === "Answered by phone: Sofia Soares · +351 912 345 678");
  ok("…the conversation carries the category (Inbox chip, metrics) and the phone answer", get("outreachThreads/th1").responseCategory === "wait_for_response" && !!get("outreachThreads/th1").otherReplyAt);
  const rem = get(`outreachTasks/${r.reminderTaskId}`);
  ok("…the reminder: a call task, Awaiting reply since today, on the company, assigned to whoever saved the result", rem.status === "open" && rem.reminderKind === "awaiting_reply" && rem.channel === "call" && rem.companyId === "c1" && rem.assignee === "andre" && /Awaiting reply since 29 Sept?/.test(rem.instructions) && /Vai falar/.test(rem.instructions));
  const act = docs("searchActivities").find((a) => a.taskId === t1);
  ok("…the activity has the result and who answered", act.type === "call_connected" && act.responseCategory === "wait_for_response" && act.contactName === "Sofia Soares" && act.contactPersonId === "p1" && /Answered: Awaiting reply/.test(act.title));
  ok("…the number that answered is marked on the company (first next time)", get("searchCompanies/c1").phoneReach?.["912345678"]?.wrong === false);
  // the scheduler: still paused before the date; resumed by itself after it; the next email waits in To approve with the note
  await run("2026-10-01T10:00:00+01:00");
  ok("before the date: still paused", get(`outreachEnrolments/${cid}_c1`).status === "paused");
  const rr = await run("2026-10-02T10:05:00+01:00");
  const e1b = get(`outreachEnrolments/${cid}_c1`);
  ok("on the date the scheduler resumes every address by itself", rr.resumed === 2 && !e1b.pausedUntil);
  ok("…and the next email waits in To approve (the campaign sends by itself), with the answer on it", e1b.status === "awaiting_approval" && /Answered by phone/.test(get(`outreachMessages/${e1b.draftMessageId}`)?.answerNote?.line || ""));
  ok("…no email left by itself", !calls.some((c) => c.method === "POST" && /emails/.test(c.url)));
  // an email from the company closes the reminder
  const n = await C.closeAwaitingReminders("c1", false, { why: "Email from geral@empresa1.pt" });
  ok("an email from the company closes the Awaiting reply reminder", n === 1 && get(`outreachTasks/${r.reminderTaskId}`).status === "done" && get(`outreachTasks/${r.reminderTaskId}`).outcome === "answered_elsewhere");

  // ── Not now: stop + Next follow-up on the company (a task that day); doing the task clears it ──
  const t2 = stepTaskId(`${cid}_c2`, "s1");
  r = await camp({ action: "completeTask", taskId: t2, outcome: "answered", result: "not_now", reminder: { at: "2027-03-29T10:00:00Z", note: "Depois do fecho de contas" } });
  ok("Not now: the company's sequence stops", r.ok && r.sequence === "stopped" && get(`outreachEnrolments/${cid}_c2`).status === "replied" && /Answered by phone — Not now/.test(get(`outreachEnrolments/${cid}_c2`).stopReason));
  const co2 = get("searchCompanies/c2");
  ok("…the company has its Next follow-up (Search CRM column and filter)", ms(co2.nextFollowUp?.at) === RealDate.parse("2027-03-29T10:00:00Z") && co2.nextFollowUp.note === "Depois do fecho de contas" && co2.nextFollowUp.campaignName === "Chamadas");
  const fu = get(`outreachTasks/${r.reminderTaskId}`);
  ok("…and a task on that day", fu.reminderKind === "follow_up" && ms(fu.dueAt) === ms(co2.nextFollowUp.at));
  setNow("2027-03-29T11:00:00+01:00");
  r = await camp({ action: "completeTask", taskId: r.reminderTaskId, outcome: "no_answer", contact: { number: "+351 222 000 002" } });
  ok("doing the follow-up task clears the date on the company", r.ok && !get("searchCompanies/c2").nextFollowUp);

  // ── Call back at…: the task reopens at that time; the other address waits until then ──
  seed("on");
  cid = await callCampaign(["c3"]);
  await run(TUE);
  const t3 = stepTaskId(`${cid}_c3`, "s1"), tr3 = addTrack(cid, "c3");
  setNow("2026-09-29T11:00:00+01:00");
  r = await camp({ action: "completeTask", taskId: t3, outcome: "answered", result: "callback_later", callbackAt: "2026-09-29T16:00:00+01:00", contact: { name: "Rececionista", number: "222000003" } });
  ok("Call back at…: the same task stays open at that day and time", r.ok && r.status === "open" && get(`outreachTasks/${t3}`).status === "open" && ms(get(`outreachTasks/${t3}`).dueAt) === RealDate.parse("2026-09-29T16:00:00+01:00"));
  ok("…its own address still waits for the task", get(`outreachEnrolments/${cid}_c3`).status === "awaiting_task");
  ok("…the other address is paused until the call back", get(`outreachEnrolments/${tr3}`).status === "paused" && ms(get(`outreachEnrolments/${tr3}`).pausedUntil) === RealDate.parse("2026-09-29T16:00:00+01:00"));
  // Wrong number on the reopened task marks the number
  r = await camp({ action: "completeTask", taskId: t3, outcome: "wrong_number", contact: { number: "+351 222 000 003" } });
  ok("Wrong number: no answer, the sequence goes on, the number is marked wrong", r.ok && r.sequence === "next" && get("searchCompanies/c3").phoneReach?.["222000003"]?.wrong === true);

  // ── A test task never touches a real campaign; no number marks on a real company ──
  seed("on");
  cid = await callCampaign(["c4"], { isTest: true });
  store.set("outreachSettings/global", { testMode: false, complianceBlockId: "cb", campaignTestRecipient: "andrenorocha@gmail.com" });
  await run(TUE);
  const t4 = stepTaskId(`${cid}_c4`, "s1");
  store.set("outreachEnrolments/real_c4", { campaignId: "real", companyId: "c4", status: "active", currentStep: 0, isTest: false, nextActionAt: Timestamp.fromDate(new RealDate("2026-12-01T09:00:00Z")) });
  setNow("2026-09-29T11:00:00+01:00");
  if (get(`outreachTasks/${t4}`)) {
    r = await camp({ action: "completeTask", taskId: t4, outcome: "answered", result: "not_interested", contact: { name: "X", number: "912000000" } });
    ok("a test task's Stop ends the test enrolment only", r.ok && get(`outreachEnrolments/${cid}_c4`).status === "replied" && get("outreachEnrolments/real_c4").status === "active");
    ok("…and writes nothing on the real company (no number mark, no follow-up)", !get("searchCompanies/c4").phoneReach && !get("searchCompanies/c4").nextFollowUp);
  } else ok("test campaign made its call task", false);

  // ── Task or activity: the same results; stops the company's running campaign ──
  seed("on");
  cid = await callCampaign(["c1"]);
  await run(TUE);
  setNow("2026-09-29T11:00:00+01:00");
  r = await camp({ action: "logActivity", companyId: "c1", channel: "whatsapp", outcome: "replied", result: "interested", notes: "Quer reunir", contact: { name: "Sofia Soares" } });
  ok("Task or activity with Interested stops the company's campaign", r.ok && r.stopped === 1 && get(`outreachEnrolments/${cid}_c1`).status === "replied" && /Answered on WhatsApp: Sofia Soares — Interested/.test(get(`outreachEnrolments/${cid}_c1`).stopReason));
  ok("…and the open call task of the step is cancelled", get(`outreachTasks/${stepTaskId(`${cid}_c1`, "s1")}`).status === "cancelled");
  r = await camp({ action: "logActivity", companyId: "c2", channel: "call", outcome: "answered", result: "callback_later", callbackAt: "2026-09-30T10:00:00+01:00" });
  ok("Task or activity with Call back at… creates the call task for that time", r.ok && !!r.callbackTaskId && ms(get(`outreachTasks/${r.callbackTaskId}`).dueAt) === RealDate.parse("2026-09-30T10:00:00+01:00"));

  // ── The related companies see a Next follow-up ──
  const Rel = require("../outreach/related.js");
  const fl = Rel.flagsFor({ related: [{ companyId: "x", name: "IRMÃ, LDA", nextFollowUpAt: Date.parse("2027-05-12T09:00:00Z") }] }, { now: Date.parse("2026-11-13T09:00:00Z") });
  ok("a related company's Next follow-up is a flag (\"next follow-up … via …\")", fl.some((f) => f.kind === "follow_up" && /next follow-up 2027-05-12 via IRMÃ/.test(f.text)));

  // ── Metrics: a company that answered with a result and never had an email conversation counts in the Monday report ──
  const Report = require("../outreach/report.js");
  const wFrom = Date.parse("2026-11-02T00:00:00Z"), wTo = Date.parse("2026-11-09T00:00:00Z");
  const at = (iso) => Timestamp.fromDate(new RealDate(iso));
  const rep = Report.buildWeeklyReport({ from: wFrom, to: wTo, companyCounts: true,
    threads: [{ id: "th", companyId: "mail", repliedAt: at("2026-11-03T10:00:00Z"), responseCategory: "interested" }],
    answers: [
      { companyId: "phone", answer: { category: "wait_for_response", channel: "call", at: at("2026-11-04T10:00:00Z") } },
      { companyId: "phone", answer: { category: "interested", channel: "call", at: at("2026-11-05T10:00:00Z") } }, // a second address: once per company
      { companyId: "mail", answer: { category: "interested", channel: "call", at: at("2026-11-04T10:00:00Z") } }, // already counted by its email
      { companyId: "old", answer: { category: "not_now", channel: "visit", at: at("2026-10-20T10:00:00Z") } }, // another week
      { companyId: "t", isTest: true, answer: { category: "interested", channel: "call", at: at("2026-11-04T10:00:00Z") } },
    ] });
  ok("Monday report: a phone answer with no email counts once per company, by its first result, as a call", rep.week.replies === 2 && rep.week.repliesNoEmail === 1 && rep.week.byCategory["Awaiting reply"] === 1 && rep.week.repliesByChannel["chamada"] === 1);
  ok("…and the report text says how many had no email", /1 sem conversa por email/.test(Report.reportText(rep, { weekKey: "2026-11-02", toKey: "2026-11-08" })));

  // ── Campaign filter: Next follow-up due (kept for new matches) ──
  const { matchesFilterSpec } = require("../outreach/campaign_util.js");
  const nowMs = Date.parse("2026-11-13T09:00:00Z");
  const coDue = { nextFollowUp: { at: at("2026-11-10T10:00:00Z") } }, coLater = { nextFollowUp: { at: at("2026-12-01T10:00:00Z") } };
  ok("filter: next follow-up due", matchesFilterSpec(coDue, [{ field: "nextFollowUpAt", op: "due", value: true }], nowMs) && !matchesFilterSpec(coLater, [{ field: "nextFollowUpAt", op: "due", value: true }], nowMs) && !matchesFilterSpec({}, [{ field: "nextFollowUpAt", op: "due", value: true }], nowMs));
  ok("filter: next follow-up in the next 30 days / any", matchesFilterSpec(coLater, [{ field: "nextFollowUpAt", op: "due_within", value: 30 }], nowMs) && !matchesFilterSpec(coLater, [{ field: "nextFollowUpAt", op: "due_within", value: 7 }], nowMs) && matchesFilterSpec(coLater, [{ field: "nextFollowUpAt", op: "exists", value: true }], nowMs));

  setNow(null);
  console.log(fail ? `\n${fail} call-results test(s) FAILED` : "\nall call-results tests passed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
