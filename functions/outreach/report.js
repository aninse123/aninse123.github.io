// Owner-aware outreach, Stage 5 (22 Oct 2026, switch "outreach.ownerAware"): the
// Monday report. The scheduler's first run on a Monday (Lisbon, from 08:00)
// writes last week's report to outreachReports/{monday} and emails it to the
// partners (Settings → General "Email the Monday report", on by default). Once a
// week: the document is the marker. Shown in Outreach → Metrics.
//
// Part 1, the week overall: emails sent (by campaign and sender), delivered and
// bounced, replies and their categories, unsubscribes, meetings booked, tasks
// done (calls, LinkedIn…), companies started and companies held (one inbox).
// Part 2, by owner: owners / groups in two or more running campaigns, companies of
// the same owner in running campaigns, open flags on drafts, companies held now.
// Test traffic is left out (onlyTest: the switch is on Test — then only test
// campaigns are counted, so the report can be tried on staging).
// Part 3 (D1, 22 Oct; switch search.sameEmail): new possible same-email links —
// company addresses that arrived or changed last week (an Orbis upload, an edit)
// and are also another company's address, when Orbis doesn't relate the two and
// nobody confirmed or dismissed it yet. Same check as the company's Ownership tab.
// Paths round 2 (R5 / D11, 27 Oct): under each campaign with paths, the emails
// sent and the replies split by path ("High fit 12 · Middle 5 · 3 respostas
// (High fit 2)") — from the path stored on each email and conversation (R1).

const { logger } = require("firebase-functions");
const { db, FieldValue, Timestamp } = require("./store");
const { lisbonParts, lisbonAt } = require("./schedule_util");
const resend = require("./resend");
const { RESEND_READ_KEY, relationshipSenders, orgName } = require("./config");
const Related = require("./related");
const Feat = require("../features"); // feature switches (Team & access → Features)

const DAY = 86400000;
const NOT_SENT = ["draft", "approved", "approving", "cancelled", "returned", "draftSent", "queued", "failed"];
const LIVE = ["pending", "active", "awaiting_approval", "awaiting_task", "paused"];
// 13 Nov (outreach.callResults): + Awaiting reply (the CRM's wait_for_response) — counts as a reply, not as positive.
const CATS = { interested: "Interested", wait_for_response: "Awaiting reply", callback_later: "Call back later", not_now: "Not now", not_interested: "Not interested", referred: "Referred", wrong_contact: "Wrong contact", excluded: "Unsubscribe / exclude" };
const ms = (t) => (t?.toMillis ? t.toMillis() : t ? new Date(t).getTime() : 0);
const inc = (o, k, n = 1) => { o[k || "—"] = (o[k || "—"] || 0) + n; };

// The Monday that starts the week of `now` (Lisbon), as "YYYY-MM-DD" and as an instant.
function weekStart(now) {
  const p = lisbonParts(now);
  const back = (p.weekday + 6) % 7; // Monday = 0 days back
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d) - back * DAY);
  const key = d.toISOString().slice(0, 10);
  return { key, at: lisbonAt(key, "00:00") };
}

// Pure: the report from the week's documents (tested on synthetic data).
// How a company first answered: the earliest of an email (repliedAt) and a call / visit / message logged by hand (otherReplyAt + channel).
const REPLY_CHANNEL = { email: "email", call: "chamada", visit: "visita", linkedin: "LinkedIn", whatsapp: "WhatsApp", letter: "carta", other: "outro" };
function replyChannelOf(list) {
  const c = [];
  for (const t of list) { if (t.repliedAt) c.push([ms(t.repliedAt), "email"]); if (t.otherReplyAt) c.push([ms(t.otherReplyAt), t.otherReplyChannel || "other"]); }
  c.sort((a, b) => a[0] - b[0]);
  return REPLY_CHANNEL[c[0]?.[1]] || "classificada";
}

function buildWeeklyReport({ from, to, messages = [], threads = [], suppressions = [], activities = [], tasks = [], enrolments = [], liveEnrolments = [], companies = new Map(), drafts = [], campaigns = new Map(), onlyTest = false, sameEmail = null, companyCounts = false }) {
  const inWeek = (t) => { const x = ms(t); return x >= from && x < to; };
  const keep = (x) => (onlyTest ? !!x.isTest : !x.isTest);
  const sent = messages.filter((m) => m.direction === "out" && keep(m) && inWeek(m.createdAt) && !NOT_SENT.includes(m.status) && m.via !== "gmail");
  const week = { sent: sent.length, byCampaign: {}, byCampaignPath: {}, bySender: {}, delivered: 0, bounced: 0, replies: 0, repliesByChannel: {}, byCategory: {}, unsubscribes: 0, meetings: 0, meetingsHeld: 0, tasksDone: 0, tasksByChannel: {}, started: 0, held: 0 };
  for (const m of sent) {
    inc(week.byCampaign, m.campaignId ? (campaigns.get(m.campaignId)?.name || "Campaign") : "Written by hand");
    if (m.campaignId && m.pathName) inc(((week.byCampaignPath[campaigns.get(m.campaignId)?.name || "Campaign"] ||= { sent: {}, replies: {} }).sent), m.pathName);
    inc(week.bySender, m.senderId || "—");
    if (["delivered", "complained", "opened", "clicked"].includes(m.status)) week.delivered++;
    if (m.status === "bounced") week.bounced++;
  }
  if (companyCounts) {
    // 3 Nov (outreach.companyCounts): one reply per company — an email, or an answer by phone / in person (otherReplyAt) — with the
    // company's most positive classification.
    const POS = ["interested", "callback_later", "referred"], groups = new Map();
    for (const t of threads.filter((x) => keep(x) && (inWeek(x.repliedAt) || inWeek(x.otherReplyAt)))) {
      const k = t.companyId || t.id;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    for (const list of groups.values()) {
      const t = list.find((x) => POS.includes(x.responseCategory)) || list.find((x) => x.responseCategory) || list[0];
      week.replies++; inc(week.byCategory, CATS[t.responseCategory] || (t.responseCategory ? t.responseCategory : "Not classified"));
      inc(week.repliesByChannel, replyChannelOf(list));
      if (t.campaignId && t.pathName) inc(((week.byCampaignPath[campaigns.get(t.campaignId)?.name || "Campaign"] ||= { sent: {}, replies: {} }).replies), t.pathName);
    }
  } else for (const t of threads.filter((x) => keep(x) && inWeek(x.repliedAt))) {
    week.replies++; inc(week.byCategory, CATS[t.responseCategory] || (t.responseCategory ? t.responseCategory : "Not classified"));
    if (t.campaignId && t.pathName) inc(((week.byCampaignPath[campaigns.get(t.campaignId)?.name || "Campaign"] ||= { sent: {}, replies: {} }).replies), t.pathName);
  }
  week.unsubscribes = suppressions.filter((s) => inWeek(s.at) && (s.source === "unsubscribe" || s.reason === "unsubscribe" || /unsub/i.test(s.reason || ""))).length
    + threads.filter((t) => keep(t) && inWeek(t.unsubscribedAt)).length;
  for (const a of activities.filter((x) => inWeek(x.createdAt) && keep(x))) {
    if (a.type === "meeting_scheduled") week.meetings++;
    if (a.type === "meeting_done") week.meetingsHeld++;
    if (a.type === "outreach_hold") week.held++;
  }
  for (const t of tasks.filter((x) => x.status === "done" && inWeek(x.completedAt) && keep(x))) { week.tasksDone++; inc(week.tasksByChannel, t.channel); }
  week.started = enrolments.filter((e) => keep(e) && inWeek(e.startedAt) && !(companyCounts && e.isExtra)).length; // 3 Nov: a company's extra addresses are not new companies

  // Part 2 — by owner (the ultimate owner's group key; a company with none is its own owner).
  const live = liveEnrolments.filter((e) => keep(e) && LIVE.includes(e.status) && e.companyId);
  const ownerKey = (id) => companies.get(id)?.ownGroupKey || `co:${id}`;
  const byOwner = new Map();
  for (const e of live) {
    const k = ownerKey(e.companyId);
    if (!byOwner.has(k)) byOwner.set(k, { key: k, companies: new Map(), campaigns: new Map() });
    const o = byOwner.get(k);
    o.companies.set(e.companyId, e.companyName || companies.get(e.companyId)?.name || "");
    o.campaigns.set(e.campaignId, e.campaignName || campaigns.get(e.campaignId)?.name || "");
  }
  const multiCampaign = [...byOwner.values()].filter((o) => o.campaigns.size >= 2 && !o.key.startsWith("co:"))
    .map((o) => ({ owner: companies.get([...o.companies.keys()][0])?.ownershipMeta?.guoName || o.key, companies: [...o.companies.values()], campaigns: [...o.campaigns.values()] }));
  const sameOwner = [...byOwner.values()].filter((o) => o.companies.size >= 2 && !o.key.startsWith("co:"))
    .map((o) => ({ owner: companies.get([...o.companies.keys()][0])?.ownershipMeta?.guoName || o.key, companies: [...o.companies.values()] }));
  // Confirmed same-email links among running companies.
  const liveIds = new Set(live.map((e) => e.companyId));
  const emailLinks = [];
  for (const id of liveIds) for (const x of companies.get(id)?.sameEmailLinks || []) if (liveIds.has(x.companyId) && id < x.companyId) emailLinks.push([companies.get(id)?.name || id, companies.get(x.companyId)?.name || x.companyId]);
  // Manual links (10 Nov, switch search.manualLinks) between running companies, with the note.
  const manualLinks = [];
  for (const id of liveIds) for (const x of companies.get(id)?.manualLinks || []) if (liveIds.has(x.companyId) && id < x.companyId) manualLinks.push([companies.get(id)?.name || id, companies.get(x.companyId)?.name || x.companyId, String(x.note || "")]);
  const openFlags = drafts.filter((d) => keep(d) && d.status === "draft" && (d.ownerPanel?.flags || []).length)
    .map((d) => ({ company: d.companyName || "", flags: d.ownerPanel.flags.map((f) => f.text).slice(0, 3) }));
  const heldNow = live.filter((e) => e.holdKind === "same_inbox").map((e) => ({ company: e.companyName || "", until: e.holdReason?.until ? new Date(ms(e.holdReason.until)).toISOString().slice(0, 10) : null, email: e.holdReason?.email || null }));
  return { week, owners: { multiCampaign, sameOwner, emailLinks, manualLinks, openFlags, heldNow }, ...(sameEmail ? { sameEmail } : {}) };
}

// Part 3: { pairs: [{ a, b, aId, bId, email }], total, truncated } — see the header.
const SAME_EMAIL_CHANGED_CAP = 3000, SAME_EMAIL_GROUP_MAX = 10, SAME_EMAIL_LIST = 25;
async function newSameEmailPairs(from, to) {
  const snap = await db().collection("searchCompanies").where("updatedAt", ">=", Timestamp.fromMillis(from)).where("updatedAt", "<", Timestamp.fromMillis(to)).select("companyEmail").limit(SAME_EMAIL_CHANGED_CAP).get();
  const emails = [...new Set(snap.docs.map((d) => String(d.data().companyEmail || "").trim().toLowerCase()).filter((e) => e.includes("@")))];
  const byEmail = new Map();
  for (let i = 0; i < emails.length; i += 30) {
    const s = await db().collection("searchCompanies").where("companyEmail", "in", emails.slice(i, i + 30)).select("name", "companyEmail", "ownGroupKey", "sameEmailLinks", "sameEmailDismissed").get();
    s.docs.forEach((d) => { const e = d.data().companyEmail; if (!byEmail.has(e)) byEmail.set(e, []); byEmail.get(e).push({ id: d.id, ...d.data() }); });
  }
  const cand = [];
  for (const [email, list] of byEmail) {
    if (list.length < 2 || list.length > SAME_EMAIL_GROUP_MAX) continue; // a shared accountant's address is not a link
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.ownGroupKey && a.ownGroupKey === b.ownGroupKey) continue;
      if ((a.sameEmailLinks || []).some((x) => x.companyId === b.id) || (a.sameEmailDismissed || []).includes(b.id) || (b.sameEmailDismissed || []).includes(a.id)) continue;
      cand.push({ a: a.name || a.id, b: b.name || b.id, aId: a.id, bId: b.id, email });
    }
  }
  // Orbis already relates them (shared owner or manager, parent / subsidiary) → not a question.
  const ids = [...new Set(cand.slice(0, 200).flatMap((p) => [p.aId, p.bId]))];
  const rel = ids.length ? await Related.relatedFor(ids) : new Map();
  const related = (x, y) => (rel.get(x)?.related || []).some((r) => r.companyId === y && r.why.some((w) => !w.startsWith("same email")));
  const pairs = cand.slice(0, 200).filter((p) => !related(p.aId, p.bId));
  return { pairs: pairs.slice(0, SAME_EMAIL_LIST), total: pairs.length, truncated: snap.size >= SAME_EMAIL_CHANGED_CAP || cand.length > 200 };
}

function reportText(r, { weekKey, toKey }) {
  const w = r.week, o = r.owners;
  const list = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  · ${k}: ${n}`).join("\n") || "  · —";
  // R5: a campaign with paths gets its split by path on the next line.
  const byPath = (k) => { const p = (w.byCampaignPath || {})[k]; if (!p) return ""; const parts = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([n, x]) => `${n} ${x}`).join(" · "); const rep = Object.values(p.replies).reduce((a, b) => a + b, 0); return `\n      por caminho: ${parts(p.sent) || "—"}${rep ? ` · ${rep} resposta${rep === 1 ? "" : "s"} (${parts(p.replies)})` : ""}`; };
  const campaignList = Object.entries(w.byCampaign).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  · ${k}: ${n}${byPath(k)}`).join("\n") || "  · —";
  const lines = [
    `Relatório semanal de outreach — semana de ${weekKey} a ${toKey}`, "",
    "1. A semana", "",
    `Emails enviados: ${w.sent} (entregues ${w.delivered}, devolvidos ${w.bounced})`, "Por campanha:", campaignList, "Por endereço:", list(w.bySender), "",
    `Respostas: ${w.replies}`, ...(Object.keys(w.repliesByChannel || {}).length ? [`Por canal (a primeira resposta de cada empresa):`, list(w.repliesByChannel)] : []), list(w.byCategory), "",
    `Pedidos de remoção: ${w.unsubscribes}`, `Reuniões marcadas: ${w.meetings}`, `Reuniões realizadas: ${w.meetingsHeld || 0}`,
    `Tarefas feitas: ${w.tasksDone}`, list(w.tasksByChannel), "",
    `Empresas que começaram uma campanha: ${w.started}`, `Empresas em espera (mesmo endereço): ${w.held}`, "",
    "2. Por dono", "",
    `Donos / grupos em duas ou mais campanhas: ${o.multiCampaign.length}`, ...o.multiCampaign.map((x) => `  · ${x.owner}: ${x.companies.join(", ")} — ${x.campaigns.join(", ")}`), "",
    `Empresas do mesmo dono em campanhas a decorrer: ${o.sameOwner.length}`, ...o.sameOwner.map((x) => `  · ${x.owner}: ${x.companies.join(", ")}`), "",
    ...(o.emailLinks.length ? [`Ligadas pelo mesmo email (confirmado): ${o.emailLinks.length}`, ...o.emailLinks.map(([a, b]) => `  · ${a} ↔ ${b}`), ""] : []),
    ...((o.manualLinks || []).length ? [`Ligadas à mão (ligação manual): ${o.manualLinks.length}`, ...o.manualLinks.map(([a, b, n]) => `  · ${a} ↔ ${b}${n ? ` — ${n}` : ""}`), ""] : []),
    `Rascunhos por aprovar com empresas relacionadas: ${o.openFlags.length}`, ...o.openFlags.map((x) => `  · ${x.company}: ${x.flags.join("; ")}`), "",
    `Empresas em espera agora (mesmo endereço): ${o.heldNow.length}`, ...o.heldNow.map((x) => `  · ${x.company}${x.until ? ` até ${x.until}` : ""}${x.email ? ` (${x.email})` : ""}`), "",
    ...(r.sameEmail ? ["3. Possíveis ligações pelo mesmo email (novas esta semana)", "",
      `Empresas com o mesmo endereço de email que outra, sem ligação no Orbis: ${r.sameEmail.total}${r.sameEmail.truncated ? " (muitas empresas mudaram — ver o filtro)" : ""}`,
      ...r.sameEmail.pairs.map((p) => `  · ${p.a} ↔ ${p.b} (${p.email})`),
      ...(r.sameEmail.total > r.sameEmail.pairs.length ? [`  · … e mais ${r.sameEmail.total - r.sameEmail.pairs.length}`] : []),
      "Confirmar ou dispensar no separador Ownership da empresa; lista completa na Search CRM, filtro \"Possible same-email link\".", ""] : []),
    "Ver no portal: Outreach → Metrics.",
  ];
  return lines.join("\n");
}

async function docsInRange(coll, field, from, to, cap = 5000) {
  const snap = await db().collection(coll).where(field, ">=", Timestamp.fromMillis(from)).where(field, "<", Timestamp.fromMillis(to)).limit(cap).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// The scheduler calls this on every run; it does the work once a week.
async function maybeRunWeekly(now, settings, { onlyTest = false, force = false } = {}) {
  const p = lisbonParts(now);
  if (!force && (p.weekday !== 1 || p.hhmm < "08:00")) return null;
  const { key: thisMonday, at } = weekStart(now);
  const to = at.getTime(), from = to - 7 * DAY;
  const fromKey = new Date(from + 12 * 3600000).toISOString().slice(0, 10);
  const ref = db().doc(`outreachReports/${fromKey}`);
  // Done → nothing to do. Still "building" → another run is on it, unless that
  // was over 30 minutes ago (it failed half-way): then this run tries again.
  const ex = await ref.get();
  if (!force && ex.exists && (ex.data().status === "done" || ms(ex.data().createdAt) > now.getTime() - 30 * 60000)) return null;
  await ref.set({ status: "building", weekFrom: fromKey, weekTo: thisMonday, createdAt: FieldValue.serverTimestamp() }, { merge: true });
  const companyCounts = (await Feat.jobState("outreach.companyCounts")) !== "off"; // 3 Nov
  const [messages, threads, suppressions, activities, tasks, enrolments, liveSnap, draftSnap, campSnap] = await Promise.all([
    docsInRange("outreachMessages", "createdAt", from, to),
    docsInRange("outreachThreads", "repliedAt", from, to).then(async (a) => [...a, ...(await docsInRange("outreachThreads", "unsubscribedAt", from, to)), ...(companyCounts ? await docsInRange("outreachThreads", "otherReplyAt", from, to) : [])]),
    docsInRange("outreachSuppression", "at", from, to),
    docsInRange("searchActivities", "createdAt", from, to),
    docsInRange("outreachTasks", "completedAt", from, to),
    docsInRange("outreachEnrolments", "startedAt", from, to),
    db().collection("outreachEnrolments").where("status", "in", LIVE).get(),
    db().collection("outreachMessages").where("status", "==", "draft").limit(500).get(),
    db().collection("outreachCampaigns").get(),
  ]);
  const liveEnrolments = liveSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const ids = [...new Set(liveEnrolments.map((e) => e.companyId).filter(Boolean))];
  const companies = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const snaps = await db().getAll(...ids.slice(i, i + 100).map((id) => db().doc(`searchCompanies/${id}`)));
    snaps.forEach((s) => { if (s.exists) companies.set(s.id, s.data()); });
  }
  const campaigns = new Map(campSnap.docs.map((d) => [d.id, d.data()]));
  let sameEmail = null;
  if ((await Feat.jobState("search.sameEmail")) !== "off") { try { sameEmail = await newSameEmailPairs(from, to); } catch (e) { logger.warn("weekly report: same email", { message: e.message }); } }
  const seen = new Set();
  const r = buildWeeklyReport({ from, to, messages, threads: threads.filter((t) => (seen.has(t.id) ? false : seen.add(t.id))), suppressions, activities, tasks, enrolments, liveEnrolments, companies, drafts: draftSnap.docs.map((d) => d.data()), campaigns, companyCounts, onlyTest, sameEmail });
  const text = reportText(r, { weekKey: fromKey, toKey: new Date(to - 12 * 3600000).toISOString().slice(0, 10) });
  let emailed = [];
  if (settings?.weeklyReportEmail !== false) {
    const partners = relationshipSenders().filter((s) => s.owner).map((s) => s.email);
    const from = (relationshipSenders().find((s) => !s.owner) || {}).email;
    if (from && partners.length) try {
      await resend.sendEmail(RESEND_READ_KEY.value(), { from: `${orgName()} <${from}>`, to: partners, subject: `Outreach — semana de ${fromKey}${onlyTest ? " (teste)" : ""}`, text }, `weekly-report-${fromKey}${onlyTest ? "-test" : ""}`);
      emailed = partners;
    } catch (e) { logger.warn("weekly report email failed", { message: e.message }); }
  }
  await ref.set({ status: "done", weekFrom: fromKey, weekTo: thisMonday, onlyTest, ...r, text, emailedTo: emailed, doneAt: FieldValue.serverTimestamp() }, { merge: true });
  return { week: fromKey, emailed: emailed.length };
}

module.exports = { maybeRunWeekly, buildWeeklyReport, reportText, weekStart, newSameEmailPairs };
