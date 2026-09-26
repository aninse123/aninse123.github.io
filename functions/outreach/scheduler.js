// outreachScheduler — runs campaign sequences (Phase 2 spec §5, §6). Every 10
// minutes it:
//   1. starts waiting ("pending") enrolments, up to each campaign's
//      new-companies-per-day pace;
//   2. takes enrolments whose next step is due, highest campaign priority
//      first (C9), and for each email step either sends it (automatic) or
//      saves it as a draft for "To approve" (approval, D4).
//
// Limits on sending: only inside the sending window (campaign override or
// Settings → General) and never on national holidays; the automations limit
// (Settings, default 80/day, Resend's UTC day); each address's daily cap;
// the account's daily target; at most MAX_SENDS_PER_RUN per run and one email
// per address per run, a few seconds apart — so each address sends at most
// every 10 minutes. What doesn't fit carries over to the next run or day.
//
// In test mode every campaign email goes to one approved address
// (settings.campaignTestRecipient) — the company is still used for the
// variables and the history, so a campaign can be rehearsed end to end (C10).

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { REGION, RESEND_SEND_KEY, UNSUBSCRIBE_SECRET, DEFAULT_SETTINGS, DEFAULT_SENDER_CAP } = require("./config");
const store = require("./store");
const { prepareEmail, deliverEmail, saveDraft } = require("./send_core");
const { endEnrolment, runDynamicAudience } = require("./campaigns");
const { stepTaskId } = require("./task_util");
const { companyRecipients, pickByPolicy } = require("./recipients");
const { lisbonParts, isWindowOpen, addWait, pickVariant, pickSender, FINAL_GRACE } = require("./schedule_util");

const { db, FieldValue, Timestamp } = store;

const MAX_SENDS_PER_RUN = 4;
const MAX_DRAFTS_PER_RUN = 50;
const MAX_TASKS_PER_RUN = 200;
const DUE_BATCH = 200;
const LOCK_MS = 10 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;

// What a failed check means for the enrolment (reasons from send_core).
const STOP = new Set(["suppressed", "personal_domain", "bad_recipient", "no_mx", "company_not_found", "thread_not_found", "do_not_contact"]);
const STOP_RUN = new Set(["over_target", "daily_quota_exceeded"]);
const DEFER = new Set(["sender_cap", "sender_not_active", "sender_not_usable", "sender_not_found"]);
// test_mode here = the campaign test address isn't on the approved list.
const PAUSE_CAMPAIGN = new Set(["template_not_found", "template_empty", "compliance_missing", "sender_required", "test_mode"]);
const PAUSE_ENROLMENT = new Set(["missing_variables", "content_required"]);

const ts = (d) => Timestamp.fromDate(d);
const randomGap = () => 5000 + Math.floor(Math.random() * 25000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Message id per enrolment and step: a retry after a crash finds the same
// message instead of sending twice.
const stepMessageId = (enrolmentId, stepId) => `${enrolmentId}_${stepId}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);

async function startPending(campaign, now, report) {
  const day = lisbonParts(now).dayKey;
  const already = campaign.startedToday?.day === day ? campaign.startedToday.count || 0 : 0;
  const room = (campaign.pacing?.newPerDay || 20) - already;
  if (room <= 0 || !campaign.steps?.length) return;
  const snap = await db().collection("outreachEnrolments")
    .where("campaignId", "==", campaign.id).where("status", "==", "pending")
    .orderBy("enrolledAt", "asc").limit(room).get();
  let n = 0;
  const firstDue = ts(addWait(now, campaign.steps[0].wait));
  for (const d of snap.docs) {
    const started = await db().runTransaction(async (tx) => {
      const cur = await tx.get(d.ref);
      if (!cur.exists || cur.data().status !== "pending") return false;
      tx.update(d.ref, { status: "active", currentStep: 0, nextActionAt: firstDue, startedAt: ts(now) });
      return true;
    });
    if (started) n++;
  }
  if (n) {
    await db().doc(`outreachCampaigns/${campaign.id}`).update({ startedToday: { day, count: already + n } });
    report.started += n;
  }
}

// Claim an enrolment for this run (a lease, in case two runs overlap).
async function claim(ref, now) {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const e = snap.data();
    if (e.status !== "active") return null;
    if (!e.nextActionAt || e.nextActionAt.toMillis() > now.getTime()) return null;
    if (e.lockUntil && e.lockUntil.toMillis() > now.getTime()) return null;
    tx.update(ref, { lockUntil: ts(new Date(now.getTime() + LOCK_MS)) });
    return e;
  });
}

const unlock = (ref, extra = {}) => ref.update({ lockUntil: null, ...extra });

async function recordSent(ref, e, campaign, step, res, { senderId, variantKey, now }) {
  const nextIndex = e.currentStep + 1;
  const next = campaign.steps[nextIndex];
  await ref.update({
    currentStep: nextIndex,
    nextActionAt: ts(addWait(now, next ? next.wait : FINAL_GRACE)),
    threadId: e.threadId || res.threadId,
    senderId,
    [`variants.${step.id}`]: variantKey,
    history: FieldValue.arrayUnion({ stepId: step.id, at: ts(now), result: "sent", messageId: res.messageId, threadId: res.threadId, variant: variantKey }),
    lastSentAt: ts(now),
    lastError: null,
    attempts: 0,
    draftMessageId: null,
    lockUntil: null,
  });
  await db().doc(`outreachCampaigns/${campaign.id}`).update({
    lockedStepIds: FieldValue.arrayUnion(step.id),
    "stats.sent": FieldValue.increment(1),
  });
}

// A manual step (call, LinkedIn, WhatsApp, letter, visit, other) becomes a
// task for a person; the enrolment waits until it's done or skipped (§5.2 —
// a manual step is never skipped on its own). Assignee: the company owner, or
// the campaign's assignee (C3).
async function createTask(ref, e, campaign, step, now, rand) {
  const taskRef = db().doc(`outreachTasks/${stepTaskId(ref.id, step.id)}`);
  let variantKey = null;
  if (step.channel === "letter" && step.templateId) {
    const t = await db().doc(`outreachTemplates/${step.templateId}`).get();
    variantKey = e.variants?.[step.id] || pickVariant(step.variants, t.exists ? t.data().variants : [], rand());
  }
  return db().runTransaction(async (tx) => {
    const cur = await tx.get(taskRef);
    if (!cur.exists || !["open"].includes(cur.data().status)) {
      tx.set(taskRef, {
        campaignId: campaign.id, campaignName: campaign.name, enrolmentId: ref.id,
        companyId: e.companyId, companyName: e.companyName || "",
        stepId: step.id, stepName: step.name, stepIndex: e.currentStep, stepCount: (campaign.steps || []).length,
        channel: step.channel, instructions: step.instructions || "", templateId: step.templateId || null, variantKey,
        assignee: campaign.assignee && campaign.assignee !== "owner" ? campaign.assignee : (e.owner || null),
        dueAt: ts(now), status: "open", outcome: null, notes: "", activityId: null,
        isTest: !!e.isTest, createdAt: FieldValue.serverTimestamp(), completedAt: null, completedBy: null,
      });
    }
    tx.update(ref, { status: "awaiting_task", taskId: taskRef.id, lockUntil: null, lastError: null, ...(variantKey ? { [`variants.${step.id}`]: variantKey } : {}) });
    return taskRef.id;
  });
}

async function pauseCampaign(campaign, reason) {
  await db().doc(`outreachCampaigns/${campaign.id}`).update({ status: "paused", pauseReason: reason, pausedAt: FieldValue.serverTimestamp(), pausedBy: "scheduler" });
  logger.warn("outreachScheduler: campaign paused", { campaignId: campaign.id, reason });
}

async function runScheduler({ now = new Date(), gap = randomGap, rand = Math.random } = {}) {
  const report = { campaigns: 0, open: 0, started: 0, sent: 0, drafts: 0, tasks: 0, completed: 0, stopped: 0, deferred: 0, retried: 0, paused: 0, stoppedSends: null };
  const settings = await store.getSettings();
  const campSnap = await db().collection("outreachCampaigns").where("status", "==", "active").get();
  report.campaigns = campSnap.size;
  if (campSnap.empty) return report;

  // Dynamic audiences (2c): once per Lisbon day, from 07:00 (C5), whatever the window.
  const lp = lisbonParts(now);
  if (lp.hhmm >= "07:00") {
    for (const d of campSnap.docs) {
      const c = { id: d.id, ...d.data() };
      if (c.audience?.mode !== "dynamic" || c.audience?.lastEvaluatedDay === lp.dayKey) continue;
      try {
        const r = await runDynamicAudience(c, now);
        await d.ref.update({ "audience.lastEvaluatedDay": lp.dayKey });
        report.dynamicAdded = (report.dynamicAdded || 0) + r.enrolled;
      } catch (e) { logger.error("outreachScheduler: dynamic audience failed", { campaignId: c.id, message: e.message }); }
    }
  }

  const globalWindow = settings.sendWindow || DEFAULT_SETTINGS.sendWindow;
  const open = new Map();
  for (const d of campSnap.docs) {
    const c = { id: d.id, ...d.data() };
    if (isWindowOpen(now, c.sendWindow || globalWindow)) open.set(c.id, c);
  }
  report.open = open.size;
  if (!open.size) return report;

  for (const c of open.values()) await startPending(c, now, report);

  const dueSnap = await db().collection("outreachEnrolments")
    .where("status", "==", "active").where("nextActionAt", "<=", ts(now))
    .orderBy("nextActionAt", "asc").limit(DUE_BATCH).get();
  const due = dueSnap.docs.filter((d) => open.has(d.data().campaignId));
  due.sort((a, b) => (open.get(a.data().campaignId).priority || 2) - (open.get(b.data().campaignId).priority || 2)
    || a.data().nextActionAt.toMillis() - b.data().nextActionAt.toMillis());
  if (!due.length) return report;

  const [daily, senderSnap] = await Promise.all([store.getTodayDaily(), db().collection("outreachSenders").get()]);
  const senders = senderSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const sentToday = Object.fromEntries(senders.map((s) => [s.id, daily.bySender?.[store.senderKey(s.id)] || 0]));
  let campaignSent = daily.campaignSent || 0;
  const budget = settings.automationBudget ?? DEFAULT_SETTINGS.automationBudget;
  const usedThisRun = new Set();
  const templates = new Map();
  const redirectTo = settings.testMode ? (settings.campaignTestRecipient || (settings.testRecipients || [])[0]) : null;
  let sendsThisRun = 0;

  for (const doc of due) {
    const campaign = open.get(doc.data().campaignId);
    if (!campaign || campaign.status !== "active") continue; // paused earlier in this run
    const canSend = !report.stoppedSends && sendsThisRun < MAX_SENDS_PER_RUN && campaignSent < budget;
    if (!canSend && report.drafts >= MAX_DRAFTS_PER_RUN && report.tasks >= MAX_TASKS_PER_RUN) break;

    const e = await claim(doc.ref, now);
    if (!e) continue;
    const enrolmentId = doc.id;
    const step = campaign.steps?.[e.currentStep];

    // Phase 3d: a rule on the previous email step ("if they clicked a link"),
    // checked when the next step comes due.
    const prevStep = campaign.steps?.[e.currentStep - 1];
    const clickRule = prevStep && (prevStep.channel || "email") === "email" && !e.rulesApplied?.[prevStep.id]
      ? (prevStep.branches || []).find((b) => b.outcome === "clicked") : null;
    if (clickRule) {
      const pm = await db().doc(`outreachMessages/${stepMessageId(enrolmentId, prevStep.id)}`).get();
      if (pm.exists && pm.data().firstClickedAt) {
        if (clickRule.action === "end") {
          if (await endEnrolment(doc.ref, "completed", "Ended by a rule: clicked a link")) report.completed++;
          continue;
        }
        const target = (campaign.steps || []).findIndex((x) => x.id === clickRule.stepId);
        if (target > e.currentStep) {
          const from = e.lastSentAt ? e.lastSentAt.toDate() : now;
          await unlock(doc.ref, { currentStep: target, nextActionAt: ts(addWait(from, campaign.steps[target].wait)), [`rulesApplied.${prevStep.id}`]: "clicked" });
          report.jumped = (report.jumped || 0) + 1;
          continue;
        }
      }
    }

    // Past the last step (grace period over): done, no reply.
    if (!step) {
      if (await endEnrolment(doc.ref, "completed", "Sequence finished, no reply")) report.completed++;
      continue;
    }
    if (step.channel !== "email") {
      if (report.tasks >= MAX_TASKS_PER_RUN) { await unlock(doc.ref); report.deferred++; continue; }
      await createTask(doc.ref, e, campaign, step, now, rand);
      report.tasks++;
      continue;
    }
    // The step's message may already exist: a draft still waiting, a draft
    // approved in "To approve" (sent now, with any edits), or a retry after a
    // crash (already sent → just record it).
    const messageRef = db().doc(`outreachMessages/${stepMessageId(enrolmentId, step.id)}`);
    const existing = await messageRef.get();
    const m = existing.exists ? existing.data() : null;
    if (m?.status === "draft") { await unlock(doc.ref, { status: "awaiting_approval", draftMessageId: messageRef.id }); continue; }
    if (m && !["failed", "cancelled", "approved"].includes(m.status)) {
      await recordSent(doc.ref, e, campaign, step, { messageId: messageRef.id, threadId: m.threadId }, { senderId: m.senderId, variantKey: m.variantKey, now });
      continue;
    }
    const approved = m?.status === "approved" ? m : null;

    const approval = (step.approval === "inherit" || !step.approval) ? campaign.approvalDefault : step.approval;
    const wantsDraft = approval === "approval" && !approved;
    if (!wantsDraft && !canSend) { await unlock(doc.ref); report.deferred++; continue; }
    if (wantsDraft && report.drafts >= MAX_DRAFTS_PER_RUN) { await unlock(doc.ref); report.deferred++; continue; }

    // Sender: follow-ups keep the address of the first email.
    let senderId = e.senderId || approved?.senderId || null;
    if (senderId) {
      const s = senders.find((x) => x.id === senderId);
      if (!wantsDraft && (usedThisRun.has(senderId) || (s && sentToday[senderId] >= (s.dailyCap || DEFAULT_SENDER_CAP)))) {
        await unlock(doc.ref); report.deferred++; continue;
      }
    } else {
      const args = { policy: campaign.senderPolicy, owner: e.owner, senders, sentToday, defaultCap: DEFAULT_SENDER_CAP };
      const picked = pickSender({ ...args, usedThisRun: wantsDraft ? new Set() : usedThisRun })
        || (wantsDraft ? pickSender({ ...args, usedThisRun: new Set(), sentToday: {} }) : null);
      if (!picked) {
        await unlock(doc.ref, { lastError: "No active sender address with room today." });
        report.deferred++;
        continue;
      }
      senderId = picked.id;
    }

    try {
      if (!templates.has(step.templateId)) {
        const t = step.templateId ? await db().doc(`outreachTemplates/${step.templateId}`).get() : null;
        templates.set(step.templateId, t?.exists ? t.data() : null);
      }
      const tpl = templates.get(step.templateId);
      const variantKey = approved?.variantKey || e.variants?.[step.id] || pickVariant(step.variants, tpl?.variants, rand());
      const isFollowUp = e.currentStep > 0 && e.threadId && !step.newSubject;
      // Phase 3b "Send to": chosen once (first email of the company) and kept.
      let recipient = e.recipient || null;
      if (!isFollowUp && !recipient && (campaign.recipientPolicy || "company") !== "company") {
        const co = await db().doc(`searchCompanies/${e.companyId}`).get();
        const pick = co.exists ? pickByPolicy(await companyRecipients(e.companyId, co.data()), campaign.recipientPolicy) : null;
        if (pick) { recipient = { email: pick.email, name: pick.name || "", kind: pick.kind }; await doc.ref.update({ recipient }); }
      }
      const p = await prepareEmail({
        callerEmail: "scheduler", settings, messageRef,
        threadId: isFollowUp ? e.threadId : null,
        companyId: e.companyId, senderId,
        recipient: isFollowUp ? null : recipient,
        templateId: step.templateId, variantKey,
        // Approved drafts go out as approved (edited subject/body included);
        // every check still runs again now.
        ...(approved ? { subject: approved.isReply ? null : approved.subject, body: approved.draftBody } : {}),
        countsAsOutreach: true, redirectTo,
        // A draft costs no quota; the target is checked again when it's approved.
        confirmOverTarget: wantsDraft,
      });
      const campaignRef = { campaignId: campaign.id, enrolmentId, stepId: step.id, approvedBy: approved?.approvedBy || null };
      if (wantsDraft) {
        await saveDraft(p, { campaign: campaignRef });
        await unlock(doc.ref, { status: "awaiting_approval", draftMessageId: messageRef.id, senderId, [`variants.${step.id}`]: p.variantKey, lastError: null });
        report.drafts++;
        continue;
      }
      if (sendsThisRun > 0 && gap) await sleep(gap());
      const res = await deliverEmail(p, { campaign: campaignRef });
      await recordSent(doc.ref, e, campaign, step, res, { senderId, variantKey: p.variantKey, now });
      sendsThisRun++; campaignSent++; report.sent++;
      sentToday[senderId] = (sentToday[senderId] || 0) + 1;
      usedThisRun.add(senderId);
    } catch (err) {
      const reason = err instanceof HttpsError ? err.details?.reason : null;
      const msg = String(err.message || err).slice(0, 300);
      if (STOP.has(reason)) {
        if (await endEnrolment(doc.ref, "stopped", msg)) report.stopped++;
      } else if (STOP_RUN.has(reason)) {
        await unlock(doc.ref);
        report.stoppedSends = reason;
      } else if (DEFER.has(reason)) {
        await unlock(doc.ref, { lastError: msg });
        report.deferred++;
      } else if (PAUSE_CAMPAIGN.has(reason)) {
        await unlock(doc.ref);
        await pauseCampaign(campaign, msg);
        campaign.status = "paused";
        report.paused++;
      } else if (PAUSE_ENROLMENT.has(reason)) {
        await unlock(doc.ref, { status: "paused", pausedFrom: "active", lastError: msg });
        report.paused++;
      } else {
        const attempts = (e.attempts || 0) + 1;
        if (attempts >= MAX_ATTEMPTS) await unlock(doc.ref, { status: "paused", pausedFrom: "active", attempts, lastError: msg });
        else await unlock(doc.ref, { attempts, lastError: msg, nextActionAt: ts(new Date(now.getTime() + RETRY_MS)) });
        report.retried++;
        logger.error("outreachScheduler: step failed", { enrolmentId, stepId: step.id, reason, message: msg });
      }
    }
  }
  return report;
}

exports.outreachScheduler = onSchedule({
  region: REGION,
  schedule: "every 10 minutes",
  timeZone: "Europe/Lisbon",
  secrets: [RESEND_SEND_KEY, UNSUBSCRIBE_SECRET],
  timeoutSeconds: 540,
  retryCount: 0, // the next run picks up whatever this one left
}, async () => {
  const report = await runScheduler();
  if (report.campaigns) logger.info("outreachScheduler run", report);
});

exports.runScheduler = runScheduler;
exports.stepMessageId = stepMessageId;
