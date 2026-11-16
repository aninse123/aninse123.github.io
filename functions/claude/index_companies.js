// Claude connector — the compact company index (build plan B5).
//
// 39,000 companies are too many to read per question, and their documents are
// large. claudeJob builds once a night a compact row per company (about 30
// fields) and keeps it in Cloud Storage (claude/index/companies.json.gz), not
// the database. At each call, companies changed since the build (updatedAt,
// updatedByAt, lastTouchAt, createdAt) are read and overlaid, so answers are
// current. Counts, sums and groups read nothing from the database.

const zlib = require("zlib");
const { getStorage } = require("firebase-admin/storage");
const U = require("./util");
const { tierOf } = require("../outreach/campaign_util");

const PATH = "claude/index/companies.json.gz";
const SELECT = ["name", "nif", "domain", "emailKeys", "companyEmail", "contacts", "reach", "legalForm", "caeCode", "caeDescription", "naceCode", "sector", "subSector", "distrito", "concelho", "city", "nuts2", "country",
  "computedRevenue", "computedEBITDA", "computedEBITDAMargin", "computedEmployees", "computedGrowthRecent", "computedGrowthSustained", "computedFinYear", "fitScore",
  "priority", "targetTierManual", "contactable", "doNotContact", "stage", "owner", "outreachStatus", "touches", "lastTouchAt", "lastOutreachAt", "lastReplyAt",
  "activeCampaignId", "activeCampaignName", "ownGroupKey", "ownGroupSize", "yearFounded", "createdAt"];
// campaignChangedAt (16 Nov, Campaigns hub): joining or leaving a campaign; updatedAt is left alone there.
const CHANGE_FIELDS = ["updatedAt", "updatedByAt", "lastTouchAt", "createdAt", "campaignChangedAt"];
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const euros = (v) => (num(v) == null ? null : Math.round(v)); // money: whole euros
const ratio = (v) => (num(v) == null ? null : Math.round(v * 10000) / 10000);
// Order by document id (FieldPath.documentId(); the test stand-in has no FieldPath).
const DOC_ID = () => { const FP = require("firebase-admin/firestore").FieldPath; return FP && FP.documentId ? FP.documentId() : "__name__"; };

// Full email addresses of a company (15 Nov): its own (companyEmail, contacts, reach)
// and the full ones among emailKeys, which also holds its people's addresses
// (savePersonReach adds them). emailKeys are prefixes, so a full address is a key
// that is no other key's prefix. Kept in the index only, never returned.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
function fullEmails(c) {
  const own = [c.companyEmail, ...(Array.isArray(c.contacts) ? c.contacts.map((x) => x && x.email) : []), ...(Array.isArray(c.reach) ? c.reach.filter((x) => x && x.type === "email").map((x) => x.value) : [])];
  const keys = Array.isArray(c.emailKeys) ? [...new Set(c.emailKeys.map((e) => String(e || "").trim().toLowerCase()))] : [];
  const fromKeys = keys.filter((k) => !k.startsWith("@") && EMAIL_RE.test(k) && !keys.some((o) => o !== k && o.startsWith(k)));
  return [...new Set([...own.map((e) => String(e || "").trim().toLowerCase()), ...fromKeys].filter((e) => EMAIL_RE.test(e)))].slice(0, 40);
}

// One company document → one index row. Money in euros.
function rowOf(id, c, tierRules = []) {
  const touches = c.touches && typeof c.touches === "object" ? c.touches : {};
  const channels = Object.entries(touches).filter(([, t]) => t && t.n).map(([ch]) => ch).sort();
  const answered = Object.values(touches).some((t) => t && t.inAt);
  return {
    id, name: c.name || "", nif: c.nif || "", domain: String(c.domain || "").toLowerCase(),
    emails: fullEmails(c),
    legalForm: c.legalForm || "", cae: String(c.caeCode || ""), caeDescription: c.caeDescription || "", nace: String(c.naceCode || ""),
    sector: c.sector || "", subSector: c.subSector || "", district: c.distrito || "", concelho: c.concelho || "", city: c.city || "", nuts2: c.nuts2 || "", country: c.country || "",
    revenue: euros(c.computedRevenue), ebitda: euros(c.computedEBITDA), margin: ratio(c.computedEBITDAMargin), employees: num(c.computedEmployees),
    growth: ratio(c.computedGrowthRecent), growthSustained: ratio(c.computedGrowthSustained), finYear: c.computedFinYear || null, fit: num(c.fitScore) == null ? null : Math.round(c.fitScore * 10) / 10,
    tier: tierOf(c, tierRules) || null, contactable: c.contactable === false ? false : c.contactable === true ? true : null,
    doNotContact: !!(c.doNotContact && (c.doNotContact.on || c.doNotContact === true)), stage: c.stage || "universe", owner: c.owner || "",
    outreachStatus: c.outreachStatus || "none", contacted: channels.length > 0 || (c.outreachStatus && c.outreachStatus !== "none") || false, answered, channels,
    lastTouchAt: U.ms(c.lastTouchAt), lastOutreachAt: U.ms(c.lastOutreachAt), lastReplyAt: U.ms(c.lastReplyAt),
    campaignId: c.activeCampaignId || null, campaignName: c.activeCampaignName || null, groupKey: c.ownGroupKey || null, groupSize: num(c.ownGroupSize),
    yearFounded: num(c.yearFounded), createdAt: U.ms(c.createdAt),
  };
}

async function tierRules() {
  try { return (await U.db().doc("searchConfig/targetTiers").get()).data()?.rules || []; } catch (e) { return []; }
}

// The nightly build (16 Nov: changes only on most nights). A full build reads every
// company (~39k reads); most nights start from the stored index instead (a Storage
// file, no database reads) and re-read only the companies changed since it was
// built, plus a count to catch deleted ones. A full build runs when the stored
// index is missing or from an older format, on Sundays (Lisbon), when the last
// full build is a week old, when the tier rules changed, when too many companies
// changed, or when the count doesn't match. Returns { count, reads, mode, reason }.
const FORMAT = 2;              // bump when rowOf or SELECT change: forces a full build
const WEEK = 7 * 86400000;
const CHANGED_CAP = 5000;      // more changes than this: a full build is simpler
const MARGIN = 10 * 60000;     // clock margin on "changed since"
const isSundayLisbon = (ms) => new Date(ms).toLocaleDateString("en-GB", { timeZone: "Europe/Lisbon", weekday: "short" }) === "Sun";

async function readStored() {
  try {
    const [buf] = await getStorage().bucket().file(PATH).download();
    return JSON.parse(zlib.gunzipSync(buf).toString("utf8"));
  } catch (e) { return null; }
}
function fullReason(prev, now, rulesKey) {
  if (!prev || !Array.isArray(prev.rows)) return "no stored index";
  if (prev.format !== FORMAT || !prev.fullAt) return "older index format";
  if (isSundayLisbon(now)) return "weekly (Sunday)";
  if (now - prev.fullAt >= WEEK - 3600000) return "last full build a week ago";
  if (prev.rulesKey !== rulesKey) return "tier rules changed";
  return null;
}
async function fullRows(rules) {
  const rows = [];
  let last = null, reads = 0;
  for (;;) {
    let q = U.db().collection("searchCompanies").select(...SELECT).orderBy(DOC_ID()).limit(5000);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    reads += Math.max(1, snap.size);
    for (const d of snap.docs) rows.push(rowOf(d.id, d.data(), rules));
    if (snap.size < 5000) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return { rows, reads };
}
// Changes since the stored build, or { reason } when a full build is needed instead.
async function changedRows(prev, rules) {
  const since = new Date(prev.builtAt - MARGIN);
  const ids = new Set();
  let reads = 0;
  for (const f of CHANGE_FIELDS) {
    let snap;
    try { snap = await U.db().collection("searchCompanies").where(f, ">=", since).select("name").limit(CHANGED_CAP + 1).get(); } catch (e) { return { reason: `changes on ${f} can't be read`, reads }; }
    reads += Math.max(1, snap.size);
    if (snap.size > CHANGED_CAP) return { reason: `more than ${CHANGED_CAP} changes`, reads };
    snap.docs.forEach((d) => ids.add(d.id));
  }
  const map = new Map(prev.rows.map((r) => [r.id, r]));
  const list = [...ids];
  for (let i = 0; i < list.length; i += 100) {
    const snaps = await U.db().getAll(...list.slice(i, i + 100).map((id) => U.db().doc(`searchCompanies/${id}`)));
    reads += snaps.length;
    for (const s of snaps) { if (s.exists) map.set(s.id, rowOf(s.id, s.data(), rules)); else map.delete(s.id); }
  }
  let total;
  try { total = (await U.db().collection("searchCompanies").count().get()).data().count; } catch (e) { return { reason: "company count can't be read", reads }; }
  reads += Math.max(1, Math.ceil(total / 1000));
  if (total !== map.size) return { reason: `count ${total} ≠ index ${map.size} (deleted companies)`, reads };
  return { rows: [...map.values()], reads, changed: ids.size };
}
async function build({ now = Date.now(), full = false } = {}) {
  const rules = await tierRules();
  const rulesKey = JSON.stringify(rules);
  let reads = 1;
  const prev = full ? null : await readStored();
  let reason = full ? "asked for" : fullReason(prev, now, rulesKey);
  let rows = null, fullAt = now, changed = null;
  if (!reason) {
    const ch = await changedRows(prev, rules);
    reads += ch.reads;
    if (ch.reason) reason = ch.reason;
    else { rows = ch.rows; fullAt = prev.fullAt; changed = ch.changed; }
  }
  if (!rows) { const f = await fullRows(rules); rows = f.rows; reads += f.reads; }
  const body = zlib.gzipSync(Buffer.from(JSON.stringify({ format: FORMAT, builtAt: now, fullAt, rulesKey, rows })));
  await getStorage().bucket().file(PATH).save(body, { contentType: "application/json", metadata: { contentEncoding: "identity", cacheControl: "no-store" } });
  mem = { builtAt: now, rows: new Map(rows.map((r) => [r.id, r])), loadedAt: Date.now() };
  overlay = { at: 0, rows: new Map() };
  return reason ? { count: rows.length, reads, mode: "full", reason } : { count: rows.length, reads, mode: "changes", changed };
}

// ── In memory per instance ──
let mem = null; // { builtAt, rows: Map, loadedAt }
let overlay = { at: 0, rows: new Map() };
function _reset() { mem = null; overlay = { at: 0, rows: new Map() }; }
async function load() {
  if (mem && Date.now() - mem.loadedAt < 30 * 60 * 1000) return mem;
  try {
    const [buf] = await getStorage().bucket().file(PATH).download();
    const data = JSON.parse(zlib.gunzipSync(buf).toString("utf8"));
    if (!mem || data.builtAt !== mem.builtAt) overlay = { at: 0, rows: new Map() };
    mem = { builtAt: data.builtAt, rows: new Map(data.rows.map((r) => [r.id, r])), loadedAt: Date.now() };
  } catch (e) {
    if (!mem) return null;
    mem.loadedAt = Date.now();
  }
  return mem;
}
// Companies changed since the build, re-read at most once a minute per instance.
async function refreshOverlay(ctx) {
  if (!mem) return;
  if (Date.now() - overlay.at < 60000) return;
  const since = new Date(mem.builtAt);
  const ids = new Set();
  for (const f of CHANGE_FIELDS) {
    try {
      const snap = await U.db().collection("searchCompanies").where(f, ">=", since).select("name").limit(2000).get();
      if (ctx) ctx.reads += Math.max(1, snap.size);
      snap.docs.forEach((d) => ids.add(d.id));
    } catch (e) { /* a field that can't be queried is skipped */ }
  }
  const rules = ids.size ? await tierRules() : [];
  const fresh = new Map();
  const list = [...ids];
  for (let i = 0; i < list.length; i += 100) {
    const refs = list.slice(i, i + 100).map((id) => U.db().doc(`searchCompanies/${id}`));
    const snaps = await U.db().getAll(...refs);
    if (ctx) ctx.reads += refs.length;
    for (const s of snaps) if (s.exists) fresh.set(s.id, rowOf(s.id, s.data(), rules)); else fresh.set(s.id, null);
  }
  overlay = { at: Date.now(), rows: fresh };
}
// All current rows (index + overlay; deleted companies removed).
async function rows(ctx) {
  const m = await load();
  if (!m) return null;
  await refreshOverlay(ctx);
  if (!overlay.rows.size) return { builtAt: m.builtAt, list: [...m.rows.values()] };
  const merged = new Map(m.rows);
  for (const [id, r] of overlay.rows) { if (r) merged.set(id, r); else merged.delete(id); }
  return { builtAt: m.builtAt, list: [...merged.values()] };
}
function _set(list, builtAt = Date.now()) { mem = { builtAt, rows: new Map(list.map((r) => [r.id, r])), loadedAt: Date.now() }; overlay = { at: Date.now(), rows: new Map() }; }

// ── Filtering, sorting, grouping ──
const NUMERIC = ["revenue", "ebitda", "margin", "employees", "growth", "growthSustained", "fit", "yearFounded", "groupSize"];
const GROUPABLE = ["sector", "subSector", "cae", "cae2", "cae3", "district", "concelho", "nuts2", "stage", "owner", "tier", "contactable", "doNotContact", "contacted", "answered", "outreachStatus", "campaignName", "legalForm", "country", "revenueBand", "ebitdaBand", "employeesBand"];
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const inList = (v, list) => !Array.isArray(list) || !list.length || list.some((x) => fold(x) === fold(v));
const dateMs = (v) => (v == null || v === "" ? null : typeof v === "number" ? v : new Date(v).getTime() || null);

function matches(r, f = {}, text = "") {
  if (text) {
    const t = fold(text).trim();
    const digits = t.replace(/\D/g, "");
    const hit = (digits.length >= 6 && String(r.nif).includes(digits))
      || (t.startsWith("@") && (r.domain === t.slice(1) || r.emails.some((e) => e.endsWith(t))))
      || (t.includes("@") && r.emails.includes(t))
      || (t.includes(".") && !t.includes(" ") && r.domain && r.domain === t.replace(/^www\./, ""))
      || fold(r.name).includes(t);
    if (!hit) return false;
  }
  if (Array.isArray(f.cae) && f.cae.length && !f.cae.some((p) => String(r.cae).replace(/\D/g, "").startsWith(String(p).replace(/\D/g, "")))) return false;
  if (!inList(r.sector, f.sector) || !inList(r.subSector, f.subSector) || !inList(r.district, f.district) || !inList(r.concelho, f.concelho)) return false;
  if (!inList(r.stage, f.stage) || !inList(r.owner, f.owner) || !inList(r.tier || "none", f.tier) || !inList(r.nuts2, f.nuts2)) return false;
  for (const k of NUMERIC) {
    const lo = f[k + "Min"], hi = f[k + "Max"];
    if (lo != null && !(r[k] != null && r[k] >= lo)) return false;
    if (hi != null && !(r[k] != null && r[k] <= hi)) return false;
  }
  if (f.fitMin != null && !(r.fit != null && r.fit >= f.fitMin)) return false;
  if (typeof f.contactable === "boolean" && (r.contactable !== false) !== f.contactable) return false;
  if (typeof f.doNotContact === "boolean" && r.doNotContact !== f.doNotContact) return false;
  if (typeof f.contacted === "boolean" && !!r.contacted !== f.contacted) return false;
  if (typeof f.answered === "boolean" && !!r.answered !== f.answered) return false;
  if (typeof f.inCampaign === "boolean" && !!r.campaignId !== f.inCampaign) return false;
  if (f.campaignId && r.campaignId !== f.campaignId) return false;
  const after = dateMs(f.lastTouchAfter), before = dateMs(f.lastTouchBefore);
  if (after != null && !(r.lastTouchAt && r.lastTouchAt >= after)) return false;
  if (before != null && r.lastTouchAt && r.lastTouchAt >= before) return false; // never touched counts as "before"
  return true;
}
function band(v, steps, unit) {
  if (v == null) return "unknown";
  for (let i = 0; i < steps.length; i++) if (v < steps[i]) return i === 0 ? `< ${fmtBand(steps[0], unit)}` : `${fmtBand(steps[i - 1], unit)}–${fmtBand(steps[i], unit)}`;
  return `≥ ${fmtBand(steps[steps.length - 1], unit)}`;
}
const fmtBand = (v, unit) => (unit === "€" ? (v >= 1e6 ? `€${v / 1e6}M` : `€${v / 1e3}k`) : String(v));
function groupValue(r, g) {
  if (g === "cae2") return String(r.cae).replace(/\D/g, "").slice(0, 2) || "unknown";
  if (g === "cae3") return String(r.cae).replace(/\D/g, "").slice(0, 3) || "unknown";
  if (g === "revenueBand") return band(r.revenue, [1e6, 2.5e6, 5e6, 10e6, 25e6, 50e6], "€");
  if (g === "ebitdaBand") return band(r.ebitda, [0, 250e3, 500e3, 1e6, 2.5e6, 5e6], "€");
  if (g === "employeesBand") return band(r.employees, [10, 25, 50, 100, 250], "");
  const v = r[g];
  return v == null || v === "" ? "unknown" : String(v);
}
function aggregate(list, groupBy = [], metrics = []) {
  const ms = (metrics.length ? metrics : [{ op: "count" }]).slice(0, 8);
  const groups = new Map();
  for (const r of list) {
    const key = groupBy.map((g) => groupValue(r, g));
    const k = JSON.stringify(key);
    if (!groups.has(k)) groups.set(k, { key, n: 0, acc: ms.map(() => ({ sum: 0, n: 0, min: null, max: null })) });
    const gr = groups.get(k);
    gr.n++;
    ms.forEach((m, i) => {
      const v = m.field ? r[m.field] : null;
      if (typeof v !== "number") return;
      const a = gr.acc[i]; a.sum += v; a.n++; a.min = a.min == null ? v : Math.min(a.min, v); a.max = a.max == null ? v : Math.max(a.max, v);
    });
  }
  const out = [...groups.values()].map((g) => {
    const row = Object.fromEntries(groupBy.map((gname, i) => [gname, g.key[i]]));
    ms.forEach((m, i) => {
      const a = g.acc[i];
      const label = m.op === "count" ? "count" : `${m.op}_${m.field}`;
      row[label] = m.op === "count" ? g.n : m.op === "sum" ? Math.round(a.sum) : m.op === "avg" ? (a.n ? Math.round((a.sum / a.n) * 100) / 100 : null) : m.op === "min" ? a.min : a.max;
      if (m.op !== "count") row[`n_${m.field}`] = a.n;
    });
    if (!ms.some((m) => m.op === "count")) row.count = g.n;
    return row;
  });
  out.sort((a, b) => (b.count || 0) - (a.count || 0));
  return out;
}
function sortRows(list, sort) {
  const field = sort?.field || "revenue";
  const dir = sort?.dir === "asc" ? 1 : -1;
  return list.slice().sort((a, b) => {
    const x = a[field], y = b[field];
    if (x == null && y == null) return a.name.localeCompare(b.name);
    if (x == null) return 1;
    if (y == null) return -1;
    if (typeof x === "string") return dir * x.localeCompare(y);
    return dir * (x - y) || a.name.localeCompare(b.name);
  });
}

module.exports = { PATH, SELECT, FORMAT, rowOf, fullEmails, build, load, rows, matches, aggregate, sortRows, groupValue, NUMERIC, GROUPABLE, _reset, _set };
