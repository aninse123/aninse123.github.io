// Claude connector — `query`: flexible reads for Partner and Admin (build plan D5).
// Only the collections in QUERY_COLLECTIONS and only their allowlisted fields;
// companies go through the company index (any filter, sort, group, no reads).

const { z } = require("zod");
const C = require("./common");
const R = require("../redact");
const IX = require("../index_companies");
const G = require("../gate");

const OPS = ["==", "!=", "<", "<=", ">", ">=", "in", "array-contains", "contains"];
const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const val = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : v);
const asComparable = (v) => { const x = val(v); if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x)) { const t = new Date(x).getTime(); return Number.isFinite(t) ? t : x; } return x; };
function test(doc, [field, op, value]) {
  const x = asComparable(field.split(".").reduce((o, k) => (o == null ? undefined : o[k]), doc));
  const v = Array.isArray(value) ? value.map(asComparable) : asComparable(value);
  switch (op) {
    case "==": return JSON.stringify(x) === JSON.stringify(v) || (typeof x === "string" && typeof v === "string" && fold(x) === fold(v));
    case "!=": return JSON.stringify(x) !== JSON.stringify(v);
    case "<": return x != null && x < v; case "<=": return x != null && x <= v; case ">": return x != null && x > v; case ">=": return x != null && x >= v;
    case "in": return Array.isArray(v) && v.some((y) => JSON.stringify(y) === JSON.stringify(x) || fold(y) === fold(x));
    case "array-contains": return Array.isArray(x) && x.some((y) => JSON.stringify(y) === JSON.stringify(v) || fold(y) === fold(v));
    case "contains": return fold(typeof x === "string" ? x : JSON.stringify(x ?? "")).includes(fold(v));
    default: return false;
  }
}

const query = {
  name: "query", perm: (who) => G.isPartnerOrAdmin(who),
  description: "Flexible read for Partner and Admin over Search, Outreach, Network and Investors: pick a collection (companies, people, personLinks, activities, campaigns, enrolments, threads, messages, tasks, networkContacts, networkFirms, networkActivities, investors, investorActivities), up to 5 filters [field, op, value] (==, !=, <, <=, >, >=, in, array-contains, contains), a sort, chosen fields, a page, or counts/sums/averages grouped by up to two fields. Companies use the company index fields (as find_companies); other collections are read up to 5,000 documents per call (the first filter on an == field narrows the read).",
  schema: {
    collection: z.string(), where: z.array(z.tuple([z.string(), z.enum(OPS), z.any()])).max(5).optional(),
    orderBy: z.object({ field: z.string(), dir: z.enum(["asc", "desc"]).optional() }).optional(), select: z.array(z.string()).optional(),
    groupBy: z.array(z.string()).max(2).optional(), aggregate: z.array(z.object({ op: z.enum(["count", "sum", "avg", "min", "max"]), field: z.string().optional() })).max(8).optional(),
    pageSize: z.number().int().optional(), cursor: z.string().optional(),
  },
  async run(ctx, a) {
    const coll = R.QUERY_COLLECTIONS[a.collection];
    if (!coll || R.isNever(coll)) return { error: `Unknown or closed collection. Use one of: ${Object.keys(R.QUERY_COLLECTIONS).join(", ")}.` };
    const where = a.where || [];
    const size = C.pageSize(ctx, a.pageSize);
    let docs, allowed;
    if (coll === "searchCompanies") {
      const ix = await IX.rows(ctx);
      if (!ix) return { error: "The company index isn't built yet." };
      docs = ix.list; allowed = Object.keys(docs[0] || {}).filter((k) => k !== "emails");
    } else {
      allowed = ["id", ...R.FIELDS[coll]];
      let q = C.db().collection(coll);
      const eq = where.find(([f, op, v]) => op === "==" && R.FIELDS[coll].includes(f) && !f.includes(".") && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"));
      if (eq) q = q.where(eq[0], "==", eq[2]);
      docs = (await ctx.query(q.limit(5000))).map((d) => R.pick(coll, d.id, d));
    }
    const bad = [...where.map((w) => w[0].split(".")[0]), ...(a.select || []), ...(a.groupBy || []), a.orderBy?.field, ...(a.aggregate || []).map((m) => m.field)].filter((f) => f && !allowed.includes(f) && !(coll === "searchCompanies" && IX.GROUPABLE.includes(f)));
    if (bad.length) return { error: `These fields can't be used here: ${[...new Set(bad)].join(", ")}. Available: ${allowed.join(", ")}.` };
    let hits = docs.filter((d) => where.every((w) => test(d, w)));
    if (a.groupBy?.length || a.aggregate?.length) {
      const groups = coll === "searchCompanies" ? IX.aggregate(hits, a.groupBy || [], a.aggregate || []) : groupDocs(hits, a.groupBy || [], a.aggregate || []);
      return C.fit({ total: hits.length, groupCount: groups.length, rows: groups.slice(0, 500) });
    }
    if (a.orderBy?.field) {
      const f = a.orderBy.field, dir = a.orderBy.dir === "asc" ? 1 : -1;
      hits = hits.slice().sort((x, y) => { const p = asComparable(x[f]), q = asComparable(y[f]); if (p == null) return 1; if (q == null) return -1; return dir * (p < q ? -1 : p > q ? 1 : 0); });
    }
    const off = Math.max(0, C.dec(a.cursor)?.o || 0);
    const pick = (d) => (a.select?.length ? Object.fromEntries(["id", ...a.select].filter((f) => f in d).map((f) => [f, d[f]])) : d);
    const rows = hits.slice(off, off + size).map((d) => { const o = pick(d); if (coll === "searchCompanies") delete o.emails; return o; });
    // Text from outside in query results is labelled like elsewhere.
    for (const o of rows) for (const f of ["content", "snippet", "closedNotes"]) if (typeof o[f] === "string" && o[f] && (coll === "searchActivities" ? ["email", "email_received"].includes(o.type) : coll === "outreachMessages")) o[f] = R.untrusted(o[f], `${a.collection} ${o.id}`);
    return C.fit({ total: hits.length, readLimitReached: coll !== "searchCompanies" && docs.length >= 5000 ? true : undefined, rows, nextCursor: off + size < hits.length ? C.enc({ o: off + size }) : null });
  },
};
function groupDocs(list, groupBy, metrics) {
  const ms = metrics.length ? metrics : [{ op: "count" }];
  const groups = new Map();
  for (const d of list) {
    const key = groupBy.map((g) => { const v = d[g]; return v == null || v === "" ? "unknown" : typeof v === "object" ? JSON.stringify(v) : String(v); });
    const k = JSON.stringify(key);
    if (!groups.has(k)) groups.set(k, { key, n: 0, acc: ms.map(() => ({ s: 0, n: 0, min: null, max: null })) });
    const g = groups.get(k); g.n++;
    ms.forEach((m, i) => { const v = Number(d[m.field]); if (!m.field || !Number.isFinite(v)) return; const a = g.acc[i]; a.s += v; a.n++; a.min = a.min == null ? v : Math.min(a.min, v); a.max = a.max == null ? v : Math.max(a.max, v); });
  }
  return [...groups.values()].map((g) => {
    const row = Object.fromEntries(groupBy.map((f, i) => [f, g.key[i]]));
    row.count = g.n;
    ms.forEach((m, i) => { if (m.op === "count") return; const a = g.acc[i]; row[`${m.op}_${m.field}`] = m.op === "sum" ? a.s : m.op === "avg" ? (a.n ? a.s / a.n : null) : m.op === "min" ? a.min : a.max; });
    return row;
  }).sort((x, y) => y.count - x.count);
}

module.exports = { tools: [query], test };
