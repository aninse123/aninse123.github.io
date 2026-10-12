// Own tasks and activities (12 Oct 2026): a call / LinkedIn / WhatsApp /
// letter / visit / other task for a company that isn't a campaign step — from
// Outreach → Tasks or from a conversation — and a touch recorded straight away.
// Synthetic data only.
const F = require("./fake_firebase.js");
global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" });
const fns = require("../index.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const INTERN = { auth: { token: { email: "maria@douropartners.pt", perms: ["out.view", "out.draft", "out.tasks"], key: "maria" } } };
const VIEWER = { auth: { token: { email: "rui@douropartners.pt", perms: ["out.view"], key: "rui" } } };
const camp = async (who, data) => { try { return await fns.outreachCampaign({ ...who, data }); } catch (e) { return { err: e }; } };
const reason = (r) => r?.err?.details?.reason;
const docs = (coll) => [...store.entries()].filter(([p]) => p.startsWith(coll + "/")).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));

(async () => {
  store.clear();
  store.set("outreachSettings/global", { testMode: false });
  store.set("teamDirectory/maria", { key: "maria", name: "Maria", active: true });
  store.set("searchCompanies/co1", { name: "EMPRESA TESTE, LDA", owner: "antonio", companyEmail: "geral@empresa.pt" });
  store.set("outreachThreads/th1", { companyId: "co1", companyName: "EMPRESA TESTE, LDA", contactEmail: "geral@empresa.pt", isTest: false });
  store.set("outreachThreads/th2", { companyId: null, contactEmail: "x@y.pt" });
  store.set("outreachTemplates/L1", { name: "Carta", status: "active", variants: [{ key: "A", body: "Carta" }] });

  // Create from Tasks: company, channel, due date, assignee.
  let r = await camp(ADMIN, { action: "createTask", companyId: "co1", channel: "call", dueAt: "2026-10-14T09:00:00Z", assignee: "andre", instructions: "Ligar à Ana depois das 15h" });
  let t = store.get(`outreachTasks/${r.taskId}`);
  ok("own call task created: no campaign, open, due, for André", r.ok && t.campaignId === null && t.enrolmentId === null && t.status === "open" && t.channel === "call" && t.assignee === "andre" && t.source === "own" && t.companyName === "EMPRESA TESTE, LDA");
  r = await camp(ADMIN, { action: "createTask", companyId: "co1", channel: "visit" });
  ok("no assignee given → the company's owner; no date → now", store.get(`outreachTasks/${r.taskId}`).assignee === "antonio" && !!store.get(`outreachTasks/${r.taskId}`).dueAt);
  r = await camp(ADMIN, { action: "createTask", companyId: "co1", channel: "call", assignee: null });
  ok("assignee null stays nobody", store.get(`outreachTasks/${r.taskId}`).assignee === null);

  // From a conversation: the company comes from the thread, the task links back.
  r = await camp(INTERN, { action: "createTask", threadId: "th1", channel: "letter", templateId: "L1", assignee: "maria" });
  t = store.get(`outreachTasks/${r.taskId}`);
  ok("intern (Do tasks) creates from a conversation: company from the thread, letter template set", r.ok && t.companyId === "co1" && t.threadId === "th1" && t.templateId === "L1" && t.variantKey === "A" && t.createdBy === "maria@douropartners.pt");
  ok("conversation without a company → refused", reason(await camp(ADMIN, { action: "createTask", threadId: "th2", channel: "call" })) === "company_required");
  ok("unknown channel → refused", reason(await camp(ADMIN, { action: "createTask", companyId: "co1", channel: "email" })) === "bad_channel");
  ok("unknown assignee → refused", reason(await camp(ADMIN, { action: "createTask", companyId: "co1", channel: "call", assignee: "zz" })) === "bad_assignee");
  ok("without Do tasks → refused", !!(await camp(VIEWER, { action: "createTask", companyId: "co1", channel: "call" })).err);

  // Completing an own task: activity on the company, task closed, no campaign touched.
  const callId = docs("outreachTasks").find((x) => x.instructions === "Ligar à Ana depois das 15h").id;
  r = await camp(ADMIN, { action: "completeTask", taskId: callId, outcome: "connected", notes: "Falei com a Ana" });
  const act = store.get(`searchActivities/${r.activityId}`);
  ok("own task done → closed, activity 'Call — Connected' on the company", r.ok && r.sequence === "none" && store.get(`outreachTasks/${callId}`).status === "done" && act.companyId === "co1" && act.type === "call_connected" && act.title === "Call — Connected" && act.content === "Falei com a Ana" && act.campaignId === null);
  // Call back keeps it open with a new date.
  r = await camp(ADMIN, { action: "createTask", companyId: "co1", channel: "call" });
  const cb = await camp(ADMIN, { action: "completeTask", taskId: r.taskId, outcome: "callback", reopenAt: "2026-10-20T09:00:00Z" });
  ok("call back on an own task → stays open with the new date", cb.ok && store.get(`outreachTasks/${r.taskId}`).status === "open");
  const sk = await camp(ADMIN, { action: "completeTask", taskId: r.taskId, outcome: "skipped" });
  ok("cancel (skip) an own task → closed without activity", sk.ok && store.get(`outreachTasks/${r.taskId}`).status === "skipped" && !sk.activityId);

  // Record an activity straight away (from a conversation).
  r = await camp(INTERN, { action: "logActivity", threadId: "th1", channel: "call", outcome: "no_answer", notes: "Não atendeu", date: "2026-10-12T15:00:00Z" });
  const a2 = store.get(`searchActivities/${r.activityId}`);
  ok("record an activity: 'Call — No answer' on the company, linked to the conversation", r.ok && a2.companyId === "co1" && a2.type === "call_attempted" && a2.title === "Call — No answer" && a2.threadId === "th1" && a2.createdBy === "maria@douropartners.pt");
  ok("record: a call-back outcome isn't a record → refused", reason(await camp(ADMIN, { action: "logActivity", companyId: "co1", channel: "call", outcome: "foo" })) === "bad_outcome");
  ok("record: a future date → refused", reason(await camp(ADMIN, { action: "logActivity", companyId: "co1", channel: "call", outcome: "connected", date: "2030-01-01T00:00:00Z" })) === "bad_date");
  ok("touches counted on the company (last touch / outreach)", !!store.get("searchCompanies/co1").lastTouchAt && !!store.get("searchCompanies/co1").lastOutreachAt);

  if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
  console.log("\nALL PASSED");
})();
