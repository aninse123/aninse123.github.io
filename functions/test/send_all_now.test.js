// "Send approved emails all at once" (28 Oct 2026, switch outreach.sendAllNow):
// a campaign's approved emails leave together instead of one per address every
// run; "Send approved now" sends them at once inside the window; without the
// setting nothing changes. Synthetic data only.
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
const Feat = require("../features");
const { runScheduler } = require("../outreach/scheduler.js");
const { store, Timestamp } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const docs = (coll) => [...store.entries()].filter(([p]) => p.startsWith(coll + "/")).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));
const sent = () => calls.filter((c) => c.url.endsWith("/emails") && c.method === "POST").length;
const IDS = ["a", "b", "c", "d", "e", "f"];
function flags(state) { store.set("config/features", { flags: { "outreach.sendAllNow": { staging: state, production: state }, "outreach.campaignCc": { staging: state, production: state } } }); Feat._reset(); }

function seed() {
  store.clear(); calls.length = 0;
  store.set("outreachSettings/global", { testMode: false, dailyTarget: 100 });
  store.set("outreachSenders/an.rocha@mail.douropartners-team.pt", { email: "an.rocha@mail.douropartners-team.pt", displayName: "André Rocha", owner: "andre", status: "active", dailyCap: 25, signature: "A" });
  store.set("teamDirectory/andre", { key: "andre", name: "André Rocha", partner: true, active: true });
  store.set("outreachTemplates/t1", { name: "t1", status: "active", variants: [{ key: "A", subject: "Notice {{company.shortName}}", body: "Corpo." }] });
  for (const id of IDS) store.set(`searchCompanies/${id}`, { name: `EMPRESA ${id.toUpperCase()}, LDA`, stage: "universe", companyEmail: `geral@${id}.pt`, owner: "andre", contacts: [], ownGraphAt: Timestamp.now(), ownGroupSize: 1, ownSubs: 0, ownParents: 0, ownOwnerOther: 0 });
}
async function ready(extra) {
  const { campaignId: k } = await camp({ action: "save", campaign: { name: "Notice", approvalDefault: "approval", pacing: { newPerDay: 30 }, senderPolicy: { mode: "fixed", senderIds: ["an.rocha@mail.douropartners-team.pt"] }, sendWindow: { days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" }, skipHolidays: false, steps: [{ id: "s1", channel: "email", name: "Email 1", templateId: "t1" }], ...extra } });
  await camp({ action: "enrol", campaignId: k, companyIds: IDS });
  await camp({ action: "setStatus", campaignId: k, status: "active" });
  await runScheduler({ now: new Date("2026-09-29T10:00:00+01:00"), gap: null }); // drafts
  const drafts = docs("outreachMessages").filter((m) => m.campaignId === k && m.status === "draft").map((m) => m.id);
  await camp({ action: "approve", messageIds: drafts });
  return { k, drafts };
}

(async () => {
  // Without the setting: one per address per run (as today)
  seed(); flags("on");
  let { drafts } = await ready({});
  await runScheduler({ now: new Date(Date.now() + 60000) /* after the approval (due "now") */, gap: null });
  ok("without the setting: 6 approved from one address → 1 leaves in a run (one per address per run, as before)", drafts.length === 6 && sent() === 1);

  // With it: all in one run
  seed(); flags("on");
  ({ drafts } = await ready({ sendAllAtOnce: true }));
  await runScheduler({ now: new Date(Date.now() + 60000) /* after the approval (due "now") */, gap: null });
  ok("\"Send approved emails all at once\": the 6 approved leave in the same run", sent() === 6);

  // Send approved now: right away, inside the window
  seed(); flags("on");
  let r = await ready({ sendAllAtOnce: true });
  const res = await camp({ action: "sendNow", campaignId: r.k });
  ok("\"Send approved now\" sends every approved email at once", !res.err && res.sent === 6 && sent() === 6);

  // Guards
  seed(); flags("on");
  r = await ready({});
  const no = await camp({ action: "sendNow", campaignId: r.k });
  ok("\"Send approved now\" is refused when the setting isn't ticked", no.err?.details?.reason === "not_send_all" && sent() === 0);
  flags("off");
  const off = await camp({ action: "save", campaign: { name: "X", steps: [{ channel: "email", name: "E" }], sendAllAtOnce: true } });
  ok("switch Off: the setting can't be saved, and \"Send approved now\" is refused", off.err?.details?.reason === "feature_off" && (await camp({ action: "sendNow", campaignId: r.k })).err?.details?.reason === "feature_off");
  seed(); flags("off");
  ({ drafts } = await ready({}));
  store.set(`outreachCampaigns/${docs("outreachCampaigns")[0].id}`, { ...docs("outreachCampaigns")[0], sendAllAtOnce: true });
  await runScheduler({ now: new Date(Date.now() + 60000) /* after the approval (due "now") */, gap: null });
  ok("switch Off: a campaign with the setting stored still sends one per address per run", sent() === 1);

  // Cc on every email (outreach.campaignCc)
  seed(); flags("on");
  calls.length = 0;
  r = await ready({ sendAllAtOnce: true, cc: ["Antonio.Carvalho@douropartners.pt"] });
  const draft = docs("outreachMessages").find((m) => m.campaignId === r.k);
  await camp({ action: "sendNow", campaignId: r.k });
  const posts = calls.filter((c) => c.url.endsWith("/emails") && c.method === "POST");
  ok("Cc on every email: the draft shows it, and each email goes to its person with António in Cc", JSON.stringify(draft.cc) === JSON.stringify(["antonio.carvalho@douropartners.pt"]) && posts.length === 6 && posts.every((c) => JSON.stringify(c.body.cc) === JSON.stringify(["antonio.carvalho@douropartners.pt"]) && c.body.to.length === 1));
  const outsider = await camp({ action: "save", campaign: { name: "Y", steps: [{ channel: "email", name: "E" }], cc: ["someone@gmail.com"] } });
  ok("Cc refuses an outside address (only Douro addresses)", outsider.err?.details?.reason === "bad_cc");

  if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
  console.log("\nall send-all-now tests passed");
})().catch((e) => { console.log("ERROR", e.stack); process.exit(1); });
