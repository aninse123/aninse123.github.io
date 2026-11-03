// "Check address" (3 Nov 2026): does a postal address from an email signature exist? A free look-up on OpenStreetMap's Nominatim (the same
// source the Search CRM map's postcode table was built from), only when somebody asks, one address at a time (their usage policy: at most
// one request a second, an identifying User-Agent, no bulk use). Server side, so the browser's content-security policy stays closed.
// Returns { status: "found" | "postcode_only" | "not_found" | "error", label?, place?, samePlace?, lat?, lon?, note }.

const { getInstance } = require("../instance");
const UA_NAME = "PortalAddressCheck/1.0";
// Nominatim's policy asks for a User-Agent that identifies the application and a way to contact it: the first admin of the instance.
async function userAgent() { try { const i = await getInstance(); return `${UA_NAME} (${(i.adminEmails || [])[0] || "no contact set"})`; } catch (e) { return UA_NAME; } }
const URL_BASE = "https://nominatim.openstreetmap.org/search";

const strip = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const POSTCODE = /^\d{4}-\d{3}$/;

// "Rua da Quinta da Serra Nº4" → "4 Rua da Quinta da Serra" (house number first, as Nominatim wants it)
function streetQuery(street) {
  const s = String(street || "").replace(/\s+/g, " ").trim();
  const m = s.match(/^(.*?)[,\s]*(?:n\.?[ºo°]?\s*)(\d+[a-z]?)\s*$/i) || s.match(/^(.*?),\s*(\d+[a-z]?)\s*$/i) || s.match(/^(.*?)\s+(\d+[a-z]?)\s*$/i);
  return m && m[1] ? `${m[2]} ${m[1].trim()}` : s;
}

async function lookup(params, { fetchImpl = fetch, timeoutMs = 8000, ua = UA_NAME } = {}) {
  const q = new URLSearchParams({ format: "jsonv2", addressdetails: "1", limit: "3", countrycodes: "pt", ...params });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(`${URL_BASE}?${q}`, { headers: { "User-Agent": ua, "Accept-Language": "pt" }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

const placeOf = (a) => a?.city || a?.town || a?.village || a?.municipality || a?.county || "";

async function checkAddress({ street = "", postcode = "", place = "" } = {}, deps = {}) {
  const pc = String(postcode || "").trim();
  const st = String(street || "").trim();
  if (!st && !pc) return { status: "error", note: "Nothing to check: no street or postcode." };
  if (pc && !POSTCODE.test(pc)) return { status: "error", note: `"${pc}" is not a Portuguese postcode (NNNN-NNN).` };
  try {
    deps = { ...deps, ua: deps.ua || (await userAgent()) };
    let hits = [];
    if (st && pc) hits = await lookup({ street: streetQuery(st), postalcode: pc }, deps);
    if (hits.length) {
      const h = hits[0], pl = placeOf(h.address);
      return { status: "found", label: h.display_name, place: pl, samePlace: place ? strip(pl).includes(strip(place)) || strip(place).includes(strip(pl)) : null, lat: Number(h.lat), lon: Number(h.lon), note: "Found on OpenStreetMap (street and postcode)." };
    }
    if (pc) {
      await new Promise((r) => setTimeout(r, deps.pauseMs ?? 1100)); // one request a second
      const byPc = await lookup({ postalcode: pc }, deps);
      if (byPc.length) {
        const h = byPc[0], pl = placeOf(h.address);
        return { status: "postcode_only", label: h.display_name, place: pl, samePlace: place ? strip(pl).includes(strip(place)) || strip(place).includes(strip(pl)) : null, lat: Number(h.lat), lon: Number(h.lon), note: st ? "The postcode exists, but OpenStreetMap does not list that street (common in small places): not proof either way." : "The postcode exists." };
      }
    }
    return { status: "not_found", note: "OpenStreetMap does not know this address or postcode. It may still exist: check it on a map before using it." };
  } catch (err) {
    return { status: "error", note: `The lookup failed (${String(err.message || err).slice(0, 80)}). Try again in a minute.` };
  }
}

module.exports = { checkAddress, streetQuery };
