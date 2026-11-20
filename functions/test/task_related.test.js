// Related companies on task cards (20 Nov 2026, switch outreach.taskRelated): when the scheduler makes a task (a call, a visit…) for a
// company, the task carries its related companies — each with its latest contact (a call answered, a meeting, a reply) and the flags
// that colour the box — like a draft in To approve. Needs outreach.ownerAware. Synthetic data, in-memory Firestore.
const F = require("./fake_firebase.js");
const dns = require("dns").promises;
dns.resolveMx = async (d) => [{ exchange: "mx." + d, priority: 10 }];
global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" });
const fns = require("../index.js");
const Feat = require("../features");
const { runScheduler } = require("../outreach/scheduler.js");
const { store, Timestamp } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const docs = (coll) => [...store.entries()].filter(([p]) => p.startsWith(coll + "/")).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));
const NOW = Date.parse("2026-11-13T15:00:00Z");
const ts = (ms) => Timestamp.fromMillis(ms);
const flags = (task, owner = "on", rel = "on") => { store.set("config/features", { flags: { "outreach.taskRelated": { staging: task, production: task }, "outreach.ownerAware": { staging: owner, production: owner }, "outreach.relatedActivity": { staging: rel, production: rel } } }); Feat._reset(); };

function seed() {
  store.clear();
  store.set("outreachSettings/global", { testMode: false });
  const co = (id, data) => store.set(`searchCompanies/${id}`, { name: `${id.toUpperCase()}, LDA`, stage: "universe", companyEmail: `geral@${id}.pt`, owner: "andre", ownGraphAt: Timestamp.now(), ownOwnerOther: 1, ...data });
  co("otj", {});
  co("somobilis", { touches: { call: { n: 1, at: ts(NOW), outcome: "connected", inAt: ts(NOW), by: "andre" } } }); // a call answered on 13 Nov
  co("termobrasa", { lastOutreachAt: ts(NOW - 3 * 86400000) });                                                     // emailed, no reply
  co("alone", { ownOwnerOther: 0 });
  for (const id of ["otj", "somobilis", "termobrasa"]) store.set(`searchPersonLinks/jo__${id}`, { personId: "u_JO", companyId: id, personEntityType: "person", shCurrent: true, shDirectPct: 60, personName: "Joaquim Rocha" });
}
async function callCampaign(ids) {
  const { campaignId } = await camp({ action: "save", campaign: { name: "Chamadas", steps: [{ channel: "call", wait: { days: 0 } }] } });
  await camp({ action: "enrol", campaignId, companyIds: ids });
  await camp({ action: "setStatus", campaignId, status: "active" });
  await runScheduler({ now: new Date("2026-11-17T10:30:00Z"), gap: null, rand: () => 0 });
  return campaignId;
}
const taskOf = (id) => docs("outreachTasks").find((t) => t.companyId === id);

(async () => {
  seed(); flags("on");
  await callCampaign(["otj", "alone"]);
  const t = taskOf("otj");
  ok("the call task is made", !!t && t.status === "open" && t.channel === "call");
  const rel = t.related;
  ok("…it carries the related companies (SOMOBILIS, TERMOBRASA)", rel && rel.related.map((r) => r.companyId).sort().join() === "somobilis,termobrasa");
  const so = rel.related.find((r) => r.companyId === "somobilis");
  ok("…with the latest contact of each: a call answered on 13 Nov", so.answeredVia === "call" && new Date(so.answeredAt).toISOString().slice(0, 10) === "2026-11-13");
  ok("…and the flags that colour the box: SOMOBILIS in conversation (call)", rel.flags.some((f) => f.kind === "in_conversation" && f.companyId === "somobilis"));
  ok("a company with nothing related: no box", !taskOf("alone").related);

  seed(); flags("off");
  await callCampaign(["otj"]);
  ok("switch off: the task has no related box", !taskOf("otj").related);

  seed(); flags("on", "off");
  await callCampaign(["otj"]);
  ok("Owner-aware outreach off: no related box either", !taskOf("otj").related);

  seed(); flags("on", "on", "off");
  await callCampaign(["otj"]);
  ok("Related companies: activity off: the box is there, the call is not a conversation flag", taskOf("otj").related?.related.length === 2 && !taskOf("otj").related.flags.some((f) => f.kind === "in_conversation"));

  console.log(fail ? `\n${fail} FAILED` : "\nAll passed");
  process.exit(fail ? 1 : 0);
})();
