// Feature switches — site from the request, Off / Test / On with testers,
// partner-only changes (audited), server actions refused when Off (with the
// exemptions), and the kill switches in the scheduler and recurring drafting.
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
const Feat = require("../features");
const { FEATURES } = require("../features/catalog");
const { runScheduler } = require("../outreach/scheduler.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const PROD = { rawRequest: { headers: { origin: "https://douropartners.pt" } } };
const STAGING = { rawRequest: { headers: { origin: "https://staging--douro-partners.netlify.app" } } };
const partner = (site) => ({ ...site, auth: { token: { email: "andre.rocha@douropartners.pt" } } });
const intern = (site, extra = []) => ({ ...site, auth: { token: { email: "maria@douropartners.pt", perms: ["out.view", "out.draft", "out.campaigns", "search.view", "search.edit", "net.view", ...extra], key: "maria" } } });
const setFlags = (flags) => { store.set("config/features", { flags }); Feat._reset(); };
const reason = async (p) => { try { await p; return "ok"; } catch (e) { return e.details?.reason || e.message; } };

(async () => {
  // ── Catalog and site ──
  ok("defaults: release On in staging / Off in production; kill switches On in both", FEATURES.filter((f) => f.kind === "release").every((f) => f.defaults.staging === "on" && f.defaults.production === "off") && FEATURES.filter((f) => f.kind === "kill").every((f) => f.defaults.staging === "on" && f.defaults.production === "on"));
  ok("site: douropartners.pt / www → production; staging and previews → staging; unknown → production", Feat.siteOfOrigin("https://douropartners.pt") === "production" && Feat.siteOfOrigin("https://www.douropartners.pt/portal/x") === "production" && Feat.siteOfOrigin("https://staging--douro-partners.netlify.app") === "staging" && Feat.siteOfOrigin("nonsense") === "production" && Feat.siteOf({ rawRequest: { headers: {} } }) === "production");

  // ── Off / Test / On ──
  setFlags({});
  ok("production, nothing stored: Outreach is Off — even for a partner", !(await Feat.isOnFor(partner(PROD), "outreach")));
  ok("staging, nothing stored: Outreach On", await Feat.isOnFor(intern(STAGING), "outreach"));
  setFlags({ outreach: { production: "test" } });
  ok("production Test: the Admin (tester) yes, intern no", (await Feat.isOnFor(partner(PROD), "outreach")) && !(await Feat.isOnFor(intern(PROD), "outreach")));
  ok("Admin / Partner split: testing features is Admin-only — an intern with the permission in an old token: no", !(await Feat.isOnFor(intern(PROD, ["features.test"]), "outreach")));
  const antonio = { auth: { token: { email: "antonio.carvalho@douropartners.pt" } }, rawRequest: { headers: { origin: "https://douropartners.pt" } } };
  ok("…and António (Partner) doesn't see features in Test unless named on the switch", !(await Feat.isOnFor(antonio, "outreach")));
  setFlags({ outreach: { production: "test", testers: ["maria@douropartners.pt"] } });
  ok("intern named as a tester on the switch: yes", await Feat.isOnFor(intern(PROD), "outreach"));
  setFlags({ outreach: { production: "on", staging: "off" } });
  ok("production On: everyone; staging Off: nobody (the two sites are separate)", (await Feat.isOnFor(intern(PROD), "outreach")) && !(await Feat.isOnFor(partner(STAGING), "outreach")));

  // ── featureAdmin (partners only, audited) ──
  setFlags({});
  const admin = async (who, data) => { try { return await fns.featureAdmin({ ...who, data }); } catch (e) { return { err: e }; } };
  ok("an intern can't change switches, even as a tester", (await admin(intern(PROD, ["features.test"]), { action: "set", key: "outreach", site: "production", state: "on" })).err?.details?.reason === "no_permission");
  const s1 = await admin(partner(PROD), { action: "set", key: "outreach", site: "production", state: "on" });
  const stored = store.get("config/features").flags.outreach;
  ok("partner sets production On: stored with who, and 'On since' for Ready to remove", s1.ok && stored.production === "on" && stored.updatedBy === "andre.rocha@douropartners.pt" && !!stored.onSince);
  const audit = [...store.entries()].filter(([p]) => p.startsWith("accessAudit/")).map(([, d]) => d);
  ok("the change is in Team → Activity (accessAudit)", audit.some((a) => a.action === "feature" && a.target === "outreach" && a.after.production === "on"));
  await admin(partner(PROD), { action: "set", key: "outreach", site: "production", state: "test" });
  ok("back to Test: 'On since' cleared", store.get("config/features").flags.outreach.onSince === null);
  ok("bad key / state / tester email refused", (await admin(partner(PROD), { action: "set", key: "nope", site: "production", state: "on" })).err?.details?.reason === "bad_key"
    && (await admin(partner(PROD), { action: "set", key: "outreach", site: "prod", state: "on" })).err?.details?.reason === "bad_state"
    && (await admin(partner(PROD), { action: "setTesters", key: "outreach", testers: ["nope"] })).err?.details?.reason === "bad_email");
  ok("testers and note saved", (await admin(partner(PROD), { action: "setTesters", key: "outreach", testers: ["Maria@DouroPartners.pt"] })).ok && store.get("config/features").flags.outreach.testers[0] === "maria@douropartners.pt" && (await admin(partner(PROD), { action: "setNote", key: "outreach", note: "Testing with Maria" })).ok);

  // ── Server actions ──
  setFlags({});
  ok("production: Outreach send refused while Off", (await reason(fns.outreachSend({ ...partner(PROD), data: {} }))) === "feature_off");
  ok("production: mobile search refused while Off", (await reason(fns.mobileSearch({ ...partner(PROD), data: { q: "metal" } }))) === "feature_off");
  ok("production: recurring emails refused while Off", (await reason(fns.outreachRecurring({ ...partner(PROD), data: { action: "optOuts", recurringId: "r1" } }))) === "feature_off");
  store.set("searchCompanies/c1", { name: "X, LDA" });
  ok("'Do not contact' is never switched (works with Outreach Off)", (await reason(fns.outreachCampaign({ ...partner(PROD), data: { action: "setDoNotContact", companyId: "c1", on: true } }))) === "ok");
  ok("Investor CRM email refused while its switch is Off…", (await reason(fns.outreachPeopleSend({ ...partner(PROD), data: { context: "crm" } }))) === "feature_off");
  ok("…but Admin notices to investors are never switched", (await reason(fns.outreachPeopleSend({ ...partner(PROD), data: { context: "portal" } }))) !== "feature_off");
  setFlags({ outreach: { production: "on" }, "outreach.people": { production: "off" } });
  ok("people campaigns need their own switch too", (await reason(fns.outreachCampaign({ ...partner(PROD), data: { action: "save", campaign: { name: "x", audienceType: "people", steps: [] } } }))) === "feature_off"
    && (await reason(fns.outreachCampaign({ ...partner(PROD), data: { action: "save", campaign: { name: "y", steps: [] } } }))) === "feature_off"); // company campaigns still Off by default
  setFlags({ outreach: { production: "on" }, "outreach.campaigns": { production: "on" } });
  ok("company campaigns On in production: saving works", (await reason(fns.outreachCampaign({ ...partner(PROD), data: { action: "save", campaign: { name: "z", steps: [] } } }))) === "ok");

  // ── Kill switches (jobs follow production) ──
  store.set("outreachSettings/global", { testMode: false, complianceBlockId: "cb" });
  store.set("outreachCompliance/cb", { legalEntityLine: "Douro Partners, Lda", footerText: "Remover: {{unsubscribeUrl}}" });
  store.set("outreachSenders/an.rocha@mail.douropartners-team.pt", { email: "an.rocha@mail.douropartners-team.pt", displayName: "André Rocha", owner: "andre", status: "active", dailyCap: 25 });
  store.set("outreachTemplates/t1", { name: "Intro", status: "active", variants: [{ key: "A", subject: "Olá", body: "Corpo" }] });
  store.set("searchCompanies/k1", { name: "REAL, LDA", stage: "universe", companyEmail: "geral@real.pt", owner: "andre" });
  const camp = async (data) => fns.outreachCampaign({ ...partner(STAGING), data });
  const { campaignId } = await camp({ action: "save", campaign: { name: "Real", approvalDefault: "auto", steps: [{ templateId: "t1" }] } });
  await camp({ action: "enrol", campaignId, companyIds: ["k1"] });
  await camp({ action: "setStatus", campaignId, status: "active" });
  const TUE = new Date("2026-09-29T10:30:00+01:00");
  setFlags({ "kill.outreach.scheduler": { production: "off" } });
  const r0 = await runScheduler({ now: TUE, gap: null, rand: () => 0 });
  ok("scheduler Off: nothing runs", r0.killed === "scheduler" && r0.sent === 0 && store.get(`outreachEnrolments/${campaignId}_k1`).status === "pending");
  setFlags({ "kill.outreach.sending": { production: "off" } });
  await runScheduler({ now: TUE, gap: null, rand: () => 0 });
  const r1 = await runScheduler({ now: new Date("2026-09-29T10:40:00+01:00"), gap: null, rand: () => 0 });
  ok("sending Off: nothing sent, the company says why", sends.length === 0 && r1.sent === 0 && /automatic sending is switched off/.test(store.get(`outreachEnrolments/${campaignId}_k1`).lastError || ""));
  setFlags({ "kill.outreach.sending": { production: "test" } });
  await runScheduler({ now: new Date("2026-09-29T10:50:00+01:00"), gap: null, rand: () => 0 });
  ok("sending Test: a real (non-test) campaign still doesn't send", sends.length === 0);
  setFlags({});
  const r3 = await runScheduler({ now: new Date("2026-09-29T11:00:00+01:00"), gap: null, rand: () => 0 });
  ok("back On: it sends", r3.sent === 1 && sends.length === 1);

  // Recurring drafting
  store.set("outreachLists/L1", { name: "Lista", count: 1 });
  store.set("outreachRecurring/r1", { name: "Update", status: "active", listId: "L1", templateId: "t1", senderId: "andre.rocha@douropartners.pt", schedule: { freq: "monthly", day: 1, time: "09:30" }, nextIssueAt: F.Timestamp.fromDate(new Date("2026-09-29T09:00:00Z")) });
  const { runRecurring } = require("../outreach/recurring.js");
  setFlags({ "kill.recurring.drafting": { production: "off" } });
  const rr0 = await runRecurring(new Date("2026-09-29T10:00:00Z"));
  ok("recurring drafting Off: no issue written, the date is kept for later", rr0.created === 0 && store.get("outreachRecurring/r1").nextIssueAt.toMillis() === Date.parse("2026-09-29T09:00:00Z"));
  setFlags({});
  const rr1 = await runRecurring(new Date("2026-09-29T10:00:00Z"));
  ok("back On: the issue is drafted", rr1.created === 1);

  console.log(fail ? `\n${fail} FAILED` : "\nall feature switch tests passed");
  process.exit(fail ? 1 : 0);
})();
