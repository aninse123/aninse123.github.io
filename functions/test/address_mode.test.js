// Addresses per company (2 Nov 2026, switch outreach.multiRecipient): the campaign's mode picks a company's addresses
// when it starts; extra addresses carry the mention choices; another person starts the same day, a general address a
// working day later (both are settings). Synthetic data only.
const F = require("./fake_firebase.js");
const Tracks = require("../outreach/tracks.js");
const { pickAddresses } = require("../outreach/recipients.js");
const { normalizeCampaign } = require("../outreach/campaign_util.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const en = (id) => store.get(`outreachEnrolments/${id}`);
const emails = (l) => l.map((r) => r.email).join(",");

const R = (kind, email, rank, extra = {}) => ({ kind, email, name: kind === "company" ? "" : email.split("@")[0], rank, trust: "confirmed", ...extra });
const ALL = [R("company", "geral@e.pt", 0), R("person", "ana@e.pt", 200, { personId: "p1" }), R("person", "ana2@e.pt", 200, { personId: "p1" }), R("person", "rui@e.pt", 120, { personId: "p2" }), R("person", "eva@e.pt", 100, { personId: "p3" }), R("contact", "cont@e.pt", 10)];

(async () => {
  // ── Which addresses ──
  ok("one: the policy's address, as before", emails(pickAddresses(ALL, { mode: "one", policy: "best_person" })) === "ana@e.pt" && emails(pickAddresses(ALL, { mode: "one", policy: "company" })) === "geral@e.pt");
  ok("person_company: the best person, then the company address", emails(pickAddresses(ALL, { mode: "person_company" })) === "ana@e.pt,geral@e.pt");
  ok("people: the best people, each once (a person's second address is not another person), up to the maximum", emails(pickAddresses(ALL, { mode: "people", max: 3 })) === "ana@e.pt,rui@e.pt,eva@e.pt" && emails(pickAddresses(ALL, { mode: "people", max: 2 })) === "ana@e.pt,rui@e.pt");
  ok("all: the people, then the company address, within the maximum", emails(pickAddresses(ALL, { mode: "all", max: 3 })) === "ana@e.pt,rui@e.pt,geral@e.pt" && emails(pickAddresses(ALL, { mode: "all", max: 2 })) === "ana@e.pt,geral@e.pt");
  ok("a blocked or bounced address is never picked", emails(pickAddresses(ALL.map((r) => (r.email === "ana@e.pt" ? { ...r, blocked: true } : r.email === "rui@e.pt" ? { ...r, trust: "bounced" } : r)), { mode: "people", max: 3 })) === "ana2@e.pt,eva@e.pt,cont@e.pt");
  ok("a company with no person: the company address only", emails(pickAddresses([R("company", "geral@e.pt", 0)], { mode: "person_company" })) === "geral@e.pt" && emails(pickAddresses([R("company", "geral@e.pt", 0)], { mode: "people" })) === "");
  ok("never more than 3 addresses", pickAddresses(ALL.concat([R("person", "x@e.pt", 90, { personId: "p4" })]), { mode: "people", max: 9 }).length === 3);

  // ── The campaign settings ──
  const n = normalizeCampaign({ name: "C", steps: [], addressMode: "people", addressMax: 9, startDelayPerson: 2, startDelayCompany: -1 });
  ok("settings: mode kept, maximum capped at 3, delays within 0 to 3", n.addressMode === "people" && n.addressMax === 3 && n.startDelayPerson === 2 && n.startDelayCompany === 1);
  const d = normalizeCampaign({ name: "C", steps: [] });
  ok("defaults: one address, a person the same day, a general address the next working day", d.addressMode === "one" && d.addressMax === 3 && d.startDelayPerson === 0 && d.startDelayCompany === 1);
  ok("an unknown mode is one address", normalizeCampaign({ name: "C", steps: [], addressMode: "everyone" }).addressMode === "one");

  // ── Applying the mode when a company starts ──
  store.clear();
  store.set("searchCompanies/co1", { name: "EMPRESA, LDA", companyEmail: "geral@empresa.pt", contacts: [] });
  store.set("searchPeople/u_1", { name: "João Silva", reach: [{ id: "r1", type: "email", value: "joao@empresa.pt", status: "ok", primary: true, origin: "team" }] });
  store.set("searchPeople/u_2", { name: "Maria Costa", reach: [{ id: "r2", type: "email", value: "maria@empresa.pt", status: "ok", primary: true, origin: "team" }] });
  store.set("searchPersonLinks/u_1__co1", { personId: "u_1", companyId: "co1", personName: "João Silva", personEntityType: "person", shCurrent: true, shDirectPct: 60, mgmtCurrent: true, mgmtRoles: ["Administrador"] });
  store.set("searchPersonLinks/u_2__co1", { personId: "u_2", companyId: "co1", personName: "Maria Costa", personEntityType: "person", shCurrent: true, shDirectPct: 40, mgmtCurrent: false });
  const camp = { id: "cmp1", name: "C", recipientPolicy: "company", addressMode: "all", addressMax: 3, status: "active" };
  store.set("outreachCampaigns/cmp1", camp);
  const mention = [{ companyId: "x1", name: "RGP 316" }];
  store.set("outreachEnrolments/en1", { campaignId: "cmp1", campaignName: "C", companyId: "co1", companyName: "EMPRESA, LDA", status: "active", currentStep: 0, senderId: "a@douropartners.pt", known: mention });
  const ref = require("../outreach/store").db().doc("outreachEnrolments/en1");
  const r = await Tracks.applyAddressMode(camp, ref);
  ok("all: João (60%) is the first address, then Maria, then the company address", r.ok && r.addresses === 3 && en("en1").recipient.email === "joao@empresa.pt" && en("en1").recipient.kind === "person" && JSON.stringify(en("en1").recipientList) === JSON.stringify(["joao@empresa.pt", "maria@empresa.pt", "geral@empresa.pt"]));
  ok("the other two get a track each, with their own kind", en("en1__t1")?.recipient.email === "maria@empresa.pt" && en("en1__t1").recipient.kind === "person" && en("en1__t2")?.recipient.email === "geral@empresa.pt" && en("en1__t2").recipient.kind === "company");
  ok("every track carries the company's mention choices (2 Nov: they were saved on the first address only)", JSON.stringify(en("en1__t1").known) === JSON.stringify(mention) && JSON.stringify(en("en1__t2").known) === JSON.stringify(mention));
  ok("applying it again changes nothing (the addresses are already chosen)", (await Tracks.applyAddressMode(camp, ref)).skipped === "chosen_by_hand" && !en("en1__t3"));
  store.set("outreachEnrolments/en2", { campaignId: "cmp1", campaignName: "C", companyId: "co1", companyName: "EMPRESA, LDA", status: "active", currentStep: 0, recipientList: ["geral@empresa.pt"], recipient: { email: "geral@empresa.pt", kind: "company" } });
  ok("a company whose addresses were chosen by hand (Choose…) is left as chosen", (await Tracks.applyAddressMode(camp, require("../outreach/store").db().doc("outreachEnrolments/en2"))).skipped === "chosen_by_hand");
  ok("mode one does nothing", (await Tracks.applyAddressMode({ ...camp, addressMode: "one" }, ref)).skipped === "mode_one");

  // ── When the extra addresses start ──
  const base = { id: "cmp1", _sendingDays: [1, 2, 3, 4, 5, 6, 7], _skipHolidays: false };
  const now = new Date("2026-11-03T10:00:00Z");
  store.set("outreachEnrolments/en1", { ...en("en1"), threadId: "th1", currentStep: 1 }); // email 1 of the first address has gone out
  await Tracks.startTracks(base, now, {});
  ok("default: another person starts the same day, a general address the next working day", en("en1__t1").status === "active" && en("en1__t1").nextActionAt.toMillis() <= now.getTime() && en("en1__t2").status === "active" && en("en1__t2").nextActionAt.toMillis() > now.getTime() + 20 * 3600 * 1000);
  // settings: person +2, company same day
  store.set("outreachEnrolments/en1__t1", { ...en("en1__t1"), status: "pending", nextActionAt: null });
  store.set("outreachEnrolments/en1__t2", { ...en("en1__t2"), status: "pending", nextActionAt: null });
  await Tracks.startTracks({ ...base, startDelayPerson: 2, startDelayCompany: 0 }, now, {});
  ok("settings: a person +2 working days, the general address the same day", en("en1__t1").nextActionAt.toMillis() > now.getTime() + 40 * 3600 * 1000 && en("en1__t2").nextActionAt.toMillis() <= now.getTime());
  // an older track with no mention gets it when it starts
  store.set("outreachEnrolments/en1__t1", { ...en("en1__t1"), status: "pending", nextActionAt: null, known: undefined, mention: undefined });
  store.set("outreachEnrolments/en1", { ...en("en1"), mention, known: undefined });
  await Tracks.startTracks(base, now, {});
  ok("a track made before this change gets the mention from the first address when it starts", JSON.stringify(en("en1__t1").mention) === JSON.stringify(mention));

  if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
  console.log("\nAll passed");
})();
