// T6 — Target tier (A / B / C: own choice, else the most specific rule) and
// Contactable (a soft filter: campaigns leave "not contactable" companies out
// unless they include them; Do not contact stays a hard block).
const F = require("./fake_firebase.js");
const U = require("../outreach/campaign_util.js");
const { runDynamicAudience } = require("../outreach/campaigns.js");
const fns = require("../index.js");
const { store, Timestamp } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };

(async () => {
  const rules = [
    { field: "sector", value: "Logistics", tier: "B" },
    { field: "caeCode", value: "49", tier: "C" },
    { field: "caeCode", value: "4941", tier: "A" },
    { field: "subSector", value: "Road freight", tier: "B" },
  ];
  ok("longest CAE prefix wins", U.tierOf({ caeCode: "49410", sector: "Logistics" }, rules) === "A");
  ok("a shorter CAE prefix still beats sector", U.tierOf({ caeCode: "49320", sector: "Logistics" }, rules) === "C");
  ok("sub-sector beats sector (case-insensitive)", U.tierOf({ subSector: "road FREIGHT", sector: "Logistics" }, [rules[0], rules[3]]) === "B");
  ok("the company's own choice always wins", U.tierOf({ caeCode: "49410", targetTierManual: "C" }, rules) === "C");
  ok("no match → no tier", U.tierOf({ caeCode: "62010" }, rules) === null);
  ok("bool filter: unset counts as contactable", U.matchesFilterSpec({}, [{ field: "contactable", op: "bool", value: true }]) && !U.matchesFilterSpec({ contactable: false }, [{ field: "contactable", op: "bool", value: true }]) && U.matchesFilterSpec({ contactable: false }, [{ field: "contactable", op: "bool", value: false }]));

  const ctx = { exclusions: { ...U.DEFAULT_CAMPAIGN.exclusions, requireEmail: false }, suppressed: new Set(), now: Date.now(), firstChannel: "call" };
  ok("not contactable: left out by default", U.evaluateCompany({ name: "X", stage: "universe", contactable: false }, ctx).reason === "not_contactable");
  ok("…included when the campaign ticks it", U.evaluateCompany({ name: "X", stage: "universe", contactable: false }, { ...ctx, exclusions: { ...ctx.exclusions, includeNotContactable: true } }).ok);
  ok("Do not contact is never included", U.evaluateCompany({ name: "X", stage: "universe", contactable: false, doNotContact: { on: true } }, { ...ctx, exclusions: { ...ctx.exclusions, includeNotContactable: true } }).reason === "do_not_contact");
  ok("a campaign saves the choice (default off)", U.normalizeCampaign({ name: "x" }).exclusions.includeNotContactable === false && U.normalizeCampaign({ name: "x", exclusions: { includeNotContactable: true } }).exclusions.includeNotContactable === true);

  // Enrolment through the callable
  store.set("outreachSettings/global", { testMode: true });
  store.set("searchCompanies/c1", { name: "A, LDA", stage: "universe", companyEmail: "a@a.pt" });
  store.set("searchCompanies/c2", { name: "B, LDA", stage: "universe", companyEmail: "b@b.pt", contactable: false });
  const { campaignId } = await camp({ action: "save", campaign: { name: "Calls", steps: [{ channel: "call" }] } });
  const r = await camp({ action: "enrol", campaignId, companyIds: ["c1", "c2"] });
  ok("enrol: the not-contactable company is skipped with its reason", r.enrolled === 1 && r.skipped?.not_contactable === 1);

  // Dynamic audience by tier (computed from the rules)
  store.set("searchConfig/targetTiers", { rules });
  const past = Timestamp.fromDate(new Date(Date.now() - 3600e3));
  store.set("searchCompanies/d1", { name: "D1", stage: "universe", caeCode: "49410", updatedAt: Timestamp.now() });
  store.set("searchCompanies/d2", { name: "D2", stage: "universe", caeCode: "62010", updatedAt: Timestamp.now() });
  store.set("searchCompanies/d3", { name: "D3", stage: "universe", caeCode: "62010", targetTierManual: "A", updatedAt: Timestamp.now() });
  const dyn = { id: "dyn1", name: "Tier A", status: "active", steps: [{ id: "s1", channel: "call" }], exclusions: { ...U.DEFAULT_CAMPAIGN.exclusions, requireEmail: false }, audience: { mode: "dynamic", lastEvaluatedAt: past, sources: [{ type: "filters", filterSpec: [{ field: "targetTier", op: "in", value: ["A"] }] }] } };
  store.set("searchCompanies/d4", { name: "D4", stage: "universe", caeCode: "62010", priority: "a", updatedAt: Timestamp.now() }); // F1: tier set on the company = the old Priority
  const Feat = require("../features");
  store.set("config/features", { flags: { "search.tier": { production: "off", staging: "on" } } }); Feat._reset();
  store.set("outreachCampaigns/dyn1", dyn);
  const d0 = await runDynamicAudience(dyn, new Date());
  ok("switch off: the rules don't count — only tiers set on the company (priority, or the older field)", d0.enrolled === 2 && store.get("outreachEnrolments/dyn1_d3") && store.get("outreachEnrolments/dyn1_d4") && !store.get("outreachEnrolments/dyn1_d1"));
  store.set("config/features", { flags: { "search.tier": { production: "on", staging: "on" } } }); Feat._reset();
  const dynB = { ...dyn, id: "dyn2" };
  store.set("outreachCampaigns/dyn2", dynB);
  ["d3", "d4"].forEach((k) => store.set(`searchCompanies/${k}`, { ...store.get(`searchCompanies/${k}`), activeCampaignId: "dyn1" }));
  const d = await runDynamicAudience(dynB, new Date());
  ok("dynamic audience by tier (switch on): rule match (CAE 4941) added, the rest not", d.enrolled === 1 && store.get("outreachEnrolments/dyn2_d1") && !store.get("outreachEnrolments/dyn2_d2"));

  console.log(fail ? `\n${fail} FAILED` : "\nall T6 tests passed");
  process.exit(fail ? 1 : 0);
})();
