// Claude connector — tool results on fixtures: filters, sorting, grouped counts
// and sums, the company page, related companies, people, campaign results,
// pipeline, network, investors, budget, query, and the company index overlay.
const X = require("./claude_fixtures");
const IX = require("../claude/index_companies");
const { store, Timestamp } = X.F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

(async () => {
  X.seed();
  const noIx = await X.tool(X.ANDRE, "find_companies", {});
  ok("before the index is built: a clear message", noIx.isError && /index isn't built/.test(noIx.result.error));
  const b = await X.buildIndex();
  ok("index build reads every company once", b.count === 233);

  // ── find / count ──
  const byNif = await X.tool(X.ANDRE, "find_companies", { text: "508123456" });
  ok("find by NIF", byNif.result.total === 1 && byNif.result.rows[0].id === "c1");
  ok("find by @domain", (await X.tool(X.ANDRE, "find_companies", { text: "@metalnorte.pt" })).result.rows[0]?.id === "c1");
  ok("find by email", (await X.tool(X.ANDRE, "find_companies", { text: "geral@metalnorte.pt" })).result.rows[0]?.id === "c1");
  ok("find by name without accents or case", (await X.tool(X.ANDRE, "find_companies", { text: "metalúrgica" })).result.rows[0]?.id === "c1");
  const f1 = await X.tool(X.ANDRE, "find_companies", { filters: { district: ["braga"], ebitdaMin: 500000, contacted: false } });
  ok("filters: district + EBITDA ≥ 500k + never contacted", f1.result.total === 1 && f1.result.rows[0].id === "c2");
  const f2 = await X.tool(X.ANDRE, "find_companies", { filters: { cae: ["2562"] } });
  ok("filters: CAE prefix", f2.result.rows.every((r) => String(r.cae).startsWith("2562")) && f2.result.total >= 1);
  ok("tier worked out with the portal's rules (CAE 2562 → A, Metals → B)", f2.result.rows.find((r) => r.id === "c1")?.tier === "A" && (await X.tool(X.ANDRE, "find_companies", { text: "metais de braga" })).result.rows[0].tier === "B");
  ok("filters: do not contact", (await X.tool(X.ANDRE, "find_companies", { filters: { doNotContact: true } })).result.rows.map((r) => r.id).join() === "c3");
  ok("filters: in a campaign", (await X.tool(X.ANDRE, "find_companies", { filters: { campaignId: "k1" } })).result.total === 1);
  const sorted = await X.tool(X.ANDRE, "find_companies", { filters: { sector: ["Metals"] }, sort: { field: "ebitda", dir: "desc" }, pageSize: 3, fields: ["ebitda"] });
  ok("sort by EBITDA, largest first", sorted.result.rows[0].id === "c2" && sorted.result.rows[0].ebitda >= sorted.result.rows[1].ebitda);
  const cnt = await X.tool(X.ANDRE, "count_companies", { filters: { sector: ["Metals"] }, groupBy: ["district", "revenueBand"], metrics: [{ op: "count" }, { op: "sum", field: "ebitda" }, { op: "avg", field: "revenue" }] });
  const braga = cnt.result.rows.filter((r) => r.district === "Braga");
  ok("grouped counts by district and revenue band", cnt.result.total === 232 && braga.reduce((s, r) => s + r.count, 0) === 117);
  ok("grouped sums and averages", braga.every((r) => typeof r.sum_ebitda === "number" && typeof r.avg_revenue === "number"));
  ok("count_companies reads nothing from the database (index only)", JSON.parse(JSON.stringify([...store.values()].filter((v) => v && v.tool === "count_companies").pop() || {})).reads <= 3);

  // ── Company page ──
  const gc = await X.tool(X.ANDRE, "get_company", { nif: "508123456" });
  ok("get_company by NIF: details, deal stage and notes", gc.result.company.name === "METALURGICA DO NORTE, LDA" && gc.result.company.stage === "engaged" && gc.result.company.tier === "A");
  ok("financials by year (Orbis, thousands of euros)", gc.result.financials.years[0].year === 2024 && gc.result.financials.years[0].operatingRevenue === 6200);
  ok("owners and managers with shares", gc.result.ownershipAndPeople[0].personName === "João Silva" && gc.result.ownershipAndPeople[0].shTotalPct === 60);
  store.set("searchPersonLinks/e_X__c1", { personId: "e_X", companyId: "c1", personName: "HOLDING X", shDirectPct: 75, shTotalPct: null, shCurrent: true, shTypeOrbis: "Corporate" });
  const gc2 = await X.tool(X.ANDRE, "get_company", { id: "c1", include: ["ownership"] });
  ok("owners sorted by share, also when only the direct share is known (Orbis)", gc2.result.ownershipAndPeople[0].personName === "HOLDING X" && gc2.result.ownershipAndPeople[0].shTypeOrbis === "Corporate");
  store.delete("searchPersonLinks/e_X__c1");
  ok("people with contact details", gc.result.people[0].reach.some((x) => x.value === "joao@metalnorte.pt"));
  ok("activities newest first", gc.result.activities.latest[0].id === "a2" && gc.result.activities.total === 2);
  ok("campaigns it is in", gc.result.campaigns[0].campaignId === "k1");
  ok("files with ids to read", gc.result.files.some((f) => f.fileId === "file:f1"));
  ok("unknown company: a clear message", (await X.tool(X.ANDRE, "get_company", { id: "nope" })).result.error === "No company with that id.");
  const rel = await X.tool(X.ANDRE, "related_companies", { companyId: "c1" });
  ok("related companies: the other company of the same owner", !rel.isError && rel.result.rows.some((r) => r.companyId === "c2"));
  const fp = await X.tool(X.ANDRE, "find_people", { name: "joão silva" });
  ok("find_people by name: every company and role", fp.result.rows[0].companies.length === 2);
  ok("find_people by phone", (await X.tool(X.ANDRE, "find_people", { phone: "+351 912 345 678" })).result.rows.length === 1);

  // ── Activities and pipeline ──
  const la = await X.tool(X.ANDRE, "list_activities", { type: ["call_connected"] });
  ok("list_activities by type, with the company name", la.result.rows.length === 1 && la.result.rows[0].companyName === "METAIS DE BRAGA SA");
  const ps = await X.tool(X.ANDRE, "pipeline_stats", {});
  ok("pipeline: companies by stage", ps.result.companiesByStage.some((r) => r.stage === "engaged" && r.count === 1));
  ok("pipeline: meetings and replies in the last 30 days", ps.result.meetings === 1 && ps.result.conversationsReplied === 1 && ps.result.repliesByCategory.interested === 1);

  // ── Outreach ──
  const lc = await X.tool(X.ANDRE, "list_campaigns", {});
  ok("list_campaigns with steps", lc.result.rows[0].name === "Metals Norte" && lc.result.rows[0].steps.length === 2);
  const cr = await X.tool(X.ANDRE, "campaign_results", { campaignId: "k1" });
  const s1 = cr.result.rows.find((r) => r.step === "s1");
  ok("campaign results per step: sent, opened, replied, positive", s1 && s1.sent === 1 && s1.opened === 1 && s1.replied === 1 && s1.positive === 1);
  ok("campaign results: a meeting with an enrolled company counts even when not tagged with the campaign", cr.result.rows.reduce((n, r) => n + r.meetings, 0) === 1);
  ok("campaign results: steps say which path", cr.result.rows.find((r) => r.step === "s1").pathId === null);
  ok("campaign results: enrolments by status and tasks", cr.result.enrolled === 2 && cr.result.enrolmentsByStatus.paused === 1 && cr.result.rows.some((r) => r.tasksOpen === 1));
  const cro = await X.tool(X.ANDRE, "campaign_results", { campaignId: "k1", by: "owner" });
  ok("campaign results by owner", cro.result.rows.some((r) => r.owner === "andre" && r.sent === 1));
  const lt = await X.tool(X.ANDRE, "list_tasks", { assignee: "maria" });
  ok("list_tasks: open tasks for a person, with company", lt.result.rows.length === 1 && lt.result.rows[0].companyName === "METAIS DE BRAGA SA");
  const gm = await X.tool(X.ANDRE, "get_message", { messageId: "i1" });
  ok("get_message lists attachments with ids; a skipped one says so", gm.result.attachments[0].fileId === "att:i1:0" && gm.result.attachments[1].available === false);

  // ── Network, investors, portal, budget ──
  ok("find_network by category with the firm", (await X.tool(X.ANDRE, "find_network", { category: "banker" })).result.rows[0].firmName === "Big Bank");
  const fi = await X.tool(X.ANDRE, "find_investors", {});
  ok("money is rounded (no float noise)", (await X.tool(X.ANDRE, "find_companies", { text: "metalurgica", fields: ["revenue", "margin"] })).result.rows[0].margin === 0.145);
  ok("find_investors with commitment totals", fi.result.totals.soft === 100000 && fi.result.totals.hard === 50000);
  ok("get_investor with activities", (await X.tool(X.ANDRE, "get_investor", { id: "i1" })).result.activities.length === 1);
  const lp = await X.tool(X.ANDRE, "list_portal_documents", {});
  ok("list_portal_documents with file ids, no download links", lp.result.rows[0].fileId === "doc:d1" && !lp.text.includes("downloadURL"));
  const bs = await X.tool(X.ANDRE, "budget_summary", { groupBy: "company" });
  ok("budget_summary by company", bs.result.rows.some((r) => r.company === "c1" && r.total === 120.5));
  const bi = await X.tool(X.ANDRE, "find_budget_items", {});
  ok("find_budget_items: amounts, never receipt links", bi.result.rows[0].amount === 120.5 && !bi.text.includes("attachments"));

  // ── query ──
  const q1 = await X.tool(X.ANT, "query", { collection: "companies", where: [["district", "==", "Braga"], ["ebitda", ">", 1000000]], select: ["name", "ebitda"] });
  ok("query companies: any filter on the index", q1.result.total === 1 && q1.result.rows[0].name === "METAIS DE BRAGA SA");
  const q2 = await X.tool(X.ANT, "query", { collection: "activities", where: [["type", "==", "meeting_done"]], select: ["companyId", "date"] });
  ok("query activities: equality filter", q2.result.total === 1 && q2.result.rows[0].companyId === "c1");
  const q3 = await X.tool(X.ANT, "query", { collection: "threads", groupBy: ["responseCategory"] });
  ok("query with groupBy", q3.result.rows[0].responseCategory === "interested" && q3.result.rows[0].count === 1);
  const q4 = await X.tool(X.ANT, "query", { collection: "companies", groupBy: ["district"], aggregate: [{ op: "sum", field: "ebitda" }] });
  ok("query companies grouped with sums", q4.result.rows.some((r) => r.district === "Braga" && r.sum_ebitda > 0));

  // ── The index overlay: changes since the build show up ──
  store.get("searchCompanies/c3").stage = "screened";
  store.get("searchCompanies/c3").updatedAt = Timestamp.fromMillis(Date.now() + 1000);
  store.set("searchCompanies/new1", { name: "NOVA EMPRESA LDA", nif: "510000000", sector: "Metals", distrito: "Braga", stage: "universe", createdAt: Timestamp.fromMillis(Date.now() + 1000) });
  IX._reset(); // a new instance: loads the stored index, then overlays changes
  ok("a company changed after the build shows its new stage", (await X.tool(X.ANDRE, "find_companies", { text: "plasticos" })).result.rows[0].stage === "screened");
  ok("a company added after the build is found", (await X.tool(X.ANDRE, "find_companies", { text: "nova empresa" })).result.total === 1);

  console.log(fail ? `\n${fail} FAILED` : "\nall Claude tool tests passed");
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
