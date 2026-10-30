// Does an email domain have a mail server? (30 Oct 2026, plan step 3, switch contacts.trustLabels)
// An ADVISORY flag, never a verdict: only a definite "no such domain / no mail server" is "none". A timeout or a
// failed lookup is "unknown" and shows nothing. A "none" is re-checked after a day, an "ok" after thirty. Only a real
// bounce ever makes an address Bounced.

const dns = require("dns").promises;
const store = require("./store");

const DAY = 24 * 3600 * 1000;
const TTL = { ok: 30 * DAY, none: 1 * DAY };
const DEFINITE = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]); // the answer is "no", not "I could not ask"

// "ok" | "none" | "unknown". deps lets a test stand in for the DNS.
async function lookupDomain(domain, deps = dns) {
  const d = String(domain || "").trim().toLowerCase();
  if (!d || !d.includes(".")) return "unknown";
  let noMx = false, uncertain = false;
  for (let attempt = 0; attempt < 2; attempt++) { // one retry for a transient failure
    uncertain = false;
    try { const mx = await deps.resolveMx(d); if (mx && mx.length) return "ok"; noMx = true; break; }
    catch (e) { if (DEFINITE.has(e && e.code)) { noMx = true; break; } uncertain = true; }
  }
  if (uncertain && !noMx) return "unknown";
  // no MX: mail falls back to the address record, so a domain that exists still receives
  try { const a = await deps.resolve4(d); if (a && a.length) return "ok"; } catch (e) { if (!DEFINITE.has(e && e.code)) return "unknown"; }
  try { const a = await deps.resolve6(d); if (a && a.length) return "ok"; } catch (e) { if (!DEFINITE.has(e && e.code)) return "unknown"; }
  return "none";
}

// { "empresa.pt": "ok" | "none" | "unknown" }, from the cache when fresh.
async function domainStates(domains, { deps = dns, now = Date.now(), useCache = true } = {}) {
  const list = [...new Set((domains || []).map((x) => String(x || "").trim().toLowerCase()).filter(Boolean))].slice(0, 40);
  const out = {};
  await Promise.all(list.map(async (d) => {
    const ref = useCache ? store.db().doc(`outreachDomainCache/${d.replace(/[^a-z0-9.-]/g, "_")}`) : null;
    try {
      const c = ref ? await ref.get() : null;
      if (c && c.exists) { const x = c.data(); if (TTL[x.state] && now - Number(x.checkedMs || 0) < TTL[x.state]) { out[d] = x.state; return; } }
    } catch (e) { /* no cache: ask */ }
    const state = await lookupDomain(d, deps);
    out[d] = state;
    if (ref && TTL[state]) { try { await ref.set({ domain: d, state, checkedMs: now }); } catch (e) { /* best effort */ } }
  }));
  return out;
}

module.exports = { lookupDomain, domainStates };
