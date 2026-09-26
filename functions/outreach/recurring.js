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

const P = require("../access/perms"); // team access: who may call what
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { REGION, ADMIN_EMAILS, RESEND_SEND_KEY, RESEND_READ_KEY, SENDER_DOMAIN } = require("./config");
const { normEmail, domainOf } = require("./util");
const { sendEmail } = require("./resend");
const { listPeople } = require("./lists");
const store = require("./store");
const { lisbonParts } = require("./schedule_util");
const { CampaignError } = require("./campaign_util");

const { db, FieldValue, Timestamp } = store;
const FREQS = ["weekly", "monthly", "quarterly"];
const MAX_MEMBERS = 5000;
const DRAFT_LEAD_MS = 24 * 3600 * 1000; // issues are drafted a day before their date

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

async function cancelDrafts(recurringId, reason, statuses = ["draft"]) {
  const drafts = await db().collection("outreachIssues").where("recurringId", "==", recurringId).where("status", "in", statuses).get();
  await Promise.all(drafts.docs.map((d) => d.ref.update({ status: "cancelled", cancelledReason: reason })));
  return drafts.size;
}

async function remove({ recurringId }) {
  await readRecurring(recurringId);
  await cancelDrafts(recurringId, "Recurring email deleted", ["draft", "approved"]);
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

// Scheduler hook. Issues are drafted a day before their date (DRAFT_LEAD),
// so there's time to edit and approve; an approved issue goes out on its date.
async function runRecurring(now) {
  const horizon = new Date(now.getTime() + DRAFT_LEAD_MS);
  const snap = await db().collection("outreachRecurring").where("status", "==", "active").where("nextIssueAt", "<=", Timestamp.fromDate(horizon)).get();
  let created = 0, launched = 0;
  for (const d of snap.docs) {
    const r = { id: d.id, ...d.data() };
    try {
      // Claim the date first so an overlapping run can't write it twice.
      const sendAt = await db().runTransaction(async (tx) => {
        const cur = await tx.get(d.ref);
        if (!cur.exists || cur.data().status !== "active" || cur.data().nextIssueAt.toMillis() > horizon.getTime()) return null;
        const at = cur.data().nextIssueAt.toDate();
        tx.update(d.ref, { nextIssueAt: Timestamp.fromDate(nextOccurrence(r.schedule, at)) });
        return at;
      });
      if (!sendAt) continue;
      await createIssue(r, sendAt, "scheduler");
      created++;
    } catch (e) { logger.error("runRecurring: issue failed", { recurringId: r.id, message: e.message }); }
  }
  // Issues approved ahead of their date go out once it comes.
  const approved = await db().collection("outreachIssues").where("status", "==", "approved").get();
  for (const d of approved.docs) {
    if (d.data().dueAt.toMillis() > now.getTime()) continue;
    try { await launch(d.id, d.data().approvedBy || "scheduler"); launched++; }
    catch (e) { logger.error("runRecurring: launch failed", { issueId: d.id, message: e.message }); }
  }
  return { created, launched };
}

function checkContent(subject, body) {
  if (body != null && (!String(body).trim() || String(body).length > 20000)) fail("invalid-argument", "bad_body", "The message can't be empty (up to 20,000 characters).");
  if (subject != null && (!String(subject).trim() || String(subject).length > 300)) fail("invalid-argument", "bad_subject", "The subject can't be empty (up to 300 characters).");
}

// Approve: before its date → "approved" (the scheduler sends it on the date);
// on or after its date → out now.
async function approveIssue({ issueId, subject, body }, caller) {
  if (!issueId) fail("invalid-argument", "issue_required", "Choose an issue.");
  checkContent(subject, body);
  const ref = db().doc(`outreachIssues/${issueId}`);
  const issue = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || s.data().status !== "draft") fail("failed-precondition", "not_waiting", "This issue is no longer waiting for approval.");
    const upd = { status: "approved", approvedBy: caller, approvedAt: FieldValue.serverTimestamp(), lastError: null, edited: subject != null || body != null };
    if (subject != null) upd.subject = String(subject).trim();
    if (body != null) upd.body = String(body).trim();
    tx.update(ref, upd);
    return { id: s.id, ...s.data(), ...upd };
  });
  if (issue.dueAt.toMillis() > Date.now()) {
    const { people } = await listPeople(issue.listId);
    const perDay = issue.maxPerDay || 40;
    return { scheduled: true, sendAt: issue.dueAt.toDate().toISOString(), listSize: people.length, perDay, days: Math.ceil(people.length / perDay) };
  }
  return launch(issueId, caller);
}

// Creates the issue's own people campaign (one email step, auto-approved,
// paced by the recurring email's max per day) from the list as it is now.
async function launch(issueId, caller) {
  const ref = db().doc(`outreachIssues/${issueId}`);
  const issue = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || s.data().status !== "approved") fail("failed-precondition", "not_approved", "This issue isn't approved.");
    tx.update(ref, { status: "launching" });
    return { id: s.id, ...s.data() };
  });
  const { _internal: C } = require("./campaigns");
  try {
    const { people } = await listPeople(issue.listId, MAX_MEMBERS);
    if (!people.length) fail("failed-precondition", "list_empty", `The list "${issue.listName}" has nobody in it.`);
    const tplRef = db().collection("outreachTemplates").doc();
    await tplRef.set({
      name: `${issue.recurringName} — #${issue.number}`, status: "active", kind: "email", purpose: "issue", hidden: true, recurringId: issue.recurringId, issueId, isTest: !!issue.isTest,
      variants: [{ key: "A", subject: issue.subject, body: issue.body }],
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
    const r = await C.enrolPeople({ campaignId, people, source: { type: "manual", label: `List: ${issue.listName}` } }, caller);
    await C.setStatus({ campaignId, status: "active" }, caller);
    await ref.update({ status: "sending", campaignId, templateId: tplRef.id, recipients: r.enrolled, skipped: r.skipped, launchedAt: FieldValue.serverTimestamp() });
    const perDay = issue.maxPerDay || 40;
    return { campaignId, enrolled: r.enrolled, skipped: r.skipped, perDay, days: Math.ceil(r.enrolled / perDay) };
  } catch (e) {
    // Back to the queue with the reason; the edited content is kept.
    await ref.update({ status: "draft", lastError: e.message || String(e) });
    throw e;
  }
}

// "Send a test to me": the issue exactly as a person on the list would get it
// (their name and organisation filled in), to the admin who asked. Nothing is
// recorded as a conversation; the unsubscribe link is inactive in a test.
async function testIssue({ issueId, subject, body }, caller) {
  checkContent(subject, body);
  const snap = await db().doc(`outreachIssues/${issueId || "-"}`).get();
  if (!snap.exists) fail("not-found", "issue_not_found", "Issue not found.");
  const issue = snap.data();
  const { people } = await listPeople(issue.listId, 1);
  const sample = people[0] || { name: "", org: "" };
  const settings = await store.getSettings();
  const { prepareEmail } = require("./send_core");
  const p = await prepareEmail({
    callerEmail: caller, settings, messageRef: db().collection("outreachMessages").doc(),
    senderId: issue.senderId, subject: subject ?? issue.subject, body: body ?? issue.body,
    person: { email: caller, name: sample.name || "", org: sample.org || "", refs: [] },
    countsAsOutreach: false, confirmOverTarget: true,
  });
  const headers = Object.fromEntries(Object.entries(p.headers || {}).filter(([k]) => !/^List-Unsubscribe/i.test(k)));
  const key = p.sender.kind === "relationship" || domainOf(p.senderId) !== SENDER_DOMAIN ? RESEND_READ_KEY.value() : RESEND_SEND_KEY.value();
  const res = await sendEmail(key, { from: `${p.sender.displayName} <${p.senderId}>`, to: [caller], subject: `[Test] ${p.subject}`, text: p.text, html: p.html, headers });
  await store.recordQuota(res.quota, "issue_test");
  return { sentTo: caller, filledWith: sample.email || null };
}

async function skipIssue({ issueId }, caller) {
  const ref = db().doc(`outreachIssues/${issueId || "-"}`);
  await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    // A draft, or an issue approved ahead of its date that hasn't gone out yet.
    if (!s.exists || !["draft", "approved"].includes(s.data().status)) fail("failed-precondition", "not_waiting", "This issue has already gone out or was skipped.");
    tx.update(ref, { status: "skipped", skippedBy: caller, skippedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
}

exports.outreachRecurring = onCall({ region: REGION, timeoutSeconds: 300, secrets: [RESEND_SEND_KEY, RESEND_READ_KEY] }, async (request) => {
  const caller = normEmail(request.auth?.token?.email);
  const data = request.data || {};
  if (!P.hasPerm(request, ["approveIssue", "skipIssue"].includes(data.action) ? "out.approve" : "out.campaigns")) fail("permission-denied", "not_admin", "You don't have permission to do this.");
  try {
    switch (data.action) {
      case "save": return await save(data, caller);
      case "setStatus": return await setStatus(data, caller);
      case "delete": return await remove(data, caller);
      case "issueNow": return await issueNow(data, caller);
      case "approveIssue": return await approveIssue(data, caller);
      case "skipIssue": return await skipIssue(data, caller);
      case "testIssue": return await testIssue(data, caller);
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
