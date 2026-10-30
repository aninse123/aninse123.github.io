// Outreach Phase 3b — who at a company can receive an email: the company
// address, the contacts typed in the Search CRM (company.contacts[]) and the
// People linked to the company (searchPersonLinks → searchPeople) that have
// an email. Used by the send path (to check a chosen recipient really
// belongs to the company) and by the scheduler ("Send to" policy).

const { normEmail, isValidEmail, isFreeMail, domainOf } = require("./util");
const store = require("./store");
const { NOT_DECIDER_RE, SOCIO_RE } = require("./roles"); // 28 Oct: who counts as a decision-maker
const Trust = require("./contact_trust"); // 30 Oct: trust status of an address (switch contacts.trustLabels)

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
  // 28 Oct: roles that never make someone a decision-maker are ignored (insolvency
  // administrators, audit / supervisory boards, representatives… — roles.js), and a
  // "Sócio" / "Partner" with no recorded stake holds a share (R7).
  const kept = (link.mgmtRoles || []).filter((r) => !NOT_DECIDER_RE.test(r));
  const socio = link.mgmtCurrent !== false && kept.some((r) => SOCIO_RE.test(r));
  const roles = kept.filter((r) => !GUO_ROLE_RE.test(r) && !/^shareholder/i.test(r) && !SOCIO_RE.test(r)).join(" ");
  const manages = link.mgmtCurrent !== false && roles.trim().length > 0;
  const share = link.shCurrent === false ? 0 : (Number(link.shTotalPct ?? link.shDirectPct) || 0);
  const holds = share > 0 || (socio && link.shCurrent !== false);
  const s = Math.min(share, 100) / 1000; // tie-break inside a level: larger stake first
  if (isGuoPerson(link, guoName) && (share > 0 || manages || GUO_ROLE_RE.test((link.mgmtRoles || []).join(" ")))) return 200 + s;
  if (share >= 50 && manages) return 180 + s;
  if (share >= 50) return 160 + s;
  if (holds && manages) return 140 + s;
  if (holds) return 120 + s;
  if (manages && TOP_ROLE_RE.test(roles)) return 100;
  if (manages && MANAGER_RE.test(roles)) return 60;
  if (manages) return 40;
  return 0;
}
// Names that aren't one person (joint holdings, estates) or Orbis id numbers.
const NOT_A_PERSON = /(\d+\s*\/\s*\d+|em comum|sem determina|heran[çc]a|herdeiros|cabe[çc]a de casal)|^P?\d{5,}$/i;

// People merge, Stage 4 (20 Oct, switch "search.people"): a person's own
// emails (searchPeople.reach, status OK) come first — one on the company's own
// domain first (company address or website), then the primary — before the
// typed field and Orbis's; bounced / old / hidden ones are never offered. A
// contact person (isContact link) ranks after owners and managers and is left
// out once marked previous. The company's main contact (primaryContact) is
// what "Send to: primary contact" uses. Off: exactly as before.
function companyDomains(company) {
  const d = new Set();
  const e = domainOf(normEmail(company?.companyEmail));
  if (e) d.add(e);
  const w = String(company?.website || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  if (w) d.add(w);
  return d;
}
function personEmailsFor(p, company, usePeople) {
  if (!usePeople) return personEmails(p);
  const doms = companyDomains(company);
  const reach = (p?.reach || []).filter((e) => e && e.type === "email");
  const ok = reach.filter((e) => (e.status || "ok") === "ok")
    .sort((a, b) => (doms.has(domainOf(normEmail(b.value))) - doms.has(domainOf(normEmail(a.value)))) || ((b.primary ? 1 : 0) - (a.primary ? 1 : 0)))
    .map((e) => e.value);
  const notOk = new Set([...reach.filter((e) => (e.status || "ok") !== "ok").map((e) => normEmail(e.value)), ...(p?.hiddenOrbis || []).map((v) => normEmail(v))]);
  return [...ok, ...personEmails(p).filter((e) => !notOk.has(normEmail(e)))];
}

// 30 Oct (switch contacts.trustLabels): the same list with a trust status per address, worked out from the
// detail's origin, what the tool said and whether a person confirmed it (contact_trust.js). A person's own
// emails: typed field = team, Orbis list = database, reach entries by their own fields. Bounced / old / hidden
// ones stay out, as before.
function personEmailsTrust(p, company, usePeople) {
  const norm = (v) => normEmail(v);
  const out = [];
  const seen = new Set();
  const push = (email, entry) => { const k = norm(email); if (!k || seen.has(k)) return; seen.add(k); out.push({ email, trust: Trust.trustOf(entry) }); };
  const doms = companyDomains(company);
  if (usePeople) {
    const reach = (p?.reach || []).filter((e) => e && e.type === "email");
    reach.filter((e) => (e.status || "ok") === "ok")
      .sort((a, b) => (doms.has(domainOf(norm(b.value))) - doms.has(domainOf(norm(a.value)))) || ((b.primary ? 1 : 0) - (a.primary ? 1 : 0)))
      .forEach((e) => push(e.value, e));
    const notOk = new Set([...reach.filter((e) => (e.status || "ok") !== "ok").map((e) => norm(e.value)), ...(p?.hiddenOrbis || []).map((v) => norm(v))]);
    if (p?.email && !notOk.has(norm(p.email))) push(p.email, { origin: "team", type: "email" });
    const orb = Array.isArray(p?.orbisEmails) ? p.orbisEmails.filter(Boolean).slice().reverse() : p?.orbisEmails ? [p.orbisEmails] : (p?.orbisEmail ? [p.orbisEmail] : []);
    orb.filter((e) => !notOk.has(norm(e))).forEach((e) => push(e, { origin: "database", type: "email" }));
    return out;
  }
  if (p?.email) push(p.email, { origin: "team", type: "email" });
  const orb = Array.isArray(p?.orbisEmails) ? p.orbisEmails.filter(Boolean).slice().reverse() : p?.orbisEmails ? [p.orbisEmails] : [];
  orb.forEach((e) => push(e, { origin: "database", type: "email" }));
  if (!out.length && p?.orbisEmail) push(p.orbisEmail, { origin: "database", type: "email" });
  return out;
}

// Returns [{ kind: "company"|"contact"|"person", email, name, role, personId?, isPrimary?, isMain?, rank, personal }]
// (only entries with a valid email), best person first among People.
// opts.usePeople: the search.people switch (People merge, Stage 4).
// opts.trust: { on, includeUnverified } (switch contacts.trustLabels): each address gets `trust`; one the
// campaign may not use (not verified, unless includeUnverified) stays in the list with `blocked: true`
// so a preview can say why, and pickByPolicy / the scheduler skip it.
async function companyRecipients(companyId, company, { usePeople = false, trust = null } = {}) {
  const out = [];
  const seen = new Set();
  const T = trust && trust.on ? trust : null;
  const add = (r) => {
    const email = normEmail(r.email);
    if (!isValidEmail(email) || seen.has(email)) return;
    seen.add(email);
    const { trust: given, ...rest } = r;
    const t = T ? given || "confirmed" : null;
    out.push({ ...rest, email, personal: isFreeMail(domainOf(email)), ...(T ? { trust: t, ...(Trust.usable(t, T.includeUnverified) ? {} : { blocked: true }) } : {}) });
  };
  if (company?.companyEmail) add({ kind: "company", email: company.companyEmail, name: "", role: "Company address", rank: 0, trust: Trust.companyEmailTrust(company) }); // registry / Orbis = tool-verified; confirmed or bounced when that address was
  // Typed contacts come after the People ranking (primary contact first), before the company address.
  (company?.contacts || []).forEach((ct) => add({ kind: "contact", email: ct.email, name: ct.name || "", role: ct.role || "", isPrimary: !!ct.isPrimary, rank: ct.isPrimary ? 20 : 10, trust: Trust.trustOf({ origin: ct.origin || "team", type: "email", status: ct.status, confirmedAt: ct.confirmedAt }) }));
  if (companyId) {
    const links = await db().collection("searchPersonLinks").where("companyId", "==", companyId).limit(60).get();
    // B5 (8 Oct): a company holder is stored as "entity" (People import); the
    // old check looked for "company" and let holdings through.
    const ranked = links.docs.map((d) => ({ id: d.id, ...d.data() })).filter((l) => l.personId && !CORPORATE_HOLDER.includes(l.personEntityType) && !NOT_A_PERSON.test(l.personName || ""))
      .filter((l) => (usePeople ? !(l.isContact && l.contactCurrent === false) : !l.isContact))
      .map((l) => ({ l, rank: rankPerson(l, company?.guoName) })).sort((a, b) => b.rank - a.rank).slice(0, 30);
    if (ranked.length) {
      const snaps = await db().getAll(...ranked.map((x) => db().doc(`searchPeople/${x.l.personId}`)));
      snaps.forEach((s, i) => {
        if (!s.exists) return;
        const p = s.data(), l = ranked[i].l;
        const role = l.isContact ? (l.contactRole || "Contact") : (l.mgmtRoles || []).join(", ") || (l.shTotalPct ? `Shareholder ${l.shTotalPct}%` : "");
        const isMain = usePeople && company?.primaryContact?.personId === s.id;
        if (T) personEmailsTrust(p, company, usePeople).forEach(({ email, trust: tr }) => add({ kind: "person", email, trust: tr, name: p.name || l.personName || "", role, personId: s.id, rank: ranked[i].rank, ...(isMain ? { isMain: true } : {}) }));
        else personEmailsFor(p, company, usePeople).forEach((email) => add({ kind: "person", email, name: p.name || l.personName || "", role, personId: s.id, rank: ranked[i].rank, ...(isMain ? { isMain: true } : {}) }));
      });
    }
  }
  return out;
}

// Campaign "Send to" (spec 3b): company | primary_contact | best_person, each
// falling back to the company address.
function pickByPolicy(all, policy) {
  const recipients = all.filter((r) => !r.blocked); // 30 Oct: an address the campaign may not use (not verified) is never picked
  const company = recipients.find((r) => r.kind === "company") || null;
  if (policy === "primary_contact") {
    const main = recipients.find((r) => r.isMain); // People merge: the company's main contact first
    if (main) return main;
    const c = recipients.filter((r) => r.kind === "contact").sort((a, b) => b.rank - a.rank)[0];
    return c || company;
  }
  if (policy === "best_person") {
    const p = recipients.filter((r) => r.kind === "person" || r.kind === "contact").sort((a, b) => b.rank - a.rank)[0];
    return p || company;
  }
  return company;
}

module.exports = { companyRecipients, pickByPolicy, rankPerson, isGuoPerson, personEmails, personValues, personEmailsFor, personEmailsTrust, companyDomains, CORPORATE_HOLDER };
