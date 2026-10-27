// Campaign paths, round 2 (27 Oct 2026, switch "outreach.paths"): results by path.
// The path stored on each email, draft, conversation and task (R1); the planned
// path of waiting companies, set when added and when the paths change (R11);
// who starts first — as added, path order, split by path (equal or own numbers;
// unused room goes on in order) (R10); the Monday report by path (R5).
// Synthetic data only.
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
const U = require("../outreach/campaign_util.js");
const Report = require("../outreach/report.js");
const { runScheduler } = require("../outreach/scheduler.js");
const { store, Timestamp } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const get = (p) => store.get(p);
const docs = (coll) => [...store.entries()].filter(([p]) => p.startsWith(coll + "/")).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));
const run = (iso) => runScheduler({ now: new Date(iso), gap: null, rand: () => 0 });
function flags(state) { store.set("config/features", { flags: { "outreach.paths": { staging: state, production: state } } }); Feat._reset(); }
const errOf = (fn) => { try { fn(); return null; } catch (e) { return e.reason || e.code || e.message; } };

function seed() {
  store.clear(); calls.length = 0;
  store.set("outreachSettings/global", { testMode: false, dailyTarget: 100 });
  for (const local of ["an.rocha", "a.rocha", "andre.rocha", "rocha.andre"]) store.set(`outreachSenders/${local}@mail.douropartners-team.pt`, { email: `${local}@mail.douropartners-team.pt`, displayName: "André Rocha", owner: "andre", status: "active", dailyCap: 25, signature: "A" });
  store.set("teamDirectory/andre", { key: "andre", name: "André Rocha", partner: true, active: true });
  for (const t of ["hi1", "mid1", "else1"]) store.set(`outreachTemplates/${t}`, { name: t, status: "active", variants: [{ key: "A", subject: `${t} {{company.shortName}}`, body: `${t}. Corpo.` }] });
  const co = (id, data) => store.set(`searchCompanies/${id}`, { name: `EMPRESA ${id.toUpperCase()}, LDA`, stage: "universe", companyEmail: `geral@${id}.pt`, owner: "andre", contacts: [], ownGraphAt: Timestamp.now(), ownGroupSize: 1, ownSubs: 0, ownParents: 0, ownOwnerOther: 0, ...data });
  co("mid", { fitScore: 50 }); co("mid2", { fitScore: 40 }); co("low", { fitScore: 10 }); co("high", { fitScore: 82 }); co("edge", { fitScore: 75 });
}
const PATHS = [
  { id: "hi", name: "High fit", filters: [{ field: "fitScore", op: "gte", value: 75 }] },
  { id: "md", name: "Middle", filters: [{ field: "fitScore", op: "range", value: [25, 75] }] },
  { id: "main", name: "Everyone else" },
];
const STEPS = [
  { id: "h1", pathId: "hi", channel: "email", name: "Email 1", templateId: "hi1", wait: { days: 0 } },
  { id: "m1", pathId: "md", channel: "email", name: "Email 1", templateId: "mid1", wait: { days: 0 } },
  { id: "e1", pathId: "main", channel: "email", name: "Email 1", templateId: "else1", wait: { days: 0 } },
];
const ORDER = ["mid", "low", "high", "mid2", "edge"]; // the order they're added
const startedOn = (k) => ORDER.filter((id) => get(`outreachEnrolments/${k}_${id}`)?.status !== "pending");
async function campaign(name, extra = {}) {
  const { campaignId: k } = await camp({ action: "save", campaign: { name, approvalDefault: "auto", paths: PATHS, steps: STEPS, ...extra } });
  for (const id of ORDER) await camp({ action: "enrol", campaignId: k, companyIds: [id] });
  return k;
}

(async () => {
  // ── Who starts first: the rules (R10) ──
  const base = { name: "T", exclusions: { allowedStages: ["universe"] }, paths: PATHS, steps: STEPS };
  ok("who starts first: no paths or \"as added\" → nothing stored; \"order\" kept; split equal by default", U.normalizeCampaign({ ...base, startOrder: { mode: "added" } }).startOrder === null && U.normalizeCampaign({ name: "T", exclusions: { allowedStages: ["universe"] }, steps: [{ channel: "email" }], startOrder: { mode: "order" } }).startOrder === null && U.normalizeCampaign({ ...base, startOrder: { mode: "order" } }).startOrder.mode === "order" && U.normalizeCampaign({ ...base, startOrder: { mode: "split" } }).startOrder.equal === true);
  const own = U.normalizeCampaign({ ...base, pacing: { newPerDay: 20 }, startOrder: { mode: "split", equal: false, perPath: { hi: 6, md: 3, main: 1 } } });
  ok("split with own numbers: their total becomes the new companies a day (6 + 3 + 1 = 10)", own.pacing.newPerDay === 10 && own.startOrder.perPath.hi === 6);
  ok("split with own numbers: all zero is refused", errOf(() => U.normalizeCampaign({ ...base, startOrder: { mode: "split", equal: false, perPath: {} } })) === "bad_split");
  ok("equal shares: 20 a day over 3 paths → 7 · 7 · 6; a leave-out path gets none", JSON.stringify(U.splitShares({ paths: PATHS, steps: STEPS, startOrder: { mode: "split", equal: true } }, 20)) === JSON.stringify({ hi: 7, md: 7, main: 6 }) && JSON.stringify(U.splitShares({ paths: PATHS, steps: STEPS.slice(0, 2), startOrder: { mode: "split", equal: true } }, 20)) === JSON.stringify({ hi: 10, md: 10 }));

  // ── Planned path (R11) ──
  seed(); flags("on");
  let k = await campaign("Planned");
  const pl = (id) => get(`outreachEnrolments/${k}_${id}`).plannedPathId;
  ok("each company added gets its planned path: fit 82 → High fit, 50 → Middle, 10 → Everyone else", pl("high") === "hi" && pl("mid") === "md" && pl("low") === "main" && get(`outreachEnrolments/${k}_high`).plannedPathName === "High fit");
  await camp({ action: "save", campaignId: k, campaign: { paths: [{ ...PATHS[0], filters: [{ field: "fitScore", op: "gte", value: 80 }] }, PATHS[1], PATHS[2]], steps: STEPS } });
  ok("saving new paths plans the waiting companies again: fit 75 moves from High fit to Everyone else (High fit now ≥ 80)", pl("edge") === "main" && pl("high") === "hi");

  // ── As added (default): unchanged ──
  seed(); flags("on");
  k = await campaign("Added", { pacing: { newPerDay: 2 } });
  await camp({ action: "setStatus", campaignId: k, status: "active" });
  await run("2026-09-29T10:30:00+01:00");
  ok("as added (default): the 2 added first start, whatever their path (Middle, Everyone else)", startedOn(k).join() === "mid,low");

  // ── Path order ──
  seed(); flags("on");
  k = await campaign("Order", { pacing: { newPerDay: 2 }, startOrder: { mode: "order" } });
  await camp({ action: "setStatus", campaignId: k, status: "active" });
  await run("2026-09-29T10:30:00+01:00");
  ok("path order: High fit first — the 2 High fit companies start though they were added later", startedOn(k).join() === "high,edge" && get(`outreachEnrolments/${k}_high`).pathId === "hi");
  await run("2026-09-30T10:30:00+01:00");
  ok("…next day: Middle (in the order they were added)", startedOn(k).join() === "mid,high,mid2,edge");
  ok("the day's starts are counted per path (Middle 2 today)", get(`outreachCampaigns/${k}`).startedToday.byPath.md === 2 && get(`outreachCampaigns/${k}`).startedToday.count === 2); // (the fake merges maps on update; Firestore replaces startedToday each day)

  // ── Split equally ──
  seed(); flags("on");
  k = await campaign("Split", { pacing: { newPerDay: 3 }, startOrder: { mode: "split", equal: true } });
  await camp({ action: "setStatus", campaignId: k, status: "active" });
  await run("2026-09-29T10:30:00+01:00");
  ok("split equally, 3 a day over 3 paths: one of each (Middle, Everyone else, High fit)", startedOn(k).join() === "mid,low,high");
  await run("2026-09-29T11:30:00+01:00");
  ok("…the same day nobody else starts (each path used its share)", startedOn(k).length === 3);

  // ── Split with own numbers; unused room goes on ──
  seed(); flags("on");
  k = await campaign("Own", { startOrder: { mode: "split", equal: false, perPath: { hi: 0, md: 1, main: 2 } } });
  await camp({ action: "setStatus", campaignId: k, status: "active" });
  await run("2026-09-29T10:30:00+01:00");
  ok("own numbers (Middle 1, Everyone else 2 — only 1 waits there): Middle 1, Everyone else 1, the unused 1 goes to the first path in order (High fit)", startedOn(k).join() === "mid,low,high" && get(`outreachCampaigns/${k}`).pacing.newPerDay === 3);

  // ── The path on emails and conversations (R1) ──
  const msgs = docs("outreachMessages").filter((m) => m.campaignId === k);
  const thr = docs("outreachThreads").filter((t) => t.campaignId === k);
  ok("every email and its conversation store the path (High fit / Middle / Everyone else)", msgs.length === 3 && msgs.every((m) => m.pathId && m.pathName) && thr.length === 3 && thr.find((t) => t.companyId === "high")?.pathName === "High fit" && thr.find((t) => t.companyId === "mid")?.pathId === "md");
  seed(); flags("on");
  const { campaignId: kd } = await camp({ action: "save", campaign: { name: "Drafts", paths: PATHS, steps: STEPS } });
  await camp({ action: "enrol", campaignId: kd, companyIds: ["high"] });
  await camp({ action: "setStatus", campaignId: kd, status: "active" });
  await run("2026-09-29T10:30:00+01:00");
  ok("a draft to approve stores the path too", docs("outreachMessages").some((m) => m.campaignId === kd && m.status === "draft" && m.pathName === "High fit"));
  const { campaignId: kn } = await camp({ action: "save", campaign: { name: "No paths", approvalDefault: "auto", steps: [{ id: "s1", channel: "email", name: "Email 1", templateId: "hi1" }] } });
  await camp({ action: "enrol", campaignId: kn, companyIds: ["mid"] });
  await camp({ action: "setStatus", campaignId: kn, status: "active" });
  await run("2026-09-30T10:30:00+01:00");
  ok("a campaign without paths: emails and conversations unchanged (no path, no planned path)", docs("outreachMessages").filter((m) => m.campaignId === kn).every((m) => !("pathId" in m)) && !("plannedPathId" in get(`outreachEnrolments/${kn}_mid`)));

  // ── Monday report by path (R5) ──
  const at = Timestamp.fromDate(new Date("2026-10-14T10:00:00Z"));
  const camps = new Map([["c1", { name: "Distribuidores" }], ["c2", { name: "Sem caminhos" }]]);
  const m = (path, extra = {}) => ({ direction: "out", status: "delivered", createdAt: at, campaignId: "c1", senderId: "a@x", ...(path ? { pathName: path } : {}), ...extra });
  const rr = Report.buildWeeklyReport({ from: Date.parse("2026-10-12T00:00:00+01:00"), to: Date.parse("2026-10-19T00:00:00+01:00"), campaigns: camps,
    messages: [m("High fit"), m("High fit"), m("Middle"), m(null, { campaignId: "c2" })],
    threads: [{ repliedAt: at, campaignId: "c1", pathName: "High fit", responseCategory: "interested" }] });
  const txt = Report.reportText(rr, { weekKey: "2026-10-12", toKey: "2026-10-18" });
  ok("Monday report: under a campaign with paths, the split — \"por caminho: High fit 2 · Middle 1 · 1 resposta (High fit 1)\"; a campaign without paths has no extra line", /· Distribuidores: 3\n {6}por caminho: High fit 2 · Middle 1 · 1 resposta \(High fit 1\)/.test(txt) && /· Sem caminhos: 1\n(?! {6}por caminho)/.test(txt));

  if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
  console.log("\nall campaign-paths round 2 tests passed");
})().catch((e) => { console.log("ERROR", e.stack); process.exit(1); });
