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
const { REGION, RESEND_SEND_KEY, RESEND_READ_KEY, UNSUBSCRIBE_SECRET, DEFAULT_SETTINGS, DEFAULT_SENDER_CAP } = require("./config");
const store = require("./store");
const Usage = require("../usage"); // Team & access → Usage
const { prepareEmail, deliverEmail, saveDraft } = require("./send_core");
const { endEnrolment, runDynamicAudience } = require("./campaigns");
const { runRecurring } = require("./recurring");
const { LIVE_ENROLMENT: LIVE_STATUSES } = require("./campaign_util");
const { stepTaskId } = require("./task_util");
const { companyRecipients, pickByPolicy } = require("./recipients");
const { getOpener, ANTHROPIC_API_KEY } = require("./ai");
const Feat = require("../features"); // kill switches (Team & access → Features)
const { lisbonParts, isWindowOpen, addWait, sendingDaysOf, skipHolidaysOf, skipMunicipalOf, waitOptsOf, pickVariant, pickSender, FINAL_GRACE } = require("./schedule_util");
const { isMunicipalHoliday } = require("./places");
const Inbox = require("./inbox"); // one inbox (19 Oct, switch outreach.oneInbox)
const Related = require("./related"); // owner-aware outreach (22 Oct, switch outreach.ownerAware)
const EN = require("./email_name_check"); // email name check (26 Oct, switch search.emailNameCheck)
const Report = require("./report"); // owner-aware outreach, Stage 5: the Monday report
const { normEmail } = require("./util");

const { db, FieldValue, Timestamp } = store;

const MAX_SENDS_PER_RUN = 4;
const MAX_DRAFTS_PER_RUN = 50;
const MAX_TASKS_PER_RUN = 200;
const DUE_BATCH = 200;
const DUE_MAX_PAGES = 10; // at most 2,000 due enrolments looked at per run
const LOCK_MS = 10 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;

// What a failed check means for the enrolment (reasons from send_core).
const STOP = new Set(["suppressed", "personal_domain", "bad_recipient", "no_mx", "company_not_found", "thread_not_found", "do_not_contact"]);
const STOP_RUN = new Set(["over_target", "daily_quota_exceeded"]);
// What a held enrolment shows (Audience → Note), so it never keeps a stale
// reason from an earlier run.
function holdText(reason, msg) {
  if (reason === "daily_quota_exceeded") return "Held: Resend's daily sending quota is used up. Tries again tomorrow in the sending window.";
  return `Held: ${String(msg || "the Resend account reached today's limit.").replace(/\s*Confirm to send anyway\.?\s*$/, "")} Tries again tomorrow in the sending window.`;
}
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
  // People campaigns start as many as their daily email limit allows (P4).
  const perDay = campaign.audienceType === "people" ? (campaign.pacing?.maxPerDay || campaign.pacing?.newPerDay || 20) : (campaign.pacing?.newPerDay || 20);
  const room = perDay - already;
  if (room <= 0 || !campaign.steps?.length) return;
  const snap = await db().collection("outreachEnrolments")
    .where("campaignId", "==", campaign.id).where("status", "==", "pending")
    .orderBy("enrolledAt", "asc").limit(room).get();
  let n = 0;
  const firstDue = ts(addWait(now, campaign.steps[0].wait, campaign._sendingDays, campaign._skipHolidays !== false, campaign._waitStart));
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

// P4: each campaign's own daily email limit (Lisbon day).
const campaignSentToday = (campaign, day) => (campaign.sentToday?.day === day ? campaign.sentToday.count || 0 : 0);

// Owner-aware outreach, Stage 3 (22 Oct, switch "outreach.ownerAware"): the
// approval card's panel — the related companies and their status, worked out
// when the draft is made — and "check the mention" when the template names the
// related companies ({{owner.otherCompanies}}) and some were chosen. Best effort.
async function ownerPanelOnDraft(messageRef, e, campaign, variantBody) {
  try {
    const entry = (await Related.relatedFor([e.companyId])).get(e.companyId);
    const flags = Related.flagsFor(entry, { campaignId: campaign.id, windowDays: campaign.exclusions?.contactedWithinDays || 30 });
    const related = entry.related.slice(0, 6).map((r) => ({ companyId: r.companyId, name: r.name, why: r.why, campaignName: r.campaignName, lastOutreachAt: r.lastOutreachAt, lastReplyAt: r.lastReplyAt, saidNo: r.saidNo, doNotContact: r.doNotContact, email: r.email }));
    const checkMention = !!(e.mention || []).length && /\{\{\s*\??owner\.otherCompan/.test(variantBody || "");
    const mention = (e.mention || []).map((x) => x.name).filter(Boolean); // D6: "This email mentions: X"
    if (related.length || checkMention) await messageRef.update({ ownerPanel: { related, flags, lead: entry.lead, mention }, ...(checkMention ? { checkMention: true } : {}) });
  } catch (err) { logger.warn("outreachScheduler: owner panel", { message: err.message }); }
}
// Email name check (26 Oct, switch "search.emailNameCheck"): a draft whose
// company's email name looks wrong carries the warning to the approval card.
// Best effort.
async function nameCheckOnDraft(messageRef, e) {
  try {
    const snap = await db().doc(`searchCompanies/${e.companyId}`).get();
    if (!snap.exists) return;
    const nc = EN.nameCheckOf({ id: snap.id, ...snap.data() }, snap.id);
    if (nc) await messageRef.update({ nameCheck: { emailName: nc.emailName, source: nc.source, issues: nc.issues, suggestion: nc.suggestion } });
  } catch (err) { logger.warn("outreachScheduler: name check", { message: err.message }); }
}
// Owner-aware outreach, Stage 4: when a company gets its first email, its related
// companies (up to 9) get "Group contacted via X" in their history — an automatic
// entry, never a touch. Real emails only.
async function groupContacted(e, campaign, step) {
  try {
    const entry = (await Related.relatedFor([e.companyId])).get(e.companyId);
    for (const r of entry.related.slice(0, 9)) {
      await db().collection("searchActivities").add({ companyId: r.companyId, type: "outreach_group", date: Timestamp.now(), title: null,
        content: `Group contacted via ${e.companyName || "a related company"} (${step.name || "Email 1"}, campaign "${campaign.name}") — ${r.why.join("; ")}`,
        relatedCompanyId: e.companyId, campaignId: campaign.id, status: null, createdAt: FieldValue.serverTimestamp(), createdBy: "scheduler" });
    }
  } catch (err) { logger.warn("outreachScheduler: group contacted", { message: err.message }); }
}

async function recordSent(ref, e, campaign, step, res, { senderId, variantKey, now }) {
  const nextIndex = e.currentStep + 1;
  const next = campaign.steps[nextIndex];
  await ref.update({
    currentStep: nextIndex,
    nextActionAt: ts(addWait(now, next ? next.wait : FINAL_GRACE, campaign._sendingDays, campaign._skipHolidays !== false, next ? campaign._waitOpts : null)),
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
  const day = lisbonParts(now).dayKey;
  const count = campaignSentToday(campaign, day) + 1;
  campaign.sentToday = { day, count };
  await db().doc(`outreachCampaigns/${campaign.id}`).update({
    lockedStepIds: FieldValue.arrayUnion(step.id),
    "stats.sent": FieldValue.increment(1),
    sentToday: { day, count },
  });
  // An issue of a recurring email (5b) is one email: that person is done once it's out.
  if (!next && campaign.kind === "issue") await endEnrolment(ref, "completed", "Issue sent");
}

// 5b: an issue's campaign with nobody left to send to is finished, and the
// issue marked sent.
async function finishIssueCampaigns(campDocs) {
  let n = 0;
  for (const d of campDocs) {
    const c = d.data();
    if (c.kind !== "issue") continue;
    const live = await db().collection("outreachEnrolments").where("campaignId", "==", d.id).where("status", "in", LIVE_STATUSES).limit(1).get();
    if (!live.empty) continue;
    await d.ref.update({ status: "finished", finishedAt: FieldValue.serverTimestamp(), finishedBy: "scheduler" });
    if (c.issueId) await db().doc(`outreachIssues/${c.issueId}`).update({ status: "sent", sentAt: FieldValue.serverTimestamp() }).catch(() => {});
    n++;
  }
  return n;
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
        companyId: e.companyId || null, companyName: e.companyName || "",
        // F1: a people campaign's task is for the person (Network / Investor CRM / broker record).
        ...(e.personEmail ? { personEmail: e.personEmail, personName: e.personName || "", org: e.org || "", refs: e.refs || [] } : {}),
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

// onlyCampaignId / ignoreWindow: "Run now" in test mode (campaigns.js runNow).
async function runScheduler({ now = new Date(), gap = randomGap, rand = Math.random, onlyCampaignId = null, ignoreWindow = false } = {}) {
  const report = { campaigns: 0, open: 0, started: 0, sent: 0, drafts: 0, tasks: 0, completed: 0, stopped: 0, deferred: 0, retried: 0, paused: 0, stoppedSends: null };
  // Kill switches (production setting — jobs serve both sites): Off stops
  // it all; Test moves / sends test campaigns only.
  const [schedState, sendState, aiState, inboxState, peopleState, waitState, ownerState, nameState] = await Promise.all([Feat.jobState("kill.outreach.scheduler"), Feat.jobState("kill.outreach.sending"), Feat.jobState("kill.ai"), Feat.jobState("outreach.oneInbox"), Feat.jobState("search.people"), Feat.jobState("outreach.waitFromWindowStart"), Feat.jobState("outreach.ownerAware"), Feat.jobState("search.emailNameCheck")]);
  if (schedState === "off") { report.killed = "scheduler"; return report; }
  const allowed = (state, campaign) => state === "on" || (state === "test" && !!campaign.isTest);
  const settings = await store.getSettings();
  // Owner-aware outreach, Stage 5 (22 Oct): the Monday report, once a week.
  if (ownerState !== "off") { try { const wr = await Report.maybeRunWeekly(now, settings, { onlyTest: ownerState === "test" }); if (wr) report.weeklyReport = wr; } catch (e) { logger.error("outreachScheduler: weekly report failed", { message: e.message }); } }
  // Recurring emails (5b): write the issue drafts whose date has come.
  try { const rr = await runRecurring(now); report.issues = rr.created; if (rr.launched) report.issuesLaunched = rr.launched; } catch (e) { logger.error("outreachScheduler: recurring failed", { message: e.message }); }
  const campSnapAll = await db().collection("outreachCampaigns").where("status", "==", "active").get();
  const campSnap0 = onlyCampaignId ? { docs: campSnapAll.docs.filter((d) => d.id === onlyCampaignId), empty: !campSnapAll.docs.some((d) => d.id === onlyCampaignId) } : campSnapAll;
  const campSnap = schedState === "test" ? { docs: campSnap0.docs.filter((d) => d.data().isTest), empty: !campSnap0.docs.some((d) => d.data().isTest) } : campSnap0;
  report.campaigns = campSnap.docs.length;
  if (campSnap.empty) return report;
  try { const f = await finishIssueCampaigns(campSnap.docs); if (f) report.issuesFinished = f; } catch (e) { logger.error("outreachScheduler: finishing issues failed", { message: e.message }); }

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
    c._sendingDays = sendingDaysOf(c, settings); // waits count this campaign's sending days
    c._skipHolidays = skipHolidaysOf(c, settings); // 13 Oct: national holidays skipped unless switched off
    c._skipMunicipal = skipMunicipalOf(c, settings); // 14 Oct: each company's own municipal holiday
    // 21 Oct (switch outreach.waitFromWindowStart): waits end at the window's opening;
    // _waitOpts after an email (with the minimum gap), _waitStart for the rest.
    c._waitOpts = allowed(waitState, c) ? waitOptsOf(c, settings) : null;
    c._waitStart = c._waitOpts ? waitOptsOf(c, settings, { gap: false }) : null;
    if (ignoreWindow || isWindowOpen(now, c.sendWindow || globalWindow, c._skipHolidays)) open.set(c.id, c);
  }
  report.open = open.size;
  if (!open.size) return report;

  for (const c of open.values()) await startPending(c, now, report);

  // Due enrolments of campaigns whose window is open. Pages on when a page is
  // taken up by campaigns outside their window, so those never hold the rest up.
  const due = [];
  let last = null;
  for (let page = 0; page < DUE_MAX_PAGES && due.length < DUE_BATCH; page++) {
    let q = db().collection("outreachEnrolments")
      .where("status", "==", "active").where("nextActionAt", "<=", ts(now))
      .orderBy("nextActionAt", "asc").limit(DUE_BATCH);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    due.push(...snap.docs.filter((d) => open.has(d.data().campaignId)));
    if (snap.size < DUE_BATCH) break;
    last = snap.docs[snap.docs.length - 1];
  }
  due.splice(DUE_BATCH);
  due.sort((a, b) => (open.get(a.data().campaignId).priority || 2) - (open.get(b.data().campaignId).priority || 2)
    || a.data().nextActionAt.toMillis() - b.data().nextActionAt.toMillis());
  if (!due.length) return report;

  const [daily, senderSnap] = await Promise.all([store.getTodayDaily(), db().collection("outreachSenders").get()]);
  const senders = senderSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const sentToday = Object.fromEntries(senders.map((s) => [s.id, daily.bySender?.[store.senderKey(s.id)] || 0]));
  await Usage.senderAlerts(senders.filter((s) => s.status !== "retired").map((s) => ({ id: s.id, sent: sentToday[s.id], cap: s.dailyCap || DEFAULT_SENDER_CAP })));
  let campaignSent = daily.campaignSent || 0;
  const budget = settings.automationBudget ?? DEFAULT_SETTINGS.automationBudget;
  const usedThisRun = new Set();
  // Drafts made in this run, per address (12 Oct): drafts cost no quota, so without
  // this every draft of a run got the same "least used" address — and approved drafts
  // keep it, so they left one per run and all follow-ups piled on one address.
  const draftLoad = {};
  const templates = new Map();
  const testAddress = settings.campaignTestRecipient || (settings.testRecipients || [])[0] || null;
  const redirectTo = settings.testMode ? testAddress : null;
  // 22 Oct (outreach.testCampaigns): a test campaign after go-live sends only to the test address.
  const testRun = (campaign) => !!settings.testMode || !!campaign.isTest;
  let sendsThisRun = 0;
  const companyPlace = new Map(); // 14 Oct: companyId → { concelho, distrito, city }, read once per run
  const inboxRun = new Map(); // one inbox (19 Oct): address → the company that got a first draft / email in this run
  const todayParts = lisbonParts(now);

  for (const doc of due) {
    const campaign = open.get(doc.data().campaignId);
    if (!campaign || campaign.status !== "active") continue; // paused earlier in this run
    const canSend = !report.stoppedSends && sendsThisRun < MAX_SENDS_PER_RUN && campaignSent < budget && allowed(sendState, campaign);
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
          await unlock(doc.ref, { currentStep: target, nextActionAt: ts(addWait(from, campaign.steps[target].wait, campaign._sendingDays, campaign._skipHolidays !== false, campaign._waitOpts)), [`rulesApplied.${prevStep.id}`]: "clicked" });
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
    if (!wantsDraft && !canSend) {
      const why = !allowed(sendState, campaign) ? "Held: automatic sending is switched off (Team & access → Features). Sends again when it's back on."
        : report.stoppedSends ? report.stoppedSendsText
        : campaignSent >= budget ? `Held: today's automations limit (${budget} emails for all campaigns) is reached. Tries again tomorrow.` : null;
      await unlock(doc.ref, why ? { lastError: why } : {});
      report.deferred++; continue;
    }
    if (!wantsDraft && campaign.pacing?.maxPerDay && campaignSentToday(campaign, lisbonParts(now).dayKey) >= campaign.pacing.maxPerDay) {
      await unlock(doc.ref); report.deferred++; report.campaignCap = (report.campaignCap || 0) + 1; continue;
    }
    if (wantsDraft && report.drafts >= MAX_DRAFTS_PER_RUN) { await unlock(doc.ref); report.deferred++; continue; }
    // 14 Oct: today is the company's own municipal holiday → this email waits for its next sending day
    // (drafts are still prepared: a person approves them, and the send itself waits).
    if (!wantsDraft && campaign._skipMunicipal && e.companyId) {
      if (!companyPlace.has(e.companyId)) {
        const co = await db().doc(`searchCompanies/${e.companyId}`).get();
        const d = co.exists ? co.data() : {};
        companyPlace.set(e.companyId, { concelho: d.concelho || "", distrito: d.distrito || "", city: d.city || "" });
      }
      if (isMunicipalHoliday(companyPlace.get(e.companyId), todayParts)) {
        await unlock(doc.ref, { nextActionAt: ts(addWait(now, { days: 1, unit: "working" }, campaign._sendingDays, campaign._skipHolidays !== false, campaign._waitStart)) });
        report.municipalHoliday = (report.municipalHoliday || 0) + 1;
        continue;
      }
    }

    // Sender: follow-ups keep the address of the first email.
    let senderId = e.senderId || approved?.senderId || null;
    let pickedNow = false;
    if (senderId) {
      const s = senders.find((x) => x.id === senderId);
      if (!wantsDraft && (usedThisRun.has(senderId) || (s && sentToday[senderId] >= (s.dailyCap || DEFAULT_SENDER_CAP)))) {
        await unlock(doc.ref); report.deferred++; continue;
      }
    } else {
      pickedNow = true;
      const load = wantsDraft ? Object.fromEntries(senders.map((x) => [x.id, (sentToday[x.id] || 0) + (draftLoad[x.id] || 0)])) : sentToday;
      const args = { policy: campaign.senderPolicy, owner: e.owner, senders, sentToday: load, defaultCap: DEFAULT_SENDER_CAP };
      const picked = pickSender({ ...args, usedThisRun: wantsDraft ? new Set() : usedThisRun })
        || (wantsDraft ? pickSender({ ...args, usedThisRun: new Set(), sentToday: {} }) : null);
      if (!picked) {
        await unlock(doc.ref, { lastError: "No active sender address with room today." });
        report.deferred++;
        continue;
      }
      senderId = picked.id;
      if (wantsDraft) draftLoad[senderId] = (draftLoad[senderId] || 0) + 1;
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
      if (!e.personEmail && !isFollowUp && !recipient && (campaign.recipientPolicy || "company") !== "company") {
        const co = await db().doc(`searchCompanies/${e.companyId}`).get();
        const pick = co.exists ? pickByPolicy(await companyRecipients(e.companyId, co.data(), { usePeople: allowed(peopleState, campaign) }), campaign.recipientPolicy) : null;
        if (pick) { recipient = { email: pick.email, name: pick.name || "", kind: pick.kind }; await doc.ref.update({ recipient }); }
      }
      // One inbox (19 Oct, switch "outreach.oneInbox"): before a company's
      // first email, its address mustn't have had an email through another
      // company inside the window, a first draft waiting for another company,
      // or one earlier in this run. Held, not ended: it waits and tries again.
      if (!isFollowUp && !e.threadId && !e.personEmail && e.companyId && allowed(inboxState, campaign)) {
        let addr = recipient?.email || null;
        if (!addr) { const co = await db().doc(`searchCompanies/${e.companyId}`).get(); addr = co.exists ? co.data().companyEmail : e.contactEmail; }
        addr = normEmail(addr);
        const windowDays = campaign.exclusions?.contactedWithinDays ?? 30;
        const c = addr ? await Inbox.clash({ email: addr, companyId: e.companyId, isTest: testRun(campaign), windowDays, now, thisRun: inboxRun }) : null;
        if (c) {
          const nextDay = addWait(now, { days: 1, unit: "working" }, campaign._sendingDays, campaign._skipHolidays !== false, campaign._waitStart);
          const until = c.untilMs && c.untilMs > nextDay.getTime() ? new Date(c.untilMs) : nextDay;
          const text = Inbox.holdText(c, until.getTime(), addr);
          const again = e.holdKind === "same_inbox" && e.holdReason?.companyId === c.companyId;
          if (pickedNow && wantsDraft) draftLoad[senderId] = Math.max(0, (draftLoad[senderId] || 1) - 1);
          await unlock(doc.ref, { nextActionAt: ts(until), holdKind: "same_inbox", holdReason: { why: c.kind, email: addr, companyId: c.companyId, companyName: c.companyName || "", at: c.at ? ts(new Date(c.at)) : null, until: ts(until) }, lastError: text });
          if (!again) await Inbox.logHold({ companyId: e.companyId, text, isTest: testRun(campaign), campaignId: campaign.id, enrolmentId });
          report.inboxHeld = (report.inboxHeld || 0) + 1;
          continue;
        }
        if (addr) inboxRun.set(addr, { companyId: e.companyId, companyName: e.companyName || "", at: now.getTime() });
        if (e.holdKind) await doc.ref.update({ holdKind: null, holdReason: null });
      }
      // Phase 4: {{ai.opener}} is written only for drafts (a person approves
      // it). If AI isn't available the field stays empty — the template's
      // fallback ({{ai.opener|…}}) is used, or the company pauses with the reason.
      let aiOpener = "";
      const variantBody = ((tpl?.variants || []).find((v) => v.key === variantKey) || (tpl?.variants || [])[0] || {}).body || "";
      if (wantsDraft && allowed(aiState, campaign) && /\{\{\s*ai\.opener/.test(variantBody)) {
        try {
          aiOpener = (await getOpener({ companyId: e.companyId, templateId: step.templateId, templateBody: variantBody, settings, apiKey: ANTHROPIC_API_KEY.value() })).text;
        } catch (aiErr) { logger.warn("outreachScheduler: AI opener unavailable", { enrolmentId, reason: aiErr.details?.reason || aiErr.message }); }
      }
      const p = await prepareEmail({
        callerEmail: "scheduler", settings, messageRef,
        threadId: isFollowUp ? e.threadId : null,
        companyId: e.companyId, senderId,
        recipient: isFollowUp || e.personEmail ? null : recipient,
        // Phase 5: a person (investor, broker, journalist…), not a company.
        person: !isFollowUp && e.personEmail ? { email: e.personEmail, name: e.personName, org: e.org, refs: e.refs } : null,
        aiOpener,
        templateId: step.templateId, variantKey,
        footer: campaign.footer, // CCSL: the campaign's choice, else the conversation's / Settings
        campaignFields: { sector: campaign.sector || "" }, // {{campaign.sector}}
        // 22 Oct (owner-aware): the related companies chosen to be mentioned ({{owner.otherCompanies}}).
        otherCompanies: allowed(ownerState, campaign) ? (e.mention || []).map((x) => x.name) : [],
        // Approved drafts go out as approved (edited subject/body included);
        // every check still runs again now.
        ...(approved ? { subject: approved.isReply ? null : approved.subject, body: approved.draftBody } : {}),
        // I21: a campaign started by someone with an approved test address
        // sends its test emails there; otherwise the general test address.
        countsAsOutreach: true, redirectTo: testRun(campaign) && testAddress ? (campaign.testRecipient || testAddress) : null,
        testCampaign: !!campaign.isTest, // marks it test and redirects it even when Outreach is live
        // A draft costs no quota; the target is checked again when it's approved.
        confirmOverTarget: wantsDraft,
      });
      const campaignRef = { campaignId: campaign.id, enrolmentId, stepId: step.id, approvedBy: approved?.approvedBy || null, kind: campaign.issueId ? "recurring" : "campaign" };
      if (wantsDraft) {
        await saveDraft(p, { campaign: campaignRef });
        if (allowed(ownerState, campaign) && e.companyId) await ownerPanelOnDraft(messageRef, e, campaign, variantBody);
        if (allowed(nameState, campaign) && e.companyId) await nameCheckOnDraft(messageRef, e); // 26 Oct (search.emailNameCheck)
        await unlock(doc.ref, { status: "awaiting_approval", draftMessageId: messageRef.id, senderId, [`variants.${step.id}`]: p.variantKey, lastError: null, ...(e.holdKind ? { holdKind: null, holdReason: null } : {}) });
        report.drafts++;
        continue;
      }
      if (sendsThisRun > 0 && gap) await sleep(gap());
      const res = await deliverEmail(p, { campaign: campaignRef });
      await recordSent(doc.ref, e, campaign, step, res, { senderId, variantKey: p.variantKey, now });
      if (allowed(ownerState, campaign) && e.currentStep === 0 && e.companyId && !e.isTest && !testRun(campaign)) await groupContacted(e, campaign, step);
      if (e.holdKind) await doc.ref.update({ holdKind: null, holdReason: null });
      sendsThisRun++; campaignSent++; report.sent++;
      sentToday[senderId] = (sentToday[senderId] || 0) + 1;
      usedThisRun.add(senderId);
    } catch (err) {
      const reason = err instanceof HttpsError ? err.details?.reason : null;
      const msg = String(err.message || err).slice(0, 300);
      if (STOP.has(reason)) {
        if (await endEnrolment(doc.ref, "stopped", msg)) report.stopped++;
      } else if (STOP_RUN.has(reason)) {
        report.stoppedSends = reason;
        report.stoppedSendsText = holdText(reason, msg);
        await unlock(doc.ref, { lastError: report.stoppedSendsText });
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
  secrets: [RESEND_SEND_KEY, RESEND_READ_KEY, UNSUBSCRIBE_SECRET, ANTHROPIC_API_KEY],
  timeoutSeconds: 540,
  retryCount: 0, // the next run picks up whatever this one left
}, async () => {
  const report = await runScheduler();
  if (report.campaigns) logger.info("outreachScheduler run", report);
});

exports.runScheduler = runScheduler;
exports.stepMessageId = stepMessageId;
