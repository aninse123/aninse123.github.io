// Drafts spread over the campaign's addresses (12 Oct 2026): the first real
// campaign gave all 10 drafts of the morning run the same address (drafts cost
// no quota, so "least used today" never moved), so the approved emails left one
// per run and every follow-up piled on one address. Synthetic data only.
const F = require("./fake_firebase.js");
const dns = require("dns").promises;
dns.resolveMx = async (d) => [{ exchange: "mx." + d, priority: 10 }];
const sends = [];
global.fetch = async (url, opts = {}) => {
  if (String(url).endsWith("/emails") && opts.method === "POST") sends.push(JSON.parse(opts.body));
  const hdrs = new Map([["x-resend-daily-quota", "5"], ["x-resend-monthly-quota", "50"]]);
  return { ok: true, status: 200, headers: { get: (h) => hdrs.get(h.toLowerCase()) ?? null }, text: async () => JSON.stringify({ id: "rs_" + sends.length }) };
};
const fns = require("../index.js");
const { runScheduler } = require("../outreach/scheduler.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const docs = (coll) => [...store.entries()].filter(([p]) => p.startsWith(coll + "/")).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));
const ADDR = ["a.rocha", "an.rocha", "andre.rocha", "rocha.andre"].map((x) => `${x}@mail.douropartners-team.pt`);

(async () => {
  store.clear(); sends.length = 0;
  store.set("outreachSettings/global", { testMode: false });
  ADDR.forEach((id) => store.set(`outreachSenders/${id}`, { email: id, displayName: "André Rocha", owner: "andre", status: "active", dailyCap: 25 }));
  store.set("teamDirectory/andre", { key: "andre", name: "André Rocha", partner: true, active: true });
  store.set("outreachTemplates/t1", { name: "E1", status: "active", variants: [{ key: "A", subject: "Olá", body: "Texto para {{company.shortName}}." }] });
  const ids = Array.from({ length: 8 }, (_, i) => `co${i + 1}`);
  ids.forEach((id, i) => store.set(`searchCompanies/${id}`, { name: `EMPRESA ${i + 1}, LDA`, stage: "universe", owner: "andre", companyEmail: `geral@empresa${i + 1}.pt`, contacts: [] }));
  const cid = (await camp({ action: "save", campaign: { name: "Formal", approvalDefault: "approval", pacing: { newPerDay: 8 }, senderPolicy: { mode: "fixed", senderIds: ADDR }, steps: [{ templateId: "t1" }] } })).campaignId;
  await camp({ action: "enrol", campaignId: cid, companyIds: ids });
  await camp({ action: "setStatus", campaignId: cid, status: "active" });

  await runScheduler({ now: new Date("2026-10-12T10:05:00+01:00"), gap: null, rand: () => 0 });
  const drafts = docs("outreachMessages").filter((m) => m.status === "draft");
  const per = {}; drafts.forEach((m) => { per[m.senderId] = (per[m.senderId] || 0) + 1; });
  ok("8 drafts in the morning run, spread 2 per address over the 4 addresses", drafts.length === 8 && ADDR.every((a) => per[a] === 2));

  await camp({ action: "approve", messageIds: drafts.map((m) => m.id) });
  // Approving stamps nextActionAt with the real clock; pin it to the test's day so the frozen runs below find them due.
  for (const [p, e] of store.entries()) if (p.startsWith("outreachEnrolments/") && e.nextActionAt?.constructor?.fromDate) e.nextActionAt = e.nextActionAt.constructor.fromDate(new Date("2026-10-12T10:20:00+01:00"));
  await runScheduler({ now: new Date("2026-10-12T10:25:00+01:00"), gap: null, rand: () => 0 });
  ok("approved: the next run sends 4 at once (one per address), not 1", sends.length === 4 && new Set(sends.map((s) => s.from)).size === 4);
  await runScheduler({ now: new Date("2026-10-12T10:35:00+01:00"), gap: null, rand: () => 0 });
  ok("…and the other 4 in the run after", sends.length === 8);

  if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
  console.log("\nALL PASSED");
})();
