// Contacted column (27 Oct 2026, switch search.contactColumns): the per-channel
// contact summary — built in full from activities, and kept up to date one
// contact at a time by store.touchCompany (emails out, replies, tasks).
// Synthetic data only.
const F = require("./fake_firebase.js");
const CS = require("../outreach/contact_summary.js");
const store = require("../outreach/store.js");
const { store: db, Timestamp } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const T = (iso) => Timestamp.fromDate(new Date(iso));

(async () => {
  // ── The whole summary from activities ──
  const acts = [
    { type: "email", date: T("2026-10-10T09:00:00Z"), createdBy: "scheduler" },
    { type: "email", date: T("2026-10-14T09:00:00Z"), createdBy: "andre.rocha@douropartners.pt" },
    { type: "email_received", date: T("2026-10-16T10:00:00Z") },
    { type: "call_attempted", date: T("2026-10-18T10:00:00Z"), createdBy: "antonio.carvalho@douropartners.pt", outcome: "no_answer" },
    { type: "linkedin", date: T("2026-10-19T10:00:00Z"), outcome: "replied" },
    { type: "letter", date: T("2026-10-20T10:00:00Z"), outcome: "posted" },
    { type: "in_person", date: T("2026-10-21T10:00:00Z"), outcome: "met" },
    { type: "email_test", date: T("2026-10-21T10:00:00Z") }, { type: "email", isTest: true, date: T("2026-10-21T10:00:00Z") },
    { type: "note", date: T("2026-10-21T10:00:00Z") }, { type: "email", date: T("2099-01-01T00:00:00Z") },
    { type: "email", recordDeleted: true, date: T("2026-10-21T10:00:00Z") },
  ];
  const s = CS.summaryOf(acts, Date.parse("2026-10-27T00:00:00Z"));
  ok("email: 2 sent (test, future, deleted left out), the latest by André, replied 16 Oct", s.email.n === 2 && s.email.by === "andre.rocha@douropartners.pt" && s.email.inAt.toMillis() === Date.parse("2026-10-16T10:00:00Z"));
  ok("call: 1, no answer, by António, no answer recorded", s.call.n === 1 && s.call.outcome === "no_answer" && !s.call.inAt);
  ok("LinkedIn replied, letter posted, visit met (an answer); notes and tests are no channel", s.linkedin.inAt && s.letter.outcome === "posted" && !s.letter.inAt && s.visit.inAt && Object.keys(s).sort().join() === "call,email,letter,linkedin,visit");

  // ── One contact at a time (touchCompany) ──
  db.clear();
  db.set("searchCompanies/c1", { name: "A" });
  await store.touchCompany("c1", { direction: "out", isTest: false, channel: "email", by: "andre.rocha@douropartners.pt" });
  await store.touchCompany("c1", { direction: "out", isTest: false, channel: "email", by: "scheduler" });
  let c = db.get("searchCompanies/c1");
  ok("each email out counts on email (2), with the latest sender", c.touches.email.n === 2 && c.touches.email.by === "scheduler" && c.touches.email.at && !c.touches.email.inAt && c.outreachStatus === "contacted");
  await store.touchCompany("c1", { direction: "in", isTest: false, isAutoReply: true, channel: "email" });
  ok("an automatic reply (out of office) is not an answer", !db.get("searchCompanies/c1").touches.email.inAt);
  await store.touchCompany("c1", { direction: "in", isTest: false, channel: "email" });
  ok("a real reply marks email answered", !!db.get("searchCompanies/c1").touches.email.inAt);
  await store.touchCompany("c1", { direction: "out", isTest: false, channel: "call", by: "antonio", outcome: "connected" });
  await store.touchCompany("c1", { direction: "out", isTest: false, channel: "linkedin", by: "antonio", outcome: "request_sent" });
  await store.touchCompany("c1", { direction: "out", isTest: false, channel: "other", by: "antonio", outcome: "done" });
  c = db.get("searchCompanies/c1");
  ok("a task: call connected = contacted and answered; LinkedIn request = contacted; \"other\" is no channel", c.touches.call.n === 1 && c.touches.call.outcome === "connected" && c.touches.call.inAt && c.touches.linkedin.n === 1 && !c.touches.linkedin.inAt && !c.touches.other);
  await store.touchCompany("c1", { direction: "out", isTest: true, channel: "whatsapp", by: "antonio" });
  ok("test traffic never touches the company", !db.get("searchCompanies/c1").touches.whatsapp);

  if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
  console.log("\nall contact-summary tests passed");
})().catch((e) => { console.log("ERROR", e.stack); process.exit(1); });
