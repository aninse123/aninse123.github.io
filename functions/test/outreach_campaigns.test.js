// Phase 2a step 1 — campaign rules (campaign_util.js) and the outreachCampaign
// callable against the in-memory Firestore fake. Nothing leaves the machine.
const F = require("./fake_firebase.js");
const U = require("../outreach/campaign_util.js");
const fns = require("../index.js");
const { endEnrolment, stopCompanyEnrolments } = require("../outreach/campaigns.js");
const { store, Timestamp } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const throwsReason = (fn, reason) => { try { fn(); return false; } catch (e) { return e.reason === reason; } };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const call = async (data, auth = ADMIN) => { try { return { res: await fns.outreachCampaign({ ...auth, data }) }; } catch (e) { return { err: e }; } };
const get = (path) => store.get(path);
const docs = (coll) => [...store.entries()].filter(([p]) => p.startsWith(coll + "/")).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));
const DAY = 86400000;

(async () => {
  // ── campaign_util: normalizeCampaign ──
  const n = U.normalizeCampaign({ name: "  Metalurgia   Norte ", steps: [{ templateId: "t1" }, { templateId: "t2" }] });
  ok("defaults: approval, owner rotation, 20/day, static", n.approvalDefault === "approval" && n.senderPolicy.mode === "owner_rotation" && n.pacing.newPerDay === 20 && n.audience.mode === "static");
  ok("name is trimmed and collapsed", n.name === "Metalurgia Norte");
  ok("default exclusions: 30 days, early stages, email required", n.exclusions.contactedWithinDays === 30 && n.exclusions.allowedStages.join() === "universe,screened,outreach" && n.exclusions.requireEmail === true);
  ok("step ids s1,s2; first wait 0, later 3 working days", n.steps.map((s) => s.id).join() === "s1,s2" && n.steps[0].wait.days === 0 && n.steps[1].wait.days === 3 && n.steps[1].wait.unit === "working");
  ok("steps inherit approval and reply in the same conversation", n.steps.every((s) => s.approval === "inherit" && s.newSubject === false));
  ok("duplicate step ids are renumbered", U.normalizeCampaign({ name: "x", steps: [{ id: "a" }, { id: "a" }] }).steps.map((s) => s.id).join() === "a,s2");
  ok("name required", throwsReason(() => U.normalizeCampaign({ name: " " }), "name_required"));
  ok("unknown step type refused", throwsReason(() => U.normalizeCampaign({ name: "x", steps: [{ channel: "fax" }] }), "bad_channel"));
  const manual = U.normalizeCampaign({ name: "x", steps: [{}, { channel: "call", instructions: "  Ligar ao gerente  ", newSubject: true }, { channel: "linkedin" }] });
  ok("manual steps kept with instructions; newSubject only for email; default names", manual.steps[1].channel === "call" && manual.steps[1].instructions === "Ligar ao gerente" && manual.steps[1].newSubject === false && manual.steps[2].name === "Linkedin 3" && manual.steps[0].instructions === "");
  ok("a step that ran can't change type", throwsReason(() => U.normalizeCampaign({ steps: [{ id: "s1", channel: "call" }, { id: "s2" }, { id: "s3" }] }, { name: "x", steps: [{ id: "s1", channel: "email" }, { id: "s2", channel: "email" }, { id: "s3", channel: "email" }], lockedStepIds: ["s1"] }), "step_locked"));
  ok("dynamic audience accepted (2c)", U.normalizeCampaign({ name: "x", audience: { mode: "dynamic" } }).audience.mode === "dynamic");
  ok("all-zero variant weights refused", throwsReason(() => U.normalizeCampaign({ name: "x", steps: [{ variants: [{ key: "A", weight: 0 }] }] }), "bad_weights"));
  ok("unknown / repeated variant keys dropped", U.normalizeCampaign({ name: "x", steps: [{ variants: [{ key: "A", weight: 60 }, { key: "A" }, { key: "Z" }, { key: "B", weight: 40 }] }] }).steps[0].variants.map((v) => v.key + v.weight).join() === "A60,B40");
  ok("fixed senders need at least one address", throwsReason(() => U.normalizeCampaign({ name: "x", senderPolicy: { mode: "fixed", senderIds: [] } }), "senders_required"));
  ok("fixed senders normalised", U.normalizeCampaign({ name: "x", senderPolicy: { mode: "fixed", senderIds: [" An.Rocha@mail.douropartners-team.pt "] } }).senderPolicy.senderIds[0] === "an.rocha@mail.douropartners-team.pt");
  ok("window: end before start refused", throwsReason(() => U.normalizeCampaign({ name: "x", sendWindow: { days: [1], from: "18:00", to: "09:00" } }), "bad_window"));
  ok("window override kept", U.normalizeCampaign({ name: "x", sendWindow: { days: [2, 1, 1], from: "10:00", to: "12:30" } }).sendWindow.days.join() === "1,2");
  ok("no allowed stage refused", throwsReason(() => U.normalizeCampaign({ name: "x", exclusions: { allowedStages: ["nope"] } }), "bad_stages"));
  ok("wait capped / invalid → default", U.normalizeCampaign({ name: "x", steps: [{}, { wait: { days: 500 } }] }).steps[1].wait.days === 3);

  // Locked steps (C8)
  const existing = { name: "x", steps: [{ id: "s1", channel: "email" }, { id: "s2", channel: "email" }, { id: "s3", channel: "email" }], lockedStepIds: ["s1", "s2"] };
  ok("locked step can't be removed", throwsReason(() => U.normalizeCampaign({ steps: [{ id: "s1" }, { id: "s3" }] }, existing), "step_locked"));
  ok("locked steps can't be reordered", throwsReason(() => U.normalizeCampaign({ steps: [{ id: "s2" }, { id: "s1" }, { id: "s3" }] }, existing), "step_locked"));
  ok("a replacement step without an id never takes a locked step's id", throwsReason(() => U.normalizeCampaign({ steps: [{ templateId: "other" }] }, existing), "step_locked"));
  ok("new steps skip the stored ids", U.normalizeCampaign({ steps: [{ id: "s1" }, { id: "s2" }, {}] }, existing).steps[2].id === "s4");
  ok("unlocked step can be removed, new ones appended, locked content edited", U.normalizeCampaign({ steps: [{ id: "s1", templateId: "new" }, { id: "s2" }, { id: "s9" }] }, existing).steps[0].templateId === "new");

  // activationProblems
  const tpl = { t1: { name: "Intro", status: "active", variants: [{ key: "A" }, { key: "B" }] }, t2: { name: "Old", status: "draft", variants: [{ key: "A" }] } };
  ok("activation: needs steps", U.activationProblems({ steps: [] }, tpl).length === 1);
  const probs = U.activationProblems({ steps: [
    { name: "E1", channel: "email", templateId: "t1", variants: [{ key: "C", weight: 50 }] },
    { name: "E2", channel: "email", templateId: "t2", variants: [] },
    { name: "E3", channel: "email", templateId: null, variants: [] },
    { name: "E4", channel: "email", templateId: "gone", variants: [] },
  ] }, tpl);
  ok("activation: missing variant, inactive, no template, deleted template", probs.length === 4 && /variant C/.test(probs[0]) && /isn't active/.test(probs[1]) && /choose a template/.test(probs[2]) && /no longer exists/.test(probs[3]));
  const tplK = { ...tpl, L: { name: "Carta", status: "active", kind: "letter", variants: [{ key: "A" }] }, M: { name: "Msg", status: "active", kind: "message", variants: [{ key: "A" }] } };
  const kp = U.activationProblems({ steps: [
    { name: "Carta", channel: "letter", templateId: null, variants: [] },
    { name: "Carta2", channel: "letter", templateId: "t1", variants: [] },
    { name: "LI", channel: "linkedin", templateId: null, variants: [] },
    { name: "WA", channel: "whatsapp", templateId: "M", variants: [] },
    { name: "Outro", channel: "other", templateId: null, instructions: "", variants: [] },
    { name: "Carta3", channel: "letter", templateId: "L", variants: [] },
  ] }, tplK);
  ok("activation: letter needs a letter template; LinkedIn without template fine; 'other' needs instructions", kp.length === 3 && /choose a template/.test(kp[0]) && /email template, not a letter/.test(kp[1]) && /write what should be done/.test(kp[2]));
  ok("activation: good campaign has no problems", U.activationProblems({ steps: [{ name: "E1", channel: "email", templateId: "t1", variants: [{ key: "A", weight: 1 }] }] }, tpl).length === 0);

  // evaluateCompany
  const ctx = { campaignId: "C1", exclusions: U.DEFAULT_CAMPAIGN.exclusions, firstChannel: "email", blockPersonalDomains: true, suppressed: new Set(["x@sup.pt", "@supdom.pt"]), now: Date.now() };
  const co = (o) => ({ name: "Co", stage: "universe", companyEmail: "geral@empresa.pt", ...o });
  const why = (o, extra = {}) => U.evaluateCompany(o === null ? null : co(o), { ...ctx, ...extra });
  ok("eligible company passes", why({}).ok);
  ok("missing company", why(null).reason === "not_found");
  ok("already in this campaign", why({}, { alreadyEnrolled: true }).reason === "already_in_campaign");
  ok("do not contact", why({ doNotContact: { on: true } }).reason === "do_not_contact");
  ok("unsubscribed / bounced status", why({ outreachStatus: "unsubscribed" }).reason === "unsubscribed" && why({ outreachStatus: "bounced" }).reason === "bounced");
  ok("suppressed address and domain", why({ companyEmail: "X@sup.pt" }).reason === "suppressed" && why({ companyEmail: "a@supdom.pt" }).reason === "suppressed");
  ok("stage not allowed (engaged, pass)", why({ stage: "engaged" }).reason === "stage" && why({ stage: "pass" }).reason === "stage");
  ok("missing stage counts as universe", why({ stage: undefined }).ok);
  ok("owner filter", why({ owner: "antonio" }, { exclusions: { ...ctx.exclusions, ownerFilter: "andre" } }).reason === "owner");
  ok("touched 10 days ago excluded, 40 days ago fine", why({ lastTouchAt: Timestamp.fromDate(new Date(Date.now() - 10 * DAY)) }).reason === "recent_touch" && why({ lastTouchAt: Timestamp.fromDate(new Date(Date.now() - 40 * DAY)) }).ok);
  ok("recent-touch rule off at 0 days", why({ lastTouchAt: Timestamp.now() }, { exclusions: { ...ctx.exclusions, contactedWithinDays: 0 } }).ok);
  ok("no email", why({ companyEmail: "" }).reason === "no_email" && why({ companyEmail: "not-an-email" }).reason === "no_email");
  ok("personal domain blocked / allowed when setting off", why({ companyEmail: "joao@gmail.com" }).reason === "personal_domain" && why({ companyEmail: "joao@gmail.com" }, { blockPersonalDomains: false }).ok);
  ok("conflict reported with the other campaign", (() => { const r = why({ activeCampaignId: "C0", activeCampaignName: "Old", activeEnrolmentId: "C0_x" }); return r.reason === "in_other_campaign" && r.conflict.campaignName === "Old" && r.conflict.enrolmentId === "C0_x"; })());
  ok("hard exclusion wins over conflict", why({ companyEmail: "", activeCampaignId: "C0" }).reason === "no_email");
  ok("own campaign id on the company isn't a conflict", why({ activeCampaignId: "C1" }).ok);

  // ── outreachCampaign callable ──
  const seedCo = (id, o = {}) => store.set(`searchCompanies/${id}`, { name: "Empresa " + id, stage: "universe", companyEmail: `geral@${id}.pt`, owner: "andre", ...o });
  ["a", "b", "c", "d", "e", "f", "g"].forEach((id) => seedCo(id));
  seedCo("nomail", { companyEmail: null });
  seedCo("gm", { companyEmail: "dono@gmail.com" });
  seedCo("eng", { stage: "engaged" });
  seedCo("recent", { lastTouchAt: Timestamp.now() });
  seedCo("sup", { companyEmail: "geral@sup.pt" });
  store.set("outreachSuppression/geral@sup.pt", { reason: "unsubscribe" });

  ok("non-admin refused", (await call({ action: "save", campaign: { name: "x" } }, { auth: { token: { email: "someone@gmail.com" } } })).err?.code === "permission-denied");
  ok("unknown action refused", (await call({ action: "nope" })).err?.code === "invalid-argument");
  const badSave = await call({ action: "save", campaign: { name: "x", steps: [{ channel: "fax" }] } });
  ok("validation error surfaces as invalid-argument with reason", badSave.err?.code === "invalid-argument" && badSave.err.details.reason === "bad_channel");

  const c1 = (await call({ action: "save", campaign: { name: "Metalurgia Norte", steps: [{ templateId: "t1" }] } })).res.campaignId;
  const camp1 = get(`outreachCampaigns/${c1}`);
  ok("new campaign: draft, test-mode flag, zero stats, creator", camp1.status === "draft" && camp1.isTest === true && camp1.stats.enrolled === 0 && camp1.createdBy === "andre.rocha@douropartners.pt");

  const ids = ["a", "b", "c", "nomail", "gm", "eng", "recent", "sup", "missing"];
  const before = store.size;
  const pv = (await call({ action: "preview", campaignId: c1, companyIds: [...ids, "a"] })).res;
  ok("preview writes nothing", store.size === before);
  ok("preview: 9 requested (deduped), 3 eligible", pv.requested === 9 && pv.eligible === 3);
  ok("preview: one of each exclusion", ["no_email", "personal_domain", "stage", "recent_touch", "suppressed", "not_found"].every((k) => pv.excluded[k] === 1));
  ok("preview: sample names the companies", pv.excludedSample.some((x) => x.companyId === "eng" && x.reason === "stage" && x.companyName === "Empresa eng"));
  ok("preview: days to start at 20/day", pv.daysToStart === 1 && pv.newPerDay === 20);
  ok("bad company ids refused", (await call({ action: "preview", campaignId: c1, companyIds: [] })).err?.details?.reason === "companies_required");

  const en = (await call({ action: "enrol", campaignId: c1, companyIds: ids, source: { type: "filters", label: "CAE 25, Norte", filterSpec: [{ field: "cae", op: "in", value: ["25"] }, { field: "caeCode", op: "prefix", value: "25" }, { field: "lastTouchAt", op: "within_days", value: 30 }, { field: "x", op: "drop table", value: 1 }] } })).res;
  ok("enrol: 3 enrolled, 6 skipped", en.enrolled === 3 && en.skippedTotal === 6 && en.skipped.stage === 1);
  const ea = get(`outreachEnrolments/${c1}_a`);
  ok("enrolment: pending, step 0, company data, test flag", ea.status === "pending" && ea.currentStep === 0 && ea.companyName === "Empresa a" && ea.contactEmail === "geral@a.pt" && ea.owner === "andre" && ea.isTest === true && ea.source === "filters");
  ok("company holds the campaign slot", get("searchCompanies/a").activeCampaignId === c1 && get("searchCompanies/a").activeCampaignName === "Metalurgia Norte" && get("searchCompanies/a").activeEnrolmentId === `${c1}_a`);
  const camp1b = get(`outreachCampaigns/${c1}`);
  ok("filter ops kept (prefix, within_days); unknown op falls back to eq", get(`outreachCampaigns/${c1}`).audience.sources[0].filterSpec.map((f) => f.op).join() === "in,prefix,within_days,eq");
  ok("campaign stats and source recorded", camp1b.stats.enrolled === 3 && camp1b.audience.sources.length === 1 && camp1b.audience.sources[0].filterSpec[0].field === "cae" && camp1b.audience.sources[0].enrolled === 3);
  const again = (await call({ action: "enrol", campaignId: c1, companyIds: ["a"] })).res;
  ok("enrolling again is skipped (already in campaign), no source added", again.enrolled === 0 && again.skipped.already_in_campaign === 1 && get(`outreachCampaigns/${c1}`).audience.sources.length === 1);

  // D5: second campaign
  const c2 = (await call({ action: "save", campaign: { name: "Têxteis", steps: [{ templateId: "t1" }] } })).res.campaignId;
  const pv2 = (await call({ action: "preview", campaignId: c2, companyIds: ["a", "b", "d"] })).res;
  ok("preview: conflicts grouped by campaign", pv2.eligible === 1 && pv2.conflictCount === 2 && pv2.conflictCampaigns[0].campaignName === "Metalurgia Norte" && pv2.conflictCampaigns[0].count === 2 && pv2.daysToStartIfMoved === 1);
  const skip = (await call({ action: "enrol", campaignId: c2, companyIds: ["a", "d"], onConflict: "skip" })).res;
  ok("skip (default): company stays in its campaign", skip.enrolled === 1 && skip.skipped.in_other_campaign === 1 && get("searchCompanies/a").activeCampaignId === c1);
  const mv = (await call({ action: "enrol", campaignId: c2, companyIds: ["a"], source: { type: "manual" }, onConflict: "move" })).res;
  ok("move: enrolled in the new campaign", mv.enrolled === 1 && mv.moved === 1 && get("searchCompanies/a").activeCampaignId === c2 && get("searchCompanies/a").activeCampaignName === "Têxteis");
  ok("move: old enrolment ended with reason", get(`outreachEnrolments/${c1}_a`).status === "moved" && /Têxteis/.test(get(`outreachEnrolments/${c1}_a`).stopReason) && get(`outreachEnrolments/${c2}_a`).movedFrom === `${c1}_a`);

  // Stale pointer: company points at an enrolment that already ended
  seedCo("stale", { activeCampaignId: "OLD", activeCampaignName: "Old", activeEnrolmentId: "OLD_stale" });
  store.set("outreachEnrolments/OLD_stale", { campaignId: "OLD", companyId: "stale", status: "replied" });
  ok("stale campaign pointer doesn't block", (await call({ action: "enrol", campaignId: c2, companyIds: ["stale"] })).res.enrolled === 1 && get("searchCompanies/stale").activeCampaignId === c2);

  // Pause / resume / remove one company
  ok("pause", (await call({ action: "enrolment", enrolmentId: `${c1}_b`, op: "pause" })).res.status === "paused" && get(`outreachEnrolments/${c1}_b`).pausedFrom === "pending");
  ok("paused company still holds its slot", get("searchCompanies/b").activeCampaignId === c1);
  ok("resume restores the previous state", (await call({ action: "enrolment", enrolmentId: `${c1}_b`, op: "resume" })).res.status === "pending");
  ok("resume when not paused refused", (await call({ action: "enrolment", enrolmentId: `${c1}_b`, op: "resume" })).err?.details?.reason === "not_paused");
  ok("remove releases the company", (await call({ action: "enrolment", enrolmentId: `${c1}_b`, op: "remove", reason: "Wrong sector" })).res.status === "removed" && get("searchCompanies/b").activeCampaignId === undefined && get(`outreachEnrolments/${c1}_b`).stopReason === "Wrong sector");
  ok("removing twice refused", (await call({ action: "enrolment", enrolmentId: `${c1}_b`, op: "remove" })).err?.details?.reason === "not_live");

  // Rename keeps the Search CRM badge current
  await call({ action: "save", campaignId: c1, campaign: { name: "Metalurgia Norte 2026" } });
  ok("rename updates companies held by the campaign only", get("searchCompanies/c").activeCampaignName === "Metalurgia Norte 2026" && get("searchCompanies/a").activeCampaignName === "Têxteis");
  ok("save doesn't touch audience sources", get(`outreachCampaigns/${c1}`).audience.sources.length === 1 && get(`outreachCampaigns/${c1}`).steps[0].templateId === "t1");

  // Status changes
  const notReady = await call({ action: "setStatus", campaignId: c1, status: "active" });
  ok("activation refused while the template is missing", notReady.err?.details?.reason === "not_ready" && /no longer exists/.test(notReady.err.message));
  store.set("outreachTemplates/t1", { name: "Intro", status: "active", variants: [{ key: "A", subject: "Olá", body: "..." }] });
  ok("activate", (await call({ action: "setStatus", campaignId: c1, status: "active" })).res.status === "active" && get(`outreachCampaigns/${c1}`).startedAt != null);
  ok("draft → finished refused", (await call({ action: "setStatus", campaignId: c2, status: "finished" })).err?.details?.reason === "bad_transition");
  ok("pause campaign", (await call({ action: "setStatus", campaignId: c1, status: "paused" })).res.status === "paused");
  ok("companies can be added to a paused campaign", (await call({ action: "enrol", campaignId: c1, companyIds: ["e"] })).res.enrolled === 1);
  ok("delete refused for non-draft", (await call({ action: "delete", campaignId: c1 })).err?.details?.reason === "not_draft");
  const fin = (await call({ action: "setStatus", campaignId: c1, status: "finished" })).res;
  ok("finish ends live enrolments and releases companies", fin.ended === 2 && get(`outreachEnrolments/${c1}_c`).status === "stopped" && get("searchCompanies/c").activeCampaignId === undefined && get("searchCompanies/e").activeCampaignId === undefined);
  ok("finish leaves the moved company in its new campaign", get("searchCompanies/a").activeCampaignId === c2);
  ok("finished campaign can't be edited or enrolled", (await call({ action: "save", campaignId: c1, campaign: { name: "y" } })).err?.details?.reason === "campaign_closed" && (await call({ action: "enrol", campaignId: c1, companyIds: ["f"] })).err?.details?.reason === "campaign_closed");
  ok("archive a finished campaign", (await call({ action: "setStatus", campaignId: c1, status: "archived" })).res.status === "archived");

  // Duplicate
  const c3 = (await call({ action: "duplicate", campaignId: c1 })).res.campaignId;
  const camp3 = get(`outreachCampaigns/${c3}`);
  ok("duplicate: new draft, (copy), same steps, no audience", camp3.status === "draft" && camp3.name === "Metalurgia Norte 2026 (copy)" && camp3.steps.length === 1 && camp3.audience.sources.length === 0 && camp3.stats.enrolled === 0 && camp3.lockedStepIds.length === 0);

  // Delete a draft
  await call({ action: "enrol", campaignId: c3, companyIds: ["f", "g"] });
  ok("draft holds f and g", get("searchCompanies/f").activeCampaignId === c3);
  const del = (await call({ action: "delete", campaignId: c3 })).res;
  ok("delete draft releases companies and removes docs", del.deleted && del.released === 2 && get("searchCompanies/f").activeCampaignId === undefined && !get(`outreachCampaigns/${c3}`) && !get(`outreachEnrolments/${c3}_f`));

  // Stop rules helper (wired into the webhook in step 2)
  const stopped = await stopCompanyEnrolments("a", "Bounced");
  ok("stopCompanyEnrolments ends the company's enrolments", stopped === 1 && get(`outreachEnrolments/${c2}_a`).status === "stopped" && get("searchCompanies/a").activeCampaignId === undefined);
  ok("endEnrolment on an ended enrolment is a no-op", (await endEnrolment(F.fakeDb.doc(`outreachEnrolments/${c2}_a`), "removed", "x")) === false);

  // Clear test data removes test campaigns and frees their companies
  ok("before clearing: d and stale are held by the test campaign", get("searchCompanies/d").activeCampaignId === c2);
  seedCo("real", {});
  store.set("outreachCampaigns/REAL", { name: "Real", status: "active", isTest: false });
  store.set("outreachEnrolments/REAL_real", { campaignId: "REAL", companyId: "real", status: "active", isTest: false });
  store.set("searchCompanies/real", { ...get("searchCompanies/real"), activeCampaignId: "REAL", activeEnrolmentId: "REAL_real" });
  const cleared = await fns.outreachAdmin({ ...ADMIN, data: { action: "clearTestData" } });
  ok("clearTestData deletes test campaigns and enrolments", cleared.campaigns === 2 && docs("outreachCampaigns").map((d) => d.id).join() === "REAL" && docs("outreachEnrolments").map((d) => d.id).join() === "OLD_stale,REAL_real"); // OLD_stale is a hand-made non-test fixture
  ok("clearTestData releases the companies, keeps real ones", get("searchCompanies/d").activeCampaignId === undefined && get("searchCompanies/stale").activeCampaignId === undefined && get("searchCompanies/real").activeCampaignId === "REAL");

  console.log(fail ? `\n${fail} FAILED` : "\nall campaign tests passed");
  process.exit(fail ? 1 : 0);
})();
