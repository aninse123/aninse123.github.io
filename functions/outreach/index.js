// Outreach module — Cloud Functions entry point.
// Spec: "Outreach - Architecture Spec.md" (Documents\Douro Partners).

module.exports = {
  ...require("./send"),        // outreachSend (callable)
  ...require("./webhook"),     // resendWebhook (HTTPS, Svix-signed)
  ...require("./unsubscribe"), // outreachUnsubscribe (HTTPS, douropartners.pt/u/*)
  ...require("./admin"),       // outreachAdmin (callable: seed, clearTestData)
  // Phase 2 — campaigns ("Outreach Phase 2 - Campaigns Spec.md")
  outreachCampaign: require("./campaigns").outreachCampaign,   // callable: save, preview, enrol, status
  outreachScheduler: require("./scheduler").outreachScheduler, // every 10 min: starts enrolments, sends / drafts due steps
  outreachAi: require("./ai").outreachAi,                      // Phase 4: AI opening line (off until key + setting)
  outreachRecurring: require("./recurring").outreachRecurring, // Phase 5b: recurring emails (issues → To approve → paced send)
};
