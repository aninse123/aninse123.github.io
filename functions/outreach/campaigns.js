// outreachCampaign — campaigns and enrolments (Phase 2a, "Outreach Phase 2 -
// Campaigns Spec.md" §4, §7). Callable, admins only. Enrolment runs here, not
// in the browser, so the one-active-campaign-per-company rule (D5) holds under
// concurrent use: each company is enrolled in its own transaction that re-reads
// the company before writing.
//
// Actions (request.data.action):
//   save        { campaignId?, campaign }            create (draft) or update settings + sequence
//   duplicate   { campaignId }                       copy settings + sequence into a new draft
//   delete      { campaignId }                       drafts only; releases every enrolled company
//   preview     { campaignId, companyIds }           exclusion summary, writes nothing
//   enrol       { campaignId, companyIds, source, onConflict: "skip"|"move" }
//   previewPeople / enrolPeople { campaignId, people: [{ email, name, org, refs }], source }
//                                                    Phase 5: campaigns to people
//   enrolment   { enrolmentId, op: "pause"|"resume"|"remove"|"move", reason?, targetCampaignId? }
//   setStatus   { campaignId, status: "active"|"paused"|"finished"|"archived" }
//   approve     { messageIds, subject?, body? }        "To approve" queue (D4): the drafts
//                                                    go back to the scheduler, which sends
//                                                    them inside the window and limits;
//                                                    subject/body = edits (one draft only)
//   skipDraft   { messageId }                        drop the draft, redraft next working day
//   completeTask { taskId, outcome, notes?, stopSequence?, profileUrl?, reopenAt? }
//                                                    a manual step's result (Phase 2b)
//   updateTask  { taskId, assignee?, dueAt?, notes?, letterText? } reassign / reschedule an open task; letterText = this letter's own text {subject, body, address?}
//   setDoNotContact { companyId, on, reason? }       stops every campaign for the company
//   emailName   { companyId, op: "use"|"set"|"keep", name? }  fix or confirm the name used in emails (26 Oct)
//   pathsPreview { campaignId, paths?, steps? }      "Check who goes where": companies per path (27 Oct)
//
// The audience's companies are chosen in the browser (Search CRM filters over
// the full cached list, a matched CSV, or ticked rows) and arrive as ids; the
// filter itself is stored on the campaign as `source.filterSpec` for Metrics.

const P = require("../access/perms"); // team access: who may call what
const Feat = require("../features"); // feature switches (Team & access → Features)
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { REGION, TEST_RECIPIENTS, RESEND_SEND_KEY, RESEND_READ_KEY, UNSUBSCRIBE_SECRET } = require("./config");
const { ANTHROPIC_API_KEY } = require("./ai");
const { normEmail } = require("./util");
const { companyRecipients, pickByPolicy } = require("./recipients");
const store = require("./store");
const Inbox = require("./inbox"); // one inbox (19 Oct, switch outreach.oneInbox)
const Related = require("./related"); // owner-aware outreach (22 Oct, switch outreach.ownerAware)
const EN = require("./email_name_check"); // email name check (26 Oct, switch search.emailNameCheck)
const { addWait, sendingDaysOf, skipHolidaysOf, waitOptsOf, FINAL_GRACE } = require("./schedule_util");
const { findOutcome, CHANNEL_LABEL } = require("./task_util");
const Usage = require("../usage"); // Team & access → Usage (best-effort counters)
const {
  LIVE_ENROLMENT, DEFAULT_CAMPAIGN, CampaignError, normalizeCampaign, activationProblems,
  evaluateCompany, enrolmentId, latestFilterSpec, matchesFilterSpec, personEnrolmentId, evaluatePerson, tierOf,
  pathSteps, pathsOf, choosePath, ELSE_PATH, normalizePaths, plannedPath, pathsUseTier,
} = require("./campaign_util");

const { db, FieldValue, Timestamp } = store;

const MAX_COMPANIES_PER_CALL = 5000;
const READ_CHUNK = 300;
const TX_PARALLEL = 10;
const SAMPLE_LIMIT = 200;

function fail(code, reason, message) {
  throw new HttpsError(code, message, { reason });
}

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function getCampaign(campaignId) {
  if (!campaignId || typeof campaignId !== "string") fail("invalid-argument", "campaign_required", "Choose a campaign.");
  const snap = await db().doc(`outreachCampaigns/${campaignId}`).get();
  if (!snap.exists) fail("not-found", "campaign_not_found", "Campaign not found.");
  return { id: snap.id, ...snap.data() };
}

function cleanCompanyIds(ids) {
  if (!Array.isArray(ids) || !ids.length) fail("invalid-argument", "companies_required", "No companies to add.");
  const out = [...new Set(ids.map((x) => String(x || "").trim()).filter((x) => /^[A-Za-z0-9_-]{1,100}$/.test(x)))];
  if (out.length > MAX_COMPANIES_PER_CALL) fail("invalid-argument", "too_many", `Add up to ${MAX_COMPANIES_PER_CALL} companies at a time.`);
  return out;
}

// Where the companies came from, kept on the campaign (spec §4.1).
function cleanSource(src) {
  const type = ["filters", "csv", "manual"].includes(src?.type) ? src.type : "manual";
  const out = { type, label: String(src?.label || "").slice(0, 120) || null };
  if (type === "csv") out.fileName = String(src?.fileName || "").slice(0, 120) || null;
  if (type === "filters" && Array.isArray(src?.filterSpec)) {
    out.filterSpec = src.filterSpec.slice(0, 30).map((f) => ({
      field: String(f?.field || "").slice(0, 60),
      op: ["eq", "in", "gte", "lte", "between", "contains", "prefix", "exists", "within_days", "bool"].includes(f?.op) ? f.op : "eq",
      value: JSON.stringify(f?.value ?? null).length <= 2000 ? JSON.parse(JSON.stringify(f?.value ?? null)) : null,
    })).filter((f) => f.field);
  }
  return out;
}

async function loadSuppressed() {
  const snap = await db().collection("outreachSuppression").get();
  return new Set(snap.docs.map((d) => d.id));
}

function firstChannel(campaign) {
  return campaign.steps?.[0]?.channel || "email";
}

async function evalContext(campaign) {
  const settings = await store.getSettings();
  // Paths round 2 (R11, 27 Oct): a company added to a campaign with paths gets its planned path.
  let plan = null;
  if ((campaign.paths || []).length > 1) {
    const rules = pathsUseTier(campaign) ? ((await db().doc("searchConfig/targetTiers").get()).data()?.rules || []) : [];
    plan = (company) => plannedPath(campaign, company || {}, rules);
  }
  return {
    plan,
    campaignId: campaign.id,
    exclusions: { ...DEFAULT_CAMPAIGN.exclusions, ...(campaign.exclusions || {}) },
    firstChannel: firstChannel(campaign),
    recipientPolicy: campaign.recipientPolicy || "company",
    blockPersonalDomains: !!settings.blockPersonalDomains,
    suppressed: await loadSuppressed(),
    now: Date.now(),
    isTest: !!(settings.testMode || campaign.isTest),
    testMode: !!settings.testMode, // conversations and drafts are marked test by the test mode at send time
  };
}

// One inbox (19 Oct): the recent conversations of these addresses, when the
// "outreach.oneInbox" switch is on for this request (or job) and the first
// step is an email. Same window as "contacted in the last N days".
async function withInbox(ctx, emails, on) {
  if (!on || ctx.firstChannel !== "email" || !(ctx.exclusions.contactedWithinDays > 0)) return ctx;
  ctx.inboxRecent = await Inbox.recentByAddress(emails, { sinceMs: ctx.now - ctx.exclusions.contactedWithinDays * Inbox.DAY, isTest: ctx.testMode });
  return ctx;
}
async function companyEmails(ids) {
  const out = [];
  for (const group of chunks(ids, READ_CHUNK)) (await db().getAll(...group.map((id) => db().doc(`searchCompanies/${id}`)))).forEach((s) => { if (s.exists && s.data().companyEmail) out.push(s.data().companyEmail); });
  return out;
}
const inboxJobOn = async (campaign) => { const st = await Feat.jobState("outreach.oneInbox"); return st === "on" || (st === "test" && !!campaign.isTest); };
// 21 Oct: waits end at the window's opening (switch "outreach.waitFromWindowStart",
// production setting like the scheduler; Test = test campaigns).
const waitJobOn = async (campaign) => { const st = await Feat.jobState("outreach.waitFromWindowStart"); return st === "on" || (st === "test" && !!campaign?.isTest); };
const peopleJobOn = async (campaign) => { const st = await Feat.jobState("search.people"); return st === "on" || (st === "test" && !!campaign.isTest); };

function assertCompanies(campaign) {
  if (campaign.audienceType === "people") fail("failed-precondition", "not_companies", "This campaign is for people — add people, not companies.");
}

function assertEnrollable(campaign) {
  if (!["draft", "active", "paused"].includes(campaign.status)) {
    fail("failed-precondition", "campaign_closed", `This campaign is ${campaign.status} — companies can't be added.`);
  }
}

// ── Ending enrolments ────────────────────────────────────────────────────────

// Writes for ending one enrolment inside a transaction whose reads are done.
// The company's campaign slot is released only if it still points here.
function endEnrolmentWrites(tx, enrolRef, companyRef, companyData, status, reason) {
  tx.update(enrolRef, { status, stopReason: reason || null, endedAt: FieldValue.serverTimestamp(), nextActionAt: null });
  if (companyData && companyData.activeEnrolmentId === enrolRef.id) {
    tx.update(companyRef, { activeCampaignId: FieldValue.delete(), activeCampaignName: FieldValue.delete(), activeEnrolmentId: FieldValue.delete() });
  }
}

// A draft still waiting in "To approve" is cancelled with its enrolment.
async function endEnrolment(enrolRef, status, reason) {
  return db().runTransaction(async (tx) => {
    const e = await tx.get(enrolRef);
    if (!e.exists || !LIVE_ENROLMENT.includes(e.data().status)) return false;
    // People enrolments (Phase 5) hold no company slot.
    const companyRef = e.data().companyId ? db().doc(`searchCompanies/${e.data().companyId}`) : null;
    const c = companyRef ? await tx.get(companyRef) : null;
    const draftRef = e.data().draftMessageId ? db().doc(`outreachMessages/${e.data().draftMessageId}`) : null;
    const draft = draftRef ? await tx.get(draftRef) : null;
    const taskRef = e.data().taskId ? db().doc(`outreachTasks/${e.data().taskId}`) : null;
    const task = taskRef ? await tx.get(taskRef) : null;
    endEnrolmentWrites(tx, enrolRef, companyRef, c?.exists ? c.data() : null, status, reason);
    if (draft?.exists && ["draft", "approved"].includes(draft.data().status)) tx.update(draftRef, { status: "cancelled", cancelledReason: reason || status });
    if (task?.exists && task.data().status === "open") tx.update(taskRef, { status: "cancelled", cancelledReason: reason || status });
    return true;
  });
}

async function endAll(refs, status, reason) {
  let n = 0;
  for (const group of chunks(refs, TX_PARALLEL)) {
    const res = await Promise.all(group.map((r) => endEnrolment(r, status, reason)));
    n += res.filter(Boolean).length;
  }
  return n;
}

async function liveEnrolmentRefs(field, value) {
  const snap = await db().collection("outreachEnrolments").where(field, "==", value).get();
  return snap.docs.filter((d) => LIVE_ENROLMENT.includes(d.data().status)).map((d) => d.ref);
}

// Stop rules (spec §5.4): a human reply ends the company's enrolments as
// "replied"; bounce, complaint, unsubscribe and do-not-contact as "stopped".
// Called from the webhook (inbound replies, delivery events) and the
// unsubscribe page.
// A people conversation (Phase 5) has no company: stop its own enrolment.
async function stopEnrolmentById(id, reason, status = "stopped") {
  if (!id) return 0;
  return (await endEnrolment(db().doc(`outreachEnrolments/${id}`), status, reason)) ? 1 : 0;
}

async function stopCompanyEnrolments(companyId, reason, status = "stopped") {
  if (!companyId) return 0;
  return endAll(await liveEnrolmentRefs("companyId", companyId), status, reason);
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function save({ campaignId, campaign }, caller, opts = {}) {
  if (!campaignId) {
    const settings = await store.getSettings();
    // 22 Oct (switch outreach.testCampaigns): a test campaign after go-live — fixed at creation.
    const wantsTest = !!campaign?.isTest && !!opts.testCampaigns;
    if (wantsTest && !(settings.campaignTestRecipient || (settings.testRecipients || [])[0])) fail("failed-precondition", "no_test_address", "Set the campaign test address first (Outreach → Settings → General).");
    const fields = normalizeCampaign(campaign);
    const ref = db().collection("outreachCampaigns").doc();
    await ref.set({
      ...DEFAULT_CAMPAIGN, ...fields,
      status: "draft", lockedStepIds: [], stats: { enrolled: 0 },
      isTest: !!settings.testMode || wantsTest,
      createdAt: FieldValue.serverTimestamp(), createdBy: caller,
      updatedAt: FieldValue.serverTimestamp(), updatedBy: caller,
      startedAt: null, finishedAt: null,
    });
    return { campaignId: ref.id };
  }
  const ref = db().doc(`outreachCampaigns/${campaignId}`);
  const { renamed, name, repath } = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail("not-found", "campaign_not_found", "Campaign not found.");
    const existing = snap.data();
    if (["finished", "archived"].includes(existing.status)) fail("failed-precondition", "campaign_closed", `This campaign is ${existing.status} and can't be edited — duplicate it instead.`);
    // audience.sources only ever grows through enrol (arrayUnion), so an
    // update never rewrites it.
    const { audience, ...fields } = normalizeCampaign(campaign, existing);
    // B1: a request to start covered the previous version.
    const withdraw = existing.startRequest && opts.canApprove === false ? { startRequest: null } : {};
    tx.update(ref, { ...fields, ...withdraw, "audience.mode": audience.mode, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller });
    return { renamed: fields.name !== existing.name, name: fields.name, repath: JSON.stringify(fields.paths || null) !== JSON.stringify(existing.paths || null) };
  });
  if (repath) await planPending(campaignId); // R11: the waiting companies' planned paths follow the new paths
  if (renamed) {
    // Keep the Search CRM badge current on companies this campaign holds.
    const refs = await liveEnrolmentRefs("campaignId", campaignId);
    for (const group of chunks(refs, 400)) {
      const enrols = await db().getAll(...group);
      const companyRefs = enrols.filter((e) => e.exists).map((e) => db().doc(`searchCompanies/${e.data().companyId}`));
      const companies = companyRefs.length ? await db().getAll(...companyRefs) : [];
      const batch = db().batch();
      companies.forEach((c, i) => {
        if (c.exists && c.data().activeCampaignId === campaignId) batch.update(companyRefs[i], { activeCampaignName: name });
      });
      await batch.commit();
    }
  }
  return { campaignId };
}

async function duplicate({ campaignId }, caller) {
  const src = await getCampaign(campaignId);
  const copy = { ...src, name: `${src.name} (copy)`.slice(0, 100), audience: { mode: src.audience?.mode || "static", sources: [] } };
  copy.steps = (src.steps || []).map((s) => ({ ...s }));
  delete copy.lockedStepIds;
  return save({ campaign: copy }, caller);
}

async function remove({ campaignId }) {
  const c = await getCampaign(campaignId);
  if (c.status !== "draft") fail("failed-precondition", "not_draft", "Only draft campaigns can be deleted — finish or archive this one instead.");
  const snap = await db().collection("outreachEnrolments").where("campaignId", "==", campaignId).get();
  const released = await endAll(snap.docs.map((d) => d.ref), "removed", "Campaign deleted");
  for (const group of chunks(snap.docs, 400)) {
    const batch = db().batch();
    group.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  await db().doc(`outreachCampaigns/${campaignId}`).delete();
  return { deleted: true, released, enrolments: snap.size };
}

async function readCompanies(ids, campaignId) {
  const out = new Map();
  for (const group of chunks(ids, READ_CHUNK)) {
    const companyRefs = group.map((id) => db().doc(`searchCompanies/${id}`));
    const enrolRefs = group.map((id) => db().doc(`outreachEnrolments/${enrolmentId(campaignId, id)}`));
    const snaps = await db().getAll(...companyRefs, ...enrolRefs);
    group.forEach((id, i) => {
      const c = snaps[i], e = snaps[group.length + i];
      out.set(id, { company: c.exists ? c.data() : null, alreadyEnrolled: e.exists });
    });
  }
  return out;
}

async function preview({ campaignId, companyIds }, caller, opts = {}) {
  const campaign = await getCampaign(campaignId);
  assertEnrollable(campaign); assertCompanies(campaign);
  const ids = cleanCompanyIds(companyIds);
  const ctx = await evalContext(campaign);
  ctx.usePeople = !!opts.usePeople; // People merge (Stage 4)
  const data = await readCompanies(ids, campaignId);
  await withInbox(ctx, ids.map((id) => data.get(id)?.company?.companyEmail), opts.oneInbox);
  const excluded = {};
  const sample = [];
  const conflicts = [];
  const conflictCampaigns = {};
  let eligible = 0;
  for (const id of ids) {
    const { company, alreadyEnrolled } = data.get(id);
    const r = evaluateCompany(company, { ...ctx, alreadyEnrolled, companyId: id });
    if (r.ok) { eligible++; continue; }
    if (r.reason === "in_other_campaign") {
      const k = r.conflict.campaignId;
      conflictCampaigns[k] = conflictCampaigns[k] || { campaignId: k, campaignName: r.conflict.campaignName, count: 0 };
      conflictCampaigns[k].count++;
      if (conflicts.length < SAMPLE_LIMIT) conflicts.push({ companyId: id, companyName: company?.name || "", ...r.conflict });
      continue;
    }
    excluded[r.reason] = (excluded[r.reason] || 0) + 1;
    if (sample.length < SAMPLE_LIMIT) sample.push({ companyId: id, companyName: company?.name || "", reason: r.reason, ...(r.inbox ? { inbox: r.inbox } : {}) });
  }
  const conflictCount = Object.values(conflictCampaigns).reduce((a, x) => a + x.count, 0);
  const newPerDay = campaign.pacing?.newPerDay || DEFAULT_CAMPAIGN.pacing.newPerDay;
  // I2+ (António, 8 Oct): companies that could be added but were already
  // contacted — an email conversation, or a call / letter / visit logged by a
  // campaign. Shown as a warning; the person adding them decides.
  const addable = ids.filter((id) => { const { company, alreadyEnrolled } = data.get(id); const r = evaluateCompany(company, { ...ctx, alreadyEnrolled, companyId: id }); return r.ok || r.reason === "in_other_campaign"; });
  const contacted = await contactedBefore(addable, data, campaignId);
  const owner = opts.ownerAware && addable.length ? await ownerPanel(addable, data, campaign, ctx) : null;
  // Email name check (26 Oct): companies whose name in emails looks wrong, to fix before Email 1.
  const nameCheck = opts.nameCheck && addable.length ? addable.map((id) => EN.nameCheckOf({ id, ...(data.get(id).company || {}) }, id)).filter(Boolean).slice(0, 300) : null;
  return {
    owner,
    nameCheck,
    contacted,
    requested: ids.length,
    eligible,
    excluded,
    excludedSample: sample,
    conflictCount,
    conflictCampaigns: Object.values(conflictCampaigns),
    conflicts,
    newPerDay,
    daysToStart: Math.ceil(eligible / newPerDay),
    daysToStartIfMoved: Math.ceil((eligible + conflictCount) / newPerDay),
  };
}

// Owner-aware outreach, Stage 3 (22 Oct, switch "outreach.ownerAware"): the
// companies being added that have related companies worth a look (another
// campaign, contacted recently, in conversation, said no / do not contact, or
// also in this batch), each with its flags, related companies, suggested lead,
// default choice (Skip for now when a related company said no, else Proceed)
// and the companies it would mention.
const OWNER_PANEL_MAX = 200;
const slimRelated = (r) => ({ companyId: r.companyId, name: r.name, why: r.why, campaignName: r.campaignName, lastOutreachAt: r.lastOutreachAt, lastReplyAt: r.lastReplyAt, saidNo: r.saidNo, doNotContact: r.doNotContact, email: r.email });
async function ownerPanel(ids, data, campaign, ctx) {
  const companies = new Map(ids.map((id) => [id, { id, ...(data.get(id)?.company || {}) }]));
  const rel = await Related.relatedFor(ids, { companies });
  const batch = new Set(ids);
  const flagged = [];
  for (const id of ids) {
    const entry = rel.get(id);
    const flags = Related.flagsFor(entry, { campaignId: campaign.id, windowDays: ctx.exclusions.contactedWithinDays || 30, batch, selfId: id, now: ctx.now });
    if (!flags.length) continue;
    flagged.push({ companyId: id, companyName: companies.get(id).name || "", flags, related: entry.related.slice(0, 6).map(slimRelated), lead: entry.lead, choice: Related.defaultChoice(flags), mention: Related.mentionFrom(entry, flags) });
  }
  return { count: flagged.length, flagged: flagged.slice(0, OWNER_PANEL_MAX) };
}
async function ownerActivity(companyId, content, caller, isTest) {
  try {
    await db().collection("searchActivities").add({ companyId, type: "outreach_owner", date: Timestamp.now(), title: null, content: (isTest ? "[TEST] " : "") + content, status: null, isTest: !!isTest, createdAt: FieldValue.serverTimestamp(), createdBy: caller || "system" });
  } catch (e) { /* history is best effort */ }
}

// Which of these companies were contacted before, and how (I2+). Email
// conversations come from outreachThreads (30 companies per query); other
// touches from the company's lastOutreachAt / outreachAttempts (no extra read).
const CONTACTED_SAMPLE = 100;
async function contactedBefore(ids, data, campaignId) {
  const last = new Map();   // companyId → { at, email, campaignId, isTest }
  for (const group of chunks(ids, 30)) {
    const snap = await db().collection("outreachThreads").where("companyId", "in", group)
      .select("companyId", "contactEmail", "lastMessageAt", "createdAt", "campaignId", "isTest", "status").get();
    snap.docs.forEach((d) => {
      const t = d.data(), at = tsMs(t.lastMessageAt || t.createdAt);
      if (t.status === "failed") return; // 27 Oct: its email never went out — not a contact
      const cur = last.get(t.companyId);
      if (!cur || at > cur.at) last.set(t.companyId, { at, email: t.contactEmail || "", campaignId: t.campaignId || null, isTest: !!t.isTest });
    });
  }
  const out = [];
  for (const id of ids) {
    const company = data.get(id)?.company || {};
    const thread = last.get(id);
    const touchAt = company.lastOutreachAt ? tsMs(company.lastOutreachAt) : (Number(company.outreachAttempts) > 0 ? tsMs(company.lastTouchAt) : 0);
    if (!thread && !touchAt) continue;
    out.push({ companyId: id, companyName: company.name || "", at: Math.max(thread?.at || 0, touchAt || 0) || null,
      email: thread?.email || "", campaignId: thread?.campaignId || null, isTest: !!thread?.isTest, emailed: !!thread });
  }
  out.sort((a, b) => (b.at || 0) - (a.at || 0));
  const campIds = [...new Set(out.slice(0, CONTACTED_SAMPLE).map((x) => x.campaignId).filter((x) => x && x !== campaignId))];
  const names = new Map();
  if (campIds.length) (await db().getAll(...campIds.map((x) => db().doc(`outreachCampaigns/${x}`)))).forEach((s) => { if (s.exists) names.set(s.id, s.data().name || ""); });
  return {
    count: out.length,
    ids: out.map((x) => x.companyId),
    sample: out.slice(0, CONTACTED_SAMPLE).map((x) => ({ ...x, campaignName: x.campaignId ? (names.get(x.campaignId) || (x.campaignId === campaignId ? "this campaign" : "")) : "" })),
  };
}
function tsMs(t) {
  if (!t) return 0;
  if (typeof t.toMillis === "function") return t.toMillis();
  if (typeof t._seconds === "number") return t._seconds * 1000;
  if (typeof t.seconds === "number") return t.seconds * 1000;
  const n = Date.parse(t); return isNaN(n) ? 0 : n;
}

// I2 (8 Oct): who each "Emails go to" option would reach, for the companies
// already in the campaign (up to RECIP_PREVIEW_MAX). Each company's pick per
// option is kept on its enrolment (recipientPreview) so the Companies list can
// show "Goes to" without reading again. Reads: the company + its People.
const RECIP_PREVIEW_MAX = 300;
const POLICIES = ["company", "primary_contact", "best_person"];
async function recipientsPreview({ campaignId }, caller, opts = {}) {
  const campaign = await getCampaign(campaignId);
  assertCompanies(campaign);
  const snap = await db().collection("outreachEnrolments").where("campaignId", "==", campaignId).where("status", "in", LIVE_ENROLMENT).limit(2000).get();
  const live = snap.docs.filter((d) => d.data().companyId);
  const todo = live.slice(0, RECIP_PREVIEW_MAX);
  const counts = Object.fromEntries(POLICIES.map((p) => [p, { company: 0, contact: 0, person: 0, none: 0 }]));
  let personal = 0, heldBack = 0; // heldBack: companies with a person address the campaign may not use (not verified)
  const updates = [];
  for (const group of chunks(todo, 10)) {
    const cos = await db().getAll(...group.map((d) => db().doc(`searchCompanies/${d.data().companyId}`)));
    await Promise.all(group.map(async (d, i) => {
      const co = cos[i].exists ? cos[i].data() : null;
      const rs = co ? await companyRecipients(d.data().companyId, co, { usePeople: !!opts.usePeople, trust: { on: !!opts.trust, includeUnverified: !!campaign.useUnverified } }) : [];
      const preview = {};
      if (rs.some((r) => r.blocked && (r.kind === "person" || r.kind === "contact"))) heldBack++;
      for (const p of POLICIES) {
        const pick = pickByPolicy(rs, p);
        counts[p][pick ? pick.kind : "none"]++;
        preview[p] = pick ? { email: pick.email, kind: pick.kind, name: pick.name || "", personal: !!pick.personal, ...(pick.trust ? { trust: pick.trust } : {}) } : null;
      }
      if (preview[campaign.recipientPolicy || "company"]?.personal) personal++;
      updates.push({ ref: d.ref, preview });
    }));
  }
  for (const group of chunks(updates, 400)) {
    const batch = db().batch();
    group.forEach((u) => batch.update(u.ref, { recipientPreview: { ...u.preview, at: FieldValue.serverTimestamp() } }));
    await batch.commit();
  }
  return { counts, checked: todo.length, total: live.length, decided: live.filter((d) => d.data().recipient).length, personal, policy: campaign.recipientPolicy || "company", ...(opts.trust ? { heldBack } : {}) };
}

async function enrolOne(companyId, campaign, ctx, source, onConflict, caller, extra = {}) {
  const companyRef = db().doc(`searchCompanies/${companyId}`);
  const enrolRef = db().doc(`outreachEnrolments/${enrolmentId(campaign.id, companyId)}`);
  return db().runTransaction(async (tx) => {
    const [cSnap, eSnap] = await tx.getAll(companyRef, enrolRef);
    const company = cSnap.exists ? cSnap.data() : null;
    let r = evaluateCompany(company, { ...ctx, alreadyEnrolled: eSnap.exists, companyId });
    let moveFrom = null;
    if (!r.ok && r.reason === "in_other_campaign") {
      // The company's pointer may be stale (enrolment already ended): check it.
      const otherRef = r.conflict.enrolmentId ? db().doc(`outreachEnrolments/${r.conflict.enrolmentId}`) : null;
      const other = otherRef ? await tx.get(otherRef) : null;
      const otherLive = other?.exists && LIVE_ENROLMENT.includes(other.data().status);
      if (!otherLive) r = { ok: true };
      else if (onConflict === "move") { moveFrom = otherRef; r = { ok: true }; }
      // What the old enrolment leaves open (a task, a draft) is cancelled with it.
      if (moveFrom) {
        const od = other.data();
        const tRef = od.taskId ? db().doc(`outreachTasks/${od.taskId}`) : null;
        const dRef = od.draftMessageId ? db().doc(`outreachMessages/${od.draftMessageId}`) : null;
        const [tSnap, dSnap] = await Promise.all([tRef ? tx.get(tRef) : null, dRef ? tx.get(dRef) : null]);
        moveFrom.leftovers = [
          tSnap?.exists && tSnap.data().status === "open" ? tRef : null,
          dSnap?.exists && ["draft", "approved"].includes(dSnap.data().status) ? dRef : null,
        ].filter(Boolean);
      }
    }
    if (!r.ok) return { result: "skipped", reason: r.reason };
    if (moveFrom) {
      tx.update(moveFrom, { status: "moved", stopReason: `Moved to "${campaign.name}"`, endedAt: FieldValue.serverTimestamp(), nextActionAt: null, movedTo: campaign.id });
      for (const ref of moveFrom.leftovers || []) tx.update(ref, { status: "cancelled", cancelledReason: `Moved to "${campaign.name}"` });
    }
    tx.set(enrolRef, {
      campaignId: campaign.id,
      campaignName: campaign.name,
      companyId,
      companyName: company.name || "",
      owner: company.owner || null,
      contactEmail: normEmail(company.companyEmail) || null,
      source: source.type,
      sourceLabel: source.label || source.type, // compared per audience in the Overview (2c)
      status: "pending",
      stopReason: null,
      currentStep: 0,
      nextActionAt: null,
      senderId: null,
      threadId: null,
      variants: {},
      history: [],
      isTest: ctx.isTest,
      movedFrom: moveFrom ? moveFrom.id : null,
      enrolledAt: FieldValue.serverTimestamp(),
      enrolledBy: caller,
      endedAt: null,
      ...(ctx.plan ? ctx.plan(company) : {}), // R11: plannedPathId / plannedPathName
      ...extra, // owner-aware outreach (22 Oct): mention [{ companyId, name }]
    });
    // A test campaign after go-live (22 Oct) doesn't take the company's campaign slot:
    // real campaigns can still add it, and the related-company flags ignore it.
    if (!(campaign.isTest && !ctx.testMode)) tx.update(companyRef, { activeCampaignId: campaign.id, activeCampaignName: campaign.name, activeEnrolmentId: enrolRef.id });
    return { result: moveFrom ? "moved" : "enrolled" };
  });
}

async function enrol({ campaignId, companyIds, source, onConflict, ownerChoices, ownerMentions }, caller, opts = {}) {
  const campaign = await getCampaign(campaignId);
  assertEnrollable(campaign); assertCompanies(campaign);
  let ids = cleanCompanyIds(companyIds);
  const src = cleanSource(source);
  const mode = onConflict === "move" ? "move" : "skip";
  const ctx = await evalContext(campaign);
  ctx.usePeople = !!opts.usePeople; // People merge (Stage 4)
  if (opts.oneInbox) await withInbox(ctx, await companyEmails(ids), true);
  let enrolled = 0, moved = 0;
  const skipped = {};
  // Owner-aware outreach (22 Oct): what was chosen for each flagged company —
  // Skip for now (not added), Proceed (added despite the flags) or Proceed and
  // mention (added; {{owner.otherCompanies}} names the related companies ticked
  // by hand — D5, 22 Oct; none ticked = Proceed). Each choice leaves an activity on
  // the company. The flags are worked out again here.
  const choices = opts.ownerAware && ownerChoices && typeof ownerChoices === "object" ? ownerChoices : {};
  const chosen = ids.filter((id) => ["skip", "proceed", "mention"].includes(choices[id]));
  const plan = new Map();
  if (chosen.length) {
    const companies = new Map((await readCompanies(chosen, campaignId)).entries());
    const rel = await Related.relatedFor(chosen, { companies: new Map([...companies].map(([id, x]) => [id, { id, ...(x.company || {}) }])) });
    const batch = new Set(ids);
    for (const id of chosen) {
      const entry = rel.get(id);
      const flags = Related.flagsFor(entry, { campaignId, windowDays: ctx.exclusions.contactedWithinDays || 30, batch, selfId: id, now: ctx.now });
      const picked = ownerMentions && typeof ownerMentions === "object" ? Related.mentionPicked(entry, ownerMentions[id]) : Related.mentionFrom(entry, flags); // no ticks sent (older page) = the suggestion
      plan.set(id, { choice: choices[id], flags, mention: choices[id] === "mention" ? picked : [] });
    }
    for (const id of chosen.filter((x) => choices[x] === "skip")) {
      skipped.owner_skip = (skipped.owner_skip || 0) + 1;
      await ownerActivity(id, `Skipped for now — not added to "${campaign.name}" because of related companies: ${plan.get(id).flags.map((f) => f.text).join("; ") || "related companies in outreach"}`, caller, ctx.isTest);
    }
    ids = ids.filter((x) => choices[x] !== "skip");
  }
  for (const group of chunks(ids, TX_PARALLEL)) {
    const res = await Promise.all(group.map((id) => enrolOne(id, campaign, ctx, src, mode, caller, plan.get(id)?.mention?.length ? { mention: plan.get(id).mention } : {})));
    for (let i = 0; i < res.length; i++) {
      const r = res[i], id = group[i];
      if (r.result === "enrolled") enrolled++;
      else if (r.result === "moved") { enrolled++; moved++; }
      else skipped[r.reason] = (skipped[r.reason] || 0) + 1;
      const pl = plan.get(id);
      if (pl && (r.result === "enrolled" || r.result === "moved")) {
        const what = pl.flags.map((f) => f.text).join("; ");
        await ownerActivity(id, pl.mention.length ? `Added to "${campaign.name}", the email mentions ${pl.mention.map((x) => x.name).join(" and ")} — related companies: ${what || "none flagged"}` : `Added to "${campaign.name}" knowing about the related companies: ${what || "related companies in outreach"}`, caller, ctx.isTest);
      }
    }
  }
  const skippedTotal = Object.values(skipped).reduce((a, b) => a + b, 0);
  if (enrolled) {
    await db().doc(`outreachCampaigns/${campaignId}`).update({
      "stats.enrolled": FieldValue.increment(enrolled),
      "audience.sources": FieldValue.arrayUnion({ ...src, at: Timestamp.now(), by: caller, requested: ids.length, enrolled, moved, skipped: skippedTotal }),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  return { requested: ids.length, enrolled, moved, skipped, skippedTotal };
}

// Move one company to another campaign (2c): the target campaign's rules
// apply; the current enrolment ends as "moved" in the same transaction.
// Owner-aware outreach, Stage 4 (22 Oct): a company's related companies and what
// is happening with them, for the Search CRM's Ownership tab ("In conversation
// via X"). Read only; nothing when the switch is off for this caller.
async function relatedOf({ companyId }, opts = {}) {
  if (!opts.ownerAware) return { off: true, related: [] };
  if (!companyId || typeof companyId !== "string") fail("invalid-argument", "bad_company", "Choose a company.");
  const entry = (await Related.relatedFor([companyId])).get(companyId);
  return { related: entry.related, lead: entry.lead, flags: Related.flagsFor(entry, { windowDays: 30 }) };
}

async function moveEnrolment(id, targetCampaignId, caller) {
  const cur = await db().doc(`outreachEnrolments/${id}`).get();
  if (!cur.exists || !LIVE_ENROLMENT.includes(cur.data().status)) fail("failed-precondition", "not_live", "This company is no longer active in the campaign.");
  if (!targetCampaignId || targetCampaignId === cur.data().campaignId) fail("invalid-argument", "bad_target", "Choose another campaign.");
  const target = await getCampaign(targetCampaignId);
  assertEnrollable(target);
  const ctx = await evalContext(target);
  const r = await enrolOne(cur.data().companyId, target, ctx, { type: "manual", label: `Moved from "${cur.data().campaignName || "another campaign"}"` }, "move", caller);
  if (r.result === "skipped") fail("failed-precondition", "cant_move", `Can't be added to "${target.name}": ${r.reason.replace(/_/g, " ")}.`);
  await db().doc(`outreachCampaigns/${target.id}`).update({ "stats.enrolled": FieldValue.increment(1) });
  return { ok: true, status: "moved", targetCampaignId: target.id };
}

// ── People (Phase 5) ────────────────────────────────────────────────────────
function cleanPeople(people) {
  if (!Array.isArray(people) || !people.length) fail("invalid-argument", "people_required", "No people to add.");
  if (people.length > MAX_COMPANIES_PER_CALL) fail("invalid-argument", "too_many", `Add up to ${MAX_COMPANIES_PER_CALL} people at a time.`);
  const seen = new Map();
  for (const p of people) {
    const email = normEmail(p?.email);
    if (!email) continue;
    const prev = seen.get(email);
    const refs = (Array.isArray(p.refs) ? p.refs : []).filter((r) => ["crm", "network", "portal", "broker"].includes(r?.source) && typeof r.id === "string").slice(0, 10).map((r) => ({ source: r.source, id: r.id }));
    if (prev) { prev.refs.push(...refs.filter((r) => !prev.refs.some((x) => x.source === r.source && x.id === r.id))); continue; }
    seen.set(email, { email, name: String(p.name || "").slice(0, 120), org: String(p.org || "").slice(0, 160), refs });
  }
  return [...seen.values()];
}
async function peopleContext(campaign) {
  const ctx = await evalContext(campaign);
  // An issue of a recurring email (5b) honours opt-outs from that recurring email.
  const keys = [campaign.id, campaign.recurringId].filter(Boolean);
  const opts = await db().collection("outreachOptOuts").where("campaignId", "in", keys).get();
  ctx.optedOut = new Set(opts.docs.map((d) => d.data()).filter((o) => !o.restoredAt).map((o) => o.email)); // F4: put back on request
  return ctx;
}
// People the portal emailed in the last `days` days: campaign / manual
// conversations (by the person's address) and relationship sends (5c).
async function recentlyEmailed(emails, days) {
  const cutoff = Date.now() - days * 86400000;
  const out = new Set();
  const ms = (t) => (t && t.toMillis ? t.toMillis() : 0);
  for (const group of chunks([...new Set(emails)], 30)) {
    const [byPerson, byContact, sends] = await Promise.all([
      db().collection("outreachThreads").where("personEmail", "in", group).get(),
      db().collection("outreachThreads").where("contactEmail", "in", group).get(),
      db().collection("outreachPeopleSends").where("recipients", "array-contains-any", group).get(),
    ]);
    // 27 Oct: a conversation whose email failed (never went out) isn't an email.
    byPerson.docs.forEach((d) => { if (d.data().status !== "failed" && ms(d.data().lastMessageAt) >= cutoff) out.add(d.data().personEmail); });
    byContact.docs.forEach((d) => { if (d.data().status !== "failed" && ms(d.data().lastMessageAt) >= cutoff) out.add(d.data().contactEmail); });
    sends.docs.forEach((d) => { if (ms(d.data().at) >= cutoff) (d.data().recipients || []).forEach((e) => group.includes(e) && out.add(e)); });
  }
  return out;
}
async function withRecent(ctx, campaign, list) {
  const days = campaign.exclusions?.peopleContactedWithinDays || 0;
  // A recurring email's issue always goes to the whole list.
  if (days > 0 && campaign.kind !== "issue") ctx.recent = await recentlyEmailed(list.map((p) => p.email), days);
  return ctx;
}
function assertPeople(campaign) {
  if (campaign.audienceType !== "people") fail("failed-precondition", "not_people", "This campaign is for companies — use a campaign for people.");
}
async function previewPeople({ campaignId, people }) {
  const campaign = await getCampaign(campaignId);
  assertEnrollable(campaign); assertPeople(campaign);
  const list = cleanPeople(people);
  const ctx = await withRecent(await peopleContext(campaign), campaign, list);
  const excluded = {}; const sample = []; let eligible = 0;
  for (const group of chunks(list, READ_CHUNK)) {
    const snaps = await db().getAll(...group.map((p) => db().doc(`outreachEnrolments/${personEnrolmentId(campaignId, p.email)}`)));
    group.forEach((p, i) => {
      const r = evaluatePerson(p, { ...ctx, alreadyEnrolled: snaps[i].exists });
      if (r.ok) { eligible++; return; }
      excluded[r.reason] = (excluded[r.reason] || 0) + 1;
      if (sample.length < SAMPLE_LIMIT) sample.push({ email: p.email, name: p.name, reason: r.reason });
    });
  }
  const perDay = campaign.pacing?.maxPerDay || campaign.pacing?.newPerDay || DEFAULT_CAMPAIGN.pacing.newPerDay;
  return { requested: list.length, eligible, excluded, excludedSample: sample, perDay, daysToStart: Math.ceil(eligible / perDay) };
}
async function enrolPeople({ campaignId, people, source }, caller) {
  const campaign = await getCampaign(campaignId);
  assertEnrollable(campaign); assertPeople(campaign);
  const list = cleanPeople(people);
  const src = cleanSource(source);
  const ctx = await withRecent(await peopleContext(campaign), campaign, list);
  let enrolled = 0; const skipped = {};
  for (const group of chunks(list, TX_PARALLEL)) {
    const res = await Promise.all(group.map((p) => {
      const ref = db().doc(`outreachEnrolments/${personEnrolmentId(campaignId, p.email)}`);
      return db().runTransaction(async (tx) => {
        const cur = await tx.get(ref);
        const r = evaluatePerson(p, { ...ctx, alreadyEnrolled: cur.exists });
        if (!r.ok) return r.reason;
        tx.set(ref, {
          campaignId: campaign.id, campaignName: campaign.name, companyId: null, companyName: p.org || "",
          personEmail: r.email, personName: p.name, org: p.org, refs: p.refs, owner: null, contactEmail: r.email,
          source: src.type, sourceLabel: src.label || src.type, status: "pending", stopReason: null, currentStep: 0,
          nextActionAt: null, senderId: null, threadId: null, variants: {}, history: [], isTest: ctx.isTest,
          enrolledAt: FieldValue.serverTimestamp(), enrolledBy: caller, endedAt: null,
        });
        return "enrolled";
      });
    }));
    res.forEach((r) => (r === "enrolled" ? enrolled++ : (skipped[r] = (skipped[r] || 0) + 1)));
  }
  const skippedTotal = Object.values(skipped).reduce((a, b) => a + b, 0);
  if (enrolled) {
    await db().doc(`outreachCampaigns/${campaignId}`).update({
      "stats.enrolled": FieldValue.increment(enrolled),
      "audience.sources": FieldValue.arrayUnion({ ...src, at: Timestamp.now(), by: caller, requested: list.length, enrolled, skipped: skippedTotal }),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  return { requested: list.length, enrolled, skipped, skippedTotal };
}

async function enrolmentOp({ enrolmentId: id, op, reason, targetCampaignId }, caller) {
  if (!id || typeof id !== "string") fail("invalid-argument", "enrolment_required", "Choose a company in the campaign.");
  const ref = db().doc(`outreachEnrolments/${id}`);
  if (op === "remove") {
    const ok = await endEnrolment(ref, "removed", String(reason || "").slice(0, 200) || `Removed by ${caller}`);
    if (!ok) fail("failed-precondition", "not_live", "This company is no longer active in the campaign.");
    return { ok: true, status: "removed" };
  }
  if (op === "move") return moveEnrolment(id, targetCampaignId, caller);
  if (op !== "pause" && op !== "resume") fail("invalid-argument", "bad_op", `Unknown operation "${op}".`);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail("not-found", "enrolment_not_found", "Enrolment not found.");
    const e = snap.data();
    if (op === "pause") {
      if (e.status === "paused") return { ok: true, status: "paused" };
      if (!LIVE_ENROLMENT.includes(e.status)) fail("failed-precondition", "not_live", "This company is no longer active in the campaign.");
      tx.update(ref, { status: "paused", pausedFrom: e.status, pausedAt: FieldValue.serverTimestamp(), pausedBy: caller });
      return { ok: true, status: "paused" };
    }
    if (e.status !== "paused") fail("failed-precondition", "not_paused", "This company isn't paused.");
    const status = e.pausedFrom || "active";
    tx.update(ref, { status, pausedFrom: null, pausedAt: null, pausedBy: null });
    return { ok: true, status };
  });
}

// What stops a campaign from starting (templates, rules that need tracking).
async function startProblems(campaign) {
  const ids = [...new Set((campaign.steps || []).map((s) => s.templateId).filter(Boolean))];
  const snaps = ids.length ? await db().getAll(...ids.map((id) => db().doc(`outreachTemplates/${id}`))) : [];
  const templatesById = Object.fromEntries(snaps.filter((s) => s.exists).map((s) => [s.id, s.data()]));
  const problems = activationProblems(campaign, templatesById);
  if ((campaign.steps || []).some((s) => (s.channel || "email") === "email" && (s.branches || []).some((b) => b.outcome === "clicked"))) {
    const st = await store.getSettings();
    if (!st.trackOpensClicks) problems.push('Rules on "clicked a link" need open/click tracking switched on (Settings → General).');
  }
  return problems;
}

// Team access B1: whoever prepares a campaign without "approve" asks a
// partner to start it. The request shows in Tasks → To approve; a partner
// starts it (setStatus active) or returns it with a note. Editing the
// campaign afterwards (without "approve") withdraws the request.
async function requestStart({ campaignId, note }, caller) {
  const campaign = await getCampaign(campaignId);
  // A draft waits to be started; a paused campaign waits to be resumed.
  if (!["draft", "paused"].includes(campaign.status)) fail("failed-precondition", "not_draft", "Only a draft or paused campaign can wait for a partner.");
  const problems = await startProblems(campaign);
  if (problems.length) throw new HttpsError("failed-precondition", `Before asking: ${problems.join(" ")}`, { reason: "not_ready", problems });
  await db().doc(`outreachCampaigns/${campaignId}`).update({
    startRequest: { by: caller, at: FieldValue.serverTimestamp(), note: String(note || "").trim().slice(0, 1000), kind: campaign.status === "paused" ? "resume" : "start" },
    startReturn: null,
  });
  return { ok: true };
}

async function returnStart({ campaignId, note }, caller) {
  const campaign = await getCampaign(campaignId);
  if (!["draft", "paused"].includes(campaign.status) || !campaign.startRequest) fail("failed-precondition", "not_waiting", "Nobody is waiting for this campaign to start.");
  await db().doc(`outreachCampaigns/${campaignId}`).update({
    startRequest: null,
    startReturn: { by: caller, at: FieldValue.serverTimestamp(), note: String(note || "").trim().slice(0, 1000), requestedBy: campaign.startRequest.by || null },
  });
  return { ok: true };
}

const TRANSITIONS = {
  active: ["draft", "paused"],
  paused: ["active"],
  finished: ["active", "paused"],
  // I5 (8 Oct): a draft is archived instead of deleted; "restore" brings an
  // archived campaign back to what it was (draft or finished).
  archived: ["finished", "draft"],
};

async function setStatus({ campaignId, status, testRecipient }, caller) {
  if (status === "restore") return restore(campaignId, caller);
  if (!TRANSITIONS[status]) fail("invalid-argument", "bad_status", `Unknown status "${status}".`);
  const campaign = await getCampaign(campaignId);
  if (campaign.status === status) return { status };
  if (!TRANSITIONS[status].includes(campaign.status)) {
    fail("failed-precondition", "bad_transition", `A ${campaign.status} campaign can't be set to ${status}.`);
  }
  const ref = db().doc(`outreachCampaigns/${campaignId}`);
  const upd = { status, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller };
  if (status === "active") {
    const problems = await startProblems(campaign);
    if (problems.length) throw new HttpsError("failed-precondition", `Before starting: ${problems.join(" ")}`, { reason: "not_ready", problems });
    if (!campaign.startedAt) upd.startedAt = FieldValue.serverTimestamp();
    upd.startRequest = null; upd.startReturn = null;
    // I21: in test mode this campaign's emails go to the person who started
    // it — only if their test address is on the approved list; otherwise to
    // the general test address (Settings → General).
    if (testRecipient !== undefined) {
      const settings = await store.getSettings();
      const approved = (settings.testRecipients || TEST_RECIPIENTS).map(normEmail);
      const want = normEmail(testRecipient);
      upd.testRecipient = want && approved.includes(want) ? want : null;
    }
  }
  if (status === "archived") {
    upd.archivedFrom = campaign.status;
    upd.archivedAt = FieldValue.serverTimestamp();
    if (campaign.status === "draft") {
      await ref.update(upd);
      const released = await endAll(await liveEnrolmentRefs("campaignId", campaignId), "removed", "Campaign archived");
      return { status, released };
    }
  }
  let ended = 0;
  if (status === "finished") {
    upd.finishedAt = FieldValue.serverTimestamp();
    await ref.update(upd);
    ended = await endAll(await liveEnrolmentRefs("campaignId", campaignId), "stopped", "Campaign finished");
    return { status, ended };
  }
  await ref.update(upd);
  return { status };
}

// I5: bring an archived campaign back as it was (a draft stays a draft —
// its companies were released when it was archived — a finished one stays finished).
async function restore(campaignId, caller) {
  const campaign = await getCampaign(campaignId);
  if (campaign.status !== "archived") fail("failed-precondition", "not_archived", "Only archived campaigns can be restored.");
  const status = campaign.archivedFrom === "draft" ? "draft" : "finished";
  await db().doc(`outreachCampaigns/${campaignId}`).update({ status, archivedFrom: FieldValue.delete(), archivedAt: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(), updatedBy: caller });
  return { status };
}

// I22 (8 Oct): "Run now" — test mode or a test campaign (22 Oct). Every waiting step of this
// campaign is brought forward to now and the scheduler runs for this campaign
// alone, ignoring the sending window (approval steps still wait for approval).
// 28 Oct (switch outreach.sendAllNow): "Send approved now" — a campaign with "Send
// approved emails all at once" sends its approved, due emails right away, inside its
// sending window (unlike Run now, nothing else is pulled forward). Real campaigns too.
async function sendNow({ campaignId }, caller) {
  const campaign = await getCampaign(campaignId);
  if (!campaign.sendAllAtOnce) fail("failed-precondition", "not_send_all", "Tick \"Send approved emails all at once\" in the campaign's Settings first.");
  if (campaign.status !== "active") fail("failed-precondition", "not_active", "Start the campaign first.");
  const { runScheduler } = require("./scheduler");
  const r = await runScheduler({ now: new Date(), onlyCampaignId: campaignId, gap: () => 1500 });
  // report.open = campaigns inside their window this run: 0 means this one is outside it.
  return { ok: true, sent: r.sent || 0, drafts: r.drafts || 0, deferred: r.deferred || 0, outsideWindow: !r.killed && !r.open, by: caller };
}

async function runNow({ campaignId }, caller) {
  const settings = await store.getSettings();
  const campaign = await getCampaign(campaignId);
  if (!settings.testMode && !campaign.isTest) fail("failed-precondition", "test_only", "Run now only works in test mode or on a test campaign.");
  if (campaign.status !== "active") fail("failed-precondition", "not_active", "Start the campaign first.");
  const now = new Date();
  const snap = await db().collection("outreachEnrolments").where("campaignId", "==", campaignId).where("status", "==", "active").limit(200).get();
  let moved = 0;
  for (const group of chunks(snap.docs, 400)) {
    const batch = db().batch();
    group.forEach((d) => { const n = d.data().nextActionAt; if (!n || n.toMillis() > now.getTime()) { batch.update(d.ref, { nextActionAt: Timestamp.fromDate(now) }); moved++; } });
    await batch.commit();
  }
  const { runScheduler } = require("./scheduler");
  const r = await runScheduler({ now: new Date(now.getTime() + 1000), onlyCampaignId: campaignId, ignoreWindow: true, gap: () => 1500 });
  return { ok: true, moved, sent: r.sent || 0, drafts: r.drafts || 0, tasks: r.tasks || 0, started: r.started || 0, completed: r.completed || 0, by: caller };
}

// ── "To approve" queue ──────────────────────────────────────────────────────

const MAX_APPROVE_PER_CALL = 300;

async function approve({ messageIds, subject, body }, caller) {
  if (!Array.isArray(messageIds) || !messageIds.length) fail("invalid-argument", "drafts_required", "No drafts to approve.");
  const ids = [...new Set(messageIds.map(String))].slice(0, MAX_APPROVE_PER_CALL);
  const edited = subject != null || body != null;
  if (edited && ids.length !== 1) fail("invalid-argument", "edit_one", "Edits apply to one draft at a time.");
  if (body != null && (!String(body).trim() || String(body).length > 20000)) fail("invalid-argument", "bad_body", "The message can't be empty (up to 20,000 characters).");
  if (subject != null && (!String(subject).trim() || String(subject).length > 300)) fail("invalid-argument", "bad_subject", "The subject can't be empty (up to 300 characters).");
  const campaignCache = new Map();
  let approved = 0;
  const skipped = {};
  const skip = (r) => { skipped[r] = (skipped[r] || 0) + 1; };
  for (const group of chunks(ids, TX_PARALLEL)) {
    const res = await Promise.all(group.map(async (id) => {
      const msgRef = db().doc(`outreachMessages/${id}`);
      const first = await msgRef.get();
      if (!first.exists || first.data().source !== "campaign") return "not_a_draft";
      const campaignId = first.data().campaignId;
      if (!campaignCache.has(campaignId)) {
        const c = await db().doc(`outreachCampaigns/${campaignId}`).get();
        campaignCache.set(campaignId, c.exists ? c.data() : null);
      }
      const campaign = campaignCache.get(campaignId);
      if (!campaign || ["finished", "archived"].includes(campaign.status)) return "campaign_closed";
      return db().runTransaction(async (tx) => {
        const m = await tx.get(msgRef);
        const enrolRef = db().doc(`outreachEnrolments/${m.data().enrolmentId}`);
        const e = await tx.get(enrolRef);
        if (m.data().status !== "draft") return "not_a_draft";
        if (!e.exists || e.data().status !== "awaiting_approval" || e.data().draftMessageId !== id) return "not_waiting";
        const upd = { status: "approved", approvedBy: caller, approvedAt: FieldValue.serverTimestamp() };
        if (body != null) { upd.draftBody = String(body).trim(); upd.edited = true; }
        // A follow-up keeps the conversation's "Re:" subject.
        if (subject != null && !m.data().isReply) { upd.subject = String(subject).trim(); upd.edited = true; }
        tx.update(msgRef, upd);
        tx.update(enrolRef, { status: "active", nextActionAt: Timestamp.now(), lastError: null });
        return "approved";
      });
    }));
    res.forEach((r) => (r === "approved" ? approved++ : skip(r)));
  }
  if (approved) await Usage.countPerson("email.approved", caller, approved);
  return { approved, skipped };
}

// Outbox (13 Oct): an approved draft that hasn't gone out yet goes back to
// "To approve" — the reverse of approve. Refused while the scheduler is sending it.
async function unapprove({ messageId }, caller) {
  if (!messageId) fail("invalid-argument", "draft_required", "Choose an email.");
  const msgRef = db().doc(`outreachMessages/${String(messageId)}`);
  return db().runTransaction(async (tx) => {
    const m = await tx.get(msgRef);
    if (!m.exists || m.data().source !== "campaign" || m.data().status !== "approved") fail("failed-precondition", "not_approved", "This email isn't waiting to go out any more (already sent, or not approved).");
    const enrolRef = db().doc(`outreachEnrolments/${m.data().enrolmentId}`);
    const e = await tx.get(enrolRef);
    if (!e.exists || e.data().status !== "active") fail("failed-precondition", "not_waiting", "This company's campaign has moved on.");
    if (e.data().lockUntil && e.data().lockUntil.toMillis() > Date.now()) fail("failed-precondition", "sending_now", "It's being sent right now — check Sent in a minute.");
    tx.update(msgRef, { status: "draft", approvedBy: null, approvedAt: null, unapprovedBy: caller, unapprovedAt: FieldValue.serverTimestamp() });
    tx.update(enrolRef, { status: "awaiting_approval", draftMessageId: msgRef.id, lastError: null });
    return { ok: true };
  });
}

async function skipDraft({ messageId }, caller) {
  if (!messageId) fail("invalid-argument", "draft_required", "Choose a draft.");
  const msgRef = db().doc(`outreachMessages/${messageId}`);
  const settings = await store.getSettings();
  return db().runTransaction(async (tx) => {
    const m = await tx.get(msgRef);
    if (!m.exists || m.data().status !== "draft") fail("failed-precondition", "not_a_draft", "This draft is no longer waiting.");
    const enrolRef = db().doc(`outreachEnrolments/${m.data().enrolmentId}`);
    const e = await tx.get(enrolRef);
    const camp = m.data().campaignId ? (await tx.get(db().doc(`outreachCampaigns/${m.data().campaignId}`))).data() : null;
    const next = addWait(new Date(), { days: 1, unit: "working" }, sendingDaysOf(camp, settings), skipHolidaysOf(camp, settings), (await waitJobOn(camp)) ? waitOptsOf(camp, settings, { gap: false }) : null);
    tx.update(msgRef, { status: "cancelled", cancelledReason: `Skipped by ${caller} — drafted again the next sending day` });
    if (e.exists && e.data().status === "awaiting_approval" && e.data().draftMessageId === messageId) {
      tx.update(enrolRef, { status: "active", nextActionAt: Timestamp.fromDate(next), draftMessageId: null });
    }
    return { ok: true, nextActionAt: next.toISOString() };
  });
}

// ── Dynamic audiences (Phase 2c, C5: daily from 07:00 Lisbon) ─────────────────
// Re-applies the campaign's latest Search CRM filter to companies changed
// since the last run (cheap: updatedAt > lastEvaluatedAt) and enrols new
// matches with the usual exclusions; companies in another campaign are left
// there. The first run only sets the starting point.
const DYNAMIC_MAX_PER_RUN = 500;
async function runDynamicAudience(campaign, now) {
  const spec = latestFilterSpec(campaign);
  const ref = db().doc(`outreachCampaigns/${campaign.id}`);
  const since = campaign.audience?.lastEvaluatedAt || null;
  if (!spec || !since) {
    await ref.update({ "audience.lastEvaluatedAt": Timestamp.fromDate(now) });
    return { checked: 0, enrolled: 0, initialised: true };
  }
  const snap = await db().collection("searchCompanies").where("updatedAt", ">", since).orderBy("updatedAt", "asc").limit(2000).get();
  // T6: the Tier is computed (set on the company, else the rules), as on the
  // page; the rules only count while the "search.tier" switch isn't off.
  const byTier = spec.some((f) => f.field === "targetTier");
  const tierRules = byTier && (await Feat.jobState("search.tier")) !== "off" ? ((await db().doc("searchConfig/targetTiers").get()).data()?.rules || []) : [];
  const matches = snap.docs.filter((d) => {
    const c = d.data();
    return !c.activeCampaignId && matchesFilterSpec(byTier ? { ...c, targetTier: tierOf(c, tierRules) } : c, spec, now.getTime());
  }).map((d) => d.id).slice(0, DYNAMIC_MAX_PER_RUN);
  let enrolled = 0;
  if (matches.length) {
    const ctx = await evalContext(campaign);
    ctx.usePeople = await peopleJobOn(campaign); // People merge (Stage 4)
    const byId = new Map(snap.docs.map((d) => [d.id, d.data()]));
    await withInbox(ctx, matches.map((id) => byId.get(id)?.companyEmail), await inboxJobOn(campaign));
    const source = { type: "dynamic", label: "Dynamic — new matches of the filter" };
    for (const group of chunks(matches, TX_PARALLEL)) {
      const res = await Promise.all(group.map((id) => enrolOne(id, campaign, ctx, source, "skip", "scheduler")));
      enrolled += res.filter((r) => r.result === "enrolled").length;
    }
  }
  const last = snap.docs.length ? snap.docs[snap.docs.length - 1].data().updatedAt : Timestamp.fromDate(now);
  await ref.update({
    "audience.lastEvaluatedAt": snap.size >= 2000 ? last : Timestamp.fromDate(now),
    ...(enrolled ? { "stats.enrolled": FieldValue.increment(enrolled), "stats.dynamicAdded": FieldValue.increment(enrolled) } : {}),
  });
  return { checked: snap.size, enrolled };
}

// ── Tasks (manual steps, Phase 2b) ──────────────────────────────────────────

const cleanUrl = (u) => { const s = String(u || "").trim().slice(0, 300); return /^https?:\/\/\S+$/i.test(s) ? s : null; };
const parseDate = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d : null; };

// Records the outcome on the company (a searchActivities touch, like the
// Search CRM's own "+ Activity"), then moves the sequence on — or stops it
// when the company answered and "stop the sequence" is ticked.
async function completeTask({ taskId, outcome, notes, stopSequence, profileUrl, reopenAt }, caller) {
  if (!taskId) fail("invalid-argument", "task_required", "Choose a task.");
  const taskRef = db().doc(`outreachTasks/${taskId}`);
  const tSnap = await taskRef.get();
  if (!tSnap.exists) fail("not-found", "task_not_found", "Task not found.");
  const t = tSnap.data();
  if (t.status !== "open") fail("failed-precondition", "task_closed", "This task is already closed.");
  const o = findOutcome(t.channel, outcome);
  if (!o) fail("invalid-argument", "bad_outcome", `Unknown outcome "${outcome}" for a ${t.channel} task.`);
  const note = String(notes || "").trim().slice(0, 2000);
  const reopen = o.reopen ? parseDate(reopenAt) : null;
  if (o.reopen && (!reopen || reopen.getTime() < Date.now() - 86400000)) fail("invalid-argument", "date_required", "Pick the date for the next attempt.");
  // Own tasks (12 Oct) have no campaign: no sequence to move, only the touch and the task.
  const campaign = t.campaignId ? ((await db().doc(`outreachCampaigns/${t.campaignId}`).get()).data() || {}) : {};
  const settingsNow = await store.getSettings();
  const campaignDays = sendingDaysOf(campaign, settingsNow), campaignHolidays = skipHolidaysOf(campaign, settingsNow);
  const campaignWait = (await waitJobOn(campaign)) ? waitOptsOf(campaign, settingsNow) : null;
  const linkedinUrl = t.channel === "linkedin" ? cleanUrl(profileUrl) : null;
  // Phase 2c branch for this outcome (set on the step): go to a later step or end.
  // Campaign paths (27 Oct): only the steps of the task's own path.
  const taskPath = ((campaign.steps || []).find((x) => x.id === t.stepId) || {}).pathId;
  if (campaign.steps) campaign.steps = pathSteps(campaign, taskPath);
  const stepIdx = (campaign.steps || []).findIndex((x) => x.id === t.stepId);
  const branch = stepIdx >= 0 ? ((campaign.steps[stepIdx].branches || []).find((b) => b.outcome === o.key) || null) : null;

  // 1. The touch on the company (a skipped step leaves no trace there).
  let activityId = null;
  if (o.activity && !t.companyId && t.personEmail) {
    // F1: a people campaign — the touch goes on the person's record.
    const title = `${CHANNEL_LABEL[t.channel]} — ${o.label}${campaign.name ? ` (${campaign.name} · ${t.stepName})` : ""}`;
    // Their activity types: call / meeting done / other (the channel is in "via").
    const type = String(o.activity).startsWith("call") ? "call" : o.key === "met" ? "meeting_done" : "other";
    activityId = await store.logPersonTask({ refs: t.refs, channel: t.channel, type, title, content: [note, linkedinUrl].filter(Boolean).join("\n") || null, taskId, campaignId: t.campaignId, createdBy: caller, isTest: t.isTest });
  } else if (o.activity) {
    const title = `${t.isTest ? "[TEST] " : ""}${CHANNEL_LABEL[t.channel]} — ${o.label}${campaign.name ? ` (${campaign.name} · ${t.stepName})` : ""}`;
    const ref = await db().collection("searchActivities").add({
      companyId: t.companyId,
      // Test-mode rehearsals never count as a touch on a real company.
      type: t.isTest ? "task_test" : o.activity,
      date: Timestamp.now(), title, content: note || null, via: t.channel, direction: "out",
      outcome: o.key, responseCategory: null, status: null, isTest: !!t.isTest,
      campaignId: t.campaignId || null, stepId: t.stepId || null, enrolmentId: t.enrolmentId || null, taskId, channel: t.channel,
      threadId: t.threadId || null, linkedinUrl, createdAt: FieldValue.serverTimestamp(), createdBy: caller,
    });
    activityId = ref.id;
    await store.touchCompany(t.companyId, { direction: "out", isTest: t.isTest, outreach: t.channel !== "other", channel: t.channel, by: caller, outcome: o.key });
    if (o.reply) await store.touchCompany(t.companyId, { direction: "in", isTest: t.isTest, channel: t.channel });
  }

  // 2. Call back / reschedule: the same task stays open for the new date.
  if (reopen) {
    await taskRef.update({
      dueAt: Timestamp.fromDate(reopen), notes: note, lastOutcome: o.key,
      attempts: FieldValue.arrayUnion({ at: Timestamp.now(), outcome: o.key, by: caller, notes: note || null, activityId }),
    });
    return { ok: true, status: "open", dueAt: reopen.toISOString(), activityId };
  }

  // 3. Close the task, then stop or advance the sequence (an own task has none).
  if (!t.campaignId || !t.enrolmentId) {
    await taskRef.update({
      status: o.key === "skipped" ? "skipped" : "done", outcome: o.key, notes: note, activityId,
      completedAt: FieldValue.serverTimestamp(), completedBy: caller, ...(linkedinUrl ? { linkedinUrl } : {}),
    });
    return { ok: true, status: o.key === "skipped" ? "skipped" : "done", sequence: "none", activityId };
  }
  const enrolRef = db().doc(`outreachEnrolments/${t.enrolmentId}`);
  await taskRef.update({
    status: o.key === "skipped" ? "skipped" : "done", outcome: o.key, notes: note, activityId,
    completedAt: FieldValue.serverTimestamp(), completedBy: caller, ...(linkedinUrl ? { linkedinUrl } : {}),
  });
  if (o.reply && stopSequence !== false) {
    // Keep the step in the history (Overview counts it as done, and as the
    // step the company answered after), then end the enrolment.
    await enrolRef.update({ history: FieldValue.arrayUnion({ stepId: t.stepId, at: Timestamp.now(), result: o.key, taskId, activityId }), taskId: null }).catch(() => {});
    await endEnrolment(enrolRef, "replied", `${CHANNEL_LABEL[t.channel]}: ${o.label}`);
    await db().doc(`outreachCampaigns/${t.campaignId}`).update({
      lockedStepIds: FieldValue.arrayUnion(t.stepId),
      [`stats.tasks_${t.channel}`]: FieldValue.increment(1),
    }).catch(() => {});
    return { ok: true, status: "done", sequence: "stopped", activityId };
  }
  if (branch?.action === "end") {
    await enrolRef.update({ history: FieldValue.arrayUnion({ stepId: t.stepId, at: Timestamp.now(), result: o.key, taskId, activityId }), taskId: null }).catch(() => {});
    await endEnrolment(enrolRef, "completed", `Ended by a rule: ${CHANNEL_LABEL[t.channel]} — ${o.label}`);
    await db().doc(`outreachCampaigns/${t.campaignId}`).update({ lockedStepIds: FieldValue.arrayUnion(t.stepId), [`stats.tasks_${t.channel}`]: FieldValue.increment(1) }).catch(() => {});
    return { ok: true, status: "done", sequence: "ended", activityId };
  }
  const moved = await db().runTransaction(async (tx) => {
    const e = await tx.get(enrolRef);
    if (!e.exists || e.data().status !== "awaiting_task" || e.data().taskId !== taskId) return false;
    const steps = campaign.steps || [];
    const gotoIdx = branch?.action === "goto" ? steps.findIndex((x) => x.id === branch.stepId) : -1;
    const nextIndex = gotoIdx > e.data().currentStep ? gotoIdx : e.data().currentStep + 1;
    const next = steps[nextIndex];
    tx.update(enrolRef, {
      status: "active", currentStep: nextIndex, taskId: null,
      nextActionAt: Timestamp.fromDate(addWait(new Date(), next ? next.wait : FINAL_GRACE, campaignDays, campaignHolidays, next ? campaignWait : null)),
      history: FieldValue.arrayUnion({ stepId: t.stepId, at: Timestamp.now(), result: o.key, taskId, activityId }),
      lastError: null,
    });
    return true;
  });
  if (moved) {
    await db().doc(`outreachCampaigns/${t.campaignId}`).update({
      lockedStepIds: FieldValue.arrayUnion(t.stepId),
      [`stats.tasks_${t.channel}`]: FieldValue.increment(1),
    }).catch(() => {});
  }
  return { ok: true, status: o.key === "skipped" ? "skipped" : "done", sequence: moved ? (branch?.action === "goto" ? "jumped" : "next") : "unchanged", activityId };
}

async function updateTask({ taskId, assignee, signer, dueAt, notes, letterText }, caller) {
  const ref = db().doc(`outreachTasks/${taskId || "_"}`);
  const snap = await ref.get();
  if (!snap.exists || snap.data().status !== "open") fail("failed-precondition", "task_closed", "This task is no longer open.");
  const upd = { updatedAt: FieldValue.serverTimestamp(), updatedBy: caller };
  if (assignee !== undefined) {
    const known = assignee === null || (/^[a-z][a-z0-9-]{1,19}$/.test(String(assignee)) && (["andre", "antonio"].includes(assignee) || (await db().doc(`teamDirectory/${assignee}`).get()).exists));
    if (!known) fail("invalid-argument", "bad_assignee", "Assign to someone on the team, or nobody.");
    upd.assignee = assignee;
  }
  // T4: who signs this letter / script (null = the campaign's choice).
  if (signer !== undefined) {
    // 29 Oct: "both" (André & António) signs a letter, never a call script.
    if (signer === "both" && snap.data().channel !== "letter") fail("invalid-argument", "bad_signer", "Only a letter can be signed by both.");
    const known = signer === null || signer === "both" || (/^[a-z][a-z0-9-]{1,19}$/.test(String(signer)) && (["andre", "antonio"].includes(signer) || (await db().doc(`teamDirectory/${signer}`).get()).exists));
    if (!known) fail("invalid-argument", "bad_signer", "Choose someone on the team.");
    upd.signer = signer;
  }
  if (dueAt !== undefined) {
    const d = parseDate(dueAt);
    if (!d) fail("invalid-argument", "bad_date", "Invalid date.");
    upd.dueAt = Timestamp.fromDate(d);
  }
  if (notes !== undefined) upd.notes = String(notes || "").trim().slice(0, 2000);
  // 29 Oct (switch outreach.letterTools): this letter's own text — {subject, body} replaces the template's
  // for this one letter (edit anything before printing); null goes back to the template.
  if (letterText !== undefined) {
    if (snap.data().channel !== "letter") fail("failed-precondition", "not_a_letter", "Only a letter can have its own text.");
    if (letterText === null) upd.letterText = FieldValue.delete();
    else {
      const subject = String(letterText?.subject ?? "").trim(), body = String(letterText?.body ?? "").trim();
      if (!body) fail("invalid-argument", "empty_letter", "The letter text can't be empty.");
      if (subject.length > 300 || body.length > 20000) fail("invalid-argument", "letter_too_long", "That letter is too long.");
      // the envelope (what shows in the window), one line per line; none = the company record's address
      const address = String(letterText?.address ?? "").replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
      if (address.length > 8 || address.join("\n").length > 600) fail("invalid-argument", "address_too_long", "That address is too long.");
      upd.letterText = { subject, body, ...(address.length ? { address: address.join("\n") } : {}), editedBy: caller, editedAt: FieldValue.serverTimestamp() };
    }
  }
  await ref.update(upd);
  return { ok: true };
}

// ── Own tasks and activities (12 Oct) ──────────────────────────────────────
// A task that isn't a campaign step (call, LinkedIn, WhatsApp, letter, visit,
// other) for a company — from Outreach → Tasks or from a conversation — and a
// touch recorded straight away (what a task's outcome would write). Both on
// the company; a conversation's company when started from one.
const OWN_CHANNELS = ["call", "linkedin", "whatsapp", "letter", "visit", "other"];
async function taskTarget({ companyId, threadId }) {
  let thread = null;
  if (threadId) {
    const th = await db().doc(`outreachThreads/${String(threadId)}`).get();
    if (!th.exists) fail("not-found", "thread_not_found", "Conversation not found.");
    thread = { id: th.id, ...th.data() };
  }
  const cid = String(companyId || thread?.companyId || "");
  if (!cid) fail("invalid-argument", "company_required", thread ? "This conversation has no company yet — assign it to a company first." : "Choose a company.");
  const c = await db().doc(`searchCompanies/${cid}`).get();
  if (!c.exists) fail("not-found", "company_not_found", "Company not found.");
  return { companyId: cid, company: c.data(), thread };
}
async function teamKeyOk(key) {
  return /^[a-z][a-z0-9-]{1,19}$/.test(String(key)) && (["andre", "antonio"].includes(key) || (await db().doc(`teamDirectory/${key}`).get()).exists);
}

async function createTask({ companyId, threadId, channel, dueAt, assignee, instructions, templateId }, caller) {
  if (!OWN_CHANNELS.includes(channel)) fail("invalid-argument", "bad_channel", "Choose call, LinkedIn, WhatsApp, letter, visit or other.");
  const { companyId: cid, company, thread } = await taskTarget({ companyId, threadId });
  const due = dueAt ? parseDate(dueAt) : new Date();
  if (!due) fail("invalid-argument", "bad_date", "Invalid date.");
  let who = assignee === undefined || assignee === "" ? (company.owner || null) : assignee;
  if (who !== null && !(await teamKeyOk(who))) fail("invalid-argument", "bad_assignee", "Assign to someone on the team, or nobody.");
  let tpl = null, variantKey = null;
  if (templateId && channel === "letter") {
    const ts = await db().doc(`outreachTemplates/${String(templateId)}`).get();
    if (!ts.exists) fail("not-found", "template_not_found", "Template not found.");
    tpl = ts.id; variantKey = (ts.data().variants || [])[0]?.key || null;
  }
  const ref = await db().collection("outreachTasks").add({
    campaignId: null, campaignName: "", enrolmentId: null, stepId: null, stepName: "", stepIndex: null, stepCount: null,
    companyId: cid, companyName: company.name || "",
    channel, instructions: String(instructions || "").trim().slice(0, 2000), templateId: tpl, variantKey,
    assignee: who, dueAt: Timestamp.fromDate(due), status: "open", outcome: null, notes: "", activityId: null,
    source: "own", threadId: thread?.id || null, isTest: !!thread?.isTest,
    createdAt: FieldValue.serverTimestamp(), createdBy: caller, completedAt: null, completedBy: null,
  });
  return { ok: true, taskId: ref.id };
}

async function logActivity({ companyId, threadId, channel, outcome, notes, date }, caller) {
  if (!OWN_CHANNELS.includes(channel)) fail("invalid-argument", "bad_channel", "Choose call, LinkedIn, WhatsApp, letter, visit or other.");
  const o = outcome === "skipped" ? null : findOutcome(channel, outcome);
  if (!o || !o.activity) fail("invalid-argument", "bad_outcome", `Unknown outcome "${outcome}" for ${CHANNEL_LABEL[channel]}.`);
  const { companyId: cid, thread } = await taskTarget({ companyId, threadId });
  const when = date ? parseDate(date) : new Date();
  if (!when || when.getTime() > Date.now() + 86400000) fail("invalid-argument", "bad_date", "The date can't be in the future.");
  const isTest = !!thread?.isTest;
  const note = String(notes || "").trim().slice(0, 2000);
  const ref = await db().collection("searchActivities").add({
    companyId: cid, type: isTest ? "task_test" : o.activity, date: Timestamp.fromDate(when),
    title: `${isTest ? "[TEST] " : ""}${CHANNEL_LABEL[channel]} — ${o.label}`, content: note || null,
    via: channel, direction: "out", outcome: o.key, responseCategory: null, status: null, isTest,
    channel, threadId: thread?.id || null, source: "outreach",
    createdAt: FieldValue.serverTimestamp(), createdBy: caller,
  });
  await store.touchCompany(cid, { direction: "out", isTest, outreach: channel !== "other", channel, by: caller, outcome: o.key });
  if (o.reply) await store.touchCompany(cid, { direction: "in", isTest, channel });
  return { ok: true, activityId: ref.id };
}

// Do not contact (spec §10): stops every campaign for the company and blocks
// enrolment and new outreach until switched off.
async function setDoNotContact({ companyId, on, reason }, caller) {
  if (!companyId || typeof companyId !== "string") fail("invalid-argument", "company_required", "Choose a company.");
  const ref = db().doc(`searchCompanies/${companyId}`);
  if (!(await ref.get()).exists) fail("not-found", "company_not_found", "Company not found.");
  const r = String(reason || "").trim().slice(0, 300);
  await ref.update({ doNotContact: { on: !!on, reason: on ? (r || null) : null, at: FieldValue.serverTimestamp(), by: caller }, updatedBy: caller, updatedByAt: FieldValue.serverTimestamp() });
  const stopped = on ? await stopCompanyEnrolments(companyId, `Marked do not contact${r ? ` — ${r}` : ""}`) : 0;
  return { ok: true, on: !!on, stopped };
}

// Email name check (26 Oct, switch search.emailNameCheck): fix or confirm the name
// a company gets in emails ({{company.shortName}}). "use" = the suggestion (the
// legal name's short form, with accents), "set" = a name typed by the person
// (taken as checked), "keep" = today's name is right (not flagged again until it
// changes). The new name's words join the Search CRM search words; logged on the company.
async function setEmailName({ companyId, op, name }, caller) {
  if (!companyId || typeof companyId !== "string") fail("invalid-argument", "company_required", "Choose a company.");
  if (!["use", "set", "keep"].includes(op)) fail("invalid-argument", "bad_op", "Choose what to do with the email name.");
  const ref = db().doc(`searchCompanies/${companyId}`);
  const snap = await ref.get();
  if (!snap.exists) fail("not-found", "company_not_found", "Company not found.");
  const c = { id: companyId, ...snap.data() };
  const before = EN.emailNameOf(c);
  const log = (content) => db().collection("searchActivities").add({ companyId, type: "company_edited", date: Timestamp.now(), title: null, content, status: null, createdAt: FieldValue.serverTimestamp(), createdBy: caller || "system" });
  if (op === "keep") {
    await ref.update({ emailNameChecked: { name: before, by: caller, at: new Date().toISOString() }, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller });
    await log(`Email name "${before}" checked and kept`);
    return { ok: true, emailName: before, kept: true };
  }
  const next = op === "use" ? EN.suggestedName(c) : String(name || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!next) fail("invalid-argument", "name_required", "Type the email name.");
  const w = EN.searchWordsFor(next);
  await ref.update({
    emailName: next,
    emailNameChecked: op === "set" ? { name: next, by: caller, at: new Date().toISOString() } : FieldValue.delete(),
    ...(w.tokens.length ? { nameTokens: FieldValue.arrayUnion(...w.tokens), namePrefixes: FieldValue.arrayUnion(...w.prefixes) } : {}),
    updatedAt: FieldValue.serverTimestamp(), updatedBy: caller,
  });
  await log(`Email name changed: "${before}" → "${next}"${op === "use" ? " (the legal name)" : ""}`);
  return { ok: true, emailName: next };
}

// Paths round 2 (R11, 27 Oct): the planned path of every company waiting to start
// (up to 5,000), worked out again with the campaign's saved paths — after the paths
// change. Only changed enrolments are written. The real path is chosen at the start.
async function planPending(campaignId) {
  const campaign = await getCampaign(campaignId);
  const multi = (campaign.paths || []).length > 1;
  const rules = multi && pathsUseTier(campaign) ? ((await db().doc("searchConfig/targetTiers").get()).data()?.rules || []) : [];
  const snap = await db().collection("outreachEnrolments").where("campaignId", "==", campaignId).where("status", "==", "pending").limit(5000).get();
  let changed = 0;
  for (const part of chunks(snap.docs.filter((d) => d.data().companyId), 100)) {
    const cos = multi ? await db().getAll(...part.map((d) => db().doc(`searchCompanies/${d.data().companyId}`))) : [];
    const batch = db().batch(); let n = 0;
    part.forEach((d, i) => {
      const pl = multi ? plannedPath(campaign, cos[i].exists ? cos[i].data() : {}, rules) : { plannedPathId: null, plannedPathName: null };
      if (pl.plannedPathId !== (d.data().plannedPathId ?? null) || pl.plannedPathName !== (d.data().plannedPathName ?? null)) { batch.update(d.ref, pl); n++; }
    });
    if (n) { await batch.commit(); changed += n; }
  }
  return changed;
}

// Campaign paths (27 Oct, switch outreach.paths): "Check who goes where" — the
// companies of the campaign per path, in three groups (27 Oct, André): "to start"
// (waiting — the path they would take today with the paths being edited, unsaved),
// "in progress" (live, their stored path) and "closed" (finished, stopped or left
// out by the paths; leftOut is the part of closed the paths left out). "elsewhere"
// (27 Oct, T4b): placed companies the paths as they are now would put on another
// path — placed under earlier conditions or older data; they keep their path.
// Up to 2,000 waiting and 2,000 placed companies are checked.
async function pathsPreview({ campaignId, paths, steps }) {
  const campaign = await getCampaign(campaignId);
  const draft = { ...campaign, paths: paths !== undefined ? normalizePaths(paths, (steps || campaign.steps || []).map((s) => ({ ...s, pathId: s.pathId || ELSE_PATH }))) : campaign.paths };
  const list = pathsOf(draft);
  const counts = Object.fromEntries(list.map((p) => [p.id, { waiting: 0, active: 0, closed: 0, leftOut: 0, elsewhere: 0 }]));
  const snap = await db().collection("outreachEnrolments").where("campaignId", "==", campaignId).limit(5000).get();
  const waiting = [], placed = [];
  for (const d of snap.docs) {
    const e = d.data();
    if (e.status === "pending") { if (e.companyId) waiting.push(e.companyId); continue; }
    if (["removed", "moved"].includes(e.status)) continue;
    const id = counts[e.pathId || ELSE_PATH] ? (e.pathId || ELSE_PATH) : null;
    if (!id) continue;
    if (e.companyId) placed.push([e.companyId, id]);
    if (LIVE_ENROLMENT.includes(e.status)) counts[id].active++;
    else { counts[id].closed++; if (/^Left out by the campaign's paths/.test(e.stopReason || "")) counts[id].leftOut++; }
  }
  const byTier = list.some((p) => (p.filters || []).some((f) => f.field === "targetTier"));
  const tierRules = byTier ? ((await db().doc("searchConfig/targetTiers").get()).data()?.rules || []) : [];
  const ids = waiting.slice(0, 2000), placedIds = placed.slice(0, 2000);
  const pathNow = async (list2, each) => {
    for (let i = 0; i < list2.length; i += 100) {
      const part = list2.slice(i, i + 100);
      const snaps = await db().getAll(...part.map((x) => db().doc(`searchCompanies/${Array.isArray(x) ? x[0] : x}`)));
      snaps.forEach((s, j) => { const c = s.exists ? s.data() : {}; each(choosePath(draft, byTier ? { ...c, targetTier: tierOf(c, tierRules) } : c).path, part[j]); });
    }
  };
  await pathNow(ids, (p) => { counts[p.id].waiting++; });
  await pathNow(placedIds, (p, [, stored]) => { if (p.id !== stored) counts[stored].elsewhere++; });
  return { paths: list.map((p) => ({ id: p.id, name: p.name, ...counts[p.id], started: counts[p.id].active + counts[p.id].closed, steps: pathSteps(draft, p.id).length })), waitingChecked: ids.length, waitingTotal: waiting.length };
}

// Team access: the permission each action needs. Starting a campaign sends
// emails, so it needs "approve" like approving drafts.
const CAMPAIGN_ACTION_PERM = {
  save: "out.campaigns", duplicate: "out.campaigns", delete: "out.campaigns", preview: "out.campaigns", enrol: "out.campaigns", recipientsPreview: "out.campaigns",
  enrolment: "out.campaigns", previewPeople: "out.campaigns", enrolPeople: "out.campaigns",
  requestStart: "out.campaigns", returnStart: "out.approve", runNow: "out.approve", sendNow: "out.approve",
  approve: "out.approve", skipDraft: "out.approve", unapprove: "out.approve", completeTask: "out.tasks", updateTask: "out.tasks", setDoNotContact: "search.edit",
  createTask: "out.tasks", logActivity: "out.tasks",
  related: "search.view", // owner-aware outreach (22 Oct): the company page's "related companies in outreach"
  emailName: "search.edit", // email name check (26 Oct)
  pathsPreview: "out.campaigns", // campaign paths (27 Oct)
};
function campaignActionPerm(data) {
  // Starting / resuming sends emails; finishing ends a live campaign.
  if (data.action === "setStatus") return ["active", "finished"].includes(data.status) ? "out.approve" : "out.campaigns";
  return CAMPAIGN_ACTION_PERM[data.action] || "out.admin";
}

// "Run now" (test campaigns / test mode) sends through the scheduler from here, so this
// function needs the scheduler's secrets too (27 Oct: without them Resend said "API key is invalid").
exports.outreachCampaign = onCall({ region: REGION, timeoutSeconds: 300, secrets: [RESEND_SEND_KEY, RESEND_READ_KEY, UNSUBSCRIBE_SECRET, ANTHROPIC_API_KEY] }, async (request) => {
  const caller = normEmail(request.auth?.token?.email);
  const data = request.data || {};
  if (!P.hasPerm(request, campaignActionPerm(data))) fail("permission-denied", "not_admin", "You don't have permission to do this.");
  const canApprove = P.hasPerm(request, "out.approve");
  // Feature switches: Outreach, then company or people campaigns by audience.
  // "Do not contact" (Search CRM) is a safety control and never switched.
  if (data.action === "emailName") await Feat.requireFeature(request, "search.emailNameCheck"); // a Search CRM change, not Outreach
  // Campaign paths (27 Oct): saving more than one path, or checking them, needs the switch.
  if (data.action === "pathsPreview" || (data.action === "save" && Array.isArray(data.campaign?.paths) && data.campaign.paths.some((p) => p && p.id !== ELSE_PATH))
    || (data.action === "save" && data.campaign?.startOrder && data.campaign.startOrder.mode !== "added")) await Feat.requireFeature(request, "outreach.paths"); // + who starts first (R10)
  if (data.action === "sendNow" || (data.action === "save" && data.campaign?.sendAllAtOnce === true)) await Feat.requireFeature(request, "outreach.sendAllNow"); // 28 Oct
  if (data.action === "save" && Array.isArray(data.campaign?.cc) && data.campaign.cc.length) await Feat.requireFeature(request, "outreach.campaignCc"); // 28 Oct
  if (data.action === "updateTask" && (data.letterText !== undefined || data.signer === "both")) await Feat.requireFeature(request, "outreach.letterTools"); // 29 Oct: a letter's own text and envelope, signed by both
  if (!["setDoNotContact", "related", "emailName"].includes(data.action)) {
    let sub = ["previewPeople", "enrolPeople"].includes(data.action) ? "outreach.people" : ["enrol", "preview", "recipientsPreview", "runNow"].includes(data.action) ? "outreach.campaigns" : null;
    if (data.action === "save") {
      let aud = data.campaign?.audienceType;
      if (!aud && data.campaignId) { const c = await db().doc(`outreachCampaigns/${data.campaignId}`).get(); aud = c.exists ? c.data().audienceType : null; }
      sub = aud === "people" ? "outreach.people" : "outreach.campaigns";
    }
    await Feat.requireFeature(request, "outreach", ...(sub ? [sub] : []));
  }
  // A campaign that has started sends on its own: changing it, or adding
  // companies / people to it, needs "approve" (preparing a draft doesn't).
  if (!canApprove) {
    const targets = [];
    if (["save", "enrol", "enrolPeople"].includes(data.action)) targets.push(data.campaignId);
    if (data.action === "enrolment") {
      // Removing, pausing or moving someone in a running campaign is a change too.
      const en = data.enrolmentId ? await db().doc(`outreachEnrolments/${data.enrolmentId}`).get() : null;
      if (en?.exists) targets.push(en.data().campaignId);
      if (data.op === "move") targets.push(data.targetCampaignId);
    }
    for (const target of targets.filter(Boolean)) {
      const t = await db().doc(`outreachCampaigns/${target}`).get();
      if (t.exists && ["active", "paused"].includes(t.data().status)) fail("permission-denied", "needs_approve", "This campaign has started — only a partner can change it.");
    }
  }
  // One inbox (19 Oct): checked when adding companies, if the switch is on for this caller and site.
  const oneInbox = ["preview", "enrol"].includes(data.action) ? await Feat.isOnFor(request, "outreach.oneInbox") : false;
  // People merge (Stage 4): people's own details and the main contact, if the switch is on for this caller and site.
  const usePeople = ["preview", "enrol", "recipientsPreview"].includes(data.action) ? await Feat.isOnFor(request, "search.people") : false;
  // Owner-aware outreach (22 Oct): the owner panel when adding companies, and the company page's related companies.
  const ownerAware = ["preview", "enrol", "related"].includes(data.action) ? await Feat.isOnFor(request, "outreach.ownerAware") : false;
  // Email name check (26 Oct): flagged names in "Add companies".
  const nameCheck = data.action === "preview" ? await Feat.isOnFor(request, "search.emailNameCheck") : false;
  try {
    switch (data.action) {
      case "save": return await save(data, caller, { canApprove, testCampaigns: !data.campaignId && !!data.campaign?.isTest && await Feat.isOnFor(request, "outreach.testCampaigns") });
      case "requestStart": return await requestStart(data, caller);
      case "returnStart": return await returnStart(data, caller);
      case "duplicate": return await duplicate(data, caller);
      case "delete": return await remove(data, caller);
      case "preview": return await preview(data, caller, { oneInbox, usePeople, ownerAware, nameCheck });
      case "related": return await relatedOf(data, { ownerAware });
      case "recipientsPreview": return await recipientsPreview(data, caller, { usePeople, trust: await Feat.isOnFor(request, "contacts.trustLabels") });
      case "runNow": return await runNow(data, caller);
      case "sendNow": return await sendNow(data, caller);
      case "enrol": return await enrol(data, caller, { oneInbox, usePeople, ownerAware });
      case "enrolment": return await enrolmentOp(data, caller);
      case "setStatus": return await setStatus(data, caller);
      case "previewPeople": return await previewPeople(data, caller);
      case "enrolPeople": return await enrolPeople(data, caller);
      case "approve": return await approve(data, caller);
      case "skipDraft": return await skipDraft(data, caller);
      case "unapprove": return await unapprove(data, caller);
      case "completeTask": return await completeTask(data, caller);
      case "updateTask": return await updateTask(data, caller);
      case "createTask": return await createTask(data, caller);
      case "logActivity": return await logActivity(data, caller);
      case "setDoNotContact": return await setDoNotContact(data, caller);
      case "emailName": return await setEmailName(data, caller);
      case "pathsPreview": return await pathsPreview(data);
      default: fail("invalid-argument", "bad_action", `Unknown action "${data.action}".`);
    }
  } catch (e) {
    if (e instanceof CampaignError) throw new HttpsError("invalid-argument", e.message, { reason: e.reason });
    throw e;
  }
});

// Helpers for the webhook and scheduler (step 2); index.js exports only the callable.
exports.stopCompanyEnrolments = stopCompanyEnrolments;
exports.stopEnrolmentById = stopEnrolmentById;
exports.runDynamicAudience = runDynamicAudience;
exports.endEnrolment = endEnrolment;
// Recurring emails (5b) create and start each issue's campaign through these.
exports._internal = { save, enrolPeople, setStatus };
