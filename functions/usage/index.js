// Usage (Team & access → Usage): what the portal uses per day — database
// reads / writes / deletes, emails, and activity per person.
//
//   usageDaily/{lisbonDay}     counters bumped where things happen (emails,
//                              sign-ins, AI, phone searches) + a snapshot
//                              written by refresh (drafts waiting, held, exports)
//   usageFirestore/{pacificDay} exact database totals from Google Cloud
//                              Monitoring (both sites + the server together)
//   usageMonthly/{YYYY-MM}     days older than 90, rolled up
//   usageAlerts/current        senders near their daily cap (scheduler)
//
// Browser estimates stay in dailyReadCounters / dailyWriteCounters (per
// person and per site since 30 Sep). Everything here is best-effort: a
// counter that fails to write never breaks the action it counts.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const P = require("../access/perms");

const REGION = "us-central1";
const KEEP_DAYS = 90;
const db = () => getFirestore();
const PROJECT = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "douro-partners";

// ── Days ──
const dayIn = (tz) => (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const lisbonDay = dayIn("Europe/Lisbon");
const pacificDay = dayIn("America/Los_Angeles"); // Firestore's free quota resets at Pacific midnight
// Midnight of `day` (YYYY-MM-DD) in time zone `tz`, as a Date.
function zonedMidnight(day, tz) {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 12);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const offsetMin = (Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) - guess) / 60000;
  return new Date(Date.UTC(y, m - 1, d) - offsetMin * 60000);
}
const addDays = (day, n) => { const t = new Date(`${day}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// ── People ──
// A map key for a person: their team short name, else the email's local part.
const safeKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 60) || "unknown";
const keyCache = new Map();
async function personKey(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e || !e.includes("@")) return safeKey(e || "automatic");
  if (P.PARTNER_KEYS[e]) return P.PARTNER_KEYS[e];
  const hit = keyCache.get(e);
  if (hit && hit.at > Date.now() - 10 * 60000) return hit.key;
  let key = null;
  try { key = (await db().doc(`team/${e}`).get()).data()?.key || null; } catch (err) { /* fall back below */ }
  key = safeKey(key || e.split("@")[0]);
  keyCache.set(e, { key, at: Date.now() });
  return key;
}

// ── Counters ──
// bump({ "email.real.campaign": 1, "activity.signIns.maria": 1 }) → increments
// on usageDaily/{lisbonDay}. Path segments are made safe (no dots in keys).
function nest(paths) {
  const out = {};
  for (const [path, n] of Object.entries(paths)) {
    if (!n) continue;
    const parts = path.split(".").map((seg) => String(seg).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60) || "unknown");
    let o = out;
    parts.slice(0, -1).forEach((p) => { o = o[p] = o[p] || {}; });
    o[parts[parts.length - 1]] = FieldValue.increment(n);
  }
  return out;
}
async function bump(paths, { now = new Date() } = {}) {
  try {
    const data = nest(paths);
    if (!Object.keys(data).length) return;
    await db().doc(`usageDaily/${lisbonDay(now)}`).set({ ...data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  } catch (e) { logger.warn("usage bump failed", { message: e.message }); }
}

// Emails: one call per email sent / failed (send_core), or per batch (people_send).
async function countEmail({ kind, isTest, senderId = null, by = null, failed = false, n = 1 }) {
  const set = isTest ? "test" : "real";
  const who = by ? await personKey(by) : "automatic";
  const paths = failed ? { [`email.failed.${set}`]: n } : { [`email.${set}.${kind}`]: n, [`email.sentBy.${who}`]: n };
  if (!failed && senderId) paths[`email.bySender.${safeKey(senderId)}.${set}`] = n;
  return bump(paths);
}
async function countPerson(what, email, n = 1) { return bump({ [`${what}.${await personKey(email)}`]: n }); }

// ── Exact figures from Google Cloud Monitoring ──
// Needs the functions' service account to hold "Monitoring Viewer".
const METRICS = { reads: "read_count", writes: "write_count", deletes: "delete_count" };
async function monitoringTotals(start, end, { fetchImpl = globalThis.fetch, token = null } = {}) {
  let bearer = token;
  if (!bearer) {
    const { GoogleAuth } = require("google-auth-library");
    const client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/monitoring.read"] }).getClient();
    bearer = (await client.getAccessToken()).token;
  }
  const secs = Math.max(60, Math.round((end - start) / 1000));
  const out = {};
  for (const [name, metric] of Object.entries(METRICS)) {
    const qs = new URLSearchParams({
      filter: `metric.type="firestore.googleapis.com/document/${metric}"`,
      "interval.startTime": start.toISOString(), "interval.endTime": end.toISOString(),
      "aggregation.alignmentPeriod": `${secs}s`, "aggregation.perSeriesAligner": "ALIGN_SUM", "aggregation.crossSeriesReducer": "REDUCE_SUM",
    });
    const res = await fetchImpl(`https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries?${qs}`, { headers: { Authorization: `Bearer ${bearer}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(body?.error?.message || `Monitoring ${res.status}`); e.status = res.status; throw e; }
    out[name] = (body.timeSeries || []).reduce((sum, ts) => sum + (ts.points || []).reduce((s, p) => s + Number(p.value?.int64Value ?? p.value?.doubleValue ?? 0), 0), 0);
  }
  return out;
}
async function storeExact(day, now, opts) {
  const start = zonedMidnight(day, "America/Los_Angeles");
  const endFull = zonedMidnight(addDays(day, 1), "America/Los_Angeles");
  const end = endFull > now ? now : endFull;
  const ref = db().doc(`usageFirestore/${day}`);
  try {
    const t = await monitoringTotals(start, end, opts);
    await ref.set({ ...t, complete: endFull <= now, fetchedAt: FieldValue.serverTimestamp(), error: null }, { merge: true });
    return t;
  } catch (e) {
    const error = e.status === 403 ? "no_permission" : (e.message || "failed").slice(0, 200);
    await ref.set({ error, fetchedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { error };
  }
}

// ── Snapshot: what's waiting right now; exports per person ──
async function snapshot(now) {
  const day = lisbonDay(now);
  const snap = { at: Timestamp.fromDate(now) };
  try {
    const drafts = await db().collection("outreachMessages").where("status", "==", "draft").get();
    const oldest = drafts.docs.map((d) => d.data().createdAt?.toMillis?.() || null).filter(Boolean).sort((a, b) => a - b)[0] || null;
    snap.draftsWaiting = drafts.size;
    snap.oldestDraftAt = oldest ? Timestamp.fromMillis(oldest) : null;
  } catch (e) { snap.draftsWaiting = null; }
  try {
    const held = await db().collection("outreachEnrolments").where("lastError", ">=", "Held:").where("lastError", "<", "Held;").get();
    snap.held = held.size;
  } catch (e) { snap.held = null; }
  // CSV exports (activityLog "data_export") per person, today and yesterday.
  for (const d of [day, addDays(day, -1)]) {
    try {
      const from = zonedMidnight(d, "Europe/Lisbon"), to = zonedMidnight(addDays(d, 1), "Europe/Lisbon");
      const ex = await db().collection("activityLog").where("timestamp", ">=", Timestamp.fromDate(from)).where("timestamp", "<", Timestamp.fromDate(to)).get();
      const exports = {}, rows = {};
      for (const doc of ex.docs) {
        const x = doc.data();
        if (x.type !== "data_export") continue;
        const k = await personKey(x.email);
        exports[k] = (exports[k] || 0) + 1; rows[k] = (rows[k] || 0) + (Number(x.rows) || 0);
      }
      await db().doc(`usageDaily/${d}`).set({ activity: { exports, exportRows: rows } }, { merge: true });
    } catch (e) { logger.warn("usage exports failed", { day: d, message: e.message }); }
  }
  await db().doc(`usageDaily/${day}`).set({ snapshot: snap }, { merge: true });
  return snap;
}

// ── Refresh: exact figures (today so far + the last 7 days) and the snapshot ──
async function refreshUsage({ now = new Date(), days = 7, monitoring = {} } = {}) {
  const today = pacificDay(now);
  const exact = {};
  for (let i = 0; i <= days; i++) {
    const d = addDays(today, -i);
    if (i > 0) {
      const cur = (await db().doc(`usageFirestore/${d}`).get()).data();
      if (cur?.complete && !cur.error) continue; // a finished day doesn't change
    }
    exact[d] = await storeExact(d, now, monitoring);
    if (exact[d].error === "no_permission") break; // no point asking again
  }
  const snap = await snapshot(now);
  return { exact, snapshot: snap };
}

// ── Keep 90 days; older days become monthly totals ──
const ROLLUPS = [
  { coll: "usageDaily", key: "usage" },
  { coll: "usageFirestore", key: "firestore" },
  { coll: "dailyReadCounters", key: "reads" },
  { coll: "dailyWriteCounters", key: "writes" },
];
function addInto(target, src) {
  for (const [k, v] of Object.entries(src || {})) {
    if (typeof v === "number") target[k] = (target[k] || 0) + v;
    else if (v && typeof v === "object" && !(v instanceof Timestamp) && !v.toMillis) { target[k] = target[k] || {}; addInto(target[k], v); }
  }
  return target;
}
async function rollup({ now = new Date() } = {}) {
  const cutoff = addDays(lisbonDay(now), -KEEP_DAYS);
  let moved = 0;
  for (const { coll, key } of ROLLUPS) {
    const snap = await db().collection(coll).get();
    const byMonth = {};
    for (const d of snap.docs) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.id) || d.id >= cutoff) continue;
      const m = d.id.slice(0, 7);
      const { snapshot: _s, updatedAt: _u, fetchedAt: _f, complete: _c, error: _e, ...data } = d.data();
      byMonth[m] = byMonth[m] || { docs: [], sum: {} };
      addInto(byMonth[m].sum, data);
      byMonth[m].docs.push(d.ref);
    }
    for (const [m, { docs, sum }] of Object.entries(byMonth)) {
      const ref = db().doc(`usageMonthly/${m}`);
      const cur = (await ref.get()).data() || {};
      await ref.set({ ...cur, [key]: addInto(cur[key] || {}, sum), days: { ...(cur.days || {}), [key]: ((cur.days || {})[key] || 0) + docs.length }, updatedAt: FieldValue.serverTimestamp() });
      for (const r of docs) await r.delete();
      moved += docs.length;
    }
  }
  return { moved, cutoff };
}

// ── Senders near their daily cap (called by the scheduler) ──
async function senderAlerts(list) {
  try {
    const near = list.filter((s) => s.cap && s.sent >= 0.8 * s.cap).map((s) => ({ id: s.id, sent: s.sent, cap: s.cap }));
    const ref = db().doc("usageAlerts/current");
    const cur = (await ref.get()).data() || {};
    const same = JSON.stringify(cur.senders || []) === JSON.stringify(near);
    if (!same) await ref.set({ senders: near, updatedAt: FieldValue.serverTimestamp() });
  } catch (e) { logger.warn("usage sender alerts failed", { message: e.message }); }
}

// ── Callable + daily job ──
const usageAdmin = onCall({ region: REGION, timeoutSeconds: 120 }, async (request) => {
  if (!P.hasPerm(request, "access.manage")) throw new HttpsError("permission-denied", "Only partners can see usage.", { reason: "no_permission" });
  const action = request.data?.action;
  if (action === "refresh") return refreshUsage();
  throw new HttpsError("invalid-argument", "Unknown action.", { reason: "bad_action" });
});
// 09:30 Lisbon: after Pacific midnight, so yesterday's database figures are final.
const usageJob = onSchedule({ region: REGION, schedule: "30 9 * * *", timeZone: "Europe/Lisbon", timeoutSeconds: 300 }, async () => {
  const r = await refreshUsage({ days: 3 });
  const k = await rollup();
  logger.info("usage job", { exact: Object.keys(r.exact).length, rolledUp: k.moved });
});

module.exports = { usageAdmin, usageJob, bump, countEmail, countPerson, personKey, refreshUsage, rollup, senderAlerts, monitoringTotals, zonedMidnight, lisbonDay, pacificDay, addDays, nest, safeKey, _keyCache: keyCache };
