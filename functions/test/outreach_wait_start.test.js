// Waits from the window's opening (21 Oct 2026, switch
// "outreach.waitFromWindowStart"): a wait in sending days ends when the
// campaign's window opens on that day, not at the time of the previous email,
// but never sooner than the minimum gap (Settings → General, default 12 h).
// Calendar days keep the time of day. Synthetic data only.
const F = require("./fake_firebase.js");
const dns = require("dns").promises;
dns.resolveMx = async (d) => [{ exchange: "mx." + d, priority: 10 }];
global.fetch = async () => {
  const hdrs = new Map([["x-resend-daily-quota", "5"], ["x-resend-monthly-quota", "50"]]);
  return { ok: true, status: 200, headers: { get: (h) => hdrs.get(h.toLowerCase()) ?? null }, text: async () => JSON.stringify({ id: "rs_" + Math.random() }) };
};
const fns = require("../index.js");
const Feat = require("../features");
const S = require("../outreach/schedule_util.js");
const { runScheduler } = require("../outreach/scheduler.js");
const { store } = F;

let fail = 0;
const ok = (l, c) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"}  ${l}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const iso = (d) => d.toISOString().slice(0, 16);
const H = 3600000;
const O9 = { startAt: "09:00", minGapMs: 12 * H };
const flags = (production) => { store.set("config/features", { flags: { "outreach.waitFromWindowStart": { staging: production, production } } }); Feat._reset(); };

(async () => {
  // ── The rule ──
  const tue16 = new Date("2026-09-29T16:00:00+01:00");
  ok("off: 3 sending days after Tue 16:00 → Fri 16:00", iso(S.addWait(tue16, { days: 3, unit: "working" })) === "2026-10-02T15:00");
  ok("on: → Fri 2 Oct at 09:00 Lisbon", iso(S.addWait(tue16, { days: 3, unit: "working" }, null, true, O9)) === "2026-10-02T08:00");
  ok("the campaign's own window start (10:30)", iso(S.addWait(tue16, { days: 3, unit: "working" }, null, true, { startAt: "10:30", minGapMs: 0 })) === "2026-10-02T09:30");
  ok("holidays still skipped: Fri 2 Oct + 1 → Tue 6 Oct 09:00 (5 Oct)", iso(S.addWait(new Date("2026-10-02T15:00:00+01:00"), { days: 1, unit: "working" }, null, true, O9)) === "2026-10-06T08:00");
  ok("clock change: Fri 23 Oct 16:00 (summer) + 2 → Tue 27 Oct 09:00 winter time", iso(S.addWait(new Date("2026-10-23T16:00:00+01:00"), { days: 2, unit: "working" }, null, true, O9)) === "2026-10-27T09:00");
  const late = new Date("2026-09-29T17:50:00+01:00");
  ok("1-day wait after 17:50, gap 12 h → Wed 09:00 (15 h later)", iso(S.addWait(late, { days: 1, unit: "working" }, null, true, O9)) === "2026-09-30T08:00");
  ok("…gap 18 h → Wed 11:50", iso(S.addWait(late, { days: 1, unit: "working" }, null, true, { startAt: "09:00", minGapMs: 18 * H })) === "2026-09-30T10:50");
  ok("calendar days keep the time of day", iso(S.addWait(tue16, { days: 3, unit: "calendar" }, null, true, O9)) === "2026-10-02T15:00");
  ok("wait 0 = now", S.addWait(tue16, { days: 0 }, null, true, O9).getTime() === tue16.getTime());
  ok("window start: campaign's, else Settings', else 09:00", S.waitOptsOf({ sendWindow: { from: "10:00" } }, { sendWindow: { from: "08:00" } }).startAt === "10:00" && S.waitOptsOf({}, { sendWindow: { from: "08:00" } }).startAt === "08:00" && S.waitOptsOf(null, {}).startAt === "09:00");
  ok("gap: Settings minGapHours (0–72), else 12; none for waits not after an email", S.waitOptsOf({}, { minGapHours: 6 }).minGapMs === 6 * H && S.waitOptsOf({}, {}).minGapMs === 12 * H && S.waitOptsOf({}, { minGapHours: 99 }).minGapMs === 12 * H && S.waitOptsOf({}, { minGapHours: 0 }).minGapMs === 0 && S.waitOptsOf({}, {}, { gap: false }).minGapMs === 0);

  // ── The scheduler ──
  async function scenario(state, isTest = false) {
    store.clear(); flags(state);
    store.set("outreachSettings/global", { testMode: false, dailyTarget: 100 });
    store.set("outreachSenders/an.rocha@mail.douropartners-team.pt", { email: "an.rocha@mail.douropartners-team.pt", displayName: "André Rocha", owner: "andre", status: "active", dailyCap: 25, signature: "A" });
    store.set("teamDirectory/andre", { key: "andre", name: "André Rocha", partner: true, active: true });
    store.set("outreachTemplates/t1", { name: "Intro", status: "active", variants: [{ key: "A", subject: "Olá", body: "Corpo" }] });
    store.set("searchCompanies/c1", { name: "EMPRESA C1, LDA", stage: "universe", companyEmail: "geral@empresa-c1.pt", owner: "andre", contacts: [] });
    const { campaignId } = await camp({ action: "save", campaign: { name: "Espera", approvalDefault: "auto", isTest, steps: [{ templateId: "t1" }, { templateId: "t1", wait: { days: 3, unit: "working" } }] } });
    if (isTest) store.set(`outreachCampaigns/${campaignId}`, { ...store.get(`outreachCampaigns/${campaignId}`), isTest: true });
    await camp({ action: "enrol", campaignId, companyIds: ["c1"] });
    await camp({ action: "setStatus", campaignId, status: "active" });
    const r = await runScheduler({ now: tue16, gap: null, rand: () => 0 });
    const e = store.get(`outreachEnrolments/${campaignId}_c1`);
    return { r, at: e?.nextActionAt ? iso(e.nextActionAt.toDate()) : null, step: e?.currentStep };
  }
  let s = await scenario("on");
  ok("on: first email sent Tue 16:00, the 2nd is due Fri 09:00", s.r.sent === 1 && s.step === 1 && s.at === "2026-10-02T08:00");
  s = await scenario("off");
  ok("off: due Fri 16:00, as before", s.r.sent === 1 && s.at === "2026-10-02T15:00");
  s = await scenario("test");
  ok("test: a real campaign keeps the old timing", s.at === "2026-10-02T15:00");
  s = await scenario("test", true);
  ok("test: a test campaign gets the new timing", s.at === "2026-10-02T08:00");

  console.log(fail ? `\n${fail} FAILED` : "\nALL PASSED");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
