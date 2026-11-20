// A company's path changed by hand (20 Nov 2026, switch outreach.pathOverride): reason 3 to 300 characters, only before email 1, kept
// by the re-plan on save and taken at the start; "Back to the filters"; a company Activity says who and why. Setup from the paths
// round-2 test. Synthetic data only.
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
function flags(state, own = "on") { store.set("config/features", { flags: { "outreach.paths": { staging: state, production: state }, "outreach.pathOverride": { staging: own, production: own } } }); Feat._reset(); }
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
  seed(); flags("on");
  let k = await campaign("Hand");
  const en = (id) => get(`outreachEnrolments/${k}_${id}`);
  const set = (id, pathId, reason) => camp({ action: "setPath", enrolmentId: `${k}_${id}`, pathId, reason });
  ok("the filters plan fit 10 on Everyone else", en("low").plannedPathId === "main");
  ok("no reason: refused", (await set("low", "hi", "  ")).err?.details?.reason === "reason_required");
  ok("2 characters: refused", (await set("low", "hi", "ab")).err?.details?.reason === "reason_required");
  ok("301 characters: refused", (await set("low", "hi", "x".repeat(301))).err?.details?.reason === "reason_required");
  ok("a path that is not in the campaign: refused", (await set("low", "zz", "porque sim")).err?.details?.reason === "bad_path");
  const r = await set("low", "hi", "  o dono é cliente   de um investidor ");
  ok("changed to High fit, with the reason", !r.err && r.plannedPathId === "hi" && en("low").plannedPathName === "High fit" && en("low").pathOverride.reason === "o dono é cliente de um investidor" && en("low").pathOverride.by === "andre.rocha@douropartners.pt" && en("low").pathOverride.from === "Everyone else");
  const act = docs("searchActivities").filter((a) => a.companyId === "low" && a.type === "outreach_campaign");
  ok("a company Activity: Path changed to X by Y: reason", act.length === 1 && act[0].content === "Path changed to High fit by andre.rocha@douropartners.pt: o dono é cliente de um investidor (Hand)");
  await camp({ action: "save", campaignId: k, campaign: { paths: [{ ...PATHS[0], filters: [{ field: "fitScore", op: "gte", value: 80 }] }, PATHS[1], PATHS[2]], steps: STEPS } });
  ok("saving the campaign plans again but keeps the hand-set path", en("low").plannedPathId === "hi" && en("edge").plannedPathId === "main");
  const pv = await camp({ action: "pathsPreview", campaignId: k });
  ok("Check who goes where counts it on its hand-set path", pv.paths.find((p) => p.id === "hi").waiting === 2);
  await camp({ action: "setStatus", campaignId: k, status: "active" });
  await run("2026-09-29T10:30:00+01:00");
  ok("at the start it takes the hand-set path (fit 10 on High fit) and says why", en("low").status !== "pending" && en("low").pathId === "hi" && /^set by hand: o dono/.test(en("low").pathWhy));
  ok("…and its first email is the High fit one", calls.some((c) => c.body && /hi1 EMPRESA LOW/i.test(c.body.subject || "")));
  ok("after it started: refused (only before email 1)", (await set("low", "md", "mudar outra vez")).err?.details?.reason === "already_started");

  seed(); flags("on");
  k = await campaign("Back");
  await set("mid", "hi", "teste de volta");
  const back = await set("mid", "auto", "afinal pelos filtros");
  ok("Back to the filters: the filters' path again, the hand mark is gone", !back.err && en("mid").plannedPathId === "md" && en("mid").pathOverride === null);
  ok("…and the Activity says so", docs("searchActivities").some((a) => a.content === "Path changed to Middle (by the filters) by andre.rocha@douropartners.pt: afinal pelos filtros (Back)"));
  await set("low", "md", "path que vai ser apagado");
  await camp({ action: "save", campaignId: k, campaign: { paths: [PATHS[0], PATHS[2]], steps: STEPS.filter((s) => s.pathId !== "md") } });
  ok("the hand-set path is deleted from the campaign: the filters decide again and the mark is dropped", en("low").plannedPathId === "main" && en("low").pathOverride === null);

  seed(); flags("on");
  k = await campaign("Track");
  store.set(`outreachEnrolments/${k}_low__t1`, { campaignId: k, companyId: "low", status: "pending", trackOf: `${k}_low` });
  ok("an extra address of the company: refused (the company's own row)", (await camp({ action: "setPath", enrolmentId: `${k}_low__t1`, pathId: "hi", reason: "abc" })).err?.details?.reason === "not_company");

  seed(); flags("on", "off");
  k = await campaign("Off");
  ok("switch off: refused", (await set("low", "hi", "porque sim")).err?.details?.reason === "feature_off");

  console.log(fail ? `\n${fail} FAILED` : "\nAll passed");
  process.exit(fail ? 1 : 0);
})();
