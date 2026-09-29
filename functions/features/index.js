// Feature switches — server side ("Portal - Feature Switches Plan.md").
// Settings live in config/features ({ flags: { key: { staging, production,
// testers[], note, … } } }); anything missing falls back to the catalog
// default. Server actions check the switch for the site the request came
// from; background jobs follow the production setting (they serve both).

const { getFirestore } = require("firebase-admin/firestore");
const { HttpsError } = require("firebase-functions/v2/https");
const P = require("../access/perms");
const { STATES, BY_KEY } = require("./catalog");

const TTL_MS = 15000;
let cache = null, cachedAt = 0;
const db = () => getFirestore();

async function getFlags({ force = false } = {}) {
  if (!force && cache && Date.now() - cachedAt < TTL_MS) return cache;
  try {
    const snap = await db().doc("config/features").get();
    cache = snap.exists ? (snap.data().flags || {}) : {};
  } catch (e) {
    cache = cache || {}; // unreadable: keep the last known, else catalog defaults
  }
  cachedAt = Date.now();
  return cache;
}
function _reset() { cache = null; cachedAt = 0; }

const PRODUCTION_HOSTS = new Set(["douropartners.pt", "www.douropartners.pt"]);
function siteOfOrigin(origin) {
  try { return PRODUCTION_HOSTS.has(new URL(origin).hostname) ? "production" : "staging"; }
  catch (e) { return "production"; } // unknown: the stricter site
}
function siteOf(request) {
  // No HTTP request at all (unit tests): FEATURE_TEST_SITE decides; real
  // callable requests always carry their headers.
  if (!request?.rawRequest) return process.env.FEATURE_TEST_SITE || "production";
  const h = request.rawRequest.headers || {};
  const o = h.origin || h.referer;
  return o ? siteOfOrigin(o) : "production";
}
function stateOf(flags, key, site) {
  const f = BY_KEY[key];
  if (!f) return "off";
  const v = flags?.[key]?.[site];
  return STATES.includes(v) ? v : f.defaults[site];
}
function isTester(request, flags, key) {
  if (P.hasPerm(request, "features.test")) return true;
  const email = P.callerOf(request);
  return !!email && (flags?.[key]?.testers || []).includes(email);
}
async function isOnFor(request, key) {
  const flags = await getFlags();
  const st = stateOf(flags, key, siteOf(request));
  return st === "on" || (st === "test" && isTester(request, flags, key));
}
// Refuses unless every listed feature is available to this caller on this site.
async function requireFeature(request, ...keys) {
  for (const k of keys) {
    if (!(await isOnFor(request, k))) throw new HttpsError("failed-precondition", "This feature isn't available yet.", { reason: "feature_off", feature: k });
  }
}
// Background jobs: "off" | "test" | "on" (production setting).
async function jobState(key) { return stateOf(await getFlags(), key, "production"); }

module.exports = { getFlags, siteOf, siteOfOrigin, stateOf, isTester, isOnFor, requireFeature, jobState, _reset };
