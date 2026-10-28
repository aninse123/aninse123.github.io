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
const MAX_STEPS = 20; // per path (27 Oct, D6r: only a guard against mistakes; was 12)
const MAX_WAIT_DAYS = 90;
const ELSE_PATH = "main"; // campaign paths (27 Oct): "Everyone else" / the only path of a campaign without paths
const MAX_PATHS = 20;
// What a path condition can use (the Search CRM filters) and how.
const PATH_FIELDS = { fitScore: "num", computedRevenue: "num", computedEBITDA: "num", computedEBITDAMargin: "num", computedGrowthRecent: "num", ownGroupSize: "num", targetTier: "tier", contactable: "bool", sector: "text", subSector: "text", caeCode: "prefix", naceCode: "prefix", nuts2: "text", nuts3: "text", stage: "text", owner: "text", website: "exists", lastTouchAt: "days" };
const PATH_OPS = { num: ["gte", "lt", "range"], tier: ["in"], bool: ["bool"], text: ["in", "eq"], prefix: ["prefix"], exists: ["exists"], days: ["within_days", "exists"] }; // text "in" = any of several (27 Oct, André)
const PATH_FIELD_LABEL = { fitScore: "Fit score", computedRevenue: "Revenue", computedEBITDA: "EBITDA", computedEBITDAMargin: "EBITDA margin", computedGrowthRecent: "Growth", ownGroupSize: "Group size", targetTier: "Tier", contactable: "Contactable", sector: "Sector", subSector: "Sub-sector", caeCode: "CAE", naceCode: "NACE", nuts2: "Region (NUTS II)", nuts3: "Region (NUTS III)", stage: "Stage", owner: "Owner", website: "Website", lastTouchAt: "Last touch" };

const DEFAULT_CAMPAIGN = {
  name: "",
  description: "",
  status: "draft",
  priority: 2,                 // C9: 1 = high … 3 = low; ties go to the oldest due
  assignee: "owner",           // C3: tasks go to the company owner unless set
  approvalDefault: "approval", // D4: recommended start — review before anything goes out
  senderPolicy: { mode: "owner_rotation", senderIds: [] },
  sendWindow: null,            // null = the global window (Settings → General)
  skipHolidays: null,          // 13 Oct: null = Settings → General; true / false = this campaign's choice
  skipMunicipalHolidays: null, // 14 Oct: same, for each company's own municipal holiday
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
  audienceType: "companies",   // Phase 5: companies | people (investors, brokers, press…)
  footer: null,                // CCSL (9 Oct): true / false = add the email footer or not; null = Settings default
  sector: "",                  // 9 Oct: {{campaign.sector}} — the sector as written in the emails ("do trabalho temporário")
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
    pathId: /^[a-z0-9_-]{1,20}$/i.test(s.pathId || "") ? s.pathId : ELSE_PATH, // campaign paths (27 Oct)
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
// A team member's short key (team access): andre, antonio, maria…
const TEAM_KEY_RE = /^[a-z][a-z0-9-]{1,19}$/;

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
  if (rawSteps.length > MAX_STEPS * MAX_PATHS) bad("too_many_steps", `A campaign can have up to ${MAX_STEPS} steps per path.`);
  const used = new Set();
  const reserved = new Set((existing?.steps || []).map((s) => s.id));
  // F1 (27 Sep): people campaigns take every step type, like companies.
  if (existing && (existing.stats?.enrolled || 0) > 0 && (src.audienceType === "people" ? "people" : "companies") !== (existing.audienceType || "companies")) bad("audience_locked", "The audience type can't change once people or companies are in the campaign.");
  const steps = rawSteps.map((s, i) => normalizeStep(s, i, used, reserved));
  const paths = normalizePaths(src.paths, steps);
  const startOrder = normalizeStartOrder(src.startOrder, paths, steps);

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
        if (steps[j].pathId !== st.pathId) bad("bad_branch", `${st.name}: "go to" must point to a step of the same path.`);
      }
    }
  });

  const locked = (existing?.lockedStepIds || []).filter((id) => (existing.steps || []).some((s) => s.id === id));
  if (locked.length) {
    // Per path (27 Oct): the steps that ran stay first in their own path, in the same order.
    const oldPath = Object.fromEntries((existing.steps || []).map((s) => [s.id, s.pathId || ELSE_PATH]));
    const lockedOrder = (existing.steps || []).filter((s) => locked.includes(s.id)).map((s) => s.id);
    for (const pid of new Set(lockedOrder.map((id) => oldPath[id]))) {
      const want = lockedOrder.filter((id) => oldPath[id] === pid);
      const have = steps.filter((s) => s.pathId === pid).slice(0, want.length).map((s) => s.id);
      if (want.some((id, i) => have[i] !== id)) {
        bad("step_locked", "Steps that have already run can't be removed or moved — you can still change their content, or add steps after them.");
      }
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
    // Team access: "owner" (the company's owner) or any team member's key.
    assignee: src.assignee === "owner" || TEAM_KEY_RE.test(src.assignee || "") ? src.assignee : "owner",
    // T4: who signs letters / call scripts (name, phone, email): the company's
    // owner (André when there's none) or a chosen team member.
    signer: src.signer === "owner" || TEAM_KEY_RE.test(src.signer || "") ? src.signer : "owner",
    approvalDefault: src.approvalDefault === "auto" ? "auto" : "approval",
    recipientPolicy: ["primary_contact", "best_person"].includes(src.recipientPolicy) ? src.recipientPolicy : "company",
    senderPolicy,
    sendWindow: normalizeWindow(src.sendWindow),
    skipHolidays: typeof src.skipHolidays === "boolean" ? src.skipHolidays : null,
    skipMunicipalHolidays: typeof src.skipMunicipalHolidays === "boolean" ? src.skipMunicipalHolidays : null,
    // P4: maxPerDay = this campaign's own daily email limit (null = only the global limits).
    // R10 (27 Oct): split by path with own numbers — their total is the new companies a day.
    pacing: { newPerDay: startOrder?.mode === "split" && !startOrder.equal ? Object.values(startOrder.perPath).reduce((a, b) => a + b, 0) : intIn(src.pacing?.newPerDay, 1, 500, 20), maxPerDay: src.pacing?.maxPerDay == null || src.pacing?.maxPerDay === "" ? null : intIn(src.pacing.maxPerDay, 1, 1000, null) },
    audienceType: src.audienceType === "people" ? "people" : "companies",
    footer: typeof src.footer === "boolean" ? src.footer : null,
    // 28 Oct (switch outreach.sendAllNow): approved emails leave together, not one per address every 10 minutes.
    sendAllAtOnce: !!src.sendAllAtOnce,
    sector: cleanText(src.sector, 120),
    audience: { mode: audienceMode, sources: base.audience?.sources || [] },
    exclusions: {
      contactedWithinDays: intIn(ex.contactedWithinDays, 0, 3650, 30),
      allowedStages,
      requireEmail: ex.requireEmail !== false,
      ownerFilter: TEAM_KEY_RE.test(ex.ownerFilter || "") ? ex.ownerFilter : null,
      // People campaigns: skip anyone the portal emailed in the last N days (0 = off, the default).
      peopleContactedWithinDays: intIn(ex.peopleContactedWithinDays, 0, 3650, 0),
      // T6: companies marked "not contactable" are left out unless this is ticked.
      includeNotContactable: !!ex.includeNotContactable,
    },
    steps,
    paths,
    startOrder,
  };
}

// ── Who starts first (27 Oct, paths round 2 — R10) ─────────────────────────
// Only for a campaign with paths. "added" (null: as added, the default — the
// oldest waiting company first), "order" (the paths' order: the first path's
// companies first, then the next…) or "split" (a number a day per path; equal =
// the day's number shared equally). A path with no steps (leave out) gets no share.
const START_MODES = ["added", "order", "split"];
function normalizeStartOrder(input, paths, steps) {
  if (!paths || !input || !START_MODES.includes(input.mode) || input.mode === "added") return null;
  if (input.mode === "order") return { mode: "order" };
  const equal = input.equal !== false;
  const perPath = {};
  for (const p of paths) if (steps.some((s) => s.pathId === p.id)) perPath[p.id] = equal ? 0 : intIn(input.perPath?.[p.id], 0, 500, 0);
  if (!equal && !Object.values(perPath).some((n) => n > 0)) bad("bad_split", "Give at least one path a number of new companies a day.");
  return { mode: "split", equal, perPath };
}
// The day's starts per path for "split": equal shares (the remainder to the first
// paths) or the numbers typed. Paths with no steps get none.
function splitShares(campaign, perDay) {
  const live = pathsOf(campaign).filter((p) => pathSteps(campaign, p.id).length);
  const so = campaign.startOrder || {};
  if (!live.length) return {};
  if (so.mode === "split" && so.equal === false) return Object.fromEntries(live.map((p) => [p.id, Number(so.perPath?.[p.id]) || 0]));
  const base = Math.floor(perDay / live.length), extra = perDay - base * live.length;
  return Object.fromEntries(live.map((p, i) => [p.id, base + (i < extra ? 1 : 0)]));
}
// R11: the path a waiting company would take today — stored on its enrolment as
// plannedPathId / plannedPathName, confirmed when it really starts.
function plannedPath(campaign, company, tierRules = [], now = Date.now()) {
  const p = choosePath(campaign, tierRules.length ? { ...company, targetTier: tierOf(company, tierRules) } : company, now).path;
  return { plannedPathId: p.id, plannedPathName: p.name || "Everyone else" };
}
const pathsUseTier = (campaign) => pathsOf(campaign).some((p) => (p.filters || []).some((f) => f.field === "targetTier"));

// ── Campaign paths (27 Oct 2026, switch outreach.paths) ─────────────────────
// A path = a filter on the company (the Search CRM filters) + its own steps.
// Paths are checked top to bottom; the first that matches takes the company,
// when it starts, and it keeps that path. The last path, "Everyone else"
// (id "main"), takes the rest; with no steps it means "leave out". A campaign
// without paths is one path, "main", holding every step — as before. Each
// step carries its pathId; an enrolment's currentStep counts within its path.
function normalizePaths(input, steps) {
  const list = Array.isArray(input) ? input : [];
  const own = list.filter((p) => p && p.id !== ELSE_PATH);
  if (!own.length) {
    if (steps.some((s) => s.pathId !== ELSE_PATH)) bad("bad_path", "A step belongs to a path that doesn't exist.");
    if (steps.length > MAX_STEPS) bad("too_many_steps", `A sequence can have up to ${MAX_STEPS} steps.`);
    return null;
  }
  if (own.length + 1 > MAX_PATHS) bad("too_many_paths", `A campaign can have up to ${MAX_PATHS} paths.`);
  const ids = new Set([ELSE_PATH]);
  const out = own.map((p, i) => {
    let id = /^[a-z0-9_-]{1,20}$/i.test(p.id || "") && !ids.has(p.id) ? p.id : null;
    if (!id) { let n = i + 1; while (ids.has("p" + n)) n++; id = "p" + n; }
    ids.add(id);
    const name = cleanText(p.name, 60) || `Path ${i + 1}`;
    const filters = (Array.isArray(p.filters) ? p.filters : []).slice(0, 10).map((f) => normalizePathFilter(f, name));
    if (!filters.length) bad("bad_path", `${name}: give the path at least one condition.`);
    return { id, name, filters };
  });
  const el = list.find((p) => p && p.id === ELSE_PATH);
  out.push({ id: ELSE_PATH, name: cleanText(el?.name, 60) || "Everyone else", filters: null });
  for (const s of steps) if (!ids.has(s.pathId)) bad("bad_path", `${s.name}: its path doesn't exist.`);
  for (const p of out) if (steps.filter((s) => s.pathId === p.id).length > MAX_STEPS) bad("too_many_steps", `${p.name}: up to ${MAX_STEPS} steps per path.`);
  return out;
}
function normalizePathFilter(f, pathName) {
  const field = String(f?.field || ""), op = String(f?.op || "");
  const type = PATH_FIELDS[field];
  if (!type) bad("bad_path", `${pathName}: "${field}" can't be used in a condition.`);
  if (!PATH_OPS[type].includes(op)) bad("bad_path", `${pathName}: "${op}" doesn't work with ${PATH_FIELD_LABEL[field]}.`);
  let value = f.value;
  const num = (x) => { const n = x == null || x === "" ? NaN : Number(x); if (!isFinite(n)) bad("bad_path", `${pathName}: ${PATH_FIELD_LABEL[field]} needs a number.`); return n; };
  if (op === "range") { if (!Array.isArray(value) || value.length !== 2) bad("bad_path", `${pathName}: ${PATH_FIELD_LABEL[field]} needs "from" and "to".`); value = [num(value[0]), num(value[1])]; if (!(value[0] < value[1])) bad("bad_path", `${pathName}: ${PATH_FIELD_LABEL[field]}: "from" must be below "to".`); }
  else if (op === "gte" || op === "lt") value = num(value);
  else if (op === "in" && type === "tier") { value = [...new Set((Array.isArray(value) ? value : [value]).filter((x) => TIERS.includes(x)))]; if (!value.length) bad("bad_path", `${pathName}: pick at least one tier.`); }
  else if (op === "in") { value = [...new Set((Array.isArray(value) ? value : [value]).map((x) => cleanText(x, 80)).filter(Boolean))].slice(0, 100); if (!value.length) bad("bad_path", `${pathName}: pick at least one ${PATH_FIELD_LABEL[field].toLowerCase()}.`); }
  else if (op === "bool" || op === "exists") value = !!value;
  else if (op === "within_days") value = intIn(value, 1, 3650, 30);
  else { value = cleanText(value, 80); if (!value) bad("bad_path", `${pathName}: ${PATH_FIELD_LABEL[field]} needs a value.`); }
  return { field, op, value };
}
const pathsOf = (campaign) => (Array.isArray(campaign?.paths) && campaign.paths.length ? campaign.paths : [{ id: ELSE_PATH, name: "Everyone", filters: null }]);
const pathSteps = (campaign, pathId) => (campaign?.steps || []).filter((s) => (s.pathId || ELSE_PATH) === (pathId || ELSE_PATH));
// The campaign as one enrolment sees it: only the steps of its path.
const viewFor = (campaign, e) => ({ ...campaign, steps: pathSteps(campaign, e?.pathId) });
// Which path a company takes, and why ("Fit score 82 (at least 75)").
function choosePath(campaign, company, now = Date.now()) {
  for (const p of pathsOf(campaign)) {
    if (p.id === ELSE_PATH || !p.filters) return { path: p, why: pathsOf(campaign).length > 1 ? "no path above matched" : "" };
    if (matchesFilterSpec(company, p.filters, now)) return { path: p, why: p.filters.map((f) => `${PATH_FIELD_LABEL[f.field]} ${pathValueText(f.field, company)}`).join(", ") };
  }
  return { path: { id: ELSE_PATH, name: "Everyone else", filters: null }, why: "" };
}
function pathValueText(field, c) {
  const v = c?.[field];
  if (v == null || v === "") return "—";
  if (field === "computedRevenue" || field === "computedEBITDA") return `€${Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + "M" : Math.round(v / 1e3) + "k"}`;
  if (PERCENT_FIELDS.has(field)) return `${(v * 100).toFixed(1)}%`;
  if (field === "lastTouchAt") return tsMillis(v) ? new Date(tsMillis(v)).toISOString().slice(0, 10) : "—";
  return String(v);
}

// What activation needs on top of a valid campaign: steps, and a usable
// template (with the chosen variants) behind every email step.
function activationProblems(campaign, templatesById) {
  const problems = [];
  if (campaign.audienceType === "people" && campaign.senderPolicy?.mode !== "fixed" && (campaign.steps || []).some((s) => (s.channel || "email") === "email")) {
    problems.push('Choose who sends it (Settings → "From which addresses" → specific addresses — e.g. andre.rocha@douropartners.pt).');
  }
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
    // Phase 4 safety default: AI text only where a person approves it.
    const approval = (s.approval === "inherit" || !s.approval) ? campaign.approvalDefault : s.approval;
    if (s.channel === "email" && approval === "auto" && (t.variants || []).some((v) => /\{\{\s*ai\.opener/.test(v.body || "") || /\{\{\s*ai\.opener/.test(v.subject || ""))) {
      problems.push(`${s.name}: template "${t.name}" uses {{ai.opener}} — set this step to "Needs approval" so a person reads the AI text before it goes out.`);
    }
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
//        alreadyEnrolled: bool (an enrolment in this campaign exists), now,
//        companyId, inboxRecent?: Map(email → conversations, newest first) —
//        only when the "outreach.oneInbox" switch is on (inbox.js) }
function evaluateCompany(company, ctx) {
  if (!company) return { ok: false, reason: "not_found" };
  if (ctx.alreadyEnrolled) return { ok: false, reason: "already_in_campaign" };
  if (company.doNotContact?.on) return { ok: false, reason: "do_not_contact" };
  // T6: a soft filter (noise), unlike Do not contact — a campaign can include them.
  if (company.contactable === false && !ctx.exclusions?.includeNotContactable) return { ok: false, reason: "not_contactable" };
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
    // People merge (Stage 4): with the switch on, a main contact with an email also makes the company reachable.
    const contactEmail = (company.contacts || []).some((ct) => isValidEmail(normEmail(ct.email))) || (!!ctx.usePeople && isValidEmail(normEmail(company.primaryContact?.email)));
    const reachable = hasEmail || (policy !== "company" && (contactEmail || policy === "best_person"));
    if (ex.requireEmail && !reachable) return { ok: false, reason: "no_email" };
    if (policy === "company" && hasEmail && ctx.blockPersonalDomains && isFreeMail(domainOf(email))) return { ok: false, reason: "personal_domain" };
    // One inbox (19 Oct): the same address had an email exchange through
    // another company inside the "contacted in the last N days" window.
    if (hasEmail && ctx.inboxRecent && ex.contactedWithinDays > 0) {
      const hit = (ctx.inboxRecent.get(email) || []).find((h) => h.companyId && h.companyId !== ctx.companyId);
      if (hit) return { ok: false, reason: "same_inbox", inbox: { email, companyId: hit.companyId, companyName: hit.companyName || "", at: hit.at || null, campaignId: hit.campaignId || null } };
    }
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
  not_contactable: "marked not contactable",
  no_email: "no email address",
  personal_domain: "personal email domain",
  same_inbox: "same email address as another company, emailed recently",
  in_other_campaign: "in another campaign",
};

const enrolmentId = (campaignId, companyId) => `${campaignId}_${companyId}`;
// Phase 5: one enrolment per person (email) in a people campaign.
const crypto = require("crypto");
const personKey = (email) => "p_" + crypto.createHash("sha1").update(normEmail(email)).digest("hex").slice(0, 20);
const personEnrolmentId = (campaignId, email) => `${campaignId}_${personKey(email)}`;

// Exclusions for a person (spec §1): invalid, already in, suppressed, opted out of this campaign/list.
function evaluatePerson(p, ctx) {
  const email = normEmail(p?.email);
  if (!isValidEmail(email)) return { ok: false, reason: "no_email" };
  if (ctx.alreadyEnrolled) return { ok: false, reason: "already_in_campaign" };
  if (ctx.suppressed.has(email) || ctx.suppressed.has("@" + domainOf(email))) return { ok: false, reason: "suppressed" };
  if (ctx.optedOut?.has(email)) return { ok: false, reason: "unsubscribed" };
  if (ctx.recent?.has(email)) return { ok: false, reason: "contacted_recently" };
  return { ok: true, email };
}

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
// T6 / F1: Tier (A / B / C) — the tier set on the company wins (the
// "priority" field, a/b/c; older companies may carry targetTierManual);
// otherwise the most specific rule (searchConfig/targetTiers): a CAE / NACE
// prefix (longer = more specific) beats a sub-sector, which beats a sector.
// Mirrored in search.html tierOf().
const TIERS = ["A", "B", "C"];
const TIER_FIELDS = ["caeCode", "naceCode", "subSector", "sector"];
function tierOf(c, rules = []) {
  const own = String(c?.priority || c?.targetTierManual || "").toUpperCase();
  if (TIERS.includes(own)) return own;
  let best = null, bestScore = -1;
  for (const r of rules || []) {
    if (!TIERS.includes(r?.tier) || !TIER_FIELDS.includes(r?.field) || !String(r.value || "").trim()) continue;
    const want = String(r.value).trim(), have = String(c?.[r.field] ?? "").trim();
    const code = r.field === "caeCode" || r.field === "naceCode";
    const hit = code ? have.replace(/[.\s]/g, "").startsWith(want.replace(/[.\s]/g, "")) : have.toLowerCase() === want.toLowerCase();
    if (!hit) continue;
    const score = code ? 10 + want.length : r.field === "subSector" ? 5 : 3;
    if (score > bestScore) { best = r.tier; bestScore = score; }
  }
  return best;
}

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
      // Campaign paths (27 Oct): "below" and "from … to under" (the upper end belongs to the next band).
      case "lt": if (v == null || Number(v) >= Number(f.value)) return false; break;
      case "range": if (v == null || !Array.isArray(f.value) || Number(v) < Number(f.value[0]) || Number(v) >= Number(f.value[1])) return false; break;
      case "exists": if (f.value ? !v : !!v) return false; break;
      // T6: yes/no fields where "not set" means yes (contactable).
      case "bool": if ((v !== false) !== !!f.value) return false; break;
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
  EXCLUSION_LABELS, enrolmentId, tsMillis, latestFilterSpec, matchesFilterSpec, tierOf, TIERS, personKey, personEnrolmentId, evaluatePerson,
  ELSE_PATH, MAX_PATHS, PATH_FIELDS, PATH_OPS, PATH_FIELD_LABEL, pathsOf, pathSteps, viewFor, choosePath, pathValueText, normalizePaths,
  START_MODES, normalizeStartOrder, splitShares, plannedPath, pathsUseTier,
};
