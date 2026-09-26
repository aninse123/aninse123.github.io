// Outreach Phase 3b — who at a company can receive an email: the company
// address, the contacts typed in the Search CRM (company.contacts[]) and the
// People linked to the company (searchPersonLinks → searchPeople) that have
// an email. Used by the send path (to check a chosen recipient really
// belongs to the company) and by the scheduler ("Send to" policy).

const { normEmail, isValidEmail, isFreeMail, domainOf } = require("./util");
const store = require("./store");

const { db } = store;

// Roles that make a person the natural addressee (PT and EN, Orbis wording).
const TOP_ROLE_RE = /(s[óo]cio[- ]?gerente|gerente|administrador|presidente|ceo|chief executive|managing director|director[- ]geral|diretor[- ]geral|general manager|owner|propriet[áa]rio|founder|fundador)/i;
const MANAGER_RE = /(director|diretor|manager|board|conselho|administra)/i;

function rankPerson(link) {
  const roles = (link.mgmtRoles || []).join(" ");
  const current = link.mgmtCurrent !== false && (link.mgmtRoles || []).length > 0;
  const share = Number(link.shTotalPct ?? link.shDirectPct) || 0;
  if (current && TOP_ROLE_RE.test(roles)) return 100 + Math.min(share, 99) / 100;
  if (share >= 50) return 80 + share / 100;
  if (current && MANAGER_RE.test(roles)) return 60;
  if (current) return 40;
  if (share > 0) return 20 + share / 100;
  return 0;
}

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
  (company?.contacts || []).forEach((ct) => add({ kind: "contact", email: ct.email, name: ct.name || "", role: ct.role || "", isPrimary: !!ct.isPrimary, rank: ct.isPrimary ? 50 : 30 }));
  if (companyId) {
    const links = await db().collection("searchPersonLinks").where("companyId", "==", companyId).limit(60).get();
    const ranked = links.docs.map((d) => ({ id: d.id, ...d.data() })).filter((l) => l.personId && l.personEntityType !== "company")
      .map((l) => ({ l, rank: rankPerson(l) })).sort((a, b) => b.rank - a.rank).slice(0, 30);
    if (ranked.length) {
      const snaps = await db().getAll(...ranked.map((x) => db().doc(`searchPeople/${x.l.personId}`)));
      snaps.forEach((s, i) => {
        if (!s.exists) return;
        const p = s.data(), l = ranked[i].l;
        add({ kind: "person", email: p.email, name: p.name || l.personName || "", role: (l.mgmtRoles || []).join(", ") || (l.shTotalPct ? `Shareholder ${l.shTotalPct}%` : ""), personId: s.id, rank: ranked[i].rank });
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

module.exports = { companyRecipients, pickByPolicy, rankPerson };
