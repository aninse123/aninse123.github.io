// People merge, Stage 4 (20 Oct 2026, switch "search.people"): who an email
// can go to reads People — a person's own emails first (the company's own
// domain, then the primary), bounced / old / hidden never offered, contact
// people after owners and managers (not once previous), the company's main
// contact for "Send to: primary contact". Switch off: exactly as before.
// Synthetic data only.
const F = require("./fake_firebase.js");
const { companyRecipients, pickByPolicy } = require("../outreach/recipients.js");
const { evaluateCompany } = require("../outreach/campaign_util.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

(async () => {
  store.clear();
  const company = { name: "EMPRESA, LDA", companyEmail: "geral@empresa.pt", website: "https://www.empresa.pt", contacts: [], primaryContact: { personId: "m_1", name: "Rita Moura", email: "rita@empresa.pt" } };
  store.set("searchCompanies/co1", company);
  store.set("searchPeople/u_1", { name: "João Silva", orbisEmails: ["velho@empresa.pt", "escondido@empresa.pt"], hiddenOrbis: ["escondido@empresa.pt"],
    reach: [{ id: "r1", type: "email", value: "joao.silva@gmail.com", status: "ok", primary: true }, { id: "r2", type: "email", value: "joao@empresa.pt", status: "ok", primary: false }, { id: "r3", type: "email", value: "antigo@empresa.pt", status: "bounced" }, { id: "r4", type: "phone", value: "+351 910 000 000", status: "ok", primary: true }] });
  store.set("searchPeople/m_1", { name: "Rita Moura", source: "manual", reach: [{ id: "r5", type: "email", value: "rita@empresa.pt", status: "ok", primary: true }] });
  store.set("searchPeople/m_2", { name: "Ex Contacto", source: "manual", reach: [{ id: "r6", type: "email", value: "ex@empresa.pt", status: "ok", primary: true }] });
  store.set("searchPersonLinks/u_1__co1", { personId: "u_1", companyId: "co1", personName: "João Silva", personEntityType: "person", shCurrent: true, shDirectPct: 60, mgmtCurrent: true, mgmtRoles: ["Sócio Gerente"], source: "orbis" });
  store.set("searchPersonLinks/m_1__co1", { personId: "m_1", companyId: "co1", personName: "Rita Moura", personEntityType: "person", isContact: true, contactRole: "Diretora financeira", contactCurrent: true, source: "manual" });
  store.set("searchPersonLinks/m_2__co1", { personId: "m_2", companyId: "co1", personName: "Ex Contacto", personEntityType: "person", isContact: true, contactCurrent: false, source: "manual" });

  // ── Switch off: as before ──
  const off = await companyRecipients("co1", company);
  const offEmails = off.map((r) => r.email);
  ok("off: own details and contact people ignored — company address + Orbis emails as before", offEmails.join() === "geral@empresa.pt,escondido@empresa.pt,velho@empresa.pt");
  ok("off: Send to primary contact falls back to the company address", pickByPolicy(off, "primary_contact").email === "geral@empresa.pt");

  // ── Switch on ──
  const on = await companyRecipients("co1", company, { usePeople: true });
  const joao = on.filter((r) => r.personId === "u_1").map((r) => r.email);
  ok("on: João's own emails first — the company's domain before the primary gmail — then Orbis's", joao.join() === "joao@empresa.pt,joao.silva@gmail.com,velho@empresa.pt");
  ok("on: bounced and hidden addresses never offered", !on.some((r) => ["antigo@empresa.pt", "escondido@empresa.pt"].includes(r.email)));
  ok("on: the contact person is offered with their role, after the owner", on.find((r) => r.email === "rita@empresa.pt")?.role === "Diretora financeira" && on.findIndex((r) => r.email === "rita@empresa.pt") > on.findIndex((r) => r.email === "joao@empresa.pt"));
  ok("on: a contact marked previous is left out", !on.some((r) => r.email === "ex@empresa.pt"));
  ok("on: Send to primary contact → the company's main contact", pickByPolicy(on, "primary_contact").email === "rita@empresa.pt");
  ok("on: Send to best person → the owner, at the company's own domain", pickByPolicy(on, "best_person").email === "joao@empresa.pt");
  ok("on: phones are not offered as email recipients", !on.some((r) => /\+351/.test(r.email)));

  // ── Adding to a campaign: a main contact makes the company reachable ──
  const noEmail = { ...company, companyEmail: "" };
  const ex = { contactedWithinDays: 30, allowedStages: ["universe"], requireEmail: true, ownerFilter: null };
  const ctx = { campaignId: "k", exclusions: ex, firstChannel: "email", recipientPolicy: "primary_contact", suppressed: new Set(), now: Date.now(), companyId: "co1" };
  ok("reachable check, switch off: no company email and no old contact → no_email", evaluateCompany({ ...noEmail, stage: "universe" }, ctx).reason === "no_email");
  ok("reachable check, switch on: the main contact's email counts", evaluateCompany({ ...noEmail, stage: "universe" }, { ...ctx, usePeople: true }).ok);

  console.log(fail ? `${fail} people-recipient test(s) FAILED` : "all people-recipient tests passed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
