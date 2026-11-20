// Remove takes the whole company (20 Nov 2026, switch outreach.removeCompany): Remove on a company ends every live address of it in
// that campaign (root + tracks), cancels their drafts and open tasks, logs who removed it and why; Stop on one address stops only that
// one; other campaigns and the other side (test / real) are left alone. Synthetic data, in-memory Firestore.
const F = require("./fake_firebase.js");
const fns = require("../index.js");
const Feat = require("../features");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const en = (id) => store.get(`outreachEnrolments/${id}`);
const acts = () => [...store.entries()].filter(([p]) => p.startsWith("searchActivities/")).map(([, d]) => d);
const flags = (state) => { store.set("config/features", { flags: { "outreach.removeCompany": { staging: state, production: state } } }); Feat._reset(); };

function seed(state = "on") {
  store.clear();
  store.set("searchCompanies/co1", { name: "EMPRESA, LDA", activeCampaignId: "cmp1", activeCampaignName: "C1", activeEnrolmentId: "en1" });
  store.set("outreachCampaigns/cmp1", { name: "C1", status: "active", steps: [{ id: "s1", channel: "email", templateId: "t1" }] });
  store.set("outreachCampaigns/cmp2", { name: "C2", status: "active", steps: [{ id: "s1", channel: "email", templateId: "t1" }] });
  const base = { campaignName: "C1", companyId: "co1", companyName: "EMPRESA, LDA", currentStep: 1 };
  store.set("outreachEnrolments/en1", { ...base, campaignId: "cmp1", status: "active", recipient: { email: "jose@empresa.pt" } });
  store.set("outreachEnrolments/en1__t1", { ...base, campaignId: "cmp1", status: "awaiting_approval", draftMessageId: "m1", isTrack: true, trackOf: "en1", recipient: { email: "maria@empresa.pt" } });
  store.set("outreachEnrolments/en1__t2", { ...base, campaignId: "cmp1", status: "awaiting_task", taskId: "tk1", isTrack: true, trackOf: "en1", recipient: { email: "geral@empresa.pt" } });
  store.set("outreachEnrolments/en1__t3", { ...base, campaignId: "cmp1", status: "stopped", stopReason: "Email bounced", isTrack: true, trackOf: "en1" });
  store.set("outreachEnrolments/other", { ...base, campaignId: "cmp2", campaignName: "C2", status: "active" });
  store.set("outreachEnrolments/testOne", { ...base, campaignId: "cmp1", status: "active", isTest: true });
  store.set("outreachMessages/m1", { status: "draft", enrolmentId: "en1__t1" });
  store.set("outreachTasks/tk1", { status: "open", enrolmentId: "en1__t2" });
  flags(state);
}

(async () => {
  seed();
  const r = await camp({ action: "enrolment", enrolmentId: "en1__t1", op: "remove", reason: "Dono já vendeu" });
  ok("Remove on one address of the company: every live address in this campaign ends", !r.err && r.removed === 3 && ["en1", "en1__t1", "en1__t2"].every((id) => en(id).status === "removed"));
  ok("…with the reason", en("en1").stopReason === "Dono já vendeu");
  ok("…the draft is cancelled and the open task too", store.get("outreachMessages/m1").status === "cancelled" && store.get("outreachTasks/tk1").status === "cancelled");
  ok("…an address that had already ended stays as it was", en("en1__t3").status === "stopped" && en("en1__t3").stopReason === "Email bounced");
  ok("…another campaign of the same company is left alone", en("other").status === "active");
  ok("…a test enrolment is left alone (real side)", en("testOne").status === "active");
  ok("…the company is no longer held by this campaign", !store.get("searchCompanies/co1").activeCampaignId);
  const a = acts().filter((x) => x.companyId === "co1" && x.type === "outreach_campaign");
  ok("…one Activity on the company: who and why", a.length === 1 && a[0].content === "Removed from C1 by andre.rocha@douropartners.pt: Dono já vendeu (3 addresses)" && a[0].campaignId === "cmp1");
  ok("removing again: nothing live, refused", (await camp({ action: "enrolment", enrolmentId: "en1", op: "remove" })).err?.details?.reason === "not_live");

  seed();
  await camp({ action: "enrolment", enrolmentId: "en1", op: "remove", reason: "" });
  ok("no reason: 'Removed by …' and the Activity says only who", en("en1__t2").stopReason === "Removed by andre.rocha@douropartners.pt" && acts().some((x) => x.content === "Removed from C1 by andre.rocha@douropartners.pt (3 addresses)"));

  seed();
  const s = await camp({ action: "enrolment", enrolmentId: "en1__t1", op: "remove", onlyAddress: true, reason: "wrong person" });
  ok("Stop on one address (onlyAddress): only that address ends", !s.err && en("en1__t1").status === "removed" && en("en1").status === "active" && en("en1__t2").status === "awaiting_task");
  ok("…its draft is cancelled, the other address's task stays open", store.get("outreachMessages/m1").status === "cancelled" && store.get("outreachTasks/tk1").status === "open");
  ok("…no company Activity for one address", !acts().some((x) => x.type === "outreach_campaign"));

  seed();
  await camp({ action: "enrolment", enrolmentId: "testOne", op: "remove" });
  ok("a test enrolment removed: the real ones stay, the note is marked [TEST]", en("en1").status === "active" && acts().some((x) => x.isTest && /^\[TEST\] Removed from C1/.test(x.content)));

  seed("off");
  await camp({ action: "enrolment", enrolmentId: "en1__t1", op: "remove", reason: "x" });
  ok("switch off: as before, only that address ends", en("en1__t1").status === "removed" && en("en1").status === "active" && en("en1__t2").status === "awaiting_task" && !acts().length);

  console.log(fail ? `\n${fail} FAILED` : "\nAll passed");
  process.exit(fail ? 1 : 0);
})();
