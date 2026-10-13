// Outbox "Back to To approve" (13 Oct 2026): an approved campaign draft that
// hasn't gone out goes back to the queue — the reverse of approve. Synthetic data.
const F = require("./fake_firebase.js");
global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" });
const fns = require("../index.js");
const { store } = F;
let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const INTERN = { auth: { token: { email: "maria@douropartners.pt", perms: ["out.view", "out.draft", "out.campaigns"], key: "maria" } } };
const camp = async (who, data) => { try { return await fns.outreachCampaign({ ...who, data }); } catch (e) { return { err: e }; } };
const reason = (r) => r?.err?.details?.reason;

(async () => {
  store.clear();
  store.set("outreachSettings/global", { testMode: false });
  store.set("outreachCampaigns/c1", { name: "C", status: "active", steps: [{ id: "s1" }] });
  store.set("outreachEnrolments/e1", { campaignId: "c1", status: "active", currentStep: 0, nextActionAt: new Date() });
  store.set("outreachMessages/m1", { source: "campaign", status: "approved", enrolmentId: "e1", campaignId: "c1", approvedBy: "andre.rocha@douropartners.pt" });

  ok("intern without approve permission → refused", !!(await camp(INTERN, { action: "unapprove", messageId: "m1" })).err);
  let r = await camp(ADMIN, { action: "unapprove", messageId: "m1" });
  ok("approved → back to draft; the company waits in To approve again", r.ok && store.get("outreachMessages/m1").status === "draft" && store.get("outreachMessages/m1").approvedBy === null
    && store.get("outreachEnrolments/e1").status === "awaiting_approval" && store.get("outreachEnrolments/e1").draftMessageId === "m1" && store.get("outreachMessages/m1").unapprovedBy === "andre.rocha@douropartners.pt");
  ok("a draft (not approved) → refused", reason(await camp(ADMIN, { action: "unapprove", messageId: "m1" })) === "not_approved");

  store.set("outreachMessages/m1", { source: "campaign", status: "approved", enrolmentId: "e1", campaignId: "c1" });
  store.set("outreachEnrolments/e1", { campaignId: "c1", status: "active", currentStep: 0, lockUntil: F.Timestamp.fromDate(new Date(Date.now() + 60000)) });
  ok("while the scheduler is sending it → refused", reason(await camp(ADMIN, { action: "unapprove", messageId: "m1" })) === "sending_now");
  store.set("outreachMessages/m2", { source: "campaign", status: "sent", enrolmentId: "e1" });
  ok("already sent → refused", reason(await camp(ADMIN, { action: "unapprove", messageId: "m2" })) === "not_approved");

  if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
  console.log("\nALL PASSED");
})();
