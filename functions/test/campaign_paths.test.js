// Campaign paths (27 Oct 2026, switch "outreach.paths"): a different sequence
// per filter. Validation, the path choice (first match wins, "Everyone else"
// last, leave out), companies keep their path and count steps within it, the
// end of a path ends the sequence, steps that ran stay locked per path, the
// switch, task rules inside a path, and "Check who goes where". Synthetic data only.
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
const base = { name: "T", exclusions: { allowedStages: ["universe"] } };

function seed() {
  store.clear(); calls.length = 0;
  store.set("outreachSettings/global", { testMode: false, dailyTarget: 100 });
  for (const [local, owner] of [["an.rocha", "andre"], ["a.rocha", "andre"], ["andre.rocha", "andre"], ["rocha.andre", "andre"]]) store.set(`outreachSenders/${local}@mail.douropartners-team.pt`, { email: `${local}@mail.douropartners-team.pt`, displayName: "André Rocha", owner, status: "active", dailyCap: 25, signature: "A" });
  store.set("teamDirectory/andre", { key: "andre", name: "André Rocha", partner: true, active: true });
  for (const t of ["hi1", "hi2", "mid1", "mid2", "mid3"]) store.set(`outreachTemplates/${t}`, { name: t, status: "active", variants: [{ key: "A", subject: `${t} {{company.shortName}}`, body: `${t}. Corpo.` }] });
  const co = (id, data) => store.set(`searchCompanies/${id}`, { name: `EMPRESA ${id.toUpperCase()}, LDA`, stage: "universe", companyEmail: `geral@${id}.pt`, owner: "andre", contacts: [], ownGraphAt: Timestamp.now(), ownGroupSize: 1, ownSubs: 0, ownParents: 0, ownOwnerOther: 0, ...data });
  co("high", { fitScore: 82, computedRevenue: 5e6 }); co("edge", { fitScore: 75 }); co("mid", { fitScore: 50 }); co("low", { fitScore: 10 }); co("none", {});
}
const PATHS = [
  { id: "hi", name: "High fit", filters: [{ field: "fitScore", op: "gte", value: 75 }] },
  { id: "md", name: "Middle", filters: [{ field: "fitScore", op: "range", value: [25, 75] }] },
  { id: "main", name: "Everyone else" },
];
const STEPS = [
  { id: "h1", pathId: "hi", channel: "email", name: "Email 1", templateId: "hi1", wait: { days: 0 } },
  { id: "h2", pathId: "hi", channel: "email", name: "Email 2", templateId: "hi2", wait: { days: 2, unit: "calendar" } },
  { id: "m1", pathId: "md", channel: "email", name: "Email 1", templateId: "mid1", wait: { days: 0 } },
  { id: "m2", pathId: "md", channel: "email", name: "Email 2", templateId: "mid2", wait: { days: 2, unit: "calendar" } },
  { id: "m3", pathId: "md", channel: "email", name: "Email 3", templateId: "mid3", wait: { days: 2, unit: "calendar" } },
];

(async () => {
  // ── Validation ──
  const n = U.normalizeCampaign({ ...base, paths: PATHS, steps: STEPS });
  ok("paths kept in order, \"Everyone else\" last with no condition; steps keep their path", n.paths.map((p) => p.id).join() === "hi,md,main" && n.paths[2].filters === null && n.steps.map((s) => s.pathId).join() === "hi,hi,md,md,md");
  ok("a campaign without paths is unchanged (no paths stored, every step on \"main\")", U.normalizeCampaign({ ...base, steps: [{ channel: "email", name: "E" }] }).paths === null && U.normalizeCampaign({ ...base, steps: [{ channel: "email" }] }).steps[0].pathId === "main");
  ok("refused: a path with no condition, an unknown field, a wrong operator, \"from\" not below \"to\"", errOf(() => U.normalizeCampaign({ ...base, paths: [{ id: "x", name: "X", filters: [] }], steps: [] })) === "bad_path" && errOf(() => U.normalizeCampaign({ ...base, paths: [{ id: "x", filters: [{ field: "nif", op: "eq", value: "1" }] }], steps: [] })) === "bad_path" && errOf(() => U.normalizeCampaign({ ...base, paths: [{ id: "x", filters: [{ field: "fitScore", op: "eq", value: 1 }] }], steps: [] })) === "bad_path" && errOf(() => U.normalizeCampaign({ ...base, paths: [{ id: "x", filters: [{ field: "fitScore", op: "range", value: [75, 25] }] }], steps: [] })) === "bad_path");
  ok("refused: a step on a path that doesn't exist; a \"go to\" into another path", errOf(() => U.normalizeCampaign({ ...base, paths: PATHS, steps: [{ pathId: "zz", channel: "email" }] })) === "bad_path" && errOf(() => U.normalizeCampaign({ ...base, paths: PATHS, steps: [{ id: "c1", pathId: "hi", channel: "call", branches: [{ outcome: "no_answer", action: "goto", stepId: "m1" }] }, { id: "m1", pathId: "md", channel: "email" }] })) === "bad_branch");
  ok("limits only as a guard: 20 steps per path is fine, 21 is refused", !errOf(() => U.normalizeCampaign({ ...base, paths: PATHS, steps: Array.from({ length: 20 }, (_, i) => ({ pathId: "hi", channel: "email", name: "E" + i })) })) && errOf(() => U.normalizeCampaign({ ...base, paths: PATHS, steps: Array.from({ length: 21 }, (_, i) => ({ pathId: "hi", channel: "email", name: "E" + i })) })) === "too_many_steps");

  // ── The choice ──
  const ch = (c) => U.choosePath(n, c).path.id;
  ok("first match wins: fit 82 → High fit; exactly 75 → High fit (the first); 50 → Middle; 10 and no score → Everyone else", ch({ fitScore: 82 }) === "hi" && ch({ fitScore: 75 }) === "hi" && ch({ fitScore: 50 }) === "md" && ch({ fitScore: 10 }) === "main" && ch({}) === "main");
  ok("…and says why: \"Fit score 82\" / \"no path above matched\"", U.choosePath(n, { fitScore: 82 }).why === "Fit score 82" && U.choosePath(n, {}).why === "no path above matched");
  const n2 = U.normalizeCampaign({ ...base, paths: [{ id: "big", name: "Big", filters: [{ field: "computedRevenue", op: "gte", value: 2e6 }, { field: "fitScore", op: "lt", value: 60 }] }, { id: "main" }], steps: [] });
  ok("conditions combine with \"and\" (revenue ≥ €2M and fit below 60)", U.choosePath(n2, { computedRevenue: 3e6, fitScore: 40 }).path.id === "big" && U.choosePath(n2, { computedRevenue: 3e6, fitScore: 70 }).path.id === "main" && /Revenue €3.0M/.test(U.choosePath(n2, { computedRevenue: 3e6, fitScore: 40 }).why));

  // ── Running ──
  seed(); flags("on");
  const { campaignId: k } = await camp({ action: "save", campaign: { name: "Paths", approvalDefault: "auto", pacing: { newPerDay: 50 }, paths: PATHS, steps: STEPS } });
  ok("a campaign with paths saves (switch on)", !!k && get(`outreachCampaigns/${k}`).paths.length === 3);
  await camp({ action: "enrol", campaignId: k, companyIds: ["high", "edge", "mid", "low", "none"] });
  let pv = await camp({ action: "pathsPreview", campaignId: k });
  const cnt = (id, f = "waiting") => pv.paths.find((p) => p.id === id)[f];
  ok("Check who goes where (before the start): High fit 2, Middle 1, Everyone else 2 (no steps)", cnt("hi") === 2 && cnt("md") === 1 && cnt("main") === 2 && pv.paths.find((p) => p.id === "main").steps === 0);
  pv = await camp({ action: "pathsPreview", campaignId: k, paths: [{ id: "md", name: "Middle", filters: [{ field: "fitScore", op: "range", value: [25, 90] }] }, { id: "main" }], steps: STEPS.filter((s) => s.pathId !== "hi") });
  ok("…with the paths being edited (unsaved): Middle 3, Everyone else 2", cnt("md") === 3 && cnt("main") === 2);
  await camp({ action: "setStatus", campaignId: k, status: "active" });
  await run("2026-09-29T10:30:00+01:00");
  const en = (id) => get(`outreachEnrolments/${k}_${id}`);
  ok("each company takes its path when it starts and keeps it, with why", en("high").pathId === "hi" && en("high").pathName === "High fit" && en("high").pathWhy === "Fit score 82" && en("mid").pathId === "md" && en("edge").pathId === "hi");
  ok("\"Everyone else\" with no steps leaves them out — never contacted", en("low").status === "completed" && /Left out by the campaign's paths \("Everyone else"\)/.test(en("low").stopReason) && en("none").status === "completed");
  const sent = () => calls.filter((c) => c.url.endsWith("/emails") && c.method === "POST").map((c) => `${String(c.body.text || "").trim().split(/[.\n]/)[0]} ${c.body.subject}`); // the template's first word (hi1, mid2…) + subject
  ok("first emails follow the paths: High fit gets hi1, Middle gets mid1", sent().some((s) => /^hi1 /.test(s)) && sent().some((s) => /^mid1 /.test(s)) && !sent().some((s) => /^mid1 Empresa High/i.test(s)));
  calls.length = 0;
  await run("2026-10-01T10:30:00+01:00");
  ok("Email 2 of each path: hi2 for High fit, mid2 for Middle; steps count within the path", sent().filter((s) => /^hi2 /.test(s)).length === 2 && sent().filter((s) => /^mid2 /.test(s)).length === 1 && en("high").currentStep === 2 && en("mid").currentStep === 2);
  calls.length = 0;
  await run("2026-10-06T10:30:00+01:00"); // Tue (3 Oct is a Saturday, 5 Oct a national holiday)
  ok("High fit has no third step (Middle's Email 3 is never sent to it); Middle gets mid3", !sent().some((s) => /^mid3 Empresa (High|Edge)/i.test(s)) && sent().filter((s) => /^mid3 /.test(s)).length === 1);
  await run("2026-10-20T10:30:00+01:00");
  ok("the end of its path ends the sequence", en("high").status === "completed" && /Sequence finished/.test(en("high").stopReason));

  // ── Editing after the start (D5r) ──
  const cur = get(`outreachCampaigns/${k}`);
  let r = await camp({ action: "save", campaignId: k, campaign: { paths: [cur.paths[1], cur.paths[0], cur.paths[2]], steps: cur.steps } });
  ok("reordering paths after the start is fine (steps that ran stay first in their path)", !r.err);
  const moved = cur.steps.map((s) => (s.id === "h1" ? { ...s, pathId: "md" } : s));
  r = await camp({ action: "save", campaignId: k, campaign: { paths: cur.paths, steps: moved } });
  ok("moving a step that ran to another path is refused", r.err?.details?.reason === "step_locked");
  r = await camp({ action: "save", campaignId: k, campaign: { paths: cur.paths, steps: [...cur.steps, { id: "x1", pathId: "main", channel: "email", name: "Email 1", templateId: "hi1" }] } });
  ok("a step can be added to \"Everyone else\" while it runs (affects companies that haven't started)", !r.err && get(`outreachCampaigns/${k}`).steps.some((s) => s.id === "x1" && s.pathId === "main"));

  // ── Switch off ──
  flags("off");
  r = await camp({ action: "save", campaign: { name: "Off", paths: PATHS, steps: STEPS } });
  ok("switch Off: saving paths is refused; \"Check who goes where\" too", r.err?.details?.reason === "feature_off" && (await camp({ action: "pathsPreview", campaignId: k })).err?.details?.reason === "feature_off");
  seed(); flags("on");
  const { campaignId: k3 } = await camp({ action: "save", campaign: { name: "P", approvalDefault: "auto", paths: PATHS, steps: [...STEPS, { id: "e1", pathId: "main", channel: "email", name: "Email 1", templateId: "mid1", wait: { days: 0 } }] } });
  await camp({ action: "enrol", campaignId: k3, companyIds: ["high"] });
  await camp({ action: "setStatus", campaignId: k3, status: "active" });
  flags("off");
  calls.length = 0;
  await run("2026-09-29T10:30:00+01:00");
  ok("switch Off when companies would start: a campaign with paths starts nobody — they wait (never left out by mistake)", get(`outreachEnrolments/${k3}_high`).status === "pending" && !sent().length);
  flags("on"); calls.length = 0;
  await run("2026-09-30T10:30:00+01:00");
  ok("…switch back On: they start on their path", get(`outreachEnrolments/${k3}_high`).pathId === "hi" && sent().some((s) => /^hi1 /.test(s)));

  // ── A task rule inside a path ──
  seed(); flags("on");
  const { campaignId: k4 } = await camp({ action: "save", campaign: { name: "Tasks", approvalDefault: "auto", paths: PATHS, steps: [
    { id: "c1", pathId: "hi", channel: "call", name: "Call", branches: [{ outcome: "no_answer", action: "goto", stepId: "c3" }] },
    { id: "c2", pathId: "hi", channel: "linkedin", name: "LinkedIn" },
    { id: "c3", pathId: "hi", channel: "whatsapp", name: "WhatsApp" },
    { id: "m1", pathId: "md", channel: "email", name: "Email 1", templateId: "mid1" },
  ] } });
  await camp({ action: "enrol", campaignId: k4, companyIds: ["high"] });
  await camp({ action: "setStatus", campaignId: k4, status: "active" });
  await run("2026-09-29T10:30:00+01:00");
  const task = docs("outreachTasks").find((t) => t.campaignId === k4 && t.stepId === "c1");
  r = await camp({ action: "completeTask", taskId: task?.id, outcome: "no_answer" });
  ok("\"No answer → go to the WhatsApp step\" jumps inside the path (to its 3rd step)", task && !r.err && get(`outreachEnrolments/${k4}_high`).currentStep === 2);

  console.log(fail ? `${fail} campaign-paths test(s) FAILED` : "all campaign-paths tests passed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
