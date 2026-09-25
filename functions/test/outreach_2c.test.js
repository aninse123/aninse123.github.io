// Phase 2c — filter-spec matching, branches on task outcomes, moving a
// company between campaigns, audience source labels and dynamic audiences.
const F = require("./fake_firebase.js");
const dns = require("dns").promises;
dns.resolveMx = async (d) => [{ exchange: "mx." + d, priority: 10 }];
global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ id: "rs_1" }) });

const U = require("../outreach/campaign_util.js");
const fns = require("../index.js");
const { runScheduler } = require("../outreach/scheduler.js");
const { stepTaskId } = require("../outreach/task_util.js");
const { store, Timestamp } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const throwsReason = (fn, reason) => { try { fn(); return false; } catch (e) { return e.reason === reason; } };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const get = (p) => store.get(p);
const run = (iso) => runScheduler({ now: new Date(iso), gap: null, rand: () => 0 });
const DAY = 86400000;

function seed() {
  store.clear();
  store.set("outreachTemplates/S", { name: "Guião", status: "active", kind: "script", variants: [{ key: "A", body: "Bom dia" }] });
  store.set("outreachTemplates/L", { name: "Carta", status: "active", kind: "letter", variants: [{ key: "A", body: "Carta" }] });
  for (let i = 1; i <= 6; i++) store.set(`searchCompanies/c${i}`, { name: `EMPRESA ${i}, LDA`, stage: "universe", companyEmail: `geral@empresa${i}.pt`, owner: "andre", sector: i <= 4 ? "Metal" : "Têxtil" });
}
async function makeCampaign(campaign, ids, source) {
  const { campaignId } = await camp({ action: "save", campaign });
  if (ids && ids.length) await camp({ action: "enrol", campaignId, companyIds: ids, source });
  const a = await camp({ action: "setStatus", campaignId, status: "active" });
  if (a.err) throw a.err;
  return campaignId;
}

(async () => {
  // ── matchesFilterSpec ──
  const now = Date.now();
  const co = { name: "Metalúrgica SILVA, Lda", nif: "500 000 001", sector: "Metal", caeCode: "25110", computedRevenue: 2e6, computedEBITDA: 3e5, computedEBITDAMargin: 0.15, computedGrowthRecent: -0.02, nationalLegalForm: "Sociedade por quotas", website: "silva.pt", lastTouchAt: Timestamp.fromDate(new Date(now - 10 * DAY)) };
  const m = (spec) => U.matchesFilterSpec(co, spec, now);
  ok("search matches name without accents, or NIF digits", m([{ field: "search", op: "contains", value: "metalurgica" }]) && m([{ field: "search", op: "contains", value: "500000" }]) && !m([{ field: "search", op: "contains", value: "texteis" }]));
  ok("stage defaults to universe; eq / prefix", m([{ field: "stage", op: "eq", value: "universe" }]) && m([{ field: "caeCode", op: "prefix", value: "25" }]) && !m([{ field: "caeCode", op: "prefix", value: "26" }]));
  ok("ranges: gte / lte / between; missing value fails", m([{ field: "computedRevenue", op: "gte", value: 1e6 }]) && !m([{ field: "computedEBITDA", op: "lte", value: 1e5 }]) && m([{ field: "computedRevenue", op: "between", value: [1e6, 3e6] }]) && !U.matchesFilterSpec({}, [{ field: "computedRevenue", op: "gte", value: 1 }]));
  ok("margin and growth compared in % like the list filters", m([{ field: "computedEBITDAMargin", op: "gte", value: 10 }]) && !m([{ field: "computedGrowthRecent", op: "gte", value: 0 }]));
  ok("legal form uses Orbis first, legacy second", m([{ field: "legalForm", op: "eq", value: "Sociedade por quotas" }]) && U.matchesFilterSpec({ legalForm: "SA" }, [{ field: "legalForm", op: "eq", value: "SA" }]));
  ok("touched within N days / never touched / has website", m([{ field: "lastTouchAt", op: "within_days", value: 30 }]) && !m([{ field: "lastTouchAt", op: "within_days", value: 7 }]) && !m([{ field: "lastTouchAt", op: "exists", value: false }]) && m([{ field: "website", op: "exists", value: true }]));
  ok("unknown operator never matches", !m([{ field: "sector", op: "regex", value: "." }]));
  ok("all conditions must hold", !m([{ field: "sector", op: "eq", value: "Metal" }, { field: "stage", op: "eq", value: "engaged" }]));

  // ── Branch validation ──
  const steps = [{ channel: "call", branches: [{ outcome: "no_answer", action: "goto", stepId: "s3" }] }, { channel: "letter", templateId: "L" }, { channel: "other", instructions: "x" }];
  const n = U.normalizeCampaign({ name: "x", steps });
  ok("branch kept (goto a later step)", n.steps[0].branches.length === 1 && n.steps[0].branches[0].stepId === "s3");
  ok("goto backwards refused", throwsReason(() => U.normalizeCampaign({ name: "x", steps: [{ channel: "call" }, { channel: "call", branches: [{ outcome: "no_answer", action: "goto", stepId: "s1" }] }] }), "bad_branch"));
  ok("outcome of another channel refused", throwsReason(() => U.normalizeCampaign({ name: "x", steps: [{ channel: "call", branches: [{ outcome: "accepted", action: "end" }] }] }), "bad_branch"));
  ok("two rules for one outcome refused", throwsReason(() => U.normalizeCampaign({ name: "x", steps: [{ channel: "call", branches: [{ outcome: "no_answer", action: "end" }, { outcome: "no_answer", action: "end" }] }] }), "bad_branch"));
  ok("email steps carry no branches; 'next' rules dropped", U.normalizeCampaign({ name: "x", steps: [{ channel: "email", branches: [{ outcome: "x", action: "end" }] }, { channel: "call", branches: [{ outcome: "voicemail", action: "next" }] }] }).steps.every((s) => !s.branches.length));

  // ── Branches in action ──
  seed();
  const cB = await makeCampaign({ name: "Ramos", steps: [
    { channel: "call", templateId: "S", branches: [{ outcome: "no_answer", action: "goto", stepId: "s3" }, { outcome: "wrong_number", action: "end" }] },
    { channel: "letter", templateId: "L", wait: { days: 0 } },
    { channel: "other", instructions: "Visitar", wait: { days: 0 } },
  ] }, ["c1", "c2", "c3"], { type: "filters", label: "Metal Norte", filterSpec: [{ field: "sector", op: "eq", value: "Metal" }] });
  await run("2026-09-29T10:30:00+01:00");
  const g = await camp({ action: "completeTask", taskId: stepTaskId(`${cB}_c1`, "s1"), outcome: "no_answer" });
  ok("no answer → rule jumps over the letter to step 3", g.sequence === "jumped" && get(`outreachEnrolments/${cB}_c1`).currentStep === 2);
  const en = await camp({ action: "completeTask", taskId: stepTaskId(`${cB}_c2`, "s1"), outcome: "wrong_number" });
  ok("wrong number → rule ends the sequence (completed), company released", en.sequence === "ended" && get(`outreachEnrolments/${cB}_c2`).status === "completed" && get("searchCompanies/c2").activeCampaignId === undefined && get(`outreachEnrolments/${cB}_c2`).history.slice(-1)[0].result === "wrong_number");
  const nx = await camp({ action: "completeTask", taskId: stepTaskId(`${cB}_c3`, "s1"), outcome: "voicemail" });
  ok("outcome without a rule → next step as usual", nx.sequence === "next" && get(`outreachEnrolments/${cB}_c3`).currentStep === 1);
  ok("enrolment remembers its audience source", get(`outreachEnrolments/${cB}_c1`).sourceLabel === "Metal Norte");

  // ── Move between campaigns ──
  await run("2026-09-29T10:40:00+01:00"); // c3's letter task is created
  const cT = (await camp({ action: "save", campaign: { name: "Destino", steps: [{ channel: "call" }] } })).campaignId;
  const mv = await camp({ action: "enrolment", enrolmentId: `${cB}_c3`, op: "move", targetCampaignId: cT });
  ok("move: company now in the target campaign, old enrolment moved", mv.ok && get("searchCompanies/c3").activeCampaignId === cT && get(`outreachEnrolments/${cB}_c3`).status === "moved" && get(`outreachEnrolments/${cT}_c3`).status === "pending" && /Moved from "Ramos"/.test(get(`outreachEnrolments/${cT}_c3`).sourceLabel));
  const oldTask = get(`outreachTasks/${stepTaskId(`${cB}_c3`, "s2")}`);
  ok("the old campaign's open task no longer counts (cancelled or never opened)", !oldTask || oldTask.status !== "open");
  ok("move to the same campaign refused", (await camp({ action: "enrolment", enrolmentId: `${cT}_c3`, op: "move", targetCampaignId: cT })).err?.details?.reason === "bad_target");
  const cStrict = (await camp({ action: "save", campaign: { name: "Só engaged", exclusions: { allowedStages: ["engaged"] }, steps: [{ channel: "call" }] } })).campaignId;
  const bad = await camp({ action: "enrolment", enrolmentId: `${cB}_c1`, op: "move", targetCampaignId: cStrict });
  ok("move blocked by the target's rules, company stays", bad.err?.details?.reason === "cant_move" && get("searchCompanies/c1").activeCampaignId === cB);

  // ── Dynamic audiences ──
  seed();
  const noFilter = (await camp({ action: "save", campaign: { name: "Dinâmica sem filtro", audience: { mode: "dynamic" }, steps: [{ channel: "call" }] } })).campaignId;
  ok("dynamic without a filter can't start", /dynamic audience needs companies added from the Search CRM filters/.test((await camp({ action: "setStatus", campaignId: noFilter, status: "active" })).err?.message || ""));
  const cD = await makeCampaign({ name: "Metal dinâmica", audience: { mode: "dynamic" }, steps: [{ channel: "call" }] }, ["c1"], { type: "filters", label: "Metal", filterSpec: [{ field: "sector", op: "eq", value: "Metal" }] });
  const other = await makeCampaign({ name: "Outra", steps: [{ channel: "call" }] }, ["c4"]);
  const r0 = await run("2026-09-30T06:50:00+01:00");
  ok("before 07:00 nothing runs", !r0.dynamicAdded && !get(`outreachCampaigns/${cD}`).audience.lastEvaluatedAt);
  await run("2026-09-30T07:10:00+01:00");
  ok("first run only sets the starting point", !!get(`outreachCampaigns/${cD}`).audience.lastEvaluatedAt && get(`outreachCampaigns/${cD}`).audience.lastEvaluatedDay === "2026-09-30" && !store.get(`outreachEnrolments/${cD}_c2`));
  const cdoc = get(`outreachCampaigns/${cD}`);
  store.set(`outreachCampaigns/${cD}`, { ...cdoc, audience: { ...cdoc.audience, lastEvaluatedAt: Timestamp.fromDate(new Date(Date.now() - DAY)) } });
  const later = Timestamp.now();
  ["c2", "c3", "c4", "c5"].forEach((id) => store.set(`searchCompanies/${id}`, { ...get(`searchCompanies/${id}`), updatedAt: later }));
  store.set("searchCompanies/c3", { ...get("searchCompanies/c3"), stage: "engaged" });
  const r1 = await run("2026-10-01T07:05:00+01:00");
  ok("next day: new matching company added (c2), with source 'dynamic'", r1.dynamicAdded === 1 && get(`outreachEnrolments/${cD}_c2`).source === "dynamic");
  ok("not added: other sector (c5), excluded stage (c3), in another campaign (c4)", !store.get(`outreachEnrolments/${cD}_c5`) && !store.get(`outreachEnrolments/${cD}_c3`) && !store.get(`outreachEnrolments/${cD}_c4`) && get("searchCompanies/c4").activeCampaignId === other);
  ok("once per day: a second run the same day adds nothing", !(await run("2026-10-01T07:15:00+01:00")).dynamicAdded);
  ok("campaign counts the dynamic additions", get(`outreachCampaigns/${cD}`).stats.dynamicAdded === 1);

  console.log(fail ? `\n${fail} FAILED` : "\nall 2c tests passed");
  process.exit(fail ? 1 : 0);
})();
