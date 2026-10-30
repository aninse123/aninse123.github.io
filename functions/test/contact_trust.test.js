// Contact trust labels (30 Oct 2026, switch contacts.trustLabels): one status per address — confirmed,
// tool-verified, not verified or bounced (replaces the others) — worked out from where it came from, what a
// tool said and whether a person confirmed it. A campaign uses confirmed and tool-verified addresses and
// not-verified ones only when it allows them. Switch off: exactly as before. Synthetic data only.
const F = require("./fake_firebase.js");
const T = require("../outreach/contact_trust.js");
const { companyRecipients, pickByPolicy } = require("../outreach/recipients.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

(async () => {
  // ── The status of one detail ──
  ok("an old detail with no origin was typed by the team: confirmed", T.trustOf({ type: "email", value: "a@b.pt", status: "ok" }) === "confirmed");
  ok("typed by the team or given by the person: confirmed", T.trustOf({ origin: "team" }) === "confirmed" && T.trustOf({ origin: "person" }) === "confirmed");
  ok("from the Orbis database: tool-verified", T.trustOf({ origin: "database", type: "email" }) === "tool");
  ok("an email a tool says is valid: tool-verified; one it could not confirm: not verified", T.trustOf({ origin: "enrichment", type: "email", toolStatus: "verified" }) === "tool" && T.trustOf({ origin: "enrichment", type: "email", toolStatus: "unconfirmed" }) === "unverified" && T.trustOf({ origin: "enrichment", type: "email" }) === "unverified");
  ok("a LinkedIn profile or a mobile from a tool is never tool-verified, whatever the tool says", T.trustOf({ origin: "enrichment", type: "linkedin", toolStatus: "verified" }) === "unverified" && T.trustOf({ origin: "enrichment", type: "phone", toolStatus: "verified" }) === "unverified");
  ok("a person confirming it makes it confirmed", T.trustOf({ origin: "enrichment", type: "email", toolStatus: "unconfirmed", confirmedAt: "2026-10-30T10:00:00Z", confirmedBy: "andre.rocha@douropartners.pt" }) === "confirmed");
  ok("bounced replaces every other status, even a confirmed one", T.trustOf({ origin: "team", status: "bounced" }) === "bounced" && T.trustOf({ origin: "enrichment", type: "email", toolStatus: "verified", confirmedAt: "x", status: "bounced" }) === "bounced");
  ok("usable: confirmed and tool-verified by default; not verified only when allowed; bounced never", T.usable("confirmed") && T.usable("tool") && !T.usable("unverified") && T.usable("unverified", true) && !T.usable("bounced") && !T.usable("bounced", true));

  // ── Who an email can go to ──
  store.clear();
  const company = { name: "EMPRESA, LDA", companyEmail: "geral@empresa.pt", website: "https://www.empresa.pt", contacts: [{ name: "Rita", role: "Financeira", email: "rita@empresa.pt" }] };
  store.set("searchCompanies/co1", company);
  const people = {
    u_1: { name: "João Silva", email: "joao.typed@empresa.pt", orbisEmails: ["joao.orbis@empresa.pt"], reach: [
      { id: "r1", type: "email", value: "joao@empresa.pt", status: "ok", primary: true, origin: "enrichment", toolStatus: "verified" },
      { id: "r2", type: "email", value: "joao.guess@empresa.pt", status: "ok", origin: "enrichment", toolStatus: "unconfirmed" },
      { id: "r3", type: "email", value: "joao.old@empresa.pt", status: "bounced", origin: "team" },
      { id: "r4", type: "linkedin", value: "https://linkedin.com/in/joao", status: "ok", origin: "enrichment" }] },
  };
  Object.entries(people).forEach(([id, p]) => store.set(`searchPeople/${id}`, p));
  store.set("searchPersonLinks/u_1__co1", { personId: "u_1", companyId: "co1", personName: "João Silva", personEntityType: "person", shCurrent: true, shDirectPct: 60, mgmtCurrent: true, mgmtRoles: ["Administrador"] });

  const off = await companyRecipients("co1", company, { usePeople: true });
  ok("switch off: no trust field, and the not-verified address is still offered, as before", off.every((r) => r.trust === undefined && r.blocked === undefined) && off.some((r) => r.email === "joao.guess@empresa.pt"));

  const on = await companyRecipients("co1", company, { usePeople: true, trust: { on: true } });
  const by = (e) => on.find((r) => r.email === e);
  ok("on: each address carries its status: tool-verified, typed = confirmed, Orbis = tool-verified, company address = tool-verified, typed company contact = confirmed",
    by("joao@empresa.pt").trust === "tool" && by("joao.typed@empresa.pt").trust === "confirmed" && by("joao.orbis@empresa.pt").trust === "tool" && by("geral@empresa.pt").trust === "tool" && by("rita@empresa.pt").trust === "confirmed");
  ok("on: the not-verified address stays in the list but is blocked; the others are not", by("joao.guess@empresa.pt").trust === "unverified" && by("joao.guess@empresa.pt").blocked === true && !by("joao@empresa.pt").blocked && !by("geral@empresa.pt").blocked);
  ok("on: a bounced address is never offered (as before)", !on.some((r) => r.email === "joao.old@empresa.pt"));
  ok("on: LinkedIn is not an email recipient", !on.some((r) => /linkedin/.test(r.email)));
  ok("on: best person → João's tool-verified address (a tool-verified one is used by default)", pickByPolicy(on, "best_person").email === "joao@empresa.pt");

  // The best person's only address is not verified
  store.set("searchPeople/u_1", { name: "João Silva", reach: [{ id: "r2", type: "email", value: "joao.guess@empresa.pt", status: "ok", origin: "enrichment", toolStatus: "unconfirmed" }] });
  const only = await companyRecipients("co1", company, { usePeople: true, trust: { on: true } });
  ok("only a not-verified address for the best person: the pick skips it (the typed company contact Rita comes next, ranked after owners)", pickByPolicy(only, "best_person").email === "rita@empresa.pt" && only.find((r) => r.email === "joao.guess@empresa.pt").blocked === true);
  const allowedUnv = await companyRecipients("co1", company, { usePeople: true, trust: { on: true, includeUnverified: true } });
  ok("the campaign option allows it: the same address is no longer blocked and is picked", allowedUnv.find((r) => r.email === "joao.guess@empresa.pt").blocked === undefined && pickByPolicy(allowedUnv, "best_person").email === "joao.guess@empresa.pt");
  store.set("searchPeople/u_1", { name: "João Silva", reach: [{ id: "r2", type: "email", value: "joao.guess@empresa.pt", status: "ok", origin: "enrichment", toolStatus: "unconfirmed", confirmedAt: "2026-10-30T10:00:00Z", confirmedBy: "andre.rocha@douropartners.pt" }] });
  const conf = await companyRecipients("co1", company, { usePeople: true, trust: { on: true } });
  ok("once a person confirms it, it is confirmed and used without the option", conf.find((r) => r.email === "joao.guess@empresa.pt").trust === "confirmed" && pickByPolicy(conf, "best_person").email === "joao.guess@empresa.pt");

  // Everything blocked falls back to the company address
  store.set("searchPeople/u_1", { name: "João Silva", reach: [{ id: "r2", type: "email", value: "joao.guess@empresa.pt", status: "ok", origin: "enrichment", toolStatus: "unconfirmed" }] });
  const noContacts = { ...company, contacts: [] };
  const none = await companyRecipients("co1", noContacts, { usePeople: true, trust: { on: true } });
  ok("no usable person address: Send to best person falls back to the company address", pickByPolicy(none, "best_person").email === "geral@empresa.pt");

  // ── The company's general address (30 Oct) ──
  const gen = { companyEmail: "Geral@Empresa.pt" };
  ok("general address: from the registry / Orbis = tool-verified", T.companyEmailTrust(gen) === "tool");
  ok("general address: confirmed by a person for THAT address = confirmed (any capitals)", T.companyEmailTrust({ ...gen, companyEmailConfirmedAt: "2026-10-30T10:00:00Z", companyEmailConfirmedFor: "geral@empresa.pt", companyEmailConfirmedBy: "andre.rocha@douropartners.pt" }) === "confirmed");
  ok("general address: a bounce recorded for that address = bounced, and it replaces a confirmation", T.companyEmailTrust({ ...gen, companyEmailBounce: { email: "geral@empresa.pt" } }) === "bounced" && T.companyEmailTrust({ ...gen, companyEmailConfirmedAt: "x", companyEmailConfirmedFor: "geral@empresa.pt", companyEmailBounce: { email: "geral@empresa.pt" } }) === "bounced");
  ok("general address: when the address is changed, the old confirmation and the old bounce no longer apply", T.companyEmailTrust({ companyEmail: "novo@empresa.pt", companyEmailConfirmedAt: "x", companyEmailConfirmedFor: "geral@empresa.pt", companyEmailBounce: { email: "geral@empresa.pt" } }) === "tool");
  const bouncedCo = { name: "B, LDA", companyEmail: "geral@b.pt", companyEmailBounce: { email: "geral@b.pt" }, contacts: [] };
  store.set("searchCompanies/cb", bouncedCo);
  const rb = await companyRecipients("cb", bouncedCo, { usePeople: true, trust: { on: true, includeUnverified: true } });
  ok("recipients: a bounced general address is Bounced and blocked, even when the campaign allows not-verified ones", rb.find((r) => r.email === "geral@b.pt").trust === "bounced" && rb.find((r) => r.email === "geral@b.pt").blocked === true && pickByPolicy(rb, "company") === null);
  const Store = require("../outreach/store.js");
  store.set("searchCompanies/cm", { name: "M, LDA", companyEmail: "geral@m.pt" });
  ok("a bounce of the company address is recorded on the company, for that address", (await Store.markCompanyEmailBounced("cm", "GERAL@m.pt", "hard bounce", false)) === true && store.get("searchCompanies/cm").companyEmailBounce.email === "geral@m.pt" && store.get("searchCompanies/cm").companyEmailBounce.reason === "hard bounce");
  store.set("searchCompanies/cn", { name: "N, LDA", companyEmail: "geral@n.pt" });
  ok("a bounce of another address (a person's) leaves the company alone; so do test sends and a missing company", (await Store.markCompanyEmailBounced("cn", "ana@n.pt", "hard bounce", false)) === false && (await Store.markCompanyEmailBounced("cn", "geral@n.pt", "x", true)) === false && (await Store.markCompanyEmailBounced("nada", "a@b.pt", "x", false)) === false && store.get("searchCompanies/cn").companyEmailBounce === undefined);

  // ── The campaign option is saved ──
  const { normalizeCampaign } = require("../outreach/campaign_util.js");
  const n1 = normalizeCampaign ? normalizeCampaign({ name: "X", useUnverified: true, steps: [] }, null) : null;
  ok("the campaign saves useUnverified as a boolean, default false", n1 && n1.useUnverified === true && normalizeCampaign({ name: "X", steps: [] }, null).useUnverified === false);

  console.log(fail ? `${fail} contact-trust test(s) FAILED` : "all contact-trust tests passed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
