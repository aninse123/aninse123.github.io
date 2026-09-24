// outreachUsageRefresh — keeps the usage bar current on days the portal
// itself sends nothing: every 15 min, one cheap Resend call just to read the
// account-wide quota headers (spec §7.6, verification V7).

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const { REGION, RESEND_READ_KEY } = require("./config");
const { pingForUsage } = require("./resend");
const store = require("./store");

exports.outreachUsageRefresh = onSchedule({ schedule: "every 15 minutes", region: REGION, secrets: [RESEND_READ_KEY] }, async () => {
  try {
    const { quota } = await pingForUsage(RESEND_READ_KEY.value());
    if (quota.daily == null && quota.monthly == null) {
      logger.warn("outreachUsageRefresh: Resend returned no quota headers on /domains (see V7)");
      return;
    }
    await store.recordQuota(quota, "scheduled");
  } catch (e) {
    logger.error("outreachUsageRefresh failed", { message: e.message, status: e.status });
  }
});
