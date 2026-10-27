// A campaign email Resend refuses (27 Oct 2026): its conversation stays, marked
// failed, and isn't a contact — one inbox doesn't hold other companies on it,
// "contacted before" and people campaigns' "emailed in the last N days" ignore it.
// The retry goes into the same conversation (one company, one email, one
// conversation). Synthetic data only.
const F = require("./fake_firebase.js");
const dns = require("dns").promises;
dns.resolveMx = async (d) => [{ exchange: "mx." + d, priority: 10 }];
let refuse = 0;
const calls = [];
global.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null });
  const hdrs = new Map([["x-resend-daily-quota", "5"], ["x-resend-monthly-quota", "50"]]);
  if (String(url).endsWith("/emails") && refuse > 0) { refuse--; return { ok: false, status: 401, headers: { get: (h) => hdrs.get(h.toLowerCase()) ?? null }, text: async () => JSON.stringify({ name: "validation_error", message: "API key is invalid" }) }; }
  return { ok: true, status: 200, headers: { get: (h) => hdrs.get(h.toLowerCase()) ?? null }, text: async () => JSON.stringify({ id: "rs_" + calls.length }) };
};
const fns = require("../index.js");
const Inbox = require("../outreach/inbox.js");
const { runScheduler } = require("../outreach/scheduler.js");
const { store, Timestamp } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const get = (p) => store.get(p);
const docs = (coll) => [...store.entries()].filter(([p]) => p.startsWith(coll + "/")).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));
const run = (iso) => runScheduler({ now: new Date(iso), gap: null, rand: () => 0 });

(async () => {
  store.clear();
  store.set("outreachSettings/global", { testMode: false, dailyTarget: 100 });
  store.set("outreachSenders/an.rocha@mail.douropartners-team.pt", { email: "an.rocha@mail.douropartners-team.pt", displayName: "André Rocha", owner: "andre", status: "active", dailyCap: 25, signature: "A" });
  store.set("teamDirectory/andre", { key: "andre", name: "André Rocha", partner: true, active: true });
  store.set("outreachTemplates/t1", { name: "t1", status: "active", variants: [{ key: "A", subject: "Olá {{company.shortName}}", body: "Corpo." }] });
  for (const id of ["alfa", "beta"]) store.set(`searchCompanies/${id}`, { name: `EMPRESA ${id.toUpperCase()}, LDA`, stage: "universe", companyEmail: "geral@partilhado.pt", owner: "andre", contacts: [], ownGraphAt: Timestamp.now(), ownGroupSize: 1, ownSubs: 0, ownParents: 0, ownOwnerOther: 0 });

  const { campaignId: k } = await camp({ action: "save", campaign: { name: "C", approvalDefault: "auto", steps: [{ id: "s1", channel: "email", name: "Email 1", templateId: "t1", wait: { days: 0 } }] } });
  await camp({ action: "enrol", campaignId: k, companyIds: ["alfa"] });
  await camp({ action: "setStatus", campaignId: k, status: "active" });
  refuse = 1;
  await run("2026-09-29T10:30:00+01:00");
  const threads = () => docs("outreachThreads").filter((t) => t.enrolmentId === `${k}_alfa`);
  ok("Resend refuses the email: the conversation stays, marked failed", threads().length === 1 && threads()[0].status === "failed" && /API key is invalid/.test(get(`outreachEnrolments/${k}_alfa`).lastError || ""));

  const recent = await Inbox.recentByAddress(["geral@partilhado.pt"], { sinceMs: 0, isTest: false });
  ok("one inbox: a failed conversation isn't a contact (nothing found for the shared address)", !(recent.get("geral@partilhado.pt") || []).length);
  const pv = await camp({ action: "preview", campaignId: k, companyIds: ["beta"] });
  ok("adding a company on the same address: not held, not \"contacted before\"", !pv.err && !JSON.stringify(pv).includes("EMPRESA ALFA"));

  const first = threads()[0].id;
  await run("2026-09-30T10:30:00+01:00");
  const after = threads();
  ok("the retry goes into the same conversation: one conversation, now open, the email sent", after.length === 1 && after[0].id === first && after[0].status !== "failed" && get(`outreachEnrolments/${k}_alfa`).history?.some((h) => h.result === "sent" && h.threadId === first));
  const recent2 = await Inbox.recentByAddress(["geral@partilhado.pt"], { sinceMs: 0, isTest: false });
  ok("…and now it counts as a contact", (recent2.get("geral@partilhado.pt") || []).some((h) => h.threadId === first));

  if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
  console.log("\nall failed-send tests passed");
})().catch((e) => { console.log("ERROR", e.stack); process.exit(1); });
