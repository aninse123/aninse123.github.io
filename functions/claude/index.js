// Claude connector (read only) — Infrastructure hub, build plan v2, 13 Nov 2026.
//
//   claudeMcp      HTTP: the connector address Claude talks to (MCP + sign-in)
//   claudeConnect  callable: the sign-in page's Allow step and the Admin's Claude tab
//   claudeJob      daily 06:00 Lisbon: company index, log and token clean-up
//
// Release switch claude.connector (production setting): Off refuses everything,
// Test lets the testers (and the Admin) in, On everyone with Claude access ticked.

const { onRequest, onCall } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const U = require("./util");

exports.claudeMcp = onRequest({ region: U.REGION, memory: "1GiB", timeoutSeconds: 120, concurrency: 20, maxInstances: 5, invoker: "public" }, (req, res) => require("./server").handle(req, res));
exports.claudeConnect = onCall({ region: U.REGION, memory: "1GiB", timeoutSeconds: 300 }, (request) => require("./connect").handleConnect(request));
exports.claudeJob = onSchedule({ region: U.REGION, schedule: "0 6 * * *", timeZone: "Europe/Lisbon", memory: "1GiB", timeoutSeconds: 540 }, async () => {
  const r = await require("./connect").dailyJob();
  logger.info("claude job", r);
});
