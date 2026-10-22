// Owner-aware outreach, round 2 (22 Oct 2026, André's answers in the tests
// artifact): D3 related people graded with the best-person ladder (owners and
// managers count; auditors / "any other role" don't) and the suggested lead; D5
// the companies to mention ticked by hand; D6 the mention on the draft; D1 new
// possible same-email links in the Monday report; F3 the history wording; F4 test
// campaigns after go-live (switch outreach.testCampaigns). Synthetic data only.
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
const R = require("../outreach/related.js");
const Report = require("../outreach/report.js");
const { runScheduler } = require("../outreach/scheduler.js");
const { store, Timestamp } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const get = (p) => store.get(p);
const docs = (coll) => [...store.entries()].filter(([p]) => p.startsWith(coll + "/")).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));
const DAY = 86400000;
const TUE = "2026-09-29T10:30:00+01:00";
function flags(map) { store.set("config/features", { flags: Object.fromEntries(Object.entries(map).map(([k, s]) => [k, { staging: s, production: s }])) }); Feat._reset(); }

function seed() {
  store.clear(); calls.length = 0;
  store.set("outreachSettings/global", { testMode: false, dailyTarget: 100, testRecipients: ["amobnc92@gmail.com"], campaignTestRecipient: "amobnc92@gmail.com" });
  for (const [local, owner] of [["an.rocha", "andre"], ["a.rocha", "andre"]]) store.set(`outreachSenders/${local}@mail.douropartners-team.pt`, { email: `${local}@mail.douropartners-team.pt`, displayName: "André Rocha", owner, status: "active", dailyCap: 25, signature: "Assinatura" });
  store.set("teamDirectory/andre", { key: "andre", name: "André Rocha", partner: true, active: true });
  store.set("outreachTemplates/t1", { name: "Intro", status: "active", variants: [{ key: "A", subject: "Olá {{company.shortName}}", body: "Escrevo{{?owner.otherCompanies| enquanto responsável também {{owner.otherCompanies}}}}. Corpo." }] });
  const co = (id, data) => store.set(`searchCompanies/${id}`, { name: `EMPRESA ${id.toUpperCase()}, LDA`, stage: "universe", companyEmail: `geral@${id}.pt`, owner: "andre", contacts: [], ownGraphAt: Timestamp.now(), ...data });
  co("x1", { ownOwnerOther: 1 });
  co("x2", { ownOwnerOther: 1, activeCampaignId: "k2", activeCampaignName: "Serviços Q4", lastOutreachAt: Timestamp.fromMillis(Date.now() - 4 * DAY), computedRevenue: 1e6 });
  co("x3", { ownOwnerOther: 1, lastReplyAt: Timestamp.fromMillis(Date.now() - 2 * DAY), computedRevenue: 5e6 });
  co("x4", { ownOwnerOther: 1, computedRevenue: 9e6 });
  const link = (id, d) => store.set(`searchPersonLinks/${id}`, { personEntityType: "person", personName: "Alfredo Cunha", personId: "u_ALF", ...d });
  link("alf__x1", { companyId: "x1", mgmtCurrent: true, mgmtRoles: ["Director Financeiro"] });                  // manager (60)
  link("alf__x2", { companyId: "x2", shCurrent: true, shDirectPct: 70, mgmtCurrent: true, mgmtRoles: ["Gerente"] }); // majority owner, manages (180)
  link("alf__x3", { companyId: "x3", mgmtCurrent: true, mgmtRoles: ["Gerente"] });                              // hired gerente (100)
  link("alf__x4", { companyId: "x4", mgmtCurrent: true, mgmtRoles: ["Accountant"] });                           // any other role (40) → not related
}

(async () => {
  // ── D3: the ladder ──
  const P = { personEntityType: "person" };
  const rk = (l) => R.deciderRank({ ...P, ...l });
  ok("ladder: ultimate owner 200+, majority owner who manages 180+, majority 160+, owner-manager 140+, shareholder 120+", rk({ mgmtCurrent: true, mgmtRoles: ["Ultimate owner"] }) >= 200 && rk({ shCurrent: true, shDirectPct: 60, mgmtCurrent: true, mgmtRoles: ["Gerente"] }) >= 180 && rk({ shCurrent: true, shDirectPct: 60 }) >= 160 && rk({ shCurrent: true, shDirectPct: 10, mgmtCurrent: true, mgmtRoles: ["Sócio-Gerente"] }) >= 140 && rk({ shCurrent: true, shDirectPct: 1 }) >= 120);
  ok("…a current shareholder with no % given still counts as a shareholder (any %)", rk({ shCurrent: true }) === 120);
  ok("…gerente / CEO 100, other managers (incl. board members) 60", rk({ mgmtCurrent: true, mgmtRoles: ["Administrador"] }) === 100 && rk({ mgmtCurrent: true, mgmtRoles: ["Voter of the Board of Directors/Vogal do Conselho de Administração"] }) === 60);
  ok("…auditor, fiscal, assembly, secretary roles → 0; any other role → 40 (doesn't count); a former manager → 0", rk({ mgmtCurrent: true, mgmtRoles: ["Revisor Oficial de Contas"] }) === 0 && rk({ mgmtCurrent: true, mgmtRoles: ["Substitute Sole Fiscal"] }) === 0 && rk({ mgmtCurrent: true, mgmtRoles: ["Secretary of the Board"] }) === 0 && rk({ mgmtCurrent: true, mgmtRoles: ["Accountant"] }) === 40 && rk({ mgmtCurrent: false, mgmtRoles: ["Gerente"] }) === 0);
  ok("…isDecider = 60 and above; an entity is never a person", R.isDecider({ ...P, mgmtCurrent: true, mgmtRoles: ["Director"] }) && !R.isDecider({ ...P, mgmtCurrent: true, mgmtRoles: ["Accountant"] }) && R.deciderRank({ personEntityType: "entity", shCurrent: true, shDirectPct: 100 }) === 0);

  seed(); flags({ "outreach.ownerAware": "on", "outreach.testCampaigns": "on" });
  const m = await R.relatedFor(["x1"]);
  const e1 = m.get("x1");
  ok("X1 related: X2 and X3 through Alfredo; X4 (only an 'Accountant' role) is not", e1.related.map((r) => r.companyId).sort().join() === "x2,x3");
  ok("…ordered by Alfredo's level there: X2 (majority owner, manages) before X3 (gerente)", e1.related[0].companyId === "x2" && e1.related[0].rank >= 180 && e1.related[1].rank === 100);
  ok("…suggested lead: X2, where Alfredo is majority owner and manages — not X3 (bigger revenue)", e1.lead?.companyId === "x2" && e1.lead.why === "owner" && e1.lead.level === "majority owner, manages" && e1.lead.person === "Alfredo Cunha");
  ok("levelText words", R.levelText(205) === "ultimate owner" && R.levelText(120) === "shareholder" && R.levelText(60) === "manager" && R.levelText(40) === "");

  // ── D5: ticked by hand ──
  ok("mentionPicked: only related companies, by email name, at most 3", JSON.stringify(R.mentionPicked(e1, ["x3", "x4", "zz"]).map((x) => x.companyId)) === '["x3"]' && R.mentionPicked(e1, []).length === 0 && R.MAX_MENTION === 3);
  const { campaignId: k1 } = await camp({ action: "save", campaign: { name: "Grupo", approvalDefault: "approval", steps: [{ templateId: "t1" }] } });
  store.set("searchCompanies/x5", { name: "EMPRESA X5, LDA", stage: "universe", companyEmail: "geral@x5.pt", owner: "andre", contacts: [], ownGraphAt: Timestamp.now(), ownOwnerOther: 1 });
  store.set("searchPersonLinks/alf__x5", { personEntityType: "person", personName: "Alfredo Cunha", personId: "u_ALF", companyId: "x5", mgmtCurrent: true, mgmtRoles: ["Gerente"] });
  const pv = await camp({ action: "preview", campaignId: k1, companyIds: ["x1", "x5"] });
  ok("preview still suggests what to mention (never ticked by the page)", pv.owner?.flagged?.find((x) => x.companyId === "x1")?.mention?.length >= 1);
  const en = await camp({ action: "enrol", campaignId: k1, companyIds: ["x1", "x5"], ownerChoices: { x1: "mention", x5: "mention" }, ownerMentions: { x1: ["x3"] } });
  const acts = (id) => docs("searchActivities").filter((a) => a.companyId === id && a.type === "outreach_owner");
  ok("enrol: X1 mentions only the ticked company (X3), not the suggestion", en.enrolled === 2 && JSON.stringify((get(`outreachEnrolments/${k1}_x1`).mention || []).map((x) => x.companyId)) === '["x3"]');
  ok("…X5 on mention with nothing ticked → no mention (as Proceed)", !(get(`outreachEnrolments/${k1}_x5`).mention || []).length);
  ok("F3 history: \"the email mentions Empresa X3\" / \"knowing about the related companies\"", /the email mentions Empresa X3 — related companies:/.test(acts("x1")[0]?.content || "") && /knowing about the related companies:/.test(acts("x5")[0]?.content || ""));

  // ── D6: the mention on the draft ──
  await camp({ action: "setStatus", campaignId: k1, status: "active" });
  await runScheduler({ now: new Date(TUE), gap: null, rand: () => 0 });
  const d1 = docs("outreachMessages").find((x) => x.companyId === "x1" && x.status === "draft");
  ok("draft for X1: the panel carries what the email mentions (\"Empresa X3\") and the text names it", d1 && JSON.stringify(d1.ownerPanel?.mention) === '["Empresa X3"]' && d1.checkMention === true && /também da Empresa X3\./.test(d1.draftBody));

  // ── F4: test campaigns after go-live ──
  seed(); flags({ "outreach.ownerAware": "on", "outreach.testCampaigns": "on" });
  const t = await camp({ action: "save", campaign: { name: "Teste", isTest: true, approvalDefault: "auto", steps: [{ templateId: "t1" }] } });
  ok("a test campaign while live (switch on) is created as test", get(`outreachCampaigns/${t.campaignId}`).isTest === true);
  await camp({ action: "enrol", campaignId: t.campaignId, companyIds: ["x3"] });
  ok("…its company keeps its campaign slot free (no activeCampaignId) and the enrolment is test", !get("searchCompanies/x3").activeCampaignId && get(`outreachEnrolments/${t.campaignId}_x3`).isTest === true);
  await camp({ action: "setStatus", campaignId: t.campaignId, status: "active" });
  calls.length = 0;
  await runScheduler({ now: new Date(TUE), gap: null, rand: () => 0 });
  const sent = calls.filter((c) => c.url.endsWith("/emails") && c.method === "POST");
  const msg = docs("outreachMessages").find((x) => x.companyId === "x3" && x.direction === "out");
  ok("…its email goes only to the campaign test address, marked test, the company untouched", sent.length === 1 && JSON.stringify(sent[0].body.to) === '["amobnc92@gmail.com"]' && msg?.isTest === true && msg.redirectedFrom === "geral@x3.pt" && !get("searchCompanies/x3").lastTouchAt);
  ok("…no \"Group contacted via\" from a test email", !docs("searchActivities").some((a) => a.type === "outreach_group"));
  const rn = await camp({ action: "runNow", campaignId: t.campaignId });
  ok("…Run now works on a test campaign while live", !rn.err);
  const real = await camp({ action: "save", campaign: { name: "Real", approvalDefault: "auto", steps: [{ templateId: "t1" }] } });
  await camp({ action: "enrol", campaignId: real.campaignId, companyIds: ["x3"] });
  await camp({ action: "setStatus", campaignId: real.campaignId, status: "active" });
  ok("…a real campaign can still add the same company", get(`outreachEnrolments/${real.campaignId}_x3`)?.isTest === false && get("searchCompanies/x3").activeCampaignId === real.campaignId);
  ok("…Run now is still refused on a real campaign while live", (await camp({ action: "runNow", campaignId: real.campaignId })).err?.details?.reason === "test_only");
  flags({ "outreach.testCampaigns": "off" });
  const off = await camp({ action: "save", campaign: { name: "Sem", isTest: true, steps: [] } });
  ok("switch Off: the tick is ignored (a normal campaign)", get(`outreachCampaigns/${off.campaignId}`).isTest === false);
  flags({ "outreach.testCampaigns": "on" });

  // ── D1: new possible same-email links in the Monday report ──
  store.clear(); flags({ "outreach.ownerAware": "on", "search.sameEmail": "on" });
  const from = Date.parse("2026-10-12T00:00:00+01:00"), to = from + 7 * DAY, inWeek = Timestamp.fromMillis(from + 2 * DAY), before = Timestamp.fromMillis(from - 9 * DAY);
  const c = (id, d) => store.set(`searchCompanies/${id}`, { name: id.toUpperCase(), ownGraphAt: Timestamp.now(), ownGroupSize: 1, ownSubs: 0, ownParents: 0, ownOwnerOther: 0, updatedAt: before, ...d });
  c("a1", { companyEmail: "geral@stop.pt", updatedAt: inWeek }); c("a2", { companyEmail: "geral@stop.pt" });                 // new pair
  c("b1", { companyEmail: "info@grp.pt", updatedAt: inWeek, ownGroupKey: "PT5" }); c("b2", { companyEmail: "info@grp.pt", ownGroupKey: "PT5" }); // same group
  c("c1", { companyEmail: "mail@conf.pt", updatedAt: inWeek, sameEmailLinks: [{ companyId: "c2" }] }); c("c2", { companyEmail: "mail@conf.pt" });    // confirmed
  c("d1", { companyEmail: "x@dis.pt", updatedAt: inWeek }); c("d2", { companyEmail: "x@dis.pt", sameEmailDismissed: ["d1"] });                     // dismissed
  c("e1", { companyEmail: "e@orb.pt", updatedAt: inWeek, ownOwnerOther: 1 }); c("e2", { companyEmail: "e@orb.pt", ownOwnerOther: 1 });              // Orbis relates them
  store.set("searchPersonLinks/z__e1", { personId: "u_Z", companyId: "e1", personEntityType: "person", mgmtCurrent: true, mgmtRoles: ["Gerente"], personName: "Z" });
  store.set("searchPersonLinks/z__e2", { personId: "u_Z", companyId: "e2", personEntityType: "person", mgmtCurrent: true, mgmtRoles: ["Gerente"], personName: "Z" });
  c("f1", { companyEmail: "old@old.pt" }); c("f2", { companyEmail: "old@old.pt" });                                                                 // not new this week
  const se = await Report.newSameEmailPairs(from, to);
  ok("D1: only the new, unrelated, undecided pair (A1 ↔ A2) — not same group, confirmed, dismissed, Orbis-related or old", se.total === 1 && se.pairs[0].email === "geral@stop.pt" && [se.pairs[0].aId, se.pairs[0].bId].sort().join() === "a1,a2");
  const rr = Report.buildWeeklyReport({ from, to, sameEmail: se });
  const txt = Report.reportText(rr, { weekKey: "2026-10-12", toKey: "2026-10-18" });
  ok("…the report text has part 3 with the pair and where to act", /3\. Possíveis ligações pelo mesmo email/.test(txt) && /A1 ↔ A2 \(geral@stop\.pt\)/.test(txt) && /Possible same-email link/.test(txt));
  calls.length = 0;
  await Report.maybeRunWeekly(new Date("2026-10-19T09:00:00+01:00"), {});
  ok("…the Monday run stores it (search.sameEmail on)", get("outreachReports/2026-10-12")?.sameEmail?.total === 1);
  store.delete("outreachReports/2026-10-12"); flags({ "outreach.ownerAware": "on", "search.sameEmail": "off" });
  await Report.maybeRunWeekly(new Date("2026-10-19T09:00:00+01:00"), {});
  ok("…and leaves it out with search.sameEmail off", get("outreachReports/2026-10-12")?.status === "done" && !get("outreachReports/2026-10-12").sameEmail);

  console.log(fail ? `${fail} owner-aware round-2 test(s) FAILED` : "all owner-aware round-2 tests passed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
