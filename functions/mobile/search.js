// Mobile app (portal/m/) — one-call search over the Search CRM: companies and
// people by name, or by NIF when the query is a number. Returns short rows
// (a few fields each) instead of whole company documents, which carry ten
// years of Orbis financials and would be slow over a phone connection.
// Permission: the same as the Search CRM ("search.view").
//
// The name normalisation mirrors portal/search.html (companySearchFields,
// personNameKey, personNameTokens) — tests/portal/mobile_parity checks that
// both give the same keys for the same input.

const P = require("../access/perms");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore } = require("firebase-admin/firestore");

const REGION = "us-central1";
// Reads: Firestore charges one read per document returned, so each kind
// reads at most LIMIT documents — MAX_ROWS shown + 1 to know there are more.
// The scan uses the most selective (longest) word, so several words rarely
// need more than that. `complete` tells the phone it saw every match, so it
// can narrow a longer query itself without reading again.
const MAX_ROWS = 25;   // per kind (companies / people)
const LIMIT = MAX_ROWS + 1;
const MIN_NAME = 3;    // characters before a name search runs (2-letter prefixes match thousands)

const db = () => getFirestore();

// ── Normalisation (same as portal/search.html) ──
function deburr(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); }
function onlyDigits(s) { return String(s || "").replace(/\D/g, ""); }
const LEGAL_FORM_RE = /\b(lda|sa|unipessoal|limitada|sgps|eireli|ltda|s a)\b/g;
function companySearchFields(name) {
  const nameKey = deburr(String(name || "").replace(/[.,\-–—&/]/g, " ")).replace(LEGAL_FORM_RE, " ").replace(/\s+/g, " ").trim().toUpperCase();
  const nameTokens = [...new Set(nameKey.split(" ").filter((w) => w.length > 1))];
  return { nameKey, nameTokens };
}
const PERSON_SALUT = /^(mr|mrs|ms|miss|dr|dra|eng|engo|enga|prof|sr|sra|d)\s+/;
function personNameKey(name) {
  let s = deburr(String(name || "")).replace(/[.,\-–—&/()']/g, " ").replace(/\s+/g, " ").trim();
  let prev; do { prev = s; s = s.replace(PERSON_SALUT, ""); } while (s !== prev);
  return s.toUpperCase();
}
const PERSON_STOPWORDS = new Set(["DE", "DA", "DO", "DOS", "DAS", "E"]);
function personNameTokens(nameKey) { return [...new Set(nameKey.split(" ").filter((w) => w.length > 1 && !PERSON_STOPWORDS.has(w)))]; }

// A query is a NIF search when it is (almost) only digits: "508 123 456", "PT508123456".
function nifQuery(q) {
  const s = String(q || "").trim().replace(/^pt/i, "");
  const d = onlyDigits(s);
  return d.length >= 3 && d.length === s.replace(/[\s.\-]/g, "").length ? d : null;
}

const COMPANY_FIELDS = ["name", "nif", "foreignTaxId", "concelho", "city", "sector", "subSector", "caeCode", "naceCode", "stage", "owner", "doNotContact", "contactable", "targetTierManual", "nameKey", "nameTokens"];
const PERSON_FIELDS = ["name", "entityType", "country", "nationality", "linkCount", "currentLinkCount", "nif", "matchedCompanyId", "nameKey", "nameTokens"];

const everyWord = (tokens) => (x) => tokens.every((t) => (x.nameTokens || []).includes(t) || String(x.nameKey || "").includes(t));
const rows = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
// The longest word matches the fewest names (first one on a tie).
const mostSelective = (tokens) => tokens.reduce((best, t) => (t.length > best.length ? t : best), tokens[0]);

async function companiesByName(q) {
  const { nameKey, nameTokens } = companySearchFields(q);
  if (!nameTokens.length) return { items: [], complete: true };
  const col = db().collection("searchCompanies");
  let found = rows(await col.where("namePrefixes", "array-contains", mostSelective(nameTokens)).select(...COMPANY_FIELDS).limit(LIMIT).get());
  if (!found.length) found = rows(await col.orderBy("nameKey").where("nameKey", ">=", nameKey).where("nameKey", "<=", nameKey + "\uf8ff").select(...COMPANY_FIELDS).limit(LIMIT).get());
  const complete = found.length < LIMIT;
  if (nameTokens.length > 1) found = found.filter(everyWord(nameTokens));
  const rank = (c) => (c.nameKey === nameKey ? 0 : String(c.nameKey || "").startsWith(nameKey) ? 1 : 2);
  return { items: found.sort((a, b) => rank(a) - rank(b) || String(a.name || "").localeCompare(String(b.name || ""))), complete };
}
async function peopleByName(q) {
  const key = personNameKey(q);
  const tokens = personNameTokens(key);
  const col = db().collection("searchPeople");
  let found = [];
  if (tokens.length) {
    const t = mostSelective(tokens);
    found = rows(await col.where("namePrefixes", "array-contains", t).select(...PERSON_FIELDS).limit(LIMIT).get());
    // People imported before namePrefixes existed have only whole-word tokens.
    if (!found.length) found = rows(await col.where("nameTokens", "array-contains", t).select(...PERSON_FIELDS).limit(LIMIT).get());
  }
  if (!found.length && key) found = rows(await col.orderBy("nameKey").where("nameKey", ">=", key).where("nameKey", "<=", key + "\uf8ff").select(...PERSON_FIELDS).limit(LIMIT).get());
  const complete = found.length < LIMIT;
  if (tokens.length > 1) found = found.filter(everyWord(tokens));
  // People with current positions first, then by how connected they are.
  const rank = (p) => (p.nameKey === key ? 0 : 1);
  return { items: found.sort((a, b) => rank(a) - rank(b) || (b.currentLinkCount || 0) - (a.currentLinkCount || 0) || (b.linkCount || 0) - (a.linkCount || 0)), complete };
}
async function byNif(digits) {
  const range = (col, field, fields) => db().collection(col).where(field, ">=", digits).where(field, "<", digits + "\uf8ff").select(...fields).limit(LIMIT).get();
  const [c1, c2, p1] = await Promise.all([
    range("searchCompanies", "nif", COMPANY_FIELDS),
    range("searchCompanies", "foreignTaxId", COMPANY_FIELDS),
    range("searchPeople", "nif", PERSON_FIELDS),
  ]);
  const seen = new Set();
  const companies = [...rows(c1), ...rows(c2)].filter((c) => !seen.has(c.id) && seen.add(c.id));
  const exact = (x) => (onlyDigits(x.nif) === digits ? 0 : 1);
  return {
    companies: { items: companies.sort((a, b) => exact(a) - exact(b)), complete: c1.size < LIMIT && c2.size < LIMIT },
    people: { items: rows(p1).sort((a, b) => exact(a) - exact(b)), complete: p1.size < LIMIT },
  };
}

// Short rows for the phone.
const companyRow = (c) => ({
  id: c.id, name: c.name || "", nif: c.nif || "", foreignTaxId: c.foreignTaxId || "", town: c.concelho || c.city || "", sector: c.sector || "", subSector: c.subSector || "",
  caeCode: c.caeCode || "", naceCode: c.naceCode || "", stage: c.stage || "universe", owner: c.owner || null,
  doNotContact: !!c.doNotContact?.on, contactable: c.contactable !== false, targetTierManual: c.targetTierManual || null,
});
const personRow = (p) => ({
  id: p.id, name: p.name || "", entityType: p.entityType || "person", country: p.country || "", nif: p.nif || "",
  linkCount: p.linkCount || 0, currentLinkCount: p.currentLinkCount || 0, matchedCompanyId: p.matchedCompanyId || null,
});

async function search(q) {
  const text = String(q || "").trim().slice(0, 100);
  const digits = nifQuery(text);
  if (!digits && text.length < MIN_NAME) return { companies: [], people: [], mode: "short", companiesComplete: true, peopleComplete: true };
  let companies, people, mode;
  if (digits) { ({ companies, people } = await byNif(digits)); mode = "nif"; }
  else { [companies, people] = await Promise.all([companiesByName(text), peopleByName(text)]); mode = "name"; }
  return {
    mode,
    companies: companies.items.slice(0, MAX_ROWS).map(companyRow), moreCompanies: !companies.complete || companies.items.length > MAX_ROWS,
    people: people.items.slice(0, MAX_ROWS).map(personRow), morePeople: !people.complete || people.items.length > MAX_ROWS,
    // Every match was seen (and fits on screen): the phone may narrow a longer query itself.
    companiesComplete: companies.complete && companies.items.length <= MAX_ROWS,
    peopleComplete: people.complete && people.items.length <= MAX_ROWS,
  };
}

exports.mobileSearch = onCall({ region: REGION }, async (request) => {
  P.requirePerm(request, "search.view");
  try { return await search(request.data?.q); }
  catch (e) { throw new HttpsError("internal", "Search failed — try again.", { reason: "search_failed" }); }
});
exports._internal = { search, nifQuery, companySearchFields, personNameKey, personNameTokens, deburr, mostSelective, LIMIT };
