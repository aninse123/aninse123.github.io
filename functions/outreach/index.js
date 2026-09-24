// Outreach module (Phase 1) — Cloud Functions entry point.
// Spec: "Outreach - Architecture Spec.md" (Documents\Douro Partners).

module.exports = {
  ...require("./send"),        // outreachSend (callable)
  ...require("./webhook"),     // resendWebhook (HTTPS, Svix-signed)
  ...require("./unsubscribe"), // outreachUnsubscribe (HTTPS, douropartners.pt/u/*)
  ...require("./usage"),       // outreachUsageRefresh (every 15 min)
  ...require("./admin"),       // outreachAdmin (callable: seed, clearTestData)
};
