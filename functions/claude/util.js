// Claude connector — shared helpers: hashing, times, settings, the base address.
// (Build plan: Infrastructure hub, "Claude connector: build plan" v2, 13 Nov 2026.)

const crypto = require("crypto");
const { getFirestore } = require("firebase-admin/firestore");

const REGION = "us-central1";
// The project comes from the Cloud Functions environment (one codebase, one project per team).
const PROJECT = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || (() => { try { return JSON.parse(process.env.FIREBASE_CONFIG || "{}").projectId || ""; } catch (e) { return ""; } })();
// The connector's address, as people add it in Claude. Must match exactly (RFC 9728 `resource`).
const BASE = `https://${REGION}-${PROJECT}.cloudfunctions.net/claudeMcp`;
const SCOPE = "douro.read";
const FEATURE = "claude.connector";

const db = () => getFirestore();
const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomToken = (bytes = 32) => b64url(crypto.randomBytes(bytes));
const ms = (t) => (t == null ? null : typeof t === "number" ? t : t.toMillis ? t.toMillis() : t._seconds != null ? t._seconds * 1000 : new Date(t).getTime() || null);

// ── Lisbon clock (limits reset on the Lisbon hour and at Lisbon midnight) ──
function lisbonParts(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: p.hour, minute: p.minute };
}
const lisbonDay = (d) => lisbonParts(d).day;
const lisbonHour = (d) => lisbonParts(d).hour;
// "15:00" — the next Lisbon hour; "00:00" for the day limit.
function nextHourLabel(d = new Date()) { const h = (+lisbonHour(d) + 1) % 24; return `${String(h).padStart(2, "0")}:00`; }

// ── Settings (claudeSettings/main), cached a minute ──
const DEFAULT_SETTINGS = { signInDays: 90, defaults: { hour: 300, day: 3000, rows: 100 }, roles: {}, people: {} };
let settingsCache = null, settingsAt = 0;
const clampInt = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt; };
function normalizeLimits(src, base) {
  const o = src || {};
  return { hour: clampInt(o.hour, 1, 100000, base.hour), day: clampInt(o.day, 1, 1000000, base.day), rows: clampInt(o.rows, 1, 100, base.rows) };
}
function normalizeSettings(raw) {
  const s = raw || {};
  const defaults = normalizeLimits(s.defaults, DEFAULT_SETTINGS.defaults);
  // Roles and people keep only the limits actually set (a cell left empty follows the line above).
  const partial = (v) => {
    const o = v && typeof v === "object" ? v : {};
    const out = {};
    const h = clampInt(o.hour, 1, 100000, null), d = clampInt(o.day, 1, 1000000, null), r = clampInt(o.rows, 1, 100, null);
    if (h != null) out.hour = h;
    if (d != null) out.day = d;
    if (r != null) out.rows = r;
    return out;
  };
  const clean = (m) => Object.fromEntries(Object.entries(m && typeof m === "object" ? m : {}).filter(([k]) => /^[a-z0-9_-]{1,40}$/i.test(k)).map(([k, v]) => [k, partial(v)]).filter(([, v]) => Object.keys(v).length));
  return { signInDays: clampInt(s.signInDays, 1, 365, DEFAULT_SETTINGS.signInDays), defaults, roles: clean(s.roles), people: clean(s.people) };
}
async function getSettings({ force = false } = {}) {
  if (!force && settingsCache && Date.now() - settingsAt < 60000) return settingsCache;
  let raw = null;
  try { raw = (await db().doc("claudeSettings/main").get()).data() || null; } catch (e) { raw = settingsCache; }
  settingsCache = normalizeSettings(raw);
  settingsAt = Date.now();
  return settingsCache;
}
function _resetSettings() { settingsCache = null; settingsAt = 0; }
// A person's limits, limit by limit: their own, else their role's, else everyone's.
function limitsFor(settings, { key, roleId }) {
  return { ...settings.defaults, ...(settings.roles[roleId] || {}), ...(settings.people[key] || {}) };
}

module.exports = { REGION, PROJECT, BASE, SCOPE, FEATURE, db, sha256, b64url, randomToken, ms, lisbonParts, lisbonDay, lisbonHour, nextHourLabel, DEFAULT_SETTINGS, normalizeSettings, getSettings, limitsFor, _resetSettings };
