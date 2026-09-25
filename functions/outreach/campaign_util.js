// Outreach Phase 2 — campaign rules that don't touch Firestore: defaults,
// validation of what the Campaigns screen saves, and the enrolment
// exclusions. Spec: "Outreach Phase 2 - Campaigns Spec.md" (§4.3, §5, §7).

const { normEmail, domainOf, isFreeMail, isValidEmail } = require("./util");

const CAMPAIGN_STATUSES = ["draft", "active", "paused", "finished", "archived"];

// An enrolment in one of these states holds the company's single campaign
// slot (D5). "pending" = enrolled, waiting for its turn under the campaign's
// daily pace (the scheduler starts it).
const LIVE_ENROLMENT = ["pending", "active", "awaiting_approval", "awaiting_task", "paused"];

// Search CRM stages (search.html STAGES). By default a campaign only enrols
// companies we haven't engaged with yet; later stages, Pass and On hold are
// excluded (spec §4.3 "stage beyond X", stored as the allowed list because
// Pass/On hold sit after Closed in the stage order).
const STAGE_KEYS = [
  "universe", "screened", "outreach", "engaged", "teaser_received", "under_nda", "cim_received",
  "nbo", "loi", "due_diligence", "financing", "closing", "closed", "pass", "on_hold",
];
const DEFAULT_ALLOWED_STAGES = ["universe", "screened", "outreach"];

const VARIANT_KEYS = ["A", "B", "C", "D", "E"];
const MAX_STEPS = 12;
const MAX_WAIT_DAYS = 90;

const DEFAULT_CAMPAIGN = {
  name: "",
  description: "",
  status: "draft",
  priority: 2,                 // C9: 1 = high … 3 = low; ties go to the oldest due
  assignee: "owner",           // C3: tasks go to the company owner unless set
  approvalDefault: "approval", // D4: recommended start — review before anything goes out
  senderPolicy: { mode: "owner_rotation", senderIds: [] },
  sendWindow: null,            // null = the global window (Settings → General)
  pacing: { newPerDay: 20 },   // spec §11: 80/day ÷ ~4 emails per company
  audience: { mode: "static", sources: [] },
  exclusions: {
    contactedWithinDays: 30,
    allowedStages: DEFAULT_ALLOWED_STAGES,
    requireEmail: true,
    ownerFilter: null,          // null | "andre" | "antonio"
  },
  steps: [],
  lockedStepIds: [],           // steps that have already run for someone (C8)
};

class CampaignError extends Error {
  constructor(reason, message) { super(message); this.reason = reason; }
}
const bad = (reason, message) => { throw new CampaignError(reason, message); };

const intIn = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt;
};
const cleanText = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function normalizeWindow(w) {
  if (w == null) return null;
  const days = [...new Set((w.days || []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!days.length) bad("bad_window", "Pick at least one sending day.");
  if (!hhmm.test(w.from || "") || !hhmm.test(w.to || "") || w.from >= w.to) bad("bad_window", "The sending window needs a start time before its end time.");
  return { days, from: w.from, to: w.to, tz: "Europe/Lisbon" };
}

// `reserved` = ids of the stored steps: a new step never takes an old step's
// id, so a replaced step can't pass for one that has already run.
function normalizeStep(s, i, usedIds, reserved = new Set()) {
  const channel = s.channel || "email";
  if (channel !== "email") bad("channel_not_ready", "Only email steps are available for now — calls, LinkedIn, letters and other manual steps arrive with Tasks (Phase 2b).");
  let id = /^[a-z0-9_-]{1,20}$/i.test(s.id || "") ? s.id : null;
  if (!id || usedIds.has(id)) { let n = i + 1; while (usedIds.has("s" + n) || reserved.has("s" + n)) n++; id = "s" + n; }
  usedIds.add(id);
  const variants = [];
  for (const v of s.variants || []) {
    if (!VARIANT_KEYS.includes(v.key) || variants.some((x) => x.key === v.key)) continue;
    variants.push({ key: v.key, weight: intIn(v.weight, 0, 100, 1) });
  }
  if (variants.length && variants.every((v) => v.weight === 0)) bad("bad_weights", `Step ${i + 1}: give at least one variant a weight above 0.`);
  return {
    id,
    order: i,
    channel,
    name: cleanText(s.name, 80) || `Email ${i + 1}`,
    wait: { days: intIn(s.wait?.days, 0, MAX_WAIT_DAYS, i === 0 ? 0 : 3), unit: s.wait?.unit === "calendar" ? "calendar" : "working" },
    approval: ["inherit", "auto", "approval"].includes(s.approval) ? s.approval : "inherit",
    templateId: s.templateId ? String(s.templateId) : null,
    variants,                  // empty = every variant of the template, equal weights
    newSubject: !!s.newSubject, // C2: follow-ups reply in the same conversation unless set
  };
}

// Returns the fields the Campaigns screen may set. `existing` is the stored
// campaign (for updates): locked steps (already run for someone) can't be
// removed or reordered, only have their content changed (C8).
function normalizeCampaign(input, existing = null) {
  const base = existing ? { ...DEFAULT_CAMPAIGN, ...existing } : DEFAULT_CAMPAIGN;
  const src = { ...base, ...(input || {}) };
  const name = cleanText(src.name, 100);
  if (!name) bad("name_required", "Give the campaign a name.");

  const ex = { ...DEFAULT_CAMPAIGN.exclusions, ...(src.exclusions || {}) };
  const allowedStages = [...new Set((ex.allowedStages || []).filter((k) => STAGE_KEYS.includes(k)))];
  if (!allowedStages.length) bad("bad_stages", "Allow at least one Search CRM stage.");

  const sp = src.senderPolicy || {};
  const senderPolicy = sp.mode === "fixed"
    ? { mode: "fixed", senderIds: [...new Set((sp.senderIds || []).map(normEmail).filter(Boolean))] }
    : { mode: "owner_rotation", senderIds: [] };
  if (senderPolicy.mode === "fixed" && !senderPolicy.senderIds.length) bad("senders_required", "Pick at least one sender address, or use the owner's addresses.");

  const rawSteps = Array.isArray(src.steps) ? src.steps : [];
  if (rawSteps.length > MAX_STEPS) bad("too_many_steps", `A sequence can have up to ${MAX_STEPS} steps.`);
  const used = new Set();
  const reserved = new Set((existing?.steps || []).map((s) => s.id));
  const steps = rawSteps.map((s, i) => normalizeStep(s, i, used, reserved));

  const locked = (existing?.lockedStepIds || []).filter((id) => (existing.steps || []).some((s) => s.id === id));
  if (locked.length) {
    const lockedOrder = (existing.steps || []).filter((s) => locked.includes(s.id)).map((s) => s.id);
    const newPrefix = steps.slice(0, lockedOrder.length).map((s) => s.id);
    if (lockedOrder.some((id, i) => newPrefix[i] !== id)) {
      bad("step_locked", "Steps that have already run can't be removed or moved — you can still change their content, or add steps after them.");
    }
  }

  const audienceMode = src.audience?.mode === "dynamic" ? "dynamic" : "static";
  if (audienceMode === "dynamic") bad("dynamic_not_ready", "Dynamic audiences arrive in Phase 2c — use a static audience for now.");

  return {
    name,
    description: cleanText(src.description, 500),
    priority: intIn(src.priority, 1, 3, 2),
    assignee: ["owner", "andre", "antonio"].includes(src.assignee) ? src.assignee : "owner",
    approvalDefault: src.approvalDefault === "auto" ? "auto" : "approval",
    senderPolicy,
    sendWindow: normalizeWindow(src.sendWindow),
    pacing: { newPerDay: intIn(src.pacing?.newPerDay, 1, 200, 20) },
    audience: { mode: audienceMode, sources: base.audience?.sources || [] },
    exclusions: {
      contactedWithinDays: intIn(ex.contactedWithinDays, 0, 3650, 30),
      allowedStages,
      requireEmail: ex.requireEmail !== false,
      ownerFilter: ["andre", "antonio"].includes(ex.ownerFilter) ? ex.ownerFilter : null,
    },
    steps,
  };
}

// What activation needs on top of a valid campaign: steps, and a usable
// template (with the chosen variants) behind every email step.
function activationProblems(campaign, templatesById) {
  const problems = [];
  if (!campaign.steps?.length) problems.push("Add at least one step to the sequence.");
  for (const s of campaign.steps || []) {
    if (s.channel !== "email") continue;
    const t = s.templateId && templatesById[s.templateId];
    if (!s.templateId) { problems.push(`${s.name}: choose a template.`); continue; }
    if (!t) { problems.push(`${s.name}: its template no longer exists.`); continue; }
    if (t.status !== "active") problems.push(`${s.name}: template "${t.name}" isn't active.`);
    const keys = (t.variants || []).map((v) => v.key);
    const missing = (s.variants || []).filter((v) => v.weight > 0 && !keys.includes(v.key)).map((v) => v.key);
    if (missing.length) problems.push(`${s.name}: template "${t.name}" has no variant ${missing.join(", ")}.`);
  }
  return problems;
}

const tsMillis = (t) => (t == null ? null : typeof t.toMillis === "function" ? t.toMillis() : t._seconds != null ? t._seconds * 1000 : Number(t) || null);

// Exclusion rules at enrolment (spec §4.3), in the order they're reported —
// a company excluded for a hard reason is never shown as a campaign conflict.
// Returns { ok: true } or { ok: false, reason, conflict? }.
//
// ctx: { campaignId, exclusions, firstChannel, blockPersonalDomains,
//        suppressed: Set of suppression ids ("addr@x.pt" and "@x.pt"),
//        alreadyEnrolled: bool (an enrolment in this campaign exists), now }
function evaluateCompany(company, ctx) {
  if (!company) return { ok: false, reason: "not_found" };
  if (ctx.alreadyEnrolled) return { ok: false, reason: "already_in_campaign" };
  if (company.doNotContact?.on) return { ok: false, reason: "do_not_contact" };
  if (["unsubscribed", "bounced"].includes(company.outreachStatus)) return { ok: false, reason: company.outreachStatus };

  const email = normEmail(company.companyEmail);
  const hasEmail = isValidEmail(email);
  if (hasEmail && (ctx.suppressed.has(email) || ctx.suppressed.has("@" + domainOf(email)))) return { ok: false, reason: "suppressed" };

  const ex = ctx.exclusions;
  if (!ex.allowedStages.includes(company.stage || "universe")) return { ok: false, reason: "stage" };
  if (ex.ownerFilter && company.owner !== ex.ownerFilter) return { ok: false, reason: "owner" };
  if (ex.contactedWithinDays > 0) {
    const last = tsMillis(company.lastTouchAt);
    if (last && ctx.now - last < ex.contactedWithinDays * 86400000) return { ok: false, reason: "recent_touch" };
  }
  if (ctx.firstChannel === "email") {
    if (ex.requireEmail && !hasEmail) return { ok: false, reason: "no_email" };
    if (hasEmail && ctx.blockPersonalDomains && isFreeMail(domainOf(email))) return { ok: false, reason: "personal_domain" };
  }
  if (company.activeCampaignId && company.activeCampaignId !== ctx.campaignId) {
    return { ok: false, reason: "in_other_campaign", conflict: { campaignId: company.activeCampaignId, campaignName: company.activeCampaignName || "", enrolmentId: company.activeEnrolmentId || null } };
  }
  return { ok: true };
}

const EXCLUSION_LABELS = {
  not_found: "not found",
  already_in_campaign: "already in this campaign",
  do_not_contact: "marked do not contact",
  unsubscribed: "unsubscribed",
  bounced: "email bounced",
  suppressed: "on the suppression list",
  stage: "stage not allowed",
  owner: "other owner",
  recent_touch: "touched recently",
  no_email: "no email address",
  personal_domain: "personal email domain",
  in_other_campaign: "in another campaign",
};

const enrolmentId = (campaignId, companyId) => `${campaignId}_${companyId}`;

module.exports = {
  CAMPAIGN_STATUSES, LIVE_ENROLMENT, STAGE_KEYS, DEFAULT_ALLOWED_STAGES, VARIANT_KEYS, MAX_STEPS,
  DEFAULT_CAMPAIGN, CampaignError, normalizeCampaign, activationProblems, evaluateCompany,
  EXCLUSION_LABELS, enrolmentId, tsMillis,
};
