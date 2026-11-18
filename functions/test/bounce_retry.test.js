// Another address after a bounce (17 Nov 2026, switch outreach.bounceRetry): the company's general address when the person has no
// other one (automatic, to approve), and "Try another address…" when nothing is left. Synthetic data only.
const F = require("./fake_firebase.js");
const Tracks = require("../outreach/tracks.js");
const OStore = require("../outreach/store.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const en = (id) => store.get(`outreachEnrolments/${id}`);
const co = () => store.get("searchCompanies/co1");
const live = (id) => ["pending", "active", "awaiting_approval", "awaiting_task", "paused"].includes(en(id)?.status);
const ON = { companyFallback: true };
const now = new Date("2026-11-17T10:00:00Z");

// Primetool-like: one person written to, no other address for that person, a general address on the company
function seed({ geral = "geral@empresa.pt", second = false } = {}) {
  store.clear();
  store.set("searchCompanies/co1", { name: "EMPRESA, LDA", ...(geral ? { companyEmail: geral } : {}), contacts: [], outreachStatus: "contacted", activeCampaignId: "cmp1", activeCampaignName: "C", activeEnrolmentId: "en1" });
  store.set("searchPeople/u_1", { name: "José Filipe", reach: [{ id: "r1", type: "email", value: "jose@empresa.pt", status: "ok", primary: true, origin: "team" }, ...(second ? [{ id: "r2", type: "email", value: "jose.filipe@empresa.pt", status: "ok", origin: "team" }] : [])] });
  store.set("searchPersonLinks/u_1__co1", { personId: "u_1", companyId: "co1", personName: "José Filipe", personEntityType: "person", shCurrent: true, shDirectPct: 60, mgmtCurrent: true, mgmtRoles: ["Gerente"] });
  store.set("outreachCampaigns/cmp1", { name: "C", status: "active", recipientPolicy: "best_person", steps: [{ id: "s1", channel: "email", templateId: "t1", wait: { days: 0, unit: "working" } }] });
  store.set("outreachEnrolments/en1", { campaignId: "cmp1", campaignName: "C", companyId: "co1", companyName: "EMPRESA, LDA", status: "active", currentStep: 1, threadId: "th1", senderId: "a@douropartners.pt", recipient: { email: "jose@empresa.pt", kind: "person", personId: "u_1" }, recipientList: ["jose@empresa.pt"] });
}

(async () => {
  // ── (a) automatic ──
  seed();
  ok("switch off: as before, nothing else to try", (await Tracks.onHardBounce("en1", "jose@empresa.pt", now)) === "none" && live("en1"));
  seed();
  const r1 = await Tracks.onHardBounce("en1", "jose@empresa.pt", now, ON);
  const t = en("en1__t1");
  ok("no other address for the person: the general address waits in To approve", r1 === "track" && t && t.recipient.email === "geral@empresa.pt" && t.recipient.kind === "company" && t.status === "pending" && t.forceApproval === true && t.fallbackFrom === "jose@empresa.pt");
  ok("the bounced one is stopped and says the company address waits", en("en1").status === "stopped" && /geral@empresa\.pt \(company address\) waits in To approve/.test(en("en1").stopReason));
  ok("the company stays held by the campaign, on the new address", co().activeCampaignId === "cmp1" && co().activeEnrolmentId === "en1__t1");
  await Tracks.startTracks({ id: "cmp1", _sendingDays: [1, 2, 3, 4, 5, 6, 7], _skipHolidays: false }, now, {});
  ok("it starts (the first email did go out) and is not removed", en("en1__t1").status === "active");
  ok("when the general address bounces too, nothing is left", (await Tracks.onHardBounce("en1__t1", "geral@empresa.pt", now, ON)) === "none");

  seed({ second: true });
  await Tracks.onHardBounce("en1", "jose@empresa.pt", now, ON);
  ok("the person has a second address: that one goes first, not the general one", en("en1__t1").recipient.email === "jose.filipe@empresa.pt" && /same person/.test(en("en1").stopReason));

  seed();
  store.set("outreachEnrolments/en1__t1", { campaignId: "cmp1", companyId: "co1", status: "stopped", stopReason: "Removed", isTrack: true, trackOf: "en1", trackIndex: 1, recipient: { email: "geral@empresa.pt", kind: "company" } });
  ok("the general address already used in this campaign: nothing", (await Tracks.onHardBounce("en1", "jose@empresa.pt", now, ON)) === "none");

  seed();
  await OStore.addSuppression("geral@empresa.pt", { reason: "hard_bounce", source: "test" });
  ok("the general address suppressed: nothing", (await Tracks.onHardBounce("en1", "jose@empresa.pt", now, ON)) === "none");

  seed({ geral: null });
  ok("no general address on the company: nothing", (await Tracks.onHardBounce("en1", "jose@empresa.pt", now, ON)) === "none");

  seed();
  store.set("outreachEnrolments/en1", { ...en("en1"), threadId: null, currentStep: 0 });
  ok("email 1 has not gone out: nothing", (await Tracks.addAlternateAddress("en1", "jose@empresa.pt", "system", ON)) === null);

  seed();
  store.set("searchCompanies/co1", { ...co(), doNotContact: { on: true } });
  ok("a company marked do not contact gets nothing", (await Tracks.addAlternateAddress("en1", "jose@empresa.pt", "system", ON)) === null);

  seed();
  store.set("outreachEnrolments/en1", { ...en("en1"), isTest: true });
  ok("test enrolments are left alone (as before)", (await Tracks.addAlternateAddress("en1", "jose@empresa.pt", "system", ON)) === null);

  seed();
  store.set("outreachCampaigns/cmp1", { ...store.get("outreachCampaigns/cmp1"), addressMax: 1 });
  store.set("outreachEnrolments/en1__t1", { campaignId: "cmp1", companyId: "co1", status: "active", currentStep: 1, isTrack: true, isExtra: true, trackOf: "en1", trackIndex: 1, threadId: "th2", recipient: { email: "maria@empresa.pt", kind: "contact" } });
  ok("the address cap is reached: nothing is added", (await Tracks.addAlternateAddress("en1", "jose@empresa.pt", "system", ON)) === null);

  // others of the company still running: the general address is not added (A2)
  seed();
  store.set("outreachEnrolments/en1__t1", { campaignId: "cmp1", companyId: "co1", status: "active", currentStep: 1, isTrack: true, isExtra: true, trackOf: "en1", trackIndex: 1, threadId: "th2", recipient: { email: "maria@empresa.pt", kind: "contact" } });
  ok("someone else of the company still written to: the bounced one just stops", (await Tracks.onHardBounce("en1", "jose@empresa.pt", now, ON)) === "track" && !en("en1__t2") && live("en1__t1"));

  // ── (b) Try another address… ──
  seed({ second: true });
  store.set("outreachEnrolments/en1", { ...en("en1"), status: "stopped", stopReason: "Email bounced" });
  store.set("searchCompanies/co1", { ...co(), outreachStatus: "bounced", activeCampaignId: null, activeEnrolmentId: null });
  ok("an address that is not the company's is refused", (await Tracks.retryAddress({ enrolmentId: "en1", email: "x@outra.pt" }, "andre", now)).reason === "unknown_address");
  ok("the address that bounced is refused", ["already_used", "bounced_address"].includes((await Tracks.retryAddress({ enrolmentId: "en1", email: "jose@empresa.pt" }, "andre", now)).reason));
  const rr = await Tracks.retryAddress({ enrolmentId: "en1", email: "geral@empresa.pt" }, "andre", now);
  const m = en("en1__t1");
  ok("the chosen address gets email 1, waiting in To approve, at once", rr.ok && rr.id === "en1__t1" && m.status === "active" && m.currentStep === 0 && m.forceApproval === true && m.nextActionAt.toMillis() === now.getTime() && m.fallbackFrom === "jose@empresa.pt" && m.retryBy === "andre");
  ok("the company is held by the campaign again and goes back to contacted", co().activeCampaignId === "cmp1" && co().activeEnrolmentId === "en1__t1" && co().outreachStatus === "contacted");
  ok("a second click is refused", (await Tracks.retryAddress({ enrolmentId: "en1", email: "jose.filipe@empresa.pt" }, "andre", now)).reason === "still_running");

  seed();
  store.set("outreachEnrolments/en1", { ...en("en1"), status: "stopped", stopReason: "Stopped by andre" });
  ok("a company not stopped by a bounce is refused", (await Tracks.retryAddress({ enrolmentId: "en1", email: "geral@empresa.pt" }, "andre", now)).reason === "not_bounced");
  seed();
  store.set("outreachEnrolments/en1", { ...en("en1"), status: "stopped", stopReason: "Email bounced" });
  store.set("searchCompanies/co1", { ...co(), outreachStatus: "unsubscribed" });
  ok("an unsubscribed company is refused", (await Tracks.retryAddress({ enrolmentId: "en1", email: "geral@empresa.pt" }, "andre", now)).reason === "unsubscribed");
  store.set("searchCompanies/co1", { ...co(), outreachStatus: "bounced", doNotContact: { on: true } });
  ok("a company marked do not contact is refused", (await Tracks.retryAddress({ enrolmentId: "en1", email: "geral@empresa.pt" }, "andre", now)).reason === "do_not_contact");
  store.set("searchCompanies/co1", { ...co(), doNotContact: null, activeCampaignId: "cmp9" });
  ok("a company now active in another campaign is refused", (await Tracks.retryAddress({ enrolmentId: "en1", email: "geral@empresa.pt" }, "andre", now)).reason === "other_campaign");
  store.set("searchCompanies/co1", { ...co(), activeCampaignId: null });
  await OStore.addSuppression("geral@empresa.pt", { reason: "unsubscribe", source: "test" });
  ok("a suppressed address is refused", (await Tracks.retryAddress({ enrolmentId: "en1", email: "geral@empresa.pt" }, "andre", now)).reason === "suppressed");
  store.set("outreachCampaigns/cmp1", { ...store.get("outreachCampaigns/cmp1"), status: "finished" });
  ok("a finished campaign is refused", (await Tracks.retryAddress({ enrolmentId: "en1", email: "geral@empresa.pt" }, "andre", now)).reason === "campaign_not_running");

  // a test campaign: works, but leaves the company's fields alone
  seed();
  store.set("outreachCampaigns/cmp1", { ...store.get("outreachCampaigns/cmp1"), isTest: true });
  store.set("outreachEnrolments/en1", { ...en("en1"), isTest: true, status: "stopped", stopReason: "Email bounced" });
  store.set("searchCompanies/co1", { ...co(), outreachStatus: "contacted", activeCampaignId: "cmpReal", activeEnrolmentId: "enReal" });
  const tr = await Tracks.retryAddress({ enrolmentId: "en1", email: "geral@empresa.pt" }, "andre", now);
  ok("test campaign: the address is added, marked test, the company untouched", tr.ok && en("en1__t1").isTest === true && co().activeEnrolmentId === "enReal");

  console.log(fail ? `\n${fail} FAILED` : "\nAll passed");
  process.exit(fail ? 1 : 0);
})();
