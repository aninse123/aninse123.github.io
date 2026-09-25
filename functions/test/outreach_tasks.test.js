// Phase 2b — manual steps as tasks (scheduler creates them, completeTask
// records the outcome and moves the sequence) and "do not contact", against
// the in-memory Firestore fake. Resend and DNS are mocked.
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
const { runScheduler } = require("../outreach/scheduler.js");
const { stepTaskId, OUTCOMES } = require("../outreach/task_util.js");
const { store, Timestamp } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const get = (p) => store.get(p);
const docs = (coll) => [...store.entries()].filter(([p]) => p.startsWith(coll + "/")).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));
const run = (iso, extra = {}) => runScheduler({ now: new Date(iso), gap: null, rand: () => 0, ...extra });
const TUE = "2026-09-29T10:30:00+01:00";

function seed({ real = false } = {}) {
  store.clear(); calls.length = 0;
  store.set("outreachSenders/an.rocha@mail.douropartners-team.pt", { email: "an.rocha@mail.douropartners-team.pt", displayName: "André Rocha", owner: "andre", status: "active", dailyCap: 25, signature: "A" });
  store.set("outreachTemplates/t1", { name: "Intro", status: "active", variants: [{ key: "A", subject: "Olá", body: "Corpo" }] });
  store.set("outreachTemplates/L", { name: "Carta", status: "active", kind: "letter", variants: [{ key: "A", subject: "", body: "Carta A" }, { key: "B", subject: "", body: "Carta B" }] });
  store.set("outreachTemplates/S", { name: "Guião", status: "active", kind: "script", variants: [{ key: "A", subject: "", body: "Bom dia" }] });
  for (let i = 1; i <= 4; i++) store.set(`searchCompanies/c${i}`, { name: `EMPRESA ${i}, LDA`, stage: "universe", companyEmail: `geral@empresa${i}.pt`, owner: "andre" });
  if (real) {
    store.set("outreachSettings/global", { testMode: false, complianceBlockId: "cb" });
    store.set("outreachCompliance/cb", { legalEntityLine: "Douro Partners, Lda", footerText: "Remover: {{unsubscribeUrl}}" });
  }
}
async function makeCampaign(campaign, ids) {
  const { campaignId } = await camp({ action: "save", campaign });
  await camp({ action: "enrol", campaignId, companyIds: ids });
  const a = await camp({ action: "setStatus", campaignId, status: "active" });
  if (a.err) throw a.err;
  return campaignId;
}

(async () => {
  ok("every channel has outcomes; each maps to a Search CRM activity type", ["linkedin", "call", "whatsapp", "letter", "visit", "other"].every((c) => OUTCOMES[c].length && OUTCOMES[c].every((o) => o.activity)));

  // ── A mixed sequence in real mode ──
  seed({ real: true });
  const steps = [
    { templateId: "t1" },                                              // s1 email
    { channel: "call", templateId: "S", instructions: "Pedir o gerente", wait: { days: 2 } }, // s2 call
    { channel: "linkedin", wait: { days: 0 } },                        // s3 LinkedIn
    { channel: "letter", templateId: "L", wait: { days: 0 } },         // s4 letter
    { channel: "other", instructions: "Enviar brochura", wait: { days: 0 } }, // s5 other
  ];
  const c1 = await makeCampaign({ name: "Mista", approvalDefault: "auto", steps }, ["c1", "c2", "c3"]);
  await run(TUE);
  ok("step 1 (email) sent to all three", calls.filter((c) => c.method === "POST").length === 1);
  await run("2026-09-29T10:40:00+01:00"); await run("2026-09-29T10:50:00+01:00");
  const r = await run("2026-10-01T11:00:00+01:00"); // the three emails went out 10:30 / 10:40 / 10:50 on Tuesday
  const t1id = stepTaskId(`${c1}_c1`, "s2");
  const t1 = get(`outreachTasks/${t1id}`);
  ok("call step due → a task per company, no email", r.tasks === 3 && r.sent === 0 && t1 && t1.status === "open" && t1.channel === "call");
  ok("task carries company, campaign, step, instructions, template; assigned to the owner", t1.companyName === "EMPRESA 1, LDA" && t1.campaignName === "Mista" && t1.stepName === "Call 2" && t1.instructions === "Pedir o gerente" && t1.templateId === "S" && t1.assignee === "andre" && t1.stepIndex === 1 && t1.stepCount === 5);
  ok("enrolment waits for the task", get(`outreachEnrolments/${c1}_c1`).status === "awaiting_task" && get(`outreachEnrolments/${c1}_c1`).taskId === t1id);
  ok("next run doesn't create a second task", (await run("2026-10-01T11:05:00+01:00")).tasks === 0 && docs("outreachTasks").length === 3);

  // Outcomes
  ok("outcome that doesn't exist for the channel refused", (await camp({ action: "completeTask", taskId: t1id, outcome: "accepted" })).err?.details?.reason === "bad_outcome");
  ok("call back needs a date", (await camp({ action: "completeTask", taskId: t1id, outcome: "callback" })).err?.details?.reason === "date_required");
  const cb = await camp({ action: "completeTask", taskId: t1id, outcome: "callback", reopenAt: "2026-10-05T10:00:00+01:00", notes: "Ligar segunda" });
  const t1b = get(`outreachTasks/${t1id}`);
  ok("call back: task stays open with the new date, attempt logged, activity written", cb.status === "open" && t1b.status === "open" && t1b.dueAt.toDate().toISOString().startsWith("2026-10-05") && t1b.attempts.length === 1 && docs("searchActivities").some((a) => a.taskId === t1id && a.type === "call_attempted"));
  const na = await camp({ action: "completeTask", taskId: t1id, outcome: "no_answer" });
  const e1 = get(`outreachEnrolments/${c1}_c1`);
  ok("no answer: task done, sequence moves to the LinkedIn step, due now (wait 0)", na.sequence === "next" && get(`outreachTasks/${t1id}`).status === "done" && e1.status === "active" && e1.currentStep === 2 && e1.history.slice(-1)[0].result === "no_answer");
  ok("real touch: call_attempted counted as outreach on the company", get("searchCompanies/c1").outreachAttempts >= 2 && docs("searchActivities").filter((a) => a.taskId === t1id && a.type === "call_attempted").length === 2);
  ok("step locked and channel counter on the campaign", get(`outreachCampaigns/${c1}`).lockedStepIds.includes("s2") && get(`outreachCampaigns/${c1}`).stats.tasks_call === 1);
  ok("completing a closed task refused", (await camp({ action: "completeTask", taskId: t1id, outcome: "no_answer" })).err?.details?.reason === "task_closed");

  // Connected → stop (default) vs keep going
  const t2id = stepTaskId(`${c1}_c2`, "s2"), t3id = stepTaskId(`${c1}_c3`, "s2");
  const con = await camp({ action: "completeTask", taskId: t2id, outcome: "connected", notes: "Interessado" });
  ok("connected: the step stays in the history and counts on the campaign", get(`outreachEnrolments/${c1}_c2`).history.slice(-1)[0].result === "connected" && get(`outreachCampaigns/${c1}`).stats.tasks_call === 2);
  ok("connected: sequence stopped as replied, company released, reply recorded", con.sequence === "stopped" && get(`outreachEnrolments/${c1}_c2`).status === "replied" && get("searchCompanies/c2").activeCampaignId === undefined && get("searchCompanies/c2").outreachStatus === "replied");
  const con2 = await camp({ action: "completeTask", taskId: t3id, outcome: "connected", stopSequence: false });
  ok("connected with 'stop' unticked: sequence continues", con2.sequence === "next" && get(`outreachEnrolments/${c1}_c3`).currentStep === 2);

  // LinkedIn (profile URL) → letter (variant) → other → skip
  await run("2026-10-01T11:00:00+01:00");
  const li = stepTaskId(`${c1}_c1`, "s3");
  await camp({ action: "completeTask", taskId: li, outcome: "request_sent", profileUrl: "https://www.linkedin.com/in/joao-silva" });
  ok("LinkedIn: profile URL kept on the task and the activity", get(`outreachTasks/${li}`).linkedinUrl === "https://www.linkedin.com/in/joao-silva" && docs("searchActivities").some((a) => a.taskId === li && a.linkedinUrl && a.type === "linkedin"));
  await run("2026-10-01T11:10:00+01:00");
  const lt = get(`outreachTasks/${stepTaskId(`${c1}_c1`, "s4")}`);
  ok("letter task gets an A/B variant, stored on the enrolment", lt.channel === "letter" && lt.variantKey === "A" && get(`outreachEnrolments/${c1}_c1`).variants.s4 === "A");
  await camp({ action: "completeTask", taskId: stepTaskId(`${c1}_c1`, "s4"), outcome: "posted" });
  await run("2026-10-01T11:20:00+01:00");
  const ot = stepTaskId(`${c1}_c1`, "s5");
  const actsBefore = docs("searchActivities").length;
  const sk = await camp({ action: "completeTask", taskId: ot, outcome: "skipped" });
  ok("skip: task skipped, no activity, sequence goes to the final grace period", sk.status === "skipped" && docs("searchActivities").length === actsBefore && get(`outreachEnrolments/${c1}_c1`).currentStep === 5);

  // ── Assignee override, budget independence, test mode ──
  seed();
  store.set("outreachSettings/global", { automationBudget: 0 });
  const c2 = await makeCampaign({ name: "Chamadas", assignee: "antonio", steps: [{ channel: "call", templateId: "S" }] }, ["c1"]);
  const r2 = await run(TUE);
  const tt = get(`outreachTasks/${stepTaskId(`${c2}_c1`, "s1")}`);
  ok("tasks don't use the email limit (limit 0, task created)", r2.tasks === 1 && !!tt);
  ok("campaign assignee overrides the owner; test-mode task flagged", tt.assignee === "antonio" && tt.isTest === true);
  await camp({ action: "completeTask", taskId: stepTaskId(`${c2}_c1`, "s1"), outcome: "voicemail" });
  const ta = docs("searchActivities").find((a) => a.taskId === stepTaskId(`${c2}_c1`, "s1"));
  ok("test-mode task writes a 'task_test' activity and doesn't touch the company", ta.type === "task_test" && /^\[TEST\]/.test(ta.title) && !get("searchCompanies/c1").outreachAttempts);

  // updateTask
  seed();
  const c3 = await makeCampaign({ name: "Visitas", steps: [{ channel: "visit" }] }, ["c1", "c2"]);
  await run(TUE);
  const vt = stepTaskId(`${c3}_c1`, "s1");
  ok("reassign + reschedule an open task", (await camp({ action: "updateTask", taskId: vt, assignee: "antonio", dueAt: "2026-10-02T09:00:00+01:00", notes: "Levar proposta" })).ok && get(`outreachTasks/${vt}`).assignee === "antonio" && get(`outreachTasks/${vt}`).notes === "Levar proposta");
  ok("bad assignee refused", (await camp({ action: "updateTask", taskId: vt, assignee: "joao" })).err?.details?.reason === "bad_assignee");
  // Removing the company cancels its open task
  await camp({ action: "enrolment", enrolmentId: `${c3}_c2`, op: "remove" });
  ok("removing the company cancels its open task", get(`outreachTasks/${stepTaskId(`${c3}_c2`, "s1")}`).status === "cancelled");

  // ── Do not contact ──
  const dnc = await camp({ action: "setDoNotContact", companyId: "c1", on: true, reason: "Pediu por telefone" });
  ok("do not contact: flag set, campaign stopped, open task cancelled", dnc.stopped === 1 && get("searchCompanies/c1").doNotContact.on === true && get("searchCompanies/c1").doNotContact.reason === "Pediu por telefone" && get(`outreachEnrolments/${c3}_c1`).status === "stopped" && get(`outreachTasks/${vt}`).status === "cancelled");
  const c4 = (await camp({ action: "save", campaign: { name: "Nova", steps: [{ templateId: "t1" }] } })).campaignId;
  ok("do not contact: can't be added to a campaign", (await camp({ action: "enrol", campaignId: c4, companyIds: ["c1"] })).skipped.do_not_contact === 1);
  let sendErr = null;
  try { await fns.outreachSend({ ...ADMIN, data: { companyId: "c1", senderId: "an.rocha@mail.douropartners-team.pt", to: "andrenorocha@gmail.com", subject: "x", body: "y" } }); } catch (e) { sendErr = e; }
  ok("do not contact: manual send from Compose refused", sendErr?.details?.reason === "do_not_contact");
  await camp({ action: "setDoNotContact", companyId: "c1", on: false });
  ok("switching it off allows enrolment again", get("searchCompanies/c1").doNotContact.on === false && (await camp({ action: "enrol", campaignId: c4, companyIds: ["c1"] })).enrolled === 1);
  ok("unknown company refused", (await camp({ action: "setDoNotContact", companyId: "nope", on: true })).err?.details?.reason === "company_not_found");

  // clearTestData removes test tasks
  const cleared = await fns.outreachAdmin({ ...ADMIN, data: { action: "clearTestData" } });
  ok("clearTestData deletes test-mode tasks", cleared.tasks >= 2 && docs("outreachTasks").length === 0);

  console.log(fail ? `\n${fail} FAILED` : "\nall task tests passed");
  process.exit(fail ? 1 : 0);
})();
