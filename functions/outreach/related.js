// Owner-aware outreach, Stage 3 (22 Oct 2026, switch "outreach.ownerAware"):
// the companies related to a company and what is happening with them, used by
// the owner panel (adding companies, the approval card), the "In conversation
// via X" lines, the "Group contacted via X" history and the weekly report.
//
// Related = a shared decision-maker, a parent or a subsidiary (a CRM
// company holding shares in the other), the same ultimate owner (ownGroupKey), or
// a same-email link confirmed by hand (sameEmailLinks, Stage 2). The add-on links
// never count. People in more than MAX_PERSON_LINKS companies (a bank, a big
// group's manager) are not followed: they relate everything to everything.
//
// Shared decision-maker (André, 22 Oct — D3): someone who ranks as an owner or a
// manager on the best-person ladder (recipients.rankPerson, 10 Oct): ultimate
// owner, majority shareholder (managing or not), sócio-gerente, any other current
// shareholder (any %), hired gerente / CEO / administrador, other managers. "Any
// other current role" doesn't count, nor auditors, fiscal, assembly or secretary
// roles: an auditor firm checks many unrelated companies. The same ladder orders
// the related companies and picks the suggested lead.
//
// Cost: the ownership summary fields (own*) skip companies with nothing related
// (most of them); the rest cost a few IN queries per 30 companies.

const { db } = require("./store");
const { emailNameOf } = require("./render");
const { rankPerson } = require("./recipients");

const EXCLUDED_ROLE = /fiscal|auditor|revisor|\bROC\b|statutory|assembl|secret[aá]ri|secretary|no specific function|sem fun[cç][aã]o/i;
const RELATED_MIN_RANK = 60; // "other managers" and above
// A person's level in one company (current data only; same as portal/owner-panel.js relatedRank).
function deciderRank(l) {
  if (!l || l.personEntityType === "entity") return 0;
  const roles = l.mgmtCurrent === true ? (l.mgmtRoles || []).filter((r) => !EXCLUDED_ROLE.test(r)) : [];
  const r = rankPerson({ ...l, shCurrent: l.shCurrent === true, mgmtCurrent: l.mgmtCurrent === true, mgmtRoles: roles });
  return l.shCurrent === true ? Math.max(r, 120) : r; // a current shareholder with no % given is still a shareholder
}
const isDecider = (l) => deciderRank(l) >= RELATED_MIN_RANK;
// The words for a level, for the suggested lead ("majority owner, manages").
function levelText(rank) {
  if (rank >= 200) return "ultimate owner";
  if (rank >= 180) return "majority owner, manages";
  if (rank >= 160) return "majority owner";
  if (rank >= 140) return "owner-manager";
  if (rank >= 120) return "shareholder";
  if (rank >= 100) return "gerente / CEO";
  if (rank >= 60) return "manager";
  return "";
}
const MAX_MENTION = 3;
const MAX_PERSON_LINKS = 40;
const MAX_GROUP = 25;
const MAX_RELATED = 12;
const IN = 30;
const DAY = 86400000;
const SAID_NO = ["not_interested", "excluded"];

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const ms = (t) => (t?.toMillis ? t.toMillis() : t ? new Date(t).getTime() : 0);
const pctTxt = (v) => (v == null ? "" : `${Math.round(Number(v) * 100) / 100}%`);

async function getCompanies(ids) {
  const out = new Map();
  for (const group of chunks([...new Set(ids)].filter(Boolean), 100)) {
    const snaps = await db().getAll(...group.map((id) => db().doc(`searchCompanies/${id}`)));
    snaps.forEach((s, i) => { if (s.exists) out.set(group[i], { id: group[i], ...s.data() }); });
  }
  return out;
}
async function linksWhereIn(field, values) {
  const out = [];
  for (const group of chunks([...new Set(values)].filter(Boolean), IN)) {
    const snap = await db().collection("searchPersonLinks").where(field, "in", group).get();
    snap.docs.forEach((d) => out.push({ id: d.id, ...d.data() }));
  }
  return out;
}
// A company worth looking at: the ownership tool says it has something related
// (or it hasn't been computed for it yet), or it has a confirmed same-email link.
function mayHaveRelated(c) {
  if (!c) return false;
  if ((c.sameEmailLinks || []).length) return true;
  if (c.ownGraphAt == null) return true;
  return (c.ownGroupSize || 0) > 1 || (c.ownSubs || 0) > 0 || (c.ownParents || 0) > 0 || (c.ownOwnerOther || 0) > 0;
}

// companyIds → Map(id → { related: [...], lead }) for every id (empty lists
// when nothing is related). opts.companies: already-read company docs (Map).
async function relatedFor(companyIds, opts = {}) {
  const ids = [...new Set(companyIds)].filter(Boolean);
  const base = opts.companies || await getCompanies(ids);
  const cand = ids.filter((id) => mayHaveRelated(base.get(id)));
  const rel = new Map(ids.map((id) => [id, new Map()])); // id → relatedId → { why: Set, rank, person }
  const selfTop = new Map(); // id → { rank, person } — the shared person's best level in this company
  const add = (id, other, why, rank = 0, person = "") => {
    if (!other || other === id) return;
    const m = rel.get(id); if (!m) return;
    if (!m.has(other)) m.set(other, { why: new Set(), rank: 0, person: "" });
    const x = m.get(other); x.why.add(why);
    if (rank > x.rank) { x.rank = rank; x.person = person; }
  };
  if (cand.length) {
    // Shared decision-makers, and parents (a CRM company among the shareholders).
    const own = await linksWhereIn("companyId", cand);
    const deciders = own.filter((l) => isDecider(l) && l.personEntityType !== "entity");
    for (const l of own) if (l.shCurrent === true && l.personEntityType === "entity" && l.personMatchedCompanyId) add(l.companyId, l.personMatchedCompanyId, `parent${l.shDirectPct != null ? " " + pctTxt(l.shDirectPct) : ""}`);
    const personIds = [...new Set(deciders.map((l) => l.personId))];
    const theirs = await linksWhereIn("personId", personIds);
    const byPerson = new Map();
    for (const l of theirs) { if (!byPerson.has(l.personId)) byPerson.set(l.personId, []); byPerson.get(l.personId).push(l); }
    for (const d of deciders) {
      const all = (byPerson.get(d.personId) || []).filter(isDecider);
      if (all.length > MAX_PERSON_LINKS) continue;
      const role = (l) => [l.shCurrent === true && l.shDirectPct != null ? pctTxt(l.shDirectPct) : "", l.mgmtCurrent === true ? (l.mgmtRoles || []).filter((r) => !EXCLUDED_ROLE.test(r))[0] || "" : ""].filter(Boolean).join(", ");
      const others = all.filter((o) => o.companyId !== d.companyId);
      for (const o of others) add(d.companyId, o.companyId, `same owner: ${d.personName || "a person"}${role(o) ? ` (${role(o)} there)` : ""}`, deciderRank(o), d.personName || "");
      if (others.length) { const r = deciderRank(d), t = selfTop.get(d.companyId); if (!t || r > t.rank) selfTop.set(d.companyId, { rank: r, person: d.personName || "" }); }
    }
    // Subsidiaries: links where one of these companies is the shareholder.
    for (const l of await linksWhereIn("personMatchedCompanyId", cand)) if (l.shCurrent === true) add(l.personMatchedCompanyId, l.companyId, `subsidiary${l.shDirectPct != null ? " " + pctTxt(l.shDirectPct) : ""}`);
    // Same ultimate owner.
    const keys = new Map();
    for (const id of cand) { const c = base.get(id); if (c?.ownGroupKey && (c.ownGroupSize || 0) > 1) keys.set(c.ownGroupKey, [...(keys.get(c.ownGroupKey) || []), id]); }
    for (const [k, members] of keys) {
      const snap = await db().collection("searchCompanies").where("ownGroupKey", "==", k).limit(MAX_GROUP).get();
      for (const d of snap.docs) for (const id of members) add(id, d.id, "same group");
    }
    // Confirmed same email (Stage 2).
    for (const id of cand) for (const x of base.get(id)?.sameEmailLinks || []) add(id, x.companyId, "same email (confirmed)");
  }
  const otherIds = [...new Set([...rel.values()].flatMap((m) => [...m.keys()]))];
  const others = await getCompanies(otherIds.filter((id) => !base.has(id)));
  for (const [id, c] of base) others.set(id, c);
  // Said no: a conversation marked "not interested" or "unsubscribe / exclude".
  const saidNo = new Set();
  for (const group of chunks(otherIds, IN)) {
    const snap = await db().collection("outreachThreads").where("companyId", "in", group).get();
    snap.docs.forEach((d) => { const t = d.data(); if (SAID_NO.includes(t.responseCategory) && !t.isTest) saidNo.add(t.companyId); });
  }
  const out = new Map();
  for (const id of ids) {
    const list = [...rel.get(id)].map(([oid, x]) => {
      const o = others.get(oid), why = x.why;
      if (!o) return null;
      return {
        companyId: oid, name: o.name || "", emailName: emailNameOf(o), why: [...why], rank: x.rank, person: x.person,
        cae: o.caeCode || null, revenue: o.computedRevenue ?? null, stage: o.stage || null,
        campaignId: o.activeCampaignId || null, campaignName: o.activeCampaignName || null,
        lastOutreachAt: ms(o.lastOutreachAt) || null, lastReplyAt: ms(o.lastReplyAt) || null,
        saidNo: saidNo.has(oid) || o.outreachStatus === "unsubscribed", doNotContact: !!o.doNotContact?.on,
        contactable: o.contactable !== false, email: o.companyEmail || null,
        parent: [...why].some((w) => w.startsWith("parent")), // it holds shares in this company
      };
    }).filter(Boolean)
      .sort((a, b) => (Number(b.parent) - Number(a.parent)) || (b.rank - a.rank) || ((b.revenue || 0) - (a.revenue || 0)))
      .slice(0, MAX_RELATED);
    out.set(id, { related: list, lead: leadOf(base.get(id), list, selfTop.get(id)) });
  }
  return out;
}
// The suggested lead company of a group (D3, 22 Oct): the parent (a related
// company that holds this one); else the company where the shared person ranks
// highest on the best-person ladder (a company they own and manage before one
// they only manage); then the largest by revenue — with an email, maybe this one.
function leadOf(self, list, selfTop = null) {
  if (!list.length) return null;
  const holders = list.filter((r) => r.why.some((w) => w.startsWith("parent")));
  if (holders.length) return { companyId: holders[0].companyId, name: holders[0].name, why: "parent" };
  const pool = [{ companyId: self?.id, name: self?.name || "", revenue: self?.computedRevenue ?? null, email: self?.companyEmail, rank: selfTop?.rank || 0, person: selfTop?.person || "" }, ...list].filter((x) => x.email);
  const top = pool.sort((a, b) => ((b.rank || 0) - (a.rank || 0)) || ((b.revenue || 0) - (a.revenue || 0)))[0];
  if (!top) return null;
  const levels = new Set(pool.map((x) => Math.floor((x.rank || 0) / 20)));
  return top.rank && levels.size > 1 ? { companyId: top.companyId, name: top.name, why: "owner", person: top.person, level: levelText(top.rank) } : { companyId: top.companyId, name: top.name, why: "largest" };
}

// The flags for a company about to be contacted, from its related companies:
// another campaign, contacted recently (group already contacted via X), in
// conversation, said no / do not contact, and related companies in the same batch.
function flagsFor(entry, { campaignId = null, windowDays = 30, batch = null, now = Date.now(), selfId = null } = {}) {
  const flags = [];
  const since = now - windowDays * DAY;
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  for (const r of entry?.related || []) {
    if (r.doNotContact || r.saidNo) flags.push({ kind: "said_no", companyId: r.companyId, text: `${r.name}: ${r.doNotContact ? "do not contact" : "said no"}` });
    if (r.lastReplyAt) flags.push({ kind: "in_conversation", companyId: r.companyId, text: `in conversation via ${r.name} (reply ${day(r.lastReplyAt)})` });
    else if (r.lastOutreachAt && r.lastOutreachAt >= since) flags.push({ kind: "group_contacted", companyId: r.companyId, text: `group contacted via ${r.name} (${day(r.lastOutreachAt)})` });
    if (r.campaignId && r.campaignId !== campaignId) flags.push({ kind: "other_campaign", companyId: r.companyId, text: `${r.name} is in campaign "${r.campaignName || "another campaign"}"` });
    if (batch && batch.has(r.companyId) && r.companyId !== selfId) flags.push({ kind: "same_batch", companyId: r.companyId, text: `${r.name} is being added too` });
  }
  return flags;
}
// Default choice in the add panel (André's 19 Oct defaults): Skip for now when a
// related company said no or is "do not contact", else Proceed.
const defaultChoice = (flags) => (flags.some((f) => f.kind === "said_no") ? "skip" : "proceed");

// The companies chosen by hand to be mentioned (D5, 22 Oct: "I should select
// from the related ones"): only related ones, at most MAX_MENTION, by their email name.
function mentionPicked(entry, pickedIds) {
  const want = new Set((Array.isArray(pickedIds) ? pickedIds : []).map(String));
  return (entry?.related || []).filter((r) => want.has(r.companyId)).slice(0, MAX_MENTION).map((r) => ({ companyId: r.companyId, name: r.emailName || r.name }));
}
// The suggested companies to mention (marked "suggested" in the panel, never
// ticked for you): the related ones the conversation can lean on (in
// conversation, contacted, in a campaign), else the parent; at most two.
function mentionFrom(entry, flags) {
  const pick = new Set(flags.filter((f) => ["in_conversation", "group_contacted", "other_campaign"].includes(f.kind)).map((f) => f.companyId));
  let list = (entry?.related || []).filter((r) => pick.has(r.companyId));
  if (!list.length) list = (entry?.related || []).filter((r) => r.why.some((w) => w.startsWith("parent")));
  return list.slice(0, 2).map((r) => ({ companyId: r.companyId, name: r.emailName || r.name }));
}

module.exports = { relatedFor, flagsFor, defaultChoice, mentionFrom, mentionPicked, leadOf, isDecider, deciderRank, levelText, mayHaveRelated, MAX_PERSON_LINKS, MAX_MENTION, SAID_NO };
