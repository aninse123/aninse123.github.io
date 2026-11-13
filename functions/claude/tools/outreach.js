// Claude connector — Outreach tools: campaigns, results, conversations, one email, tasks.

const { z } = require("zod");
const C = require("./common");
const R = require("../redact");
const U = require("../util");

const NOT_SENT = ["draft", "approved", "approving", "cancelled", "returned", "draftSent", "queued", "failed"];
const POSITIVE = ["interested", "callback_later", "referred"];
const MEETING_TYPES = ["meeting_scheduled", "meeting_done", "in_person"];
const okId = (s) => /^(?!__)[A-Za-z0-9_-]{1,200}$/.test(String(s || "")); // __x__ ids are reserved by Firestore

const listCampaigns = {
  name: "list_campaigns", perm: "out.view",
  description: "Outreach campaigns: name, status, audience, steps (channel, wait, template), paths and totals. Test campaigns are marked.",
  schema: { status: z.array(z.string()).optional().describe("draft, active, paused, completed…"), text: z.string().optional(), includeSteps: z.boolean().optional() },
  async run(ctx, a) {
    const list = await ctx.query(C.db().collection("outreachCampaigns").limit(500));
    const t = String(a.text || "").toLowerCase();
    const rows = list.filter((c) => (!a.status?.length || a.status.includes(c.status)) && (!t || String(c.name || "").toLowerCase().includes(t)))
      .map((c) => {
        const o = R.pick("outreachCampaigns", c.id, c, a.includeSteps === false ? ["name", "description", "status", "priority", "assignee", "audienceType", "stats", "isTest", "createdAt"] : null);
        if (Array.isArray(o.steps)) o.steps = o.steps.map((s) => ({ id: s.id, order: s.order, pathId: s.pathId || null, channel: s.channel, name: s.name, wait: s.wait, approval: s.approval, templateId: s.templateId || null, instructions: s.instructions || null }));
        if (Array.isArray(o.paths)) o.paths = o.paths.map((p) => ({ id: p.id, name: p.name, filter: p.filter || p.spec || null }));
        return o;
      });
    rows.sort((x, y) => String(y.createdAt || "").localeCompare(String(x.createdAt || "")));
    return C.fit({ total: rows.length, rows });
  },
};

const campaignResults = {
  name: "campaign_results", perm: "out.view",
  description: "Results of one campaign: companies enrolled and their status, and per step (or per path, or per owner) emails sent, opened, bounced, conversations replied, positive replies (interested, call back later, referred), meetings and tasks done.",
  schema: { campaignId: z.string(), by: z.enum(["step", "path", "owner"]).optional() },
  async run(ctx, a) {
    if (!okId(a.campaignId)) return { error: "Give a campaign id (from list_campaigns)." };
    const camp = await ctx.doc(`outreachCampaigns/${a.campaignId}`);
    if (!camp) return { error: "No campaign with that id." };
    const by = a.by || "step";
    const [ens, msgs, threads, tasks, acts] = await Promise.all([
      ctx.query(C.db().collection("outreachEnrolments").where("campaignId", "==", a.campaignId).limit(5000)),
      ctx.query(C.db().collection("outreachMessages").where("campaignId", "==", a.campaignId).limit(10000)),
      ctx.query(C.db().collection("outreachThreads").where("campaignId", "==", a.campaignId).limit(5000)),
      ctx.query(C.db().collection("outreachTasks").where("campaignId", "==", a.campaignId).limit(5000)),
      ctx.query(C.db().collection("searchActivities").where("campaignId", "==", a.campaignId).limit(5000)),
    ]);
    const steps = new Map((camp.steps || []).map((s) => [s.id, s]));
    const enById = new Map(ens.map((e) => [e.id, e]));
    const enOf = (o) => enById.get(o.enrolmentId) || enById.get(`${a.campaignId}_${o.companyId}`);
    const keyOf = (o) => {
      if (by === "path") return o.pathId || enOf(o)?.plannedPathId || "default";
      if (by === "owner") return o.owner || enOf(o)?.owner || "unknown";
      return o.stepId || "unknown";
    };
    const groups = {};
    const g = (k) => (groups[k] = groups[k] || { sent: 0, opened: 0, bounced: 0, replied: 0, positive: 0, meetings: 0, tasksDone: 0, tasksOpen: 0 });
    const outByThread = {};
    for (const m of msgs) {
      if (m.isTest || m.direction !== "out" || NOT_SENT.includes(m.status)) continue;
      const r = g(keyOf(m));
      r.sent++;
      if (m.firstOpenedAt || (m.events || []).some((e) => e.type === "opened")) r.opened++;
      if (m.status === "bounced" || (m.events || []).some((e) => e.type === "bounced")) r.bounced++;
      (outByThread[m.threadId] = outByThread[m.threadId] || []).push(m);
    }
    for (const t of threads) {
      if (t.isTest || !t.repliedAt) continue;
      // The reply counts for the last email sent before it.
      const outs = (outByThread[t.id] || []).filter((m) => (U.ms(m.createdAt) || 0) <= (U.ms(t.repliedAt) || 0)).sort((x, y) => (U.ms(y.createdAt) || 0) - (U.ms(x.createdAt) || 0));
      const k = by === "step" ? (outs[0]?.stepId || "unknown") : keyOf({ ...t, stepId: outs[0]?.stepId });
      g(k).replied++;
      if (POSITIVE.includes(t.responseCategory)) g(k).positive++;
    }
    // Meetings: tagged with the campaign, or held by an enrolled company after it was enrolled.
    const seen = new Set(acts.map((x) => x.id));
    const ids = ens.map((e) => e.companyId).filter(okId);
    for (let i = 0; i < ids.length; i += 30) {
      const more = await ctx.query(C.db().collection("searchActivities").where("companyId", "in", ids.slice(i, i + 30)).limit(2000));
      for (const x of more) {
        const en = enById.get(`${a.campaignId}_${x.companyId}`);
        if (!seen.has(x.id) && MEETING_TYPES.includes(x.type) && (U.ms(x.date) || 0) >= (U.ms(en?.enrolledAt) || 0)) { seen.add(x.id); acts.push({ ...x, stepId: "after the campaign started" }); }
      }
    }
    for (const x of acts) if (!x.isTest && MEETING_TYPES.includes(x.type) && (x.campaignId === a.campaignId || x.stepId === "after the campaign started")) g(by === "step" ? (x.stepId || "unknown") : keyOf(x)).meetings++;
    for (const t of tasks) { const r = g(keyOf(t)); if (t.status === "done" || t.completedAt) r.tasksDone++; else r.tasksOpen++; }
    const rows = Object.entries(groups).map(([k, v]) => ({ [by]: k, ...(by === "step" && steps.get(k) ? { stepName: steps.get(k).name, channel: steps.get(k).channel, order: steps.get(k).order, pathId: steps.get(k).pathId || null } : {}), ...v }));
    rows.sort((x, y) => (x.order ?? 99) - (y.order ?? 99));
    const status = {};
    ens.forEach((e) => { status[e.status || "unknown"] = (status[e.status || "unknown"] || 0) + 1; });
    const cat = {};
    threads.filter((t) => !t.isTest && t.responseCategory).forEach((t) => { cat[t.responseCategory] = (cat[t.responseCategory] || 0) + 1; });
    return C.fit({ campaign: { id: a.campaignId, name: camp.name, status: camp.status, isTest: !!camp.isTest }, enrolled: ens.length, enrolmentsByStatus: status, repliesByCategory: cat, positiveMeans: POSITIVE, rows });
  },
};

function threadOut(t) {
  const o = R.pick("outreachThreads", t.id, t);
  if (t.lastSnippet || t.snippet) o.lastSnippet = R.untrusted(t.lastSnippet || t.snippet, `email conversation with ${t.contactEmail || t.companyName || "a contact"}`);
  return o;
}
const getConversations = {
  name: "get_conversations", perm: "out.view",
  description: "Email conversations (Outreach inbox and sent) by company, contact email, campaign or date: subject, status, who wrote last, reply classification, and a short snippet of each email (labelled as outside content). Open one email in full with get_message.",
  schema: { companyId: z.string().optional(), email: z.string().optional(), campaignId: z.string().optional(), from: z.string().optional(), to: z.string().optional(), status: z.array(z.string()).optional(), withMessages: z.boolean().optional().describe("Also list each conversation's emails (summary lines)"), pageSize: z.number().int().optional(), cursor: z.string().optional() },
  async run(ctx, a) {
    const size = Math.min(C.pageSize(ctx, a.pageSize), a.withMessages ? 20 : 100);
    let q = C.db().collection("outreachThreads");
    if (a.companyId) q = q.where("companyId", "==", String(a.companyId));
    else if (a.email) q = q.where("contactEmail", "==", String(a.email).trim().toLowerCase());
    else if (a.campaignId) q = q.where("campaignId", "==", String(a.campaignId));
    let list = await ctx.query((a.companyId || a.email || a.campaignId) ? q.limit(1000) : q.orderBy("lastMessageAt", "desc").limit(1000));
    const from = C.toMs(a.from), to = C.toMs(a.to);
    list = list.filter((t) => (from == null || (U.ms(t.lastMessageAt) || 0) >= from) && (to == null || (U.ms(t.lastMessageAt) || 0) < to) && (!a.status?.length || a.status.includes(t.status)));
    list.sort((x, y) => (U.ms(y.lastMessageAt) || 0) - (U.ms(x.lastMessageAt) || 0));
    const off = Math.max(0, C.dec(a.cursor)?.o || 0);
    const page = list.slice(off, off + size);
    const rows = [];
    for (const t of page) {
      const o = threadOut(t);
      if (a.withMessages) {
        const ms = await ctx.query(C.db().collection("outreachMessages").where("threadId", "==", t.id).limit(100));
        ms.sort((x, y) => (U.ms(x.createdAt) || 0) - (U.ms(y.createdAt) || 0));
        o.messages = ms.filter((m) => m.status !== "draft").map((m) => ({ messageId: m.id, direction: m.direction, from: m.from, to: m.to, subject: m.subject, status: m.status, at: C.iso(m.createdAt), attachments: (m.attachments || []).length, snippet: m.snippet ? R.untrusted(String(m.snippet).slice(0, 300), m.direction === "in" ? `email from ${m.from || "unknown"}` : "email sent by Douro (may quote outside text)") : null }));
      }
      rows.push(o);
    }
    return C.fit({ total: list.length, rows, nextCursor: off + size < list.length ? C.enc({ o: off + size }) : null });
  },
};

const getMessage = {
  name: "get_message", perm: "out.view",
  description: "One email in full, as plain text, labelled as outside content when it came from outside Douro, with its attachments (read them with read_file).",
  schema: { messageId: z.string() },
  async run(ctx, a) {
    if (!okId(a.messageId)) return { error: "Give a message id (from get_conversations with withMessages)." };
    const m = await ctx.doc(`outreachMessages/${a.messageId}`);
    if (!m) return { error: "No email with that id." };
    let text = m.text || "";
    if (!text && m.html) text = R.htmlToText(m.html);
    if (!text && m.htmlStoragePath) {
      try { const [buf] = await require("firebase-admin/storage").getStorage().bucket().file(m.htmlStoragePath).download(); text = R.htmlToText(buf.toString("utf8")); } catch (e) { text = m.snippet || ""; }
    }
    if (!text) text = m.draftBody || m.snippet || "";
    const out = R.pick("outreachMessages", a.messageId, m);
    // Sent emails are labelled too: replies quote the outside text below them.
    out.body = R.untrusted(text, m.direction === "in" ? `email from ${m.from || "unknown"}, ${C.iso(m.createdAt) || ""}` : `email sent by Douro (may quote outside text), ${C.iso(m.createdAt) || ""}`);
    out.attachments = (m.attachments || []).filter((x) => x && !x.inline).map((x, i) => ({ fileId: `att:${a.messageId}:${i}`, filename: x.filename, contentType: x.contentType, size: x.size, available: !!x.storagePath || !!x.fileId, skippedReason: x.skippedReason || null }));
    return C.fit(out, "none");
  },
};

const listTasks = {
  name: "list_tasks", perm: "out.view",
  description: "Outreach tasks (calls, LinkedIn, letters, visits, other): what, company, who, due date, status and outcome.",
  schema: { assignee: z.string().optional(), status: z.array(z.string()).optional().describe("Default: open tasks"), dueBefore: z.string().optional(), campaignId: z.string().optional(), companyId: z.string().optional(), pageSize: z.number().int().optional(), cursor: z.string().optional() },
  async run(ctx, a) {
    const size = C.pageSize(ctx, a.pageSize);
    let q = C.db().collection("outreachTasks");
    if (a.companyId) q = q.where("companyId", "==", String(a.companyId));
    else if (a.campaignId) q = q.where("campaignId", "==", String(a.campaignId));
    else if (a.assignee) q = q.where("assignee", "==", String(a.assignee));
    let list = await ctx.query(q.limit(3000));
    const due = C.toMs(a.dueBefore);
    const open = (t) => !t.completedAt && !["done", "cancelled", "skipped"].includes(t.status);
    list = list.filter((t) => (a.status?.length ? a.status.includes(t.status) : open(t)) && (!a.assignee || t.assignee === a.assignee) && (due == null || ((U.ms(t.dueAt) || 0) < due)));
    list.sort((x, y) => (U.ms(x.dueAt) || 0) - (U.ms(y.dueAt) || 0));
    const off = Math.max(0, C.dec(a.cursor)?.o || 0);
    const page = list.slice(off, off + size);
    const names = new Map();
    const cids = [...new Set(page.map((t) => t.companyId).filter(okId))];
    (await ctx.docs(cids.map((id) => `searchCompanies/${id}`))).forEach((c) => c && names.set(c.id, c.name));
    return C.fit({ total: list.length, rows: page.map((t) => ({ ...R.pick("outreachTasks", t.id, t), companyName: names.get(t.companyId) || null })), nextCursor: off + size < list.length ? C.enc({ o: off + size }) : null });
  },
};

module.exports = { tools: [listCampaigns, campaignResults, getConversations, getMessage, listTasks], POSITIVE };
