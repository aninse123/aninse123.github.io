// Outreach Phase 3b — who at a company can receive an email: the company
// address, the contacts typed in the Search CRM (company.contacts[]) and the
// People linked to the company (searchPersonLinks → searchPeople) that have
// an email. Used by the send path (to check a chosen recipient really
// belongs to the company) and by the scheduler ("Send to" policy).

const { normEmail, isValidEmail, isFreeMail, domainOf } = require("./util");
const store = require("./store");

const { db } = store;

// A link to a company (holding, SGPS…) rather than a person.
const CORPORATE_HOLDER = ["entity", "company"];

// Roles that make a person the natural addressee (PT and EN, Orbis wording).
const TOP_ROLE_RE = /(s[óo]cio[- ]?gerente|gerente|administrador|presidente|ceo|chief executive|managing director|director[- ]geral|diretor[- ]geral|general manager|owner|propriet[áa]rio|founder|fundador)/i;
const MANAGER_RE = /(director|diretor|manager|board|conselho|administra)/i;

// People contact data (search.html PERSON_CONTACT_FIELDS): what you typed
// (email / phone) wins; otherwise what Orbis gave — orbisEmails / orbisPhones
// lists (newest last), or the older single orbisEmail / orbisPhone.
function personValues(p, typed, list, legacy) {
  const out = [];
  if (p?.[typed]) out.push(p[typed]);
  const v = p?.[list];
  if (Array.isArray(v)) out.push(...v.filter(Boolean).slice().reverse());
  else if (v) out.push(v);
  if (!out.length && p?.[legacy]) out.push(p[legacy]);
  return out;
}
const personEmails = (p) => personValues(p, "email", "orbisEmails", "orbisEmail");

// "Best person" ranking (André, 10 Oct) — current data only (a former manager or a
// sold stake doesn't count):
//   1. the GUO (Orbis ultimate owner) when it's a person — "Ultimate owner" in the
//      roles, or the company's GUO name — so they come first when they have an email
//   2. majority shareholder (≥ 50%) who manages   3. majority shareholder not managing
//   4. sócio-gerente / owner with a smaller stake (largest first)
//   5. minority shareholders (largest first)      6. hired gerente / CEO / administrador
//   7. other managers   8. any other current role
// Then the typed contacts (primary first) and the company address (pickByPolicy).
const GUO_ROLE_RE = /ultimate owner|benefici[áa]rio efetivo|beneficial owner/i;
const nameKey = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/\b(mr|mrs|ms|miss|dr|dra|eng|sr|sra)\b\.?/g, " ").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
function isGuoPerson(link, guoName) {
  if (GUO_ROLE_RE.test((link.mgmtRoles || []).join(" "))) return true;
  const g = nameKey(guoName), n = nameKey(link.personName);
  return !!g && !!n && (g === n || (g.split(" ").length >= 2 && g.split(" ").every((w) => n.split(" ").includes(w))));
}
function rankPerson(link, guoName = "") {
  const roles = (link.mgmtRoles || []).filter((r) => !GUO_ROLE_RE.test(r) && !/^shareholder/i.test(r)).join(" ");
  const manages = link.mgmtCurrent !== false && roles.trim().length > 0;
  const share = link.shCurrent === false ? 0 : (Number(link.shTotalPct ?? link.shDirectPct) || 0);
  const s = Math.min(share, 100) / 1000; // tie-break inside a level: larger stake first
  if (isGuoPerson(link, guoName) && (share > 0 || manages || GUO_ROLE_RE.test((link.mgmtRoles || []).join(" ")))) return 200 + s;
  if (share >= 50 && manages) return 180 + s;
  if (share >= 50) return 160 + s;
  if (share > 0 && manages) return 140 + s;
  if (share > 0) return 120 + s;
  if (manages && TOP_ROLE_RE.test(roles)) return 100;
  if (manages && MANAGER_RE.test(roles)) return 60;
  if (manages) return 40;
  return 0;
}
// Names that aren't one person (joint holdings, estates) or Orbis id numbers.
const NOT_A_PERSON = /(\d+\s*\/\s*\d+|em comum|sem determina|heran[çc]a|herdeiros|cabe[çc]a de casal)|^P?\d{5,}$/i;

// Returns [{ kind: "company"|"contact"|"person", email, name, role, personId?, isPrimary?, rank, personal }]
// (only entries with a valid email), best person first among People.
async function companyRecipients(companyId, company) {
  const out = [];
  const seen = new Set();
  const add = (r) => {
    const email = normEmail(r.email);
    if (!isValidEmail(email) || seen.has(email)) return;
    seen.add(email);
    out.push({ ...r, email, personal: isFreeMail(domainOf(email)) });
  };
  if (company?.companyEmail) add({ kind: "company", email: company.companyEmail, name: "", role: "Company address", rank: 0 });
  // Typed contacts come after the People ranking (primary contact first), before the company address.
  (company?.contacts || []).forEach((ct) => add({ kind: "contact", email: ct.email, name: ct.name || "", role: ct.role || "", isPrimary: !!ct.isPrimary, rank: ct.isPrimary ? 20 : 10 }));
  if (companyId) {
    const links = await db().collection("searchPersonLinks").where("companyId", "==", companyId).limit(60).get();
    // B5 (8 Oct): a company holder is stored as "entity" (People import); the
    // old check looked for "company" and let holdings through.
    const ranked = links.docs.map((d) => ({ id: d.id, ...d.data() })).filter((l) => l.personId && !CORPORATE_HOLDER.includes(l.personEntityType) && !NOT_A_PERSON.test(l.personName || ""))
      .map((l) => ({ l, rank: rankPerson(l, company?.guoName) })).sort((a, b) => b.rank - a.rank).slice(0, 30);
    if (ranked.length) {
      const snaps = await db().getAll(...ranked.map((x) => db().doc(`searchPeople/${x.l.personId}`)));
      snaps.forEach((s, i) => {
        if (!s.exists) return;
        const p = s.data(), l = ranked[i].l;
        const role = (l.mgmtRoles || []).join(", ") || (l.shTotalPct ? `Shareholder ${l.shTotalPct}%` : "");
        personEmails(p).forEach((email) => add({ kind: "person", email, name: p.name || l.personName || "", role, personId: s.id, rank: ranked[i].rank }));
      });
    }
  }
  return out;
}

// Campaign "Send to" (spec 3b): company | primary_contact | best_person, each
// falling back to the company address.
function pickByPolicy(recipients, policy) {
  const company = recipients.find((r) => r.kind === "company") || null;
  if (policy === "primary_contact") {
    const c = recipients.filter((r) => r.kind === "contact").sort((a, b) => b.rank - a.rank)[0];
    return c || company;
  }
  if (policy === "best_person") {
    const p = recipients.filter((r) => r.kind === "person" || r.kind === "contact").sort((a, b) => b.rank - a.rank)[0];
    return p || company;
  }
  return company;
}

module.exports = { companyRecipients, pickByPolicy, rankPerson, isGuoPerson, personEmails, personValues, CORPORATE_HOLDER };
