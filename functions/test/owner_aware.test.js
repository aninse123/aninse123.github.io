// Owner-aware outreach, Stages 3–5 (22 Oct 2026, switch "outreach.ownerAware"):
// the owner panel when adding companies (flags, defaults), the choices (Skip for
// now / Proceed / Proceed and mention) with their history, {{owner.otherCompanies}},
// the approval card's panel and "check the mention", "Group contacted via X" on
// the first email, and the Monday report. Synthetic data only.
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
const { buildContext, renderTemplate } = require("../outreach/render.js");
const Report = require("../outreach/report.js");
const { store, Timestamp } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const get = (p) => store.get(p);
const docs = (coll) => [...store.entries()].filter(([p]) => p.startsWith(coll + "/")).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));
const DAY = 86400000;
const TUE = "2026-09-29T10:30:00+01:00";
const run = (iso) => runScheduler({ now: new Date(iso), gap: null, rand: () => 0 });
function flags(state) { store.set("config/features", { flags: { "outreach.ownerAware": { staging: state, production: state } } }); Feat._reset(); }

function seed() {
  store.clear(); calls.length = 0;
  store.set("outreachSettings/global", { testMode: false, dailyTarget: 100 });
  for (const [local, owner] of [["an.rocha", "andre"], ["a.rocha", "andre"]]) store.set(`outreachSenders/${local}@mail.douropartners-team.pt`, { email: `${local}@mail.douropartners-team.pt`, displayName: "André Rocha", owner, status: "active", dailyCap: 25, signature: "Assinatura" });
  store.set("teamDirectory/andre", { key: "andre", name: "André Rocha", partner: true, active: true });
  store.set("outreachTemplates/t1", { name: "Intro", status: "active", variants: [{ key: "A", subject: "Olá {{company.shortName}}", body: "Escrevo{{?owner.otherCompanies| enquanto responsável também {{owner.otherCompanies}}}}. Corpo." }] });
  const co = (id, data) => store.set(`searchCompanies/${id}`, { name: `EMPRESA ${id.toUpperCase()}, LDA`, stage: "universe", companyEmail: `geral@${id}.pt`, owner: "andre", contacts: [], ownGraphAt: Timestamp.now(), ...data });
  co("x1", { ownOwnerOther: 1 }); co("x2", { ownOwnerOther: 1, activeCampaignId: "k2", activeCampaignName: "Serviços Q4", lastOutreachAt: Timestamp.fromMillis(Date.now() - 4 * DAY) });
  co("x3", { ownGroupKey: "PT9", ownGroupSize: 2 }); co("x4", { ownGroupKey: "PT9", ownGroupSize: 2 });
  co("x5", { ownGroupSize: 1, ownSubs: 0, ownParents: 0, ownOwnerOther: 0 });
  store.set("searchPersonLinks/alf__x1", { personId: "u_ALF", companyId: "x1", personEntityType: "person", shCurrent: true, shDirectPct: 2, personName: "Alfredo Cunha" });
  store.set("searchPersonLinks/alf__x2", { personId: "u_ALF", companyId: "x2", personEntityType: "person", mgmtCurrent: true, mgmtRoles: ["Gerente"], personName: "Alfredo Cunha" });
  store.set("outreachThreads/no4", { companyId: "x4", responseCategory: "not_interested", isTest: false });
}
async function makeCampaign(campaign, ids, activate = true) {
  const { campaignId } = await camp({ action: "save", campaign });
  if (ids) await camp({ action: "enrol", campaignId, companyIds: ids });
  if (activate) { const r = await camp({ action: "setStatus", campaignId, status: "active" }); if (r.err) throw r.err; }
  return campaignId;
}

(async () => {
  // ── Adding companies: the panel ──
  seed(); flags("on");
  const k1 = await makeCampaign({ name: "Grupo", approvalDefault: "approval", steps: [{ templateId: "t1" }] }, null, false);
  let pv = await camp({ action: "preview", campaignId: k1, companyIds: ["x1", "x3", "x5"] });
  const f1 = pv.owner?.flagged?.find((x) => x.companyId === "x1"), f3 = pv.owner?.flagged?.find((x) => x.companyId === "x3");
  ok("preview: 2 of 3 companies flagged (X5 has nothing related)", pv.owner?.count === 2 && !pv.owner.flagged.some((x) => x.companyId === "x5"));
  ok("X1: same owner at 2% (any %) with X2 → group contacted via X2 + X2 in another campaign; default Proceed", f1 && f1.flags.map((f) => f.kind).sort().join() === "group_contacted,other_campaign" && f1.choice === "proceed" && f1.related[0].why[0].startsWith("same owner: Alfredo Cunha"));
  ok("X3: same group as X4, which said no → default Skip for now", f3 && f3.flags.some((f) => f.kind === "said_no") && f3.choice === "skip");
  ok("…with what it would mention (X2, by its email name)", f1.mention.length === 1 && f1.mention[0].companyId === "x2");

  // ── The choices ──
  let en = await camp({ action: "enrol", campaignId: k1, companyIds: ["x1", "x3", "x5"], ownerChoices: { x1: "mention", x3: "skip" } });
  const acts = (id) => docs("searchActivities").filter((a) => a.companyId === id && a.type === "outreach_owner");
  ok("enrol: X3 skipped for now (owner_skip), X1 and X5 added", en.enrolled === 2 && en.skipped.owner_skip === 1 && !get(`outreachEnrolments/${k1}_x3`));
  ok("…X3's history says why", acts("x3").length === 1 && /Skipped for now \(owner-aware\)/.test(acts("x3")[0].content) && /said no/.test(acts("x3")[0].content));
  ok("…X1 keeps the companies to mention and its history says so", JSON.stringify(get(`outreachEnrolments/${k1}_x1`).mention.map((x) => x.companyId)) === '["x2"]' && /mentioning/.test(acts("x1")[0].content));
  ok("…X5 (not flagged) gets no history entry", acts("x5").length === 0);

  // ── The template field and the approval card ──
  await camp({ action: "setStatus", campaignId: k1, status: "active" });
  await run(TUE);
  const draft = docs("outreachMessages").find((m) => m.companyId === "x1" && m.status === "draft");
  ok("draft for X1: {{owner.otherCompanies}} filled with the mentioned company (\"da Empresa X2\")", draft && /enquanto responsável também da Empresa X2\./i.test(draft.draftBody));
  ok("…the approval card's panel lists X2 with why and status, and asks to check the mention", draft.ownerPanel?.related?.[0]?.companyId === "x2" && draft.ownerPanel.flags.length >= 1 && draft.checkMention === true);
  const d5 = docs("outreachMessages").find((m) => m.companyId === "x5" && m.status === "draft");
  ok("draft for X5: no mention, the fallback leaves the sentence out; no panel", d5 && /^Escrevo\. Corpo/.test(d5.draftBody) && !d5.ownerPanel && !d5.checkMention);
  const ctx = buildContext({ company: { name: "A" }, otherCompanies: ["Fillwork", "Flexitrab"] });
  ok("render: owner.otherCompanies = \"da Fillwork e da Flexitrab\", owner.otherCompanyNames = \"Fillwork e Flexitrab\"", ctx.owner.otherCompanies === "da Fillwork e da Flexitrab" && ctx.owner.otherCompanyNames === "Fillwork e Flexitrab" && renderTemplate("{{owner.otherCompanies|—}}", buildContext({ company: {} })).text === "—");

  // ── First email: "Group contacted via X" ──
  seed(); flags("on");
  const kA = await makeCampaign({ name: "Auto", approvalDefault: "auto", steps: [{ templateId: "t1" }] }, ["x1"]);
  await run(TUE);
  const g = docs("searchActivities").filter((a) => a.type === "outreach_group");
  ok("X1's first email → X2 gets \"Group contacted via EMPRESA X1, LDA\" (automatic, not a touch)", g.length === 1 && g[0].companyId === "x2" && /Group contacted via EMPRESA X1, LDA/.test(g[0].content) && g[0].relatedCompanyId === "x1");

  // ── Switch Off: as before ──
  seed(); flags("off");
  const k0 = await makeCampaign({ name: "Sem", approvalDefault: "approval", steps: [{ templateId: "t1" }] }, null, false);
  pv = await camp({ action: "preview", campaignId: k0, companyIds: ["x1", "x3"] });
  en = await camp({ action: "enrol", campaignId: k0, companyIds: ["x1", "x3"], ownerChoices: { x3: "skip" } });
  ok("switch Off: no panel, choices ignored (both added), no history", pv.owner === null && en.enrolled === 2 && docs("searchActivities").filter((a) => a.type === "outreach_owner").length === 0);
  const rel = await camp({ action: "related", companyId: "x1" });
  ok("switch Off: the company page's related lookup answers off", rel.off === true);
  flags("on");
  const rel2 = await camp({ action: "related", companyId: "x1" });
  ok("switch On: related lookup for the company page (X2 with its campaign)", rel2.related?.[0]?.companyId === "x2" && rel2.related[0].campaignName === "Serviços Q4");

  // ── The Monday report (pure) ──
  const from = Date.parse("2026-10-12T00:00:00+01:00"), to = from + 7 * DAY, mid = Timestamp.fromMillis(from + 2 * DAY);
  const r = Report.buildWeeklyReport({
    from, to, campaigns: new Map([["k1", { name: "Grupo" }]]),
    messages: [
      { direction: "out", status: "delivered", campaignId: "k1", senderId: "an.rocha@m", createdAt: mid },
      { direction: "out", status: "bounced", campaignId: "k1", senderId: "a.rocha@m", createdAt: mid },
      { direction: "out", status: "draft", campaignId: "k1", createdAt: mid },
      { direction: "out", status: "delivered", isTest: true, createdAt: mid },
      { direction: "out", status: "delivered", createdAt: Timestamp.fromMillis(from - DAY) },
    ],
    threads: [{ repliedAt: mid, responseCategory: "interested" }, { repliedAt: mid }],
    activities: [{ type: "meeting_scheduled", createdAt: mid }, { type: "outreach_hold", createdAt: mid }],
    tasks: [{ status: "done", channel: "call", completedAt: mid }],
    enrolments: [{ startedAt: mid }],
    liveEnrolments: [
      { status: "active", companyId: "x1", companyName: "X1", campaignId: "k1", campaignName: "Grupo" },
      { status: "active", companyId: "x2", companyName: "X2", campaignId: "k2", campaignName: "Q4", holdKind: "same_inbox", holdReason: { email: "geral@x.pt" } },
    ],
    companies: new Map([["x1", { ownGroupKey: "PT1", ownershipMeta: { guoName: "Alfredo Cunha" } }], ["x2", { ownGroupKey: "PT1" }]]),
    drafts: [{ status: "draft", companyName: "X3", ownerPanel: { flags: [{ text: "group contacted via X4" }] } }],
  });
  ok("report, the week: 2 sent (draft, test and last week left out), 1 delivered, 1 bounced, by campaign and sender", r.week.sent === 2 && r.week.delivered === 1 && r.week.bounced === 1 && r.week.byCampaign.Grupo === 2 && Object.keys(r.week.bySender).length === 2);
  ok("…2 replies (Interested + not classified), 1 meeting, 1 call done, 1 started, 1 held", r.week.replies === 2 && r.week.byCategory.Interested === 1 && r.week.meetings === 1 && r.week.tasksByChannel.call === 1 && r.week.started === 1 && r.week.held === 1);
  ok("report, by owner: Alfredo Cunha's group in two campaigns; the open flag; X2 held now", r.owners.multiCampaign.length === 1 && r.owners.multiCampaign[0].owner === "Alfredo Cunha" && r.owners.openFlags[0].company === "X3" && r.owners.heldNow[0].company === "X2");
  const txt = Report.reportText(r, { weekKey: "2026-10-12", toKey: "2026-10-18" });
  ok("report text (Portuguese) lists both parts", /1\. A semana/.test(txt) && /2\. Por dono/.test(txt) && /Emails enviados: 2/.test(txt));
  ok("week start: a Wednesday → that week's Monday (Lisbon)", Report.weekStart(new Date("2026-10-21T10:00:00Z")).key === "2026-10-19");

  // ── The Monday run ──
  seed(); calls.length = 0;
  ok("not on a Tuesday", (await Report.maybeRunWeekly(new Date("2026-10-20T09:00:00+01:00"), {})) === null);
  ok("not on a Monday before 08:00", (await Report.maybeRunWeekly(new Date("2026-10-19T07:30:00+01:00"), {})) === null);
  const wr = await Report.maybeRunWeekly(new Date("2026-10-19T09:00:00+01:00"), {});
  const rep = get("outreachReports/2026-10-12");
  const mail = calls.find((c) => c.url.endsWith("/emails") && c.method === "POST");
  ok("Monday 09:00: last week's report saved (12–19 Oct) and emailed to both partners from noreply@", wr?.week === "2026-10-12" && rep?.status === "done" && rep.weekTo === "2026-10-19" && mail && JSON.stringify(mail.body.to) === '["andre.rocha@douropartners.pt","antonio.carvalho@douropartners.pt"]' && /noreply@douropartners\.pt/.test(mail.body.from));
  calls.length = 0;
  ok("a second run the same Monday does nothing", (await Report.maybeRunWeekly(new Date("2026-10-19T09:10:00+01:00"), {})) === null && !calls.length);
  seed(); calls.length = 0;
  store.set("outreachReports/2026-10-12", { status: "building", createdAt: Timestamp.fromMillis(Date.parse("2026-10-19T08:00:00+01:00")) });
  ok("a report left half-built over 30 minutes ago is built again", (await Report.maybeRunWeekly(new Date("2026-10-19T09:00:00+01:00"), {}))?.week === "2026-10-12" && get("outreachReports/2026-10-12").status === "done");
  store.set("outreachReports/2026-10-12", { status: "building", createdAt: Timestamp.fromMillis(Date.parse("2026-10-19T08:50:00+01:00")) });
  ok("…but not one another run started 10 minutes ago", (await Report.maybeRunWeekly(new Date("2026-10-19T09:00:00+01:00"), {})) === null);
  seed(); calls.length = 0;
  await Report.maybeRunWeekly(new Date("2026-10-19T09:00:00+01:00"), { weeklyReportEmail: false });
  ok("Settings \"Email the Monday report\" off → saved, not emailed", get("outreachReports/2026-10-12")?.status === "done" && !calls.some((c) => c.url.endsWith("/emails")));

  console.log(fail ? `${fail} owner-aware test(s) FAILED` : "all owner-aware tests passed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
