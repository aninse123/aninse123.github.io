// A visit is a meeting, and the company counts as replied by phone or in person (3 Nov 2026; switches outreach.visitMeetings and
// outreach.companyCounts). Synthetic data only.
const F = require("./fake_firebase.js");
global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" });
const fns = require("../index.js");
const Report = require("../outreach/report.js");
const Feat = require("../features");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const docs = (coll) => [...store.entries()].filter(([p]) => p.startsWith(coll + "/")).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));
function flags(visit, counts) {
  store.set("config/features", { flags: { "outreach.visitMeetings": { staging: visit, production: visit }, "outreach.companyCounts": { staging: counts, production: counts } } });
  Feat._reset();
}

(async () => {
  store.clear();
  store.set("outreachSettings/global", { testMode: false });
  store.set("searchCompanies/co1", { name: "SHORTLEC, LDA", owner: "andre" });
  store.set("outreachThreads/thA", { companyId: "co1", contactEmail: "cmontanha@shortlec.com", isTest: false, responseCategory: "interested" });
  store.set("outreachThreads/thB", { companyId: "co1", contactEmail: "jsantos@shortlec.com", isTest: false });

  // Switch Off: a visit is only a task, as before.
  flags("off", "off");
  let r = await camp({ action: "createTask", companyId: "co1", channel: "visit", dueAt: "2026-11-06T09:00:00Z", assignee: "andre" });
  ok("Off: no meeting is logged when a visit is booked", r.ok && docs("searchActivities").length === 0 && !store.get(`outreachTasks/${r.taskId}`).meetingActivityId);
  let done = await camp({ action: "completeTask", taskId: r.taskId, outcome: "met" });
  ok("Off: Met logs the in-person visit, as before", done.ok && store.get(`searchActivities/${done.activityId}`).type === "in_person");
  ok("Off: no otherReplyAt on the conversations", docs("outreachThreads").every((t) => !t.otherReplyAt));

  // On: booking = meeting scheduled for the visit date.
  store.delete(`searchActivities/${done.activityId}`);
  flags("on", "on");
  r = await camp({ action: "createTask", companyId: "co1", channel: "visit", dueAt: "2026-11-06T09:00:00Z", assignee: "andre", instructions: "Reunião na sede, 14h30" });
  const tk = store.get(`outreachTasks/${r.taskId}`), sched = store.get(`searchActivities/${tk.meetingActivityId}`);
  ok("On: booking a visit logs 'meeting scheduled' for that company and date", !!sched && sched.type === "meeting_scheduled" && sched.companyId === "co1" && sched.status === "open" && sched.taskId === r.taskId && new Date(sched.date.toDate ? sched.date.toDate() : sched.date).toISOString().slice(0, 10) === "2026-11-06");
  ok("On: a call task books no meeting", (await camp({ action: "createTask", companyId: "co1", channel: "call" })).ok && docs("searchActivities").filter((a) => a.type === "meeting_scheduled").length === 1);

  // Reschedule moves the same meeting (no second one).
  const rs = await camp({ action: "completeTask", taskId: r.taskId, outcome: "reschedule", reopenAt: new Date(Date.now() + 9 * 86400000).toISOString() });
  const moved = store.get(`searchActivities/${tk.meetingActivityId}`);
  ok("Reschedule moves the scheduled meeting; still one meeting; task open", rs.ok && store.get(`outreachTasks/${r.taskId}`).status === "open" && docs("searchActivities").filter((a) => a.type === "meeting_scheduled").length === 1 && new Date(moved.date.toDate ? moved.date.toDate() : moved.date).getTime() > Date.now() + 8 * 86400000);

  // Met: meeting done, the scheduled one closed, the company's conversations marked as answered.
  done = await camp({ action: "completeTask", taskId: r.taskId, outcome: "met", notes: "Reunião feita" });
  const md = store.get(`searchActivities/${done.activityId}`);
  ok("Met logs 'meeting done' on the company", done.ok && md.type === "meeting_done" && md.companyId === "co1");
  ok("Met closes the scheduled meeting as happened", store.get(`searchActivities/${tk.meetingActivityId}`).status === "happened");
  ok("Met marks every conversation of the company as answered (otherReplyAt)", docs("outreachThreads").every((t) => !!t.otherReplyAt));

  // A visit that already happened (recorded from a conversation) is a meeting done too.
  store.set("outreachThreads/thC", { companyId: "co1", contactEmail: "x@shortlec.com", isTest: false });
  const la = await camp({ action: "logActivity", threadId: "thC", channel: "visit", outcome: "met", notes: "Estive lá", date: "2026-11-02T15:00:00Z" });
  ok("logActivity visit Met → meeting done", la.ok && store.get(`searchActivities/${la.activityId}`).type === "meeting_done");
  // A call that connected counts as an answer by phone, but a missed one does not.
  store.set("searchCompanies/co2", { name: "OUTRA, LDA", owner: "andre" });
  store.set("outreachThreads/thD", { companyId: "co2", contactEmail: "a@outra.pt", isTest: false });
  await camp({ action: "logActivity", companyId: "co2", channel: "call", outcome: "no_answer", date: "2026-11-02T15:00:00Z" });
  ok("a call nobody answered does not count as a reply", !store.get("outreachThreads/thD").otherReplyAt);
  await camp({ action: "logActivity", companyId: "co2", channel: "call", outcome: "connected", date: "2026-11-02T16:00:00Z" });
  ok("a call that connected does", !!store.get("outreachThreads/thD").otherReplyAt);

  // Companies-only switch: counts follow its own switch.
  flags("off", "off");
  store.set("searchCompanies/co3", { name: "TERCEIRA, LDA", owner: "andre" });
  store.set("outreachThreads/thE", { companyId: "co3", contactEmail: "a@t.pt", isTest: false });
  await camp({ action: "logActivity", companyId: "co3", channel: "call", outcome: "connected", date: "2026-11-02T16:00:00Z" });
  ok("companyCounts Off: a connected call leaves no mark", !store.get("outreachThreads/thE").otherReplyAt);

  // Monday report: one reply per company; meetings booked and held.
  const from = Date.parse("2026-11-02T00:00:00Z"), to = Date.parse("2026-11-09T00:00:00Z"), at = Date.parse("2026-11-03T10:00:00Z");
  const threads = [
    { id: "a", companyId: "co1", responseCategory: "interested", otherReplyAt: at },
    { id: "b", companyId: "co1", responseCategory: null, otherReplyAt: at },
    { id: "c", companyId: "co9", responseCategory: "not_now", repliedAt: at },
  ];
  const acts = [{ type: "meeting_scheduled", createdAt: at }, { type: "meeting_done", createdAt: at }, { type: "meeting_done", createdAt: at }];
  let rep = Report.buildWeeklyReport({ from, to, threads, activities: acts, companyCounts: true }).week;
  ok("report On: two conversations of one company are one reply, with the positive classification", rep.replies === 2 && rep.byCategory["Interested"] === 1 && rep.byCategory["Not now"] === 1);
  ok("report: meetings booked 1, held 2", rep.meetings === 1 && rep.meetingsHeld === 2);
  rep = Report.buildWeeklyReport({ from, to, threads, activities: acts }).week;
  ok("report Off: as before, by email only (one reply, the phone one is not counted)", rep.replies === 1);
  const en = [{ startedAt: at, companyId: "co1" }, { startedAt: at, companyId: "co1", isExtra: true }, { startedAt: at, companyId: "co2" }];
  ok("report On: a company's extra addresses are not new companies started", Report.buildWeeklyReport({ from, to, enrolments: en, companyCounts: true }).week.started === 2 && Report.buildWeeklyReport({ from, to, enrolments: en }).week.started === 3);
  const chThreads = [
    { id: "a", companyId: "co1", repliedAt: at + 86400000, otherReplyAt: at, otherReplyChannel: "call" },
    { id: "c", companyId: "co9", repliedAt: at },
    { id: "d", companyId: "co7", otherReplyAt: at, otherReplyChannel: "visit" },
  ];
  const wk = Report.buildWeeklyReport({ from, to, threads: chThreads, companyCounts: true }).week;
  ok("report On: replies by channel, the first answer of each company (call before email)", wk.replies === 3 && wk.repliesByChannel["chamada"] === 1 && wk.repliesByChannel["email"] === 1 && wk.repliesByChannel["visita"] === 1);
  flags("on", "on");
  store.set("outreachThreads/thF", { companyId: "co3", contactEmail: "z@t.pt", isTest: false });
  await camp({ action: "logActivity", companyId: "co3", channel: "call", outcome: "connected", date: "2026-11-02T12:00:00Z" });
  const tf = store.get("outreachThreads/thF");
  ok("logActivity stores the channel and the logged date of the answer", tf.otherReplyChannel === "call" && new Date(tf.otherReplyAt.toDate ? tf.otherReplyAt.toDate() : tf.otherReplyAt).toISOString().slice(0, 10) === "2026-11-02");
  store.set("searchCompanies/coMx", { name: "SEM MX, LDA", companyEmail: "geral@sem-mx.pt" });
  const Store = require("../outreach/store.js");
  ok("a general address with no mail servers is marked on the company, for that address only", (await Store.markCompanyEmailBounced("coMx", "geral@sem-mx.pt", "no mail servers (the domain can't receive email)", false)) === true && store.get("searchCompanies/coMx").companyEmailBounce.email === "geral@sem-mx.pt" && (await Store.markCompanyEmailBounced("coMx", "outro@sem-mx.pt", "x", false)) === false);
  ok("the scheduler marks it when a send stops for no mail servers", require("fs").readFileSync(require("path").join(__dirname, "../outreach/scheduler.js"), "utf8").includes('reason === "no_mx" && e.recipient?.email) await store.markCompanyEmailBounced('));
  ok("the report text has the held line", /Reuniões realizadas: 2/.test(Report.reportText({ week: { ...rep, meetingsHeld: 2, byCampaign: {}, bySender: {}, byCategory: {}, tasksByChannel: {} }, owners: { multiCampaign: [], sameOwner: [], emailLinks: [], openFlags: [], heldNow: [] } }, { weekKey: "2026-11-02", toKey: "2026-11-08" })));

  console.log(fail ? `\n${fail} FAILED` : "\nAll passed");
  process.exit(fail ? 1 : 0);
})();
