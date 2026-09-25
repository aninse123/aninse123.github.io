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
//   enrolment   { enrolmentId, op: "pause"|"resume"|"remove", reason? }
//   setStatus   { campaignId, status: "active"|"paused"|"finished"|"archived" }
//   approve     { messageIds, subject?, body? }        "To approve" queue (D4): the drafts
//                                                    go back to the scheduler, which sends
//                                                    them inside the window and limits;
//                                                    subject/body = edits (one draft only)
//   skipDraft   { messageId }                        drop the draft, redraft next working day
//
// The audience's companies are chosen in the browser (Search CRM filters over
// the full cached list, a matched CSV, or ticked rows) and arrive as ids; the
// filter itself is stored on the campaign as `source.filterSpec` for Metrics.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { REGION, ADMIN_EMAILS } = require("./config");
const { normEmail } = require("./util");
const store = require("./store");
const { addWait } = require("./schedule_util");
const {
  LIVE_ENROLMENT, DEFAULT_CAMPAIGN, CampaignError, normalizeCampaign, activationProblems,
  evaluateCompany, enrolmentId,
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
      op: ["eq", "in", "gte", "lte", "between", "contains", "exists"].includes(f?.op) ? f.op : "eq",
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
  return {
    campaignId: campaign.id,
    exclusions: { ...DEFAULT_CAMPAIGN.exclusions, ...(campaign.exclusions || {}) },
    firstChannel: firstChannel(campaign),
    blockPersonalDomains: !!settings.blockPersonalDomains,
    suppressed: await loadSuppressed(),
    now: Date.now(),
    isTest: !!(settings.testMode || campaign.isTest),
  };
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
    const companyRef = db().doc(`searchCompanies/${e.data().companyId}`);
    const c = await tx.get(companyRef);
    const draftRef = e.data().draftMessageId ? db().doc(`outreachMessages/${e.data().draftMessageId}`) : null;
    const draft = draftRef ? await tx.get(draftRef) : null;
    endEnrolmentWrites(tx, enrolRef, companyRef, c.exists ? c.data() : null, status, reason);
    if (draft?.exists && ["draft", "approved"].includes(draft.data().status)) tx.update(draftRef, { status: "cancelled", cancelledReason: reason || status });
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
async function stopCompanyEnrolments(companyId, reason, status = "stopped") {
  if (!companyId) return 0;
  return endAll(await liveEnrolmentRefs("companyId", companyId), status, reason);
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function save({ campaignId, campaign }, caller) {
  if (!campaignId) {
    const settings = await store.getSettings();
    const fields = normalizeCampaign(campaign);
    const ref = db().collection("outreachCampaigns").doc();
    await ref.set({
      ...DEFAULT_CAMPAIGN, ...fields,
      status: "draft", lockedStepIds: [], stats: { enrolled: 0 },
      isTest: !!settings.testMode,
      createdAt: FieldValue.serverTimestamp(), createdBy: caller,
      updatedAt: FieldValue.serverTimestamp(), updatedBy: caller,
      startedAt: null, finishedAt: null,
    });
    return { campaignId: ref.id };
  }
  const ref = db().doc(`outreachCampaigns/${campaignId}`);
  const { renamed, name } = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail("not-found", "campaign_not_found", "Campaign not found.");
    const existing = snap.data();
    if (["finished", "archived"].includes(existing.status)) fail("failed-precondition", "campaign_closed", `This campaign is ${existing.status} and can't be edited — duplicate it instead.`);
    // audience.sources only ever grows through enrol (arrayUnion), so an
    // update never rewrites it.
    const { audience, ...fields } = normalizeCampaign(campaign, existing);
    tx.update(ref, { ...fields, "audience.mode": audience.mode, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller });
    return { renamed: fields.name !== existing.name, name: fields.name };
  });
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

async function preview({ campaignId, companyIds }) {
  const campaign = await getCampaign(campaignId);
  assertEnrollable(campaign);
  const ids = cleanCompanyIds(companyIds);
  const ctx = await evalContext(campaign);
  const data = await readCompanies(ids, campaignId);
  const excluded = {};
  const sample = [];
  const conflicts = [];
  const conflictCampaigns = {};
  let eligible = 0;
  for (const id of ids) {
    const { company, alreadyEnrolled } = data.get(id);
    const r = evaluateCompany(company, { ...ctx, alreadyEnrolled });
    if (r.ok) { eligible++; continue; }
    if (r.reason === "in_other_campaign") {
      const k = r.conflict.campaignId;
      conflictCampaigns[k] = conflictCampaigns[k] || { campaignId: k, campaignName: r.conflict.campaignName, count: 0 };
      conflictCampaigns[k].count++;
      if (conflicts.length < SAMPLE_LIMIT) conflicts.push({ companyId: id, companyName: company?.name || "", ...r.conflict });
      continue;
    }
    excluded[r.reason] = (excluded[r.reason] || 0) + 1;
    if (sample.length < SAMPLE_LIMIT) sample.push({ companyId: id, companyName: company?.name || "", reason: r.reason });
  }
  const conflictCount = Object.values(conflictCampaigns).reduce((a, x) => a + x.count, 0);
  const newPerDay = campaign.pacing?.newPerDay || DEFAULT_CAMPAIGN.pacing.newPerDay;
  return {
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

async function enrolOne(companyId, campaign, ctx, source, onConflict, caller) {
  const companyRef = db().doc(`searchCompanies/${companyId}`);
  const enrolRef = db().doc(`outreachEnrolments/${enrolmentId(campaign.id, companyId)}`);
  return db().runTransaction(async (tx) => {
    const [cSnap, eSnap] = await tx.getAll(companyRef, enrolRef);
    const company = cSnap.exists ? cSnap.data() : null;
    let r = evaluateCompany(company, { ...ctx, alreadyEnrolled: eSnap.exists });
    let moveFrom = null;
    if (!r.ok && r.reason === "in_other_campaign") {
      // The company's pointer may be stale (enrolment already ended): check it.
      const otherRef = r.conflict.enrolmentId ? db().doc(`outreachEnrolments/${r.conflict.enrolmentId}`) : null;
      const other = otherRef ? await tx.get(otherRef) : null;
      const otherLive = other?.exists && LIVE_ENROLMENT.includes(other.data().status);
      if (!otherLive) r = { ok: true };
      else if (onConflict === "move") { moveFrom = otherRef; r = { ok: true }; }
    }
    if (!r.ok) return { result: "skipped", reason: r.reason };
    if (moveFrom) {
      tx.update(moveFrom, { status: "moved", stopReason: `Moved to "${campaign.name}"`, endedAt: FieldValue.serverTimestamp(), nextActionAt: null, movedTo: campaign.id });
    }
    tx.set(enrolRef, {
      campaignId: campaign.id,
      campaignName: campaign.name,
      companyId,
      companyName: company.name || "",
      owner: company.owner || null,
      contactEmail: normEmail(company.companyEmail) || null,
      source: source.type,
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
    });
    tx.update(companyRef, { activeCampaignId: campaign.id, activeCampaignName: campaign.name, activeEnrolmentId: enrolRef.id });
    return { result: moveFrom ? "moved" : "enrolled" };
  });
}

async function enrol({ campaignId, companyIds, source, onConflict }, caller) {
  const campaign = await getCampaign(campaignId);
  assertEnrollable(campaign);
  const ids = cleanCompanyIds(companyIds);
  const src = cleanSource(source);
  const mode = onConflict === "move" ? "move" : "skip";
  const ctx = await evalContext(campaign);
  let enrolled = 0, moved = 0;
  const skipped = {};
  for (const group of chunks(ids, TX_PARALLEL)) {
    const res = await Promise.all(group.map((id) => enrolOne(id, campaign, ctx, src, mode, caller)));
    for (const r of res) {
      if (r.result === "enrolled") enrolled++;
      else if (r.result === "moved") { enrolled++; moved++; }
      else skipped[r.reason] = (skipped[r.reason] || 0) + 1;
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

async function enrolmentOp({ enrolmentId: id, op, reason }, caller) {
  if (!id || typeof id !== "string") fail("invalid-argument", "enrolment_required", "Choose a company in the campaign.");
  const ref = db().doc(`outreachEnrolments/${id}`);
  if (op === "remove") {
    const ok = await endEnrolment(ref, "removed", String(reason || "").slice(0, 200) || `Removed by ${caller}`);
    if (!ok) fail("failed-precondition", "not_live", "This company is no longer active in the campaign.");
    return { ok: true, status: "removed" };
  }
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

const TRANSITIONS = {
  active: ["draft", "paused"],
  paused: ["active"],
  finished: ["active", "paused"],
  archived: ["finished"],
};

async function setStatus({ campaignId, status }, caller) {
  if (!TRANSITIONS[status]) fail("invalid-argument", "bad_status", `Unknown status "${status}".`);
  const campaign = await getCampaign(campaignId);
  if (campaign.status === status) return { status };
  if (!TRANSITIONS[status].includes(campaign.status)) {
    fail("failed-precondition", "bad_transition", `A ${campaign.status} campaign can't be set to ${status}.`);
  }
  const ref = db().doc(`outreachCampaigns/${campaignId}`);
  const upd = { status, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller };
  if (status === "active") {
    const ids = [...new Set((campaign.steps || []).map((s) => s.templateId).filter(Boolean))];
    const snaps = ids.length ? await db().getAll(...ids.map((id) => db().doc(`outreachTemplates/${id}`))) : [];
    const templatesById = Object.fromEntries(snaps.filter((s) => s.exists).map((s) => [s.id, s.data()]));
    const problems = activationProblems(campaign, templatesById);
    if (problems.length) throw new HttpsError("failed-precondition", `Before starting: ${problems.join(" ")}`, { reason: "not_ready", problems });
    if (!campaign.startedAt) upd.startedAt = FieldValue.serverTimestamp();
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
  return { approved, skipped };
}

async function skipDraft({ messageId }, caller) {
  if (!messageId) fail("invalid-argument", "draft_required", "Choose a draft.");
  const msgRef = db().doc(`outreachMessages/${messageId}`);
  return db().runTransaction(async (tx) => {
    const m = await tx.get(msgRef);
    if (!m.exists || m.data().status !== "draft") fail("failed-precondition", "not_a_draft", "This draft is no longer waiting.");
    const enrolRef = db().doc(`outreachEnrolments/${m.data().enrolmentId}`);
    const e = await tx.get(enrolRef);
    const next = addWait(new Date(), { days: 1, unit: "working" });
    tx.update(msgRef, { status: "cancelled", cancelledReason: `Skipped by ${caller} — drafted again the next working day` });
    if (e.exists && e.data().status === "awaiting_approval" && e.data().draftMessageId === messageId) {
      tx.update(enrolRef, { status: "active", nextActionAt: Timestamp.fromDate(next), draftMessageId: null });
    }
    return { ok: true, nextActionAt: next.toISOString() };
  });
}

exports.outreachCampaign = onCall({ region: REGION, timeoutSeconds: 300 }, async (request) => {
  const caller = normEmail(request.auth?.token?.email);
  if (!ADMIN_EMAILS.includes(caller)) fail("permission-denied", "not_admin", "Only Douro admins can manage campaigns.");
  const data = request.data || {};
  try {
    switch (data.action) {
      case "save": return await save(data, caller);
      case "duplicate": return await duplicate(data, caller);
      case "delete": return await remove(data, caller);
      case "preview": return await preview(data, caller);
      case "enrol": return await enrol(data, caller);
      case "enrolment": return await enrolmentOp(data, caller);
      case "setStatus": return await setStatus(data, caller);
      case "approve": return await approve(data, caller);
      case "skipDraft": return await skipDraft(data, caller);
      default: fail("invalid-argument", "bad_action", `Unknown action "${data.action}".`);
    }
  } catch (e) {
    if (e instanceof CampaignError) throw new HttpsError("invalid-argument", e.message, { reason: e.reason });
    throw e;
  }
});

// Helpers for the webhook and scheduler (step 2); index.js exports only the callable.
exports.stopCompanyEnrolments = stopCompanyEnrolments;
exports.endEnrolment = endEnrolment;
