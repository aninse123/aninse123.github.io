// outreachRecurring — recurring emails (Phase 5b, "Outreach Phase 5 - People
// Campaigns & Recurring Emails Spec.md" §4). Callable, admins only.
//
// A recurring email = a saved list of people (outreachLists), one sender, a
// base template and a schedule (weekly / monthly / quarterly, Lisbon time).
// On each date the scheduler writes that date's ISSUE (outreachIssues) as a
// draft in To approve. Approving it (content usually edited first) creates a
// hidden people campaign for that issue — one email step, auto-approved,
// paced by the recurring email's max per day — so sending, limits, logging on
// the person's record, bounces and the projection all reuse Phase 5a.
// The unsubscribe link in an issue opts out of that recurring email only
// (outreachOptOuts keyed by the recurring id); complaints stay global.
//
// Actions (request.data.action):
//   save        { recurringId?, recurring }   create (active, next date computed) or update
//   setStatus   { recurringId, status: "active"|"paused" }
//   delete      { recurringId }               waiting drafts are cancelled; sent issues stay
//   issueNow    { recurringId }               write an issue draft now (off-schedule)
//   approveIssue { issueId, subject?, body? } send this issue to the list
//   skipIssue   { issueId }

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { REGION, ADMIN_EMAILS } = require("./config");
const { normEmail } = require("./util");
const store = require("./store");
const { lisbonParts } = require("./schedule_util");
const { CampaignError } = require("./campaign_util");

const { db, FieldValue, Timestamp } = store;
const FREQS = ["weekly", "monthly", "quarterly"];
const MAX_MEMBERS = 5000;

function fail(code, reason, message) { throw new HttpsError(code, message, { reason }); }
const intIn = (v, lo, hi, dflt) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt; };

// Lisbon wall-clock time → the instant (handles summer time).
function lisbonDate(y, m, d, hhmm) {
  const [H, M] = hhmm.split(":").map(Number);
  const want = Date.UTC(y, m - 1, d, H, M);
  let t = want;
  for (let i = 0; i < 3; i++) {
    const p = lisbonParts(new Date(t));
    const [ph, pm] = p.hhmm.split(":").map(Number);
    const diff = want - Date.UTC(p.y, p.m - 1, p.d, ph, pm);
    if (!diff) break;
    t += diff;
  }
  return new Date(t);
}

function normalizeSchedule(s) {
  const freq = FREQS.includes(s?.freq) ? s.freq : "monthly";
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(s?.time || "") ? s.time : "09:30";
  return {
    freq, time,
    weekday: intIn(s?.weekday, 0, 6, 1),        // weekly: 0 = Sunday … 6 = Saturday
    day: intIn(s?.day, 1, 28, 1),               // monthly / quarterly: day of the month (1–28, exists every month)
    startMonth: intIn(s?.startMonth, 1, 3, 1),  // quarterly: 1 = Jan/Apr/Jul/Oct, 2 = Feb/May/…, 3 = Mar/Jun/…
  };
}

// First scheduled instant strictly after `after`.
function nextOccurrence(schedule, after) {
  const s = normalizeSchedule(schedule);
  const p = lisbonParts(after);
  if (s.freq === "weekly") {
    for (let k = 0; k <= 7; k++) {
      const d = new Date(Date.UTC(p.y, p.m - 1, p.d + k));
      if (d.getUTCDay() !== s.weekday) continue;
      const at = lisbonDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), s.time);
      if (at > after) return at;
    }
  }
  for (let k = 0; k <= 13; k++) {
    const idx = p.m - 1 + k, y = p.y + Math.floor(idx / 12), m = (idx % 12) + 1;
    if (s.freq === "quarterly" && (m - s.startMonth + 12) % 3 !== 0) continue;
    const at = lisbonDate(y, m, s.day, s.time);
    if (at > after) return at;
  }
  return null;
}

async function readRecurring(id) {
  if (!id) fail("invalid-argument", "recurring_required", "Choose a recurring email.");
  const snap = await db().doc(`outreachRecurring/${id}`).get();
  if (!snap.exists) fail("not-found", "recurring_not_found", "Recurring email not found.");
  return { id: snap.id, ...snap.data() };
}

async function validate(input, existing) {
  const src = { ...(existing || {}), ...(input || {}) };
  const name = String(src.name || "").trim().slice(0, 100);
  if (!name) fail("invalid-argument", "name_required", "Give the recurring email a name.");
  const listId = String(src.listId || "");
  const templateId = String(src.templateId || "");
  const senderId = normEmail(src.senderId);
  const [list, tpl, sender] = await Promise.all([
    listId ? db().doc(`outreachLists/${listId}`).get() : null,
    templateId ? db().doc(`outreachTemplates/${templateId}`).get() : null,
    senderId ? db().doc(`outreachSenders/${senderId}`).get() : null,
  ]);
  if (!list?.exists) fail("invalid-argument", "list_required", "Choose a list of people (Campaigns → Lists of people).");
  if (!tpl?.exists || tpl.data().status !== "active") fail("invalid-argument", "template_required", "Choose an active template — each issue starts from it.");
  if (!sender?.exists || sender.data().status !== "active") fail("invalid-argument", "sender_required", "Choose an active sender address.");
  return {
    name,
    description: String(src.description || "").trim().slice(0, 500),
    listId, listName: list.data().name || "",
    templateId, templateName: tpl.data().name || "",
    senderId,
    schedule: normalizeSchedule(src.schedule),
    maxPerDay: intIn(src.maxPerDay, 1, 1000, 40),
  };
}

async function save({ recurringId, recurring }, caller) {
  if (!recurringId) {
    const fields = await validate(recurring, null);
    const ref = db().collection("outreachRecurring").doc();
    const next = nextOccurrence(fields.schedule, new Date());
    await ref.set({
      ...fields, status: "active", nextIssueAt: Timestamp.fromDate(next), issueCount: 0, lastIssueId: null, lastIssueAt: null,
      createdAt: FieldValue.serverTimestamp(), createdBy: caller, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller,
    });
    return { recurringId: ref.id, nextIssueAt: next.toISOString() };
  }
  const existing = await readRecurring(recurringId);
  const fields = await validate(recurring, existing);
  const upd = { ...fields, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller };
  if (existing.status === "active" && JSON.stringify(fields.schedule) !== JSON.stringify(existing.schedule)) {
    upd.nextIssueAt = Timestamp.fromDate(nextOccurrence(fields.schedule, new Date()));
  }
  await db().doc(`outreachRecurring/${recurringId}`).update(upd);
  return { recurringId };
}

async function setStatus({ recurringId, status }, caller) {
  if (!["active", "paused"].includes(status)) fail("invalid-argument", "bad_status", `Unknown status "${status}".`);
  const r = await readRecurring(recurringId);
  const upd = { status, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller };
  // Resuming never back-fills missed dates: the next one from now.
  if (status === "active") upd.nextIssueAt = Timestamp.fromDate(nextOccurrence(r.schedule, new Date()));
  await db().doc(`outreachRecurring/${recurringId}`).update(upd);
  return { status };
}

async function cancelDrafts(recurringId, reason) {
  const drafts = await db().collection("outreachIssues").where("recurringId", "==", recurringId).where("status", "==", "draft").get();
  await Promise.all(drafts.docs.map((d) => d.ref.update({ status: "cancelled", cancelledReason: reason })));
  return drafts.size;
}

async function remove({ recurringId }) {
  await readRecurring(recurringId);
  await cancelDrafts(recurringId, "Recurring email deleted");
  await db().doc(`outreachRecurring/${recurringId}`).delete();
  return { ok: true };
}

// Writes an issue draft from the base template. Older waiting drafts of the
// same recurring email are superseded (never two issues waiting at once).
async function createIssue(r, dueAt, by) {
  const tpl = await db().doc(`outreachTemplates/${r.templateId}`).get();
  const v = (tpl.exists ? tpl.data().variants || [] : [])[0] || { subject: r.name, body: "" };
  const superseded = await cancelDrafts(r.id, "Replaced by a newer issue");
  const list = await db().doc(`outreachLists/${r.listId}`).get();
  const settings = await store.getSettings();
  const ref = db().collection("outreachIssues").doc();
  const number = (r.issueCount || 0) + 1;
  await ref.set({
    recurringId: r.id, recurringName: r.name, number, subject: v.subject || r.name, body: v.body || "",
    status: "draft", dueAt: Timestamp.fromDate(dueAt), listId: r.listId, listName: r.listName || "", listCount: list.exists ? list.data().count ?? null : null,
    senderId: r.senderId, maxPerDay: r.maxPerDay || 40, campaignId: null, recipients: null,
    isTest: !!settings.testMode, createdAt: FieldValue.serverTimestamp(), createdBy: by,
  });
  await db().doc(`outreachRecurring/${r.id}`).update({ issueCount: number, lastIssueId: ref.id, lastIssueAt: FieldValue.serverTimestamp() });
  return { issueId: ref.id, number, superseded };
}

async function issueNow({ recurringId }, caller) {
  const r = await readRecurring(recurringId);
  return createIssue(r, new Date(), caller);
}

// Scheduler hook: every active recurring email whose date has come.
async function runRecurring(now) {
  const snap = await db().collection("outreachRecurring").where("status", "==", "active").where("nextIssueAt", "<=", Timestamp.fromDate(now)).get();
  let created = 0;
  for (const d of snap.docs) {
    const r = { id: d.id, ...d.data() };
    try {
      // Claim the date first so an overlapping run can't write it twice.
      const claimed = await db().runTransaction(async (tx) => {
        const cur = await tx.get(d.ref);
        if (!cur.exists || cur.data().status !== "active" || cur.data().nextIssueAt.toMillis() > now.getTime()) return false;
        tx.update(d.ref, { nextIssueAt: Timestamp.fromDate(nextOccurrence(r.schedule, now)) });
        return true;
      });
      if (!claimed) continue;
      await createIssue(r, r.nextIssueAt.toDate(), "scheduler");
      created++;
    } catch (e) { logger.error("runRecurring: issue failed", { recurringId: r.id, message: e.message }); }
  }
  return created;
}

async function approveIssue({ issueId, subject, body }, caller) {
  if (!issueId) fail("invalid-argument", "issue_required", "Choose an issue.");
  if (body != null && (!String(body).trim() || String(body).length > 20000)) fail("invalid-argument", "bad_body", "The message can't be empty (up to 20,000 characters).");
  if (subject != null && (!String(subject).trim() || String(subject).length > 300)) fail("invalid-argument", "bad_subject", "The subject can't be empty (up to 300 characters).");
  const ref = db().doc(`outreachIssues/${issueId}`);
  const issue = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || s.data().status !== "draft") fail("failed-precondition", "not_waiting", "This issue is no longer waiting for approval.");
    tx.update(ref, { status: "approving", approvedBy: caller, approvedAt: FieldValue.serverTimestamp() });
    return { id: s.id, ...s.data() };
  });
  const finalSubject = subject != null ? String(subject).trim() : issue.subject;
  const finalBody = body != null ? String(body).trim() : issue.body;
  const { _internal: C } = require("./campaigns");
  try {
    const members = await db().collection("outreachLists").doc(issue.listId).collection("members").limit(MAX_MEMBERS).get();
    if (members.empty) fail("failed-precondition", "list_empty", `The list "${issue.listName}" has nobody in it.`);
    const tplRef = db().collection("outreachTemplates").doc();
    await tplRef.set({
      name: `${issue.recurringName} — #${issue.number}`, status: "active", kind: "email", purpose: "issue", hidden: true, recurringId: issue.recurringId, issueId, isTest: !!issue.isTest,
      variants: [{ key: "A", subject: finalSubject, body: finalBody }],
      createdAt: FieldValue.serverTimestamp(), createdBy: caller, updatedAt: FieldValue.serverTimestamp(),
    });
    const { campaignId } = await C.save({ campaign: {
      name: `${issue.recurringName} — #${issue.number}`.slice(0, 100),
      description: `Issue ${issue.number} of the recurring email "${issue.recurringName}".`,
      audienceType: "people", approvalDefault: "auto",
      senderPolicy: { mode: "fixed", senderIds: [issue.senderId] },
      pacing: { maxPerDay: issue.maxPerDay || 40 },
      steps: [{ channel: "email", name: "Issue", templateId: tplRef.id }],
    } }, caller);
    await db().doc(`outreachCampaigns/${campaignId}`).update({ kind: "issue", recurringId: issue.recurringId, issueId });
    const people = members.docs.map((m) => m.data());
    const r = await C.enrolPeople({ campaignId, people, source: { type: "manual", label: `List: ${issue.listName}` } }, caller);
    await C.setStatus({ campaignId, status: "active" }, caller);
    await ref.update({ status: "sending", subject: finalSubject, body: finalBody, campaignId, templateId: tplRef.id, recipients: r.enrolled, skipped: r.skipped, edited: subject != null || body != null });
    return { campaignId, enrolled: r.enrolled, skipped: r.skipped, perDay: issue.maxPerDay || 40, days: Math.ceil(r.enrolled / (issue.maxPerDay || 40)) };
  } catch (e) {
    await ref.update({ status: "draft", lastError: e.message || String(e) });
    throw e;
  }
}

async function skipIssue({ issueId }, caller) {
  const ref = db().doc(`outreachIssues/${issueId || "-"}`);
  await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || s.data().status !== "draft") fail("failed-precondition", "not_waiting", "This issue is no longer waiting for approval.");
    tx.update(ref, { status: "skipped", skippedBy: caller, skippedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
}

exports.outreachRecurring = onCall({ region: REGION, timeoutSeconds: 300 }, async (request) => {
  const caller = normEmail(request.auth?.token?.email);
  if (!ADMIN_EMAILS.includes(caller)) fail("permission-denied", "not_admin", "Only Douro admins can manage recurring emails.");
  const data = request.data || {};
  try {
    switch (data.action) {
      case "save": return await save(data, caller);
      case "setStatus": return await setStatus(data, caller);
      case "delete": return await remove(data, caller);
      case "issueNow": return await issueNow(data, caller);
      case "approveIssue": return await approveIssue(data, caller);
      case "skipIssue": return await skipIssue(data, caller);
      default: fail("invalid-argument", "bad_action", `Unknown action "${data.action}".`);
    }
  } catch (e) {
    if (e instanceof CampaignError) throw new HttpsError("invalid-argument", e.message, { reason: e.reason });
    throw e;
  }
});

exports.runRecurring = runRecurring;
exports.nextOccurrence = nextOccurrence;
exports.normalizeSchedule = normalizeSchedule;
exports.lisbonDate = lisbonDate;
