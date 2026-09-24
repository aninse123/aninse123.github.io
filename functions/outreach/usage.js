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
    const { quota, path } = await pingForUsage(RESEND_READ_KEY.value());
    if (quota.daily == null && quota.monthly == null) {
      logger.warn("outreachUsageRefresh: no Resend endpoint returned quota headers (V7)");
      return;
    }
    logger.info("outreachUsageRefresh: quota read", { path, daily: quota.daily, monthly: quota.monthly });
    await store.recordQuota(quota, "scheduled");
  } catch (e) {
    logger.error("outreachUsageRefresh failed", { message: e.message, status: e.status });
  }
});
