// Related companies: activity (10 Nov 2026, switch "outreach.relatedActivity"): what is logged on a related company
// (a call that connected, a meeting, a visit, an Engaged stage) counts as "in conversation"; the same activity can be
// logged on related companies ticked by hand; a running sequence can be paused. Synthetic data only.
const F = require("./fake_firebase.js");
const dns = require("dns").promises;
dns.resolveMx = async (d) => [{ exchange: "mx." + d, priority: 10 }];
global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" });
const fns = require("../index.js");
const Feat = require("../features");
const R = require("../outreach/related.js");
const { store, Timestamp } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const get = (p) => store.get(p);
const docs = (coll) => [...store.entries()].filter(([p]) => p.startsWith(coll + "/")).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));
const DAY = 86400000, NOW = Date.parse("2026-11-10T15:00:00Z");
const flagsOn = (rel) => { store.set("config/features", { flags: { "outreach.ownerAware": { staging: "on", production: "on" }, "outreach.relatedActivity": { staging: rel, production: rel } } }); Feat._reset(); };
const ts = (ms) => Timestamp.fromMillis(ms);

function seed() {
  store.clear();
  const co = (id, data) => store.set(`searchCompanies/${id}`, { name: `${id.toUpperCase()}, LDA`, stage: "universe", companyEmail: `geral@${id}.pt`, ownGraphAt: Timestamp.now(), ...data });
  co("est", { ownOwnerOther: 1, touches: { call: { n: 1, at: ts(NOW - 2 * 3600e3), outcome: "connected", inAt: ts(NOW - 2 * 3600e3), by: "andre" } } }); // the call was logged here
  co("otj", { ownOwnerOther: 1, outreachStatus: "contacted", touches: { email: { n: 3, at: ts(NOW - 6 * DAY), inAt: null } } });
  co("sib", { ownOwnerOther: 1, stage: "engaged" });                               // only Engaged
  co("quiet", { ownOwnerOther: 1, touches: { call: { n: 1, at: ts(NOW - DAY), outcome: "no_answer", inAt: null }, letter: { n: 1, at: ts(NOW - DAY) } } }); // our own contacts only
  co("meet", { ownOwnerOther: 1, touches: { meeting: { n: 1, at: ts(NOW - DAY) } } });
  co("stranger", { ownOwnerOther: 0 });
  const link = (id, d) => store.set(`searchPersonLinks/${id}`, d);
  for (const id of ["est", "otj", "sib", "quiet", "meet"]) link(`jo__${id}`, { personId: "u_JO", companyId: id, personEntityType: "person", shCurrent: true, shDirectPct: id === "est" ? 51 : 100, personName: "Joaquim Rocha" });
  store.set("outreachEnrolments/e1", { companyId: "otj", campaignId: "k1", status: "active", currentStep: 3 });
  store.set("outreachEnrolments/e2", { companyId: "otj", campaignId: "k2", status: "ended" });
  store.set("searchActivities/a1", { companyId: "est", type: "call_connected", date: ts(NOW - 2 * 3600e3), content: "Estufas e OTJ. OTJ quer despachar.", via: "call", contactName: "Joaquim Rocha", responseCategory: "interested", createdBy: "andre.rocha@douropartners.pt" });
  store.set("searchActivities/a2", { companyId: "est", type: "note", date: ts(NOW - 3600e3), content: "Quase 70 anos.", createdBy: "andre.rocha@douropartners.pt" });
  store.set("searchActivities/t1", { companyId: "est", type: "task_test", date: ts(NOW), isTest: true });
}

(async () => {
  seed();
  // The signal, from the related company's own contact summary
  ok("signalOf: a call that connected is an answer (call, when)", R.signalOf(get("searchCompanies/est")).answeredVia === "call" && R.signalOf(get("searchCompanies/est")).answeredAt > 0);
  ok("signalOf: a meeting set up counts; our own call with no answer and a letter do not", R.signalOf(get("searchCompanies/meet")).answeredVia === "meeting" && R.signalOf(get("searchCompanies/quiet")).answeredAt === null);
  ok("signalOf: an email only sent is nothing; Engaged is flagged", R.signalOf(get("searchCompanies/otj")).answeredAt === null && R.signalOf(get("searchCompanies/sib")).engaged === true);

  // Flags: OTJ looks at its related companies
  const m = await R.relatedFor(["otj"]);
  const entry = m.get("otj");
  ok("OTJ's related companies: EST, SIB, QUIET, MEET (not the stranger)", entry.related.map((r) => r.companyId).sort().join() === "est,meet,quiet,sib");
  const off = R.flagsFor(entry, { windowDays: 30, now: NOW });
  ok("switch off: nothing is in conversation (no reply on any)", !off.some((f) => f.kind === "in_conversation"));
  const on = R.flagsFor(entry, { windowDays: 30, now: NOW, activity: true });
  const conv = on.filter((f) => f.kind === "in_conversation");
  ok("switch on: EST (call), MEET (meeting) and SIB (engaged) are in conversation; QUIET (our own contacts) is not", conv.map((f) => f.companyId).sort().join() === "est,meet,sib" && conv.every((f) => f.activity === true));
  ok("…the text says how: \"call 2026-11-10\", \"meeting …\", \"engaged\"", conv.find((f) => f.companyId === "est").text === "in conversation via EST, LDA (call 2026-11-10)" && /^in conversation via MEET, LDA \(meeting 2026-11-09\)$/.test(conv.find((f) => f.companyId === "meet").text) && conv.find((f) => f.companyId === "sib").text === "in conversation via SIB, LDA (engaged)");
  ok("a plain email reply keeps its own text and is not marked as activity", (() => { const e2 = { related: [{ companyId: "z", name: "Z", lastReplyAt: NOW - DAY, answeredAt: NOW - 3 * DAY, answeredVia: "call" }] }; const f = R.flagsFor(e2, { activity: true, now: NOW }); return f.length === 1 && f[0].text === "in conversation via Z (reply 2026-11-09)" && !f[0].activity; })());

  // Through the callable: the related lookup follows the switch
  flagsOn("off");
  let r = await camp({ action: "related", companyId: "otj" });
  ok("callable 'related', switch off: no flag from the call", !r.err && !r.flags.some((f) => f.kind === "in_conversation"));
  flagsOn("on");
  r = await camp({ action: "related", companyId: "otj" });
  ok("callable 'related', switch on: EST is in conversation (activity flag)", r.flags.some((f) => f.kind === "in_conversation" && f.companyId === "est" && f.activity));

  // Logging the same activity on related companies
  flagsOn("off");
  r = await camp({ action: "logRelated", activityId: "a1", companyIds: ["otj"] });
  ok("logRelated with the switch off: refused", r.err?.details?.reason === "switch_off");
  flagsOn("on");
  r = await camp({ action: "logRelated", activityId: "a1", companyIds: ["stranger"] });
  ok("a company that is not related cannot be ticked", r.err?.details?.reason === "not_related");
  r = await camp({ action: "logRelated", activityId: "a1", companyIds: ["otj", "sib", "meet", "quiet"] });
  ok("more than 3 refused", r.err?.details?.reason === "too_many");
  r = await camp({ action: "logRelated", activityId: "t1", companyIds: ["otj"] });
  ok("a test activity cannot be copied", r.err?.details?.reason === "not_copyable");
  r = await camp({ action: "logRelated", activityId: "a1", companyIds: ["otj"] });
  const copies = docs("searchActivities").filter((a) => a.companyId === "otj");
  ok("the call is logged on OTJ, marked as a copy, same date, contact and answer", r.ok && r.logged === 1 && copies.length === 1 && copies[0].type === "call_connected" && copies[0].source === "related" && copies[0].relatedFromActivityId === "a1" && copies[0].relatedFromCompanyId === "est" && copies[0].content.startsWith("[Also logged from EST, LDA] Estufas e OTJ") && copies[0].contactName === "Joaquim Rocha" && copies[0].responseCategory === "interested" && copies[0].createdBy === "andre.rocha@douropartners.pt");
  const otj = get("searchCompanies/otj");
  ok("OTJ's contact summary: a call that connected (answered); its email count is untouched", otj.touches.call && otj.touches.email.n === 3 && otj.lastTouchAt && otj.outreachStatus === "replied");
  r = await camp({ action: "logRelated", activityId: "a1", companyIds: ["otj"] });
  ok("once only: asking again adds nothing", r.ok && r.logged === 0 && docs("searchActivities").filter((a) => a.companyId === "otj").length === 1);
  ok("…and a copy cannot be copied again", (await camp({ action: "logRelated", activityId: copies[0].id, companyIds: ["est"] })).err?.details?.reason === "not_copyable");
  r = await camp({ action: "logRelated", activityId: "a2", companyIds: ["sib"] });
  const note = docs("searchActivities").find((a) => a.companyId === "sib");
  ok("a note is copied as text: no contact summary, no touch", r.logged === 1 && note.type === "note" && !get("searchCompanies/sib").touches && !get("searchCompanies/sib").lastTouchAt);
  const sig = R.signalOf(get("searchCompanies/otj"));
  ok("after the copy OTJ itself counts as in conversation for the others", sig.answeredVia === "call");

  // Pausing the sequence
  flagsOn("off");
  ok("pauseSequence with the switch off: refused", (await camp({ action: "pauseSequence", companyId: "otj" })).err?.details?.reason === "switch_off");
  flagsOn("on");
  r = await camp({ action: "pauseSequence", companyId: "otj", reason: "in conversation via EST, LDA (call 2026-11-10)" });
  ok("the running sequence is paused (not ended); the ended one is left alone", r.ok && r.paused === 1 && get("outreachEnrolments/e1").status === "paused" && get("outreachEnrolments/e1").pausedFrom === "active" && get("outreachEnrolments/e2").status === "ended");
  ok("…a note on the company says who paused it and why", docs("searchActivities").some((a) => a.companyId === "otj" && a.type === "outreach_group" && /paused by andre\.rocha@douropartners\.pt/i.test(a.content) && /in conversation via EST/.test(a.content)));
  r = await camp({ action: "pauseSequence", companyId: "otj" });
  ok("pausing again: nothing more to pause", r.ok && r.paused === 0);
  r = await camp({ action: "pauseSequence", companyId: "stranger" });
  ok("a company with no sequence: nothing paused, no note", r.ok && r.paused === 0 && r.live === 0);

  console.log(fail ? `${fail} related-activity test(s) FAILED` : "all related-activity tests passed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
