// Claude connector — Search CRM tools.

const { z } = require("zod");
const C = require("./common");
const R = require("../redact");
const IX = require("../index_companies");
const U = require("../util");

const ROW_FIELDS = ["id", "name", "nif", "domain", "legalForm", "cae", "caeDescription", "sector", "subSector", "district", "concelho", "city", "nuts2", "revenue", "ebitda", "margin", "employees", "growth", "growthSustained", "finYear", "fit", "tier", "contactable", "doNotContact", "stage", "owner", "outreachStatus", "contacted", "answered", "channels", "lastTouchAt", "lastOutreachAt", "lastReplyAt", "campaignId", "campaignName", "groupKey", "groupSize", "yearFounded"];
const DEFAULT_FIELDS = ["id", "name", "nif", "sector", "cae", "district", "concelho", "revenue", "ebitda", "margin", "employees", "fit", "tier", "stage", "owner", "contactable", "doNotContact", "contacted", "lastTouchAt", "campaignName"];
const DATE_FIELDS = ["lastTouchAt", "lastOutreachAt", "lastReplyAt"];

const filtersSchema = z.object({
  cae: z.array(z.string()).optional().describe("CAE code prefixes, e.g. [\"25\", \"2562\"]"),
  sector: z.array(z.string()).optional(), subSector: z.array(z.string()).optional(),
  district: z.array(z.string()).optional().describe("Distrito names, e.g. [\"Braga\", \"Porto\"]"), concelho: z.array(z.string()).optional(), nuts2: z.array(z.string()).optional(),
  revenueMin: z.number().optional().describe("Euros"), revenueMax: z.number().optional(), ebitdaMin: z.number().optional().describe("Euros"), ebitdaMax: z.number().optional(),
  marginMin: z.number().optional().describe("EBITDA margin as a fraction or percent, as stored"), marginMax: z.number().optional(),
  employeesMin: z.number().optional(), employeesMax: z.number().optional(), growthMin: z.number().optional(), growthMax: z.number().optional(), fitMin: z.number().optional(),
  tier: z.array(z.string()).optional().describe("A, B, C or none"), stage: z.array(z.string()).optional().describe("universe, screened, outreach, engaged, teaser_received, under_nda, cim_received, nbo, loi, due_diligence, financing, closing, closed, pass, on_hold"),
  owner: z.array(z.string()).optional().describe("Team short names, e.g. andre"),
  contactable: z.boolean().optional(), doNotContact: z.boolean().optional(), contacted: z.boolean().optional().describe("Ever contacted on any channel"), answered: z.boolean().optional(),
  inCampaign: z.boolean().optional(), campaignId: z.string().optional(),
  lastTouchAfter: z.string().optional().describe("ISO date"), lastTouchBefore: z.string().optional().describe("ISO date; never-touched companies count as before"),
}).partial();

async function indexRows(ctx) {
  const ix = await IX.rows(ctx);
  if (!ix) throw new Error("The company index isn't built yet. Ask André to run the Claude daily job once (Team & access → Claude).");
  return ix;
}
function shapeRow(r, fields) {
  const out = {};
  for (const f of fields) {
    if (!(f in r)) continue;
    out[f] = DATE_FIELDS.includes(f) ? (r[f] ? new Date(r[f]).toISOString().slice(0, 10) : null) : r[f];
  }
  return out;
}

const findCompanies = {
  name: "find_companies", perm: "search.view",
  description: "Find companies in the Douro Search CRM by name, NIF, email or @domain and/or filters (sector, CAE, district, size, fit, tier, stage, owner, contacted…). Returns a page of rows (max 100) with a cursor for the next page; choose fields to keep long lists small. Money in euros. Use count_companies for totals and grouped sums.",
  schema: {
    text: z.string().optional().describe("Name, NIF, email or @domain"), filters: filtersSchema.optional(),
    sort: z.object({ field: z.enum(["revenue", "ebitda", "margin", "employees", "growth", "fit", "name", "lastTouchAt", "lastOutreachAt", "yearFounded"]), dir: z.enum(["asc", "desc"]).optional() }).optional(),
    fields: z.array(z.enum(ROW_FIELDS)).optional(), pageSize: z.number().int().optional(), cursor: z.string().optional(),
  },
  async run(ctx, a) {
    const ix = await indexRows(ctx);
    const hits = IX.sortRows(ix.list.filter((r) => IX.matches(r, a.filters || {}, a.text || "")), a.sort);
    const size = C.pageSize(ctx, a.pageSize);
    const off = Math.max(0, C.dec(a.cursor)?.o || 0);
    const page = hits.slice(off, off + size);
    const fields = a.fields?.length ? [...new Set(["id", "name", ...a.fields])] : DEFAULT_FIELDS;
    return C.fit({ total: hits.length, from: off + 1, rows: page.map((r) => shapeRow(r, fields)), nextCursor: off + size < hits.length ? C.enc({ o: off + size }) : null, indexBuiltAt: new Date(ix.builtAt).toISOString() });
  },
};

const countCompanies = {
  name: "count_companies", perm: "search.view",
  description: "Count companies matching filters, with sums, averages, min and max of revenue, EBITDA, employees, margin or growth, grouped by up to two fields (sector, subSector, cae, cae2, cae3, district, concelho, nuts2, stage, owner, tier, contactable, contacted, answered, outreachStatus, campaignName, legalForm, revenueBand, ebitdaBand, employeesBand). For assessing sectors and regions in one call.",
  schema: {
    text: z.string().optional(), filters: filtersSchema.optional(),
    groupBy: z.array(z.enum(IX.GROUPABLE)).max(2).optional(),
    metrics: z.array(z.object({ op: z.enum(["count", "sum", "avg", "min", "max"]), field: z.enum(["revenue", "ebitda", "employees", "margin", "growth", "growthSustained", "fit"]).optional() })).max(8).optional(),
    maxGroups: z.number().int().optional(),
  },
  async run(ctx, a) {
    const ix = await indexRows(ctx);
    const hits = ix.list.filter((r) => IX.matches(r, a.filters || {}, a.text || ""));
    const groups = IX.aggregate(hits, a.groupBy || [], (a.metrics || []).filter((m) => m.op === "count" || m.field));
    const max = Math.min(Math.max(1, a.maxGroups || 200), 500);
    return C.fit({ total: hits.length, groupCount: groups.length, rows: groups.slice(0, max), note: groups.length > max ? `Showing the ${max} largest groups of ${groups.length}.` : undefined, indexBuiltAt: new Date(ix.builtAt).toISOString() });
  },
};

// Activities whose text came from outside (emails) are labelled.
const OUTSIDE_TYPES = new Set(["email_received", "email"]);
function activityOut(a, companyName) {
  const o = R.pick("searchActivities", a.id, a);
  if (o.content && (OUTSIDE_TYPES.has(a.type) || a.direction === "in")) o.content = R.untrusted(o.content, `${a.type} ${companyName || ""} ${o.date ? String(o.date).slice(0, 10) : ""}`.trim());
  return o;
}
const FIN_KEYS = ["operatingRevenue", "sales", "ebitda", "plForPeriod", "numberOfEmployees", "totalAssets", "shareholdersFunds", "cashAndCashEquivalent", "longTermDebt", "enterpriseValue"];
function financials(c) {
  const of = c.orbisFinancials && typeof c.orbisFinancials === "object" ? c.orbisFinancials : null;
  if (of) {
    return { unit: "thousands of euros (Orbis)", years: Object.keys(of).filter((y) => /^\d{4}$/.test(y)).sort().reverse().map((y) => ({ year: +y, ...Object.fromEntries(FIN_KEYS.filter((k) => of[y]?.[k] != null).map((k) => [k, of[y][k]])) })) };
  }
  const f = c.financials && typeof c.financials === "object" ? c.financials : null;
  return f ? { unit: "as entered (Y1 = most recent year)", years: Object.entries(f).map(([k, v]) => ({ period: k, ...R.plain(v) })) } : null;
}

const getCompany = {
  name: "get_company", perm: "search.view",
  description: "Open one company: details, financials by year, deal stage and deal fields, owners and managers with their shares, people with contact details, latest activities, campaigns it is in, and its files. Give id (from find_companies) or nif.",
  schema: {
    id: z.string().optional(), nif: z.string().optional(),
    include: z.array(z.enum(["financials", "ownership", "people", "activities", "campaigns", "files"])).optional().describe("Default: all"),
    activitiesLimit: z.number().int().optional(),
  },
  async run(ctx, a) {
    let id = a.id && /^(?!__)[A-Za-z0-9_-]{1,100}$/.test(a.id) ? a.id : null;
    if (!id && a.nif) {
      const hit = await ctx.query(C.db().collection("searchCompanies").where("nif", "==", String(a.nif).replace(/\D/g, "")).select("name").limit(1));
      id = hit[0]?.id || null;
    }
    if (!id) return { error: "Give the company id (from find_companies) or its NIF." };
    const c = await ctx.doc(`searchCompanies/${id}`);
    if (!c) return { error: "No company with that id." };
    const inc = new Set(a.include?.length ? a.include : ["financials", "ownership", "people", "activities", "campaigns", "files"]);
    const out = { company: R.pick("searchCompanies", id, c) };
    const rules = (await ctx.doc("searchConfig/targetTiers"))?.rules || [];
    out.company.tier = require("../../outreach/campaign_util").tierOf(c, rules) || null;
    if (inc.has("financials")) out.financials = financials(c);
    if (inc.has("ownership") || inc.has("people")) {
      const links = await ctx.query(C.db().collection("searchPersonLinks").where("companyId", "==", id).limit(200));
      const pct = (l) => Math.max(Number(l.shTotalPct) || 0, Number(l.shDirectPct) || 0);
      // Shareholders first, largest share first; then current managers; then contacts.
      const rank = (l) => (l.shCurrent !== false && pct(l) ? 10000 + pct(l) * 100 : 0) + (l.mgmtCurrent ? 50 : 0) + (l.isContact ? 10 : 0);
      links.sort((x, y) => rank(y) - rank(x));
      out.ownershipAndPeople = links.map((l) => R.pick("searchPersonLinks", l.id, l));
      if (inc.has("people")) {
        const ids = [...new Set(links.map((l) => l.personId).filter((p) => p && /^[A-Za-z0-9_-]{1,200}$/.test(p)))].slice(0, 60);
        const people = await ctx.docs(ids.map((p) => `searchPeople/${p}`));
        out.people = people.filter(Boolean).map((p) => R.pick("searchPeople", p.id, p, ["name", "entityType", "country", "reach", "notes", "matchedCompanyId"]));
      }
    }
    if (inc.has("activities")) {
      const acts = await ctx.query(C.db().collection("searchActivities").where("companyId", "==", id).limit(500));
      acts.sort((x, y) => (U.ms(y.date) || 0) - (U.ms(x.date) || 0));
      const n = Math.min(Math.max(1, a.activitiesLimit || 50), ctx.rowsLimit);
      out.activities = { total: acts.length, latest: acts.slice(0, n).map((x) => activityOut(x, c.name)) };
    }
    if (inc.has("campaigns")) {
      const en = await ctx.query(C.db().collection("outreachEnrolments").where("companyId", "==", id).limit(50));
      out.campaigns = en.map((e) => R.pick("outreachEnrolments", e.id, e));
    }
    if (inc.has("files")) {
      const files = await ctx.query(C.db().collection("outreachFiles").where("companyId", "==", id).limit(100));
      out.files = files.map((f) => ({ fileId: `file:${f.id}`, ...R.pick("outreachFiles", f.id, f) }));
    }
    return C.fit(out, "none");
  },
};

const relatedCompanies = {
  name: "related_companies", perm: "search.view",
  description: "Companies related to one company: shared owners or managers, parent or subsidiary, same group, same email, or linked by hand, with their stage and outreach status.",
  schema: { companyId: z.string() },
  async run(ctx, a) {
    const { relatedFor } = require("../../outreach/related");
    const id = String(a.companyId || "");
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return { error: "Give a company id." };
    const m = await relatedFor([id]);
    ctx.reads += 60; // relatedFor reads links and companies itself; an estimate for the log
    const r = m.get(id) || { related: [], lead: null };
    return C.fit({ companyId: id, rows: (r.related || []).map((x) => R.plain(x)), lead: R.plain(r.lead || null) });
  },
};

const PERSON_SALUT = /^(mr|mrs|ms|miss|dr|dra|eng|engo|enga|prof|sr|sra|d)\s+/;
const STOP = new Set(["DE", "DA", "DO", "DOS", "DAS", "E"]);
function nameTokens(name) {
  let s = String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.,\-–—&/()']/g, " ").replace(/\s+/g, " ").trim();
  let prev; do { prev = s; s = s.replace(PERSON_SALUT, ""); } while (s !== prev);
  return [...new Set(s.toUpperCase().split(" ").filter((w) => w.length > 1 && !STOP.has(w)))];
}
function phoneKey(v) {
  const raw = String(v == null ? "" : v).trim();
  let d = raw.replace(/\D/g, "");
  if (/^(\+|00)/.test(raw) || (d.length === 12 && d.startsWith("351"))) { if (/^00/.test(raw)) d = d.slice(2); return d.startsWith("351") && d.length === 12 ? d.slice(3) : null; }
  return d.length === 9 ? d : null;
}
const findPeople = {
  name: "find_people", perm: "search.view",
  description: "Find a person (owner, manager or contact) by name, email or phone, with every company they are linked to: roles, shares, contact details.",
  schema: { name: z.string().optional(), email: z.string().optional(), phone: z.string().optional(), pageSize: z.number().int().optional() },
  async run(ctx, a) {
    const size = Math.min(C.pageSize(ctx, a.pageSize), 25);
    let people = [];
    if (a.email) people = await ctx.query(C.db().collection("searchPeople").where("reachEmails", "array-contains", String(a.email).trim().toLowerCase()).limit(size));
    else if (a.phone) { const k = phoneKey(a.phone); if (k) people = await ctx.query(C.db().collection("searchPeople").where("reachPhones", "array-contains", k).limit(size)); }
    else if (a.name) {
      const toks = nameTokens(a.name);
      if (!toks.length) return { error: "Give a longer name." };
      const longest = toks.slice().sort((x, y) => y.length - x.length)[0];
      const cands = await ctx.query(C.db().collection("searchPeople").where("nameTokens", "array-contains", longest).limit(300));
      people = cands.filter((p) => toks.every((t) => (p.nameTokens || []).includes(t))).slice(0, size);
    } else return { error: "Give a name, email or phone." };
    const rows = [];
    for (const p of people) {
      const links = await ctx.query(C.db().collection("searchPersonLinks").where("personId", "==", p.id).limit(50));
      rows.push({ ...R.pick("searchPeople", p.id, p), companies: links.map((l) => R.pick("searchPersonLinks", l.id, l)) });
    }
    return C.fit({ rows });
  },
};

const listActivities = {
  name: "list_activities", perm: "search.view",
  description: "Activities on companies (calls, meetings, visits, notes, emails, letters…) by company, type, date range or who logged them. Text that came from emails is labelled as outside content.",
  schema: {
    companyId: z.string().optional(), type: z.array(z.string()).optional().describe("note, letter, call_attempted, call_connected, email, email_received, whatsapp, linkedin, warm_intro, meeting_scheduled, meeting_done, in_person, observation, other"),
    from: z.string().optional().describe("ISO date"), to: z.string().optional(), by: z.string().optional().describe("createdBy (email or short name)"), pageSize: z.number().int().optional(), cursor: z.string().optional(),
  },
  async run(ctx, a) {
    const size = C.pageSize(ctx, a.pageSize);
    let q = C.db().collection("searchActivities");
    if (a.companyId) q = q.where("companyId", "==", String(a.companyId));
    const from = C.toMs(a.from), to = C.toMs(a.to);
    let list;
    if (a.companyId) {
      list = await ctx.query(q.limit(1000));
    } else {
      if (from != null) q = q.where("date", ">=", new Date(from));
      if (to != null) q = q.where("date", "<", new Date(to));
      list = await ctx.query(q.orderBy("date", "desc").limit(from != null ? 3000 : 500));
    }
    list = list.filter((x) => (!a.type?.length || a.type.includes(x.type))
      && (from == null || (U.ms(x.date) || 0) >= from) && (to == null || (U.ms(x.date) || 0) < to)
      && (!a.by || String(x.createdBy || "").toLowerCase().includes(String(a.by).toLowerCase())));
    list.sort((x, y) => (U.ms(y.date) || 0) - (U.ms(x.date) || 0));
    const off = Math.max(0, C.dec(a.cursor)?.o || 0);
    const page = list.slice(off, off + size);
    const names = new Map();
    const cids = [...new Set(page.map((x) => x.companyId).filter((x) => x && /^[A-Za-z0-9_-]{1,100}$/.test(x)))];
    (await ctx.docs(cids.map((id) => `searchCompanies/${id}`))).forEach((c) => c && names.set(c.id, c.name));
    return C.fit({ total: list.length, rows: page.map((x) => ({ ...activityOut(x, names.get(x.companyId)), companyName: names.get(x.companyId) || null })), nextCursor: off + size < list.length ? C.enc({ o: off + size }) : null });
  },
};

const MEETING_TYPES = ["meeting_scheduled", "meeting_done", "in_person"];
const pipelineStats = {
  name: "pipeline_stats", perm: "search.stats",
  description: "The deal funnel: companies by stage (and by tier, district, owner or sector), and in a date range the activities by type and month (calls, meetings, visits, NDAs), replies and campaign emails sent. For investor updates and reviews.",
  schema: { from: z.string().optional().describe("ISO date, default 30 days ago"), to: z.string().optional(), groupBy: z.enum(["stage", "tier", "district", "owner", "sector"]).optional() },
  async run(ctx, a) {
    const ix = await indexRows(ctx);
    const to = C.toMs(a.to) || Date.now(), from = C.toMs(a.from) || to - 30 * 86400000;
    const byStage = IX.aggregate(ix.list, a.groupBy && a.groupBy !== "stage" ? ["stage", a.groupBy] : ["stage"], [{ op: "count" }, { op: "sum", field: "revenue" }, { op: "sum", field: "ebitda" }]);
    const acts = await ctx.query(C.db().collection("searchActivities").where("date", ">=", new Date(from)).where("date", "<", new Date(to)).orderBy("date", "desc").limit(5000));
    const real = acts.filter((x) => !x.isTest);
    const byType = {}, byMonth = {};
    for (const x of real) {
      byType[x.type] = (byType[x.type] || 0) + 1;
      const m = new Date(U.ms(x.date) || 0).toISOString().slice(0, 7);
      byMonth[m] = byMonth[m] || {}; byMonth[m][x.type] = (byMonth[m][x.type] || 0) + 1;
    }
    const threads = await ctx.query(C.db().collection("outreachThreads").where("repliedAt", ">=", new Date(from)).limit(2000));
    const replies = threads.filter((t) => !t.isTest && (U.ms(t.repliedAt) || 0) < to);
    const byCategory = {};
    replies.forEach((t) => { const k = t.responseCategory || "unclassified"; byCategory[k] = (byCategory[k] || 0) + 1; });
    return C.fit({
      period: { from: new Date(from).toISOString().slice(0, 10), to: new Date(to).toISOString().slice(0, 10) },
      companiesByStage: byStage, activitiesByType: byType, activitiesByMonth: byMonth,
      meetings: MEETING_TYPES.reduce((s, t) => s + (byType[t] || 0), 0),
      conversationsReplied: replies.length, repliesByCategory: byCategory,
      note: acts.length >= 5000 ? "More than 5,000 activities in the period; activity counts cover the latest 5,000." : undefined,
      indexBuiltAt: new Date(ix.builtAt).toISOString(),
    }, "none");
  },
};

module.exports = { tools: [findCompanies, countCompanies, getCompany, relatedCompanies, findPeople, listActivities, pipelineStats], activityOut, nameTokens, phoneKey, filtersSchema, ROW_FIELDS };
