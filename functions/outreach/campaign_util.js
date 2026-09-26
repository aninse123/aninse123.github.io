// Outreach Phase 2 — campaign rules that don't touch Firestore: defaults,
// validation of what the Campaigns screen saves, and the enrolment
// exclusions. Spec: "Outreach Phase 2 - Campaigns Spec.md" (§4.3, §5, §7).

const { normEmail, domainOf, isFreeMail, isValidEmail } = require("./util");
const { OUTCOMES } = require("./task_util");

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

// Step channels (spec §5.1). Email is sent by the scheduler; the others
// become tasks for a person (Phase 2b). LinkedIn stays manual (D2).
const CHANNELS = ["email", "linkedin", "call", "whatsapp", "letter", "visit", "other"];
const MANUAL_CHANNELS = CHANNELS.filter((c) => c !== "email");
// Which template kind each channel uses (templates without a kind are email).
const TEMPLATE_KIND = { email: "email", letter: "letter", linkedin: "message", whatsapp: "message", call: "script" };
const templateKind = (t) => t?.kind || "email";
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
  recipientPolicy: "company",  // Phase 3b: company | primary_contact | best_person
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
  if (!CHANNELS.includes(channel)) bad("bad_channel", `Unknown step type "${channel}".`);
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
    name: cleanText(s.name, 80) || (channel === "email" ? `Email ${i + 1}` : `${channel.charAt(0).toUpperCase() + channel.slice(1)} ${i + 1}`),
    wait: { days: intIn(s.wait?.days, 0, MAX_WAIT_DAYS, i === 0 ? 0 : 3), unit: s.wait?.unit === "calendar" ? "calendar" : "working" },
    approval: ["inherit", "auto", "approval"].includes(s.approval) ? s.approval : "inherit",
    templateId: s.templateId ? String(s.templateId) : null,
    variants,                  // empty = every variant of the template, equal weights
    newSubject: channel === "email" && !!s.newSubject, // C2: follow-ups reply in the same conversation unless set
    // Manual steps: what the person should do (shown on the task).
    instructions: channel === "email" ? "" : String(s.instructions ?? "").trim().slice(0, 2000),
    // Phase 2c: what a task outcome does to the sequence. Validated against
    // the final step list in normalizeCampaign (goto must point forward).
    // Email steps: only "clicked a link" (Phase 3d; opens are unreliable, D7).
    branches: (Array.isArray(s.branches) ? s.branches : []).slice(0, 12).map((b) => ({
      outcome: String(b?.outcome || ""),
      action: ["goto", "end"].includes(b?.action) ? b.action : "next",
      stepId: b?.action === "goto" ? String(b?.stepId || "") : null,
    })).filter((b) => b.outcome && b.action !== "next"),
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

  steps.forEach((st, i) => {
    const valid = new Set(st.channel === "email" ? ["clicked"] : (OUTCOMES[st.channel] || []).map((o) => o.key));
    const seen = new Set();
    for (const b of st.branches) {
      if (!valid.has(b.outcome)) bad("bad_branch", `${st.name}: "${b.outcome}" isn't an outcome of a ${st.channel} step.`);
      if (seen.has(b.outcome)) bad("bad_branch", `${st.name}: two rules for the same outcome.`);
      seen.add(b.outcome);
      if (b.action === "goto") {
        const j = steps.findIndex((x) => x.id === b.stepId);
        if (j <= i) bad("bad_branch", `${st.name}: "go to" must point to a later step.`);
      }
    }
  });

  const locked = (existing?.lockedStepIds || []).filter((id) => (existing.steps || []).some((s) => s.id === id));
  if (locked.length) {
    const lockedOrder = (existing.steps || []).filter((s) => locked.includes(s.id)).map((s) => s.id);
    const newPrefix = steps.slice(0, lockedOrder.length).map((s) => s.id);
    if (lockedOrder.some((id, i) => newPrefix[i] !== id)) {
      bad("step_locked", "Steps that have already run can't be removed or moved — you can still change their content, or add steps after them.");
    }
    const oldChannel = Object.fromEntries((existing.steps || []).map((s) => [s.id, s.channel || "email"]));
    if (steps.some((s) => locked.includes(s.id) && s.channel !== oldChannel[s.id])) {
      bad("step_locked", "A step that has already run can't change type — add a new step instead.");
    }
  }

  const audienceMode = src.audience?.mode === "dynamic" ? "dynamic" : "static";

  return {
    name,
    description: cleanText(src.description, 500),
    priority: intIn(src.priority, 1, 3, 2),
    assignee: ["owner", "andre", "antonio"].includes(src.assignee) ? src.assignee : "owner",
    approvalDefault: src.approvalDefault === "auto" ? "auto" : "approval",
    recipientPolicy: ["primary_contact", "best_person"].includes(src.recipientPolicy) ? src.recipientPolicy : "company",
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
  if (campaign.audience?.mode === "dynamic" && !latestFilterSpec(campaign)) {
    problems.push("A dynamic audience needs companies added from the Search CRM filters first — that's the filter it keeps applying.");
  }
  if (!campaign.steps?.length) problems.push("Add at least one step to the sequence.");
  for (const s of campaign.steps || []) {
    const kind = TEMPLATE_KIND[s.channel];
    const needsTemplate = s.channel === "email" || s.channel === "letter";
    if (!needsTemplate && !s.templateId) {
      if (s.channel === "other" && !s.instructions) problems.push(`${s.name}: write what should be done.`);
      continue;
    }
    const t = s.templateId && templatesById[s.templateId];
    if (!s.templateId) { problems.push(`${s.name}: choose a template.`); continue; }
    if (t && kind && templateKind(t) !== kind) { problems.push(`${s.name}: template "${t.name}" is a ${templateKind(t)} template, not a ${kind} template.`); continue; }
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
    // Phase 3c: the last outreach touch (email, call, LinkedIn, WhatsApp,
    // letter, visit). Companies from before lastOutreachAt existed fall back
    // to lastTouchAt only if they ever had an outreach touch.
    const last = company.lastOutreachAt != null ? tsMillis(company.lastOutreachAt)
      : (Number(company.outreachAttempts) > 0 ? tsMillis(company.lastTouchAt) : null);
    if (last && ctx.now - last < ex.contactedWithinDays * 86400000) return { ok: false, reason: "recent_touch" };
  }
  if (ctx.firstChannel === "email") {
    // Phase 3b: with "Send to" a person, a company without a generic address
    // can still be written to through a contact; People are only checked at
    // send time (they need extra reads), so best_person lets it through.
    const policy = ctx.recipientPolicy || "company";
    const contactEmail = (company.contacts || []).some((ct) => isValidEmail(normEmail(ct.email)));
    const reachable = hasEmail || (policy !== "company" && (contactEmail || policy === "best_person"));
    if (ex.requireEmail && !reachable) return { ok: false, reason: "no_email" };
    if (policy === "company" && hasEmail && ctx.blockPersonalDomains && isFreeMail(domainOf(email))) return { ok: false, reason: "personal_domain" };
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

// The filter a dynamic audience keeps applying: the latest "filters" source.
function latestFilterSpec(campaign) {
  const src = [...(campaign.audience?.sources || [])].reverse().find((x) => x.type === "filters" && Array.isArray(x.filterSpec) && x.filterSpec.length);
  return src ? src.filterSpec : null;
}

const deburr = (v) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
// Margin and growth are stored as fractions but filtered in % (search.html).
const PERCENT_FIELDS = new Set(["computedEBITDAMargin", "computedGrowthRecent"]);

// Does a company match a saved Search CRM filter spec? Same rules as the
// list filters in search.html getFiltered(), so a dynamic audience adds the
// companies you would see with that filter.
function matchesFilterSpec(c, spec, now = Date.now()) {
  for (const f of spec || []) {
    let v = f.field === "legalForm" ? (c.nationalLegalForm || c.legalForm) : c[f.field];
    if (PERCENT_FIELDS.has(f.field) && v != null) v = v * 100;
    switch (f.op) {
      case "contains": {
        if (f.field !== "search") { if (!deburr(v).includes(deburr(f.value))) return false; break; }
        const q = deburr(f.value), digits = q.replace(/[^a-z0-9]/g, "");
        const hit = deburr(c.name).includes(q)
          || (digits && String(c.nif || "").replace(/[^a-z0-9]/gi, "").toLowerCase().includes(digits))
          || (digits && String(c.foreignTaxId || "").replace(/[^a-z0-9]/gi, "").toLowerCase().includes(digits));
        if (!hit) return false;
        break;
      }
      case "eq": if (f.field === "stage" ? (c.stage || "universe") !== f.value : v !== f.value) return false; break;
      case "in": if (!Array.isArray(f.value) || !f.value.includes(v)) return false; break;
      case "prefix": if (!String(v ?? "").startsWith(String(f.value))) return false; break;
      case "gte": if (v == null || Number(v) < Number(f.value)) return false; break;
      case "lte": if (v == null || Number(v) > Number(f.value)) return false; break;
      case "between": if (v == null || !Array.isArray(f.value) || Number(v) < Number(f.value[0]) || Number(v) > Number(f.value[1])) return false; break;
      case "exists": if (f.value ? !v : !!v) return false; break;
      case "within_days": {
        const ms = tsMillis(v);
        if (!ms || now - ms > Number(f.value) * 86400000) return false;
        break;
      }
      default: return false; // unknown op: don't guess
    }
  }
  return true;
}

module.exports = {
  CHANNELS, MANUAL_CHANNELS, TEMPLATE_KIND, templateKind,
  CAMPAIGN_STATUSES, LIVE_ENROLMENT, STAGE_KEYS, DEFAULT_ALLOWED_STAGES, VARIANT_KEYS, MAX_STEPS,
  DEFAULT_CAMPAIGN, CampaignError, normalizeCampaign, activationProblems, evaluateCompany,
  EXCLUSION_LABELS, enrolmentId, tsMillis, latestFilterSpec, matchesFilterSpec,
};
