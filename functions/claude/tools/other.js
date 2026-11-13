// Claude connector — Network, Investor CRM, investor portal documents, Budget.

const { z } = require("zod");
const C = require("./common");
const R = require("../redact");
const U = require("../util");

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const okId = (s) => /^(?!__)[A-Za-z0-9_-]{1,200}$/.test(String(s || "")); // __x__ ids are reserved by Firestore
const textHit = (t, ...vals) => !t || vals.some((v) => fold(typeof v === "string" ? v : JSON.stringify(v || "")).includes(fold(t)));

const findNetwork = {
  name: "find_network", perm: "net.view",
  description: "Douro's Network: contacts (advisers, brokers, bankers, lawyers…) and their firms, by text, category or firm, optionally with their activities.",
  schema: { text: z.string().optional(), category: z.string().optional(), firmId: z.string().optional(), withActivities: z.boolean().optional(), pageSize: z.number().int().optional(), cursor: z.string().optional() },
  async run(ctx, a) {
    const size = C.pageSize(ctx, a.pageSize);
    const [contacts, firms] = await Promise.all([ctx.query(C.db().collection("networkContacts").limit(3000)), ctx.query(C.db().collection("networkFirms").limit(2000))]);
    const firmName = new Map(firms.map((f) => [f.id, f.name]));
    const list = contacts.filter((c) => textHit(a.text, c.name, c.email, c.role, c.notes, c.howWeMet, firmName.get(c.firmId)) && (!a.category || (c.categories || []).some((x) => fold(x) === fold(a.category))) && (!a.firmId || c.firmId === a.firmId));
    list.sort((x, y) => String(x.name || "").localeCompare(String(y.name || "")));
    const off = Math.max(0, C.dec(a.cursor)?.o || 0);
    const page = list.slice(off, off + size);
    const rows = [];
    for (const c of page) {
      const o = { ...R.pick("networkContacts", c.id, c), firmName: firmName.get(c.firmId) || null };
      if (a.withActivities) {
        const acts = await ctx.query(C.db().collection("networkActivities").where("contactId", "==", c.id).limit(50));
        acts.sort((x, y) => (U.ms(y.date) || 0) - (U.ms(x.date) || 0));
        o.activities = acts.map((x) => R.pick("networkActivities", x.id, x));
      }
      rows.push(o);
    }
    const firmHits = a.text ? firms.filter((f) => textHit(a.text, f.name, f.notes)).slice(0, 20).map((f) => R.pick("networkFirms", f.id, f)) : undefined;
    return C.fit({ total: list.length, rows, firms: firmHits, nextCursor: off + size < list.length ? C.enc({ o: off + size }) : null });
  },
};

const findInvestors = {
  name: "find_investors", perm: "icrm.view",
  description: "Investor CRM: investors by text, stage or type, with contacts and commitments (soft, hard, wired: units and value).",
  schema: { text: z.string().optional(), stage: z.array(z.string()).optional(), type: z.array(z.string()).optional(), pageSize: z.number().int().optional(), cursor: z.string().optional() },
  async run(ctx, a) {
    const size = C.pageSize(ctx, a.pageSize);
    const all = await ctx.query(C.db().collection("crmInvestors").limit(3000));
    const list = all.filter((i) => textHit(a.text, i.name, i.contacts, i.notes, i.source) && (!a.stage?.length || a.stage.includes(i.stage)) && (!a.type?.length || a.type.includes(i.type)));
    list.sort((x, y) => String(x.name || "").localeCompare(String(y.name || "")));
    const off = Math.max(0, C.dec(a.cursor)?.o || 0);
    const sum = (k) => Math.round(list.reduce((s, i) => s + (Number(i[k]?.value) || 0), 0) * 100) / 100;
    return C.fit({ total: list.length, totals: { soft: sum("softCommitment"), hard: sum("hardCommitment"), wired: sum("wiredCommitment") }, rows: list.slice(off, off + size).map((i) => R.pick("crmInvestors", i.id, i)), nextCursor: off + size < list.length ? C.enc({ o: off + size }) : null });
  },
};
const getInvestor = {
  name: "get_investor", perm: "icrm.view",
  description: "One investor: details, contacts, commitments and all activities.",
  schema: { id: z.string() },
  async run(ctx, a) {
    if (!okId(a.id)) return { error: "Give an investor id (from find_investors)." };
    const i = await ctx.doc(`crmInvestors/${a.id}`);
    if (!i) return { error: "No investor with that id." };
    const acts = await ctx.query(C.db().collection("crmActivities").where("investorId", "==", a.id).limit(300));
    acts.sort((x, y) => (U.ms(y.date) || 0) - (U.ms(x.date) || 0));
    return C.fit({ investor: R.pick("crmInvestors", a.id, i), activities: acts.map((x) => R.pick("crmActivities", x.id, x)) }, "none");
  },
};

const listPortalDocuments = {
  name: "list_portal_documents", perm: "portal.admin",
  description: "Investor portal documents (updates, decks, reports): name, category, date, who can see them. Read one with read_file and its fileId.",
  schema: { category: z.string().optional() },
  async run(ctx, a) {
    const docs = await ctx.query(C.db().collection("documents").limit(500));
    const rows = docs.filter((d) => !a.category || fold(d.category) === fold(a.category)).map((d) => ({ fileId: `doc:${d.id}`, ...R.pick("documents", d.id, d) }));
    rows.sort((x, y) => String(y.addedAt || "").localeCompare(String(x.addedAt || "")));
    return C.fit({ total: rows.length, rows });
  },
};

// Budget items: amounts and categories; never bank lines, accounts, cards or receipt links.
async function budgetItems(ctx, a) {
  const from = C.toMs(a.from), to = C.toMs(a.to);
  const items = await ctx.query(C.db().collection("budgetItems").limit(5000));
  return items.filter((i) => {
    const d = U.ms(i.date) || C.toMs(i.date) || 0;
    return (from == null || d >= from) && (to == null || d < to) && (!a.category || i.categoryId === a.category) && (!a.kind || i.kind === a.kind)
      && (!a.companyId || (i.companyIds || []).includes(a.companyId) || (i.lines || []).some((l) => l?.companyId === a.companyId)) && textHit(a.text, i.name, i.counterparty, i.notes);
  });
}
const budgetSummary = {
  name: "budget_summary", perm: "budget.view",
  description: "Budget totals in a date range, grouped by month, category, kind or company.",
  schema: { from: z.string().optional(), to: z.string().optional(), groupBy: z.enum(["month", "category", "kind", "company"]).optional() },
  async run(ctx, a) {
    const items = await budgetItems(ctx, a);
    const cats = (await ctx.query(C.db().collection("budgetCategories").limit(500)).catch(() => [])) || [];
    const catName = new Map(cats.map((c) => [c.id, c.name]));
    const by = a.groupBy || "month";
    const groups = {};
    for (const i of items) {
      const amount = Number(i.amount) || 0;
      const keys = by === "month" ? [new Date(U.ms(i.date) || C.toMs(i.date) || 0).toISOString().slice(0, 7)]
        : by === "category" ? [catName.get(i.categoryId) || i.categoryId || "none"] : by === "kind" ? [i.kind || "none"]
        : (i.companyIds && i.companyIds.length ? i.companyIds : ["none"]);
      for (const k of keys) { groups[k] = groups[k] || { total: 0, items: 0 }; groups[k].total += amount / keys.length; groups[k].items++; }
    }
    const rows = Object.entries(groups).map(([k, v]) => ({ [by]: k, total: Math.round(v.total * 100) / 100, items: v.items })).sort((x, y) => String(x[by]).localeCompare(String(y[by])));
    return C.fit({ items: items.length, total: Math.round(items.reduce((s, i) => s + (Number(i.amount) || 0), 0) * 100) / 100, rows });
  },
};
const findBudgetItems = {
  name: "find_budget_items", perm: "budget.view",
  description: "Budget items: name, supplier or counterparty, amount, date, category, kind, company and status. Never bank accounts, bank lines, cards or receipt links.",
  schema: { from: z.string().optional(), to: z.string().optional(), category: z.string().optional(), kind: z.string().optional(), companyId: z.string().optional(), text: z.string().optional(), pageSize: z.number().int().optional(), cursor: z.string().optional() },
  async run(ctx, a) {
    const size = C.pageSize(ctx, a.pageSize);
    const items = await budgetItems(ctx, a);
    items.sort((x, y) => (U.ms(y.date) || C.toMs(y.date) || 0) - (U.ms(x.date) || C.toMs(x.date) || 0));
    const off = Math.max(0, C.dec(a.cursor)?.o || 0);
    return C.fit({ total: items.length, rows: items.slice(off, off + size).map((i) => R.pick("budgetItems", i.id, i)), nextCursor: off + size < items.length ? C.enc({ o: off + size }) : null });
  },
};

module.exports = { tools: [findNetwork, findInvestors, getInvestor, listPortalDocuments, budgetSummary, findBudgetItems] };
