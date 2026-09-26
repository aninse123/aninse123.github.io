// Phase 4 — AI opening line: settings/key gates, data sent (business facts
// only), request shape, cache, daily cap, refusal/errors, scheduler drafts,
// and the "approval only" safety rule. The Anthropic client is faked — no
// real API calls.
const F = require("./fake_firebase.js");
const dns = require("dns").promises;
dns.resolveMx = async (d) => [{ exchange: "mx." + d, priority: 10 }];
global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ id: "rs_1" }) });

const ai = require("../outreach/ai.js");
const fns = require("../index.js");
const { runScheduler, stepMessageId } = require("../outreach/scheduler.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const callAi = async (data) => { try { return await fns.outreachAi({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const get = (p) => store.get(p);
const reason = async (p) => { try { await p; return null; } catch (e) { return e.details?.reason; } };

// Fake Anthropic client
const requests = [];
let nextReply = { stop_reason: "end_turn", model: "claude-opus-5", content: [{ type: "text", text: "«A Silva tem mais de trinta anos de metalomecânica em Braga.»" }], usage: { input_tokens: 700, output_tokens: 120 } };
let nextError = null;
const fakeCreate = async (params) => { requests.push(params); if (nextError) { const e = nextError; nextError = null; throw e; } return nextReply; };
ai._setClientFactory(() => ({ messages: { create: fakeCreate }, beta: { messages: { create: fakeCreate } } }));

(async () => {
  store.set("searchCompanies/co1", {
    name: "METALURGICA SILVA, LDA", sector: "Manufacturing", caeDescription: "Fabricação de estruturas metálicas", description: "Estruturas metálicas para a construção.",
    concelho: "Braga", nuts2: "Norte", yearFounded: 1991, computedRevenue: 6e6, computedGrowthRecent: 0.12,
    companyEmail: "geral@silva.pt", companyPhone: "253000000", contacts: [{ name: "Rita Costa", email: "rita@silva.pt", phone: "912000000" }], guoName: "JOAO SILVA",
  });

  // Gates and data
  ok("key check: real key yes, 'none' / short no", ai.keyConfigured("sk-ant-api03-" + "x".repeat(40)) && !ai.keyConfigured("none") && !ai.keyConfigured("abc"));
  const facts = ai.companyFacts(get("searchCompanies/co1"));
  const factsJson = JSON.stringify(facts);
  ok("facts: business data only — no emails, phones, contact or owner names", !/@|253000000|912000000|Rita|JOAO SILVA/i.test(factsJson) && facts.nome_no_email === "Metalurgica Silva" && facts.tendencia_faturacao === "a crescer" && facts.dimensao === "média" && facts.ano_fundacao === 1991);
  const base = { companyId: "co1", templateId: "t1", templateBody: "{{ai.opener}}\n\nSomos a Douro Partners…", apiKey: "sk-ant-api03-" + "x".repeat(40) };
  ok("off by default → ai_off", await reason(ai.getOpener({ ...base, settings: {} })) === "ai_off");
  ok("no key → ai_no_key", await reason(ai.getOpener({ ...base, apiKey: "none", settings: { aiEnabled: true } })) === "ai_no_key");

  // Success
  const r = await ai.getOpener({ ...base, settings: { aiEnabled: true } });
  const q = requests[0];
  ok("returns the text without quotes", r.text === "A Silva tem mais de trinta anos de metalomecânica em Braga." && r.cached === false);
  ok("request: claude-opus-5, server-side fallback 'default', no temperature, low effort", q.model === "claude-opus-5" && q.fallbacks === "default" && q.betas[0] === "server-side-fallback-2026-07-01" && q.temperature === undefined && q.output_config.effort === "low");
  ok("request: frozen system prompt marked for caching; facts + template excerpt in the user turn", q.system[0].cache_control.type === "ephemeral" && q.system[0].text === ai.SYSTEM_PROMPT && /"nome_no_email": "Metalurgica Silva"/.test(q.messages[0].content) && /\[ABERTURA\]/.test(q.messages[0].content));
  ok("cached per company × template; second call makes no request", (await ai.getOpener({ ...base, settings: { aiEnabled: true } })).cached === true && requests.length === 1 && get("outreachAi/co1_t1").text.startsWith("A Silva"));
  ok("force regenerates", (await ai.getOpener({ ...base, force: true, settings: { aiEnabled: true } })).cached === false && requests.length === 2);
  ok("other models: plain request, no fallback beta", (await ai.getOpener({ ...base, templateId: "t9", settings: { aiEnabled: true, aiModel: "claude-sonnet-5" } }), requests[2].model === "claude-sonnet-5" && requests[2].fallbacks === undefined));
  ok("daily cap", await reason(ai.getOpener({ ...base, templateId: "tx", settings: { aiEnabled: true, aiDailyCap: 3 } })) === "ai_cap");
  nextReply = { stop_reason: "refusal", content: [], model: "claude-opus-5" };
  ok("refusal → ai_declined", await reason(ai.getOpener({ ...base, templateId: "tr", settings: { aiEnabled: true } })) === "ai_declined");
  nextReply = { stop_reason: "end_turn", model: "claude-opus-5", content: [{ type: "text", text: "Abertura de teste." }], usage: {} };
  nextError = Object.assign(new Error("overloaded"), { status: 429 });
  ok("rate limit → ai_failed (try again)", await reason(ai.getOpener({ ...base, templateId: "te", settings: { aiEnabled: true } })) === "ai_failed");

  // Callable
  store.set("outreachSettings/global", { aiEnabled: true, aiDailyCap: 50 });
  const st = await callAi({ action: "status" });
  ok("status: enabled, key configured (test secret), model, cap, used today", st.enabled && st.keyConfigured && st.model === "claude-opus-5" && st.cap === 50 && st.usedToday >= 3);
  store.set("outreachTemplates/t1", { name: "Intro IA", status: "active", variants: [{ key: "A", subject: "Olá {{company.shortName}}", body: "{{ai.opener}}\n\nSomos a Douro Partners." }] });
  const op = await callAi({ action: "opener", companyId: "co1", templateId: "t1" });
  ok("opener via callable (cached from before)", op.text && op.cached === true);

  // Scheduler: drafts get the AI line; automatic steps with {{ai.opener}} can't start
  store.set("outreachSenders/an.rocha@mail.douropartners-team.pt", { email: "an.rocha@mail.douropartners-team.pt", displayName: "André Rocha", owner: "andre", status: "active", dailyCap: 25, signature: "A" });
  store.set("searchCompanies/co1", { ...get("searchCompanies/co1"), stage: "universe", owner: "andre" });
  const auto = (await camp({ action: "save", campaign: { name: "IA auto", approvalDefault: "auto", steps: [{ templateId: "t1" }] } })).campaignId;
  ok("safety: an automatic step using {{ai.opener}} can't start", /set this step to "Needs approval"/.test((await camp({ action: "setStatus", campaignId: auto, status: "active" })).err?.message || ""));
  const appr = (await camp({ action: "save", campaign: { name: "IA aprovação", approvalDefault: "approval", steps: [{ templateId: "t1" }] } })).campaignId;
  await camp({ action: "enrol", campaignId: appr, companyIds: ["co1"] });
  await camp({ action: "setStatus", campaignId: appr, status: "active" });
  await runScheduler({ now: new Date("2026-09-29T10:30:00+01:00"), gap: null, rand: () => 0 });
  const draft = get(`outreachMessages/${stepMessageId(`${appr}_co1`, "s1")}`);
  ok("draft carries the AI opening (to be read in To approve)", draft?.status === "draft" && draft.draftBody.startsWith("A Silva tem mais de trinta anos") && /Somos a Douro Partners/.test(draft.draftBody));

  // AI switched off: template fallback used
  store.set("outreachSettings/global", { aiEnabled: false });
  store.set("outreachTemplates/t2", { name: "Intro fallback", status: "active", variants: [{ key: "A", subject: "Olá", body: "{{ai.opener|Escrevo-lhe a propósito da {{company.shortName}}.}}\n\nResto." }] });
  store.set("searchCompanies/co2", { name: "TEXTEIS NORTE, SA", stage: "universe", owner: "andre", companyEmail: "geral@tn.pt" });
  const fb = (await camp({ action: "save", campaign: { name: "IA off", approvalDefault: "approval", steps: [{ templateId: "t2" }] } })).campaignId;
  await camp({ action: "enrol", campaignId: fb, companyIds: ["co2"] });
  await camp({ action: "setStatus", campaignId: fb, status: "active" });
  const before = requests.length;
  await runScheduler({ now: new Date("2026-09-30T10:30:00+01:00"), gap: null, rand: () => 0 });
  const d2 = get(`outreachMessages/${stepMessageId(`${fb}_co2`, "s1")}`);
  ok("AI off: no API call, the template's fallback is used (with its own field filled)", requests.length === before && d2?.status === "draft" && d2.draftBody.startsWith("Escrevo-lhe a propósito da Texteis Norte."));

  console.log(fail ? `\n${fail} FAILED` : "\nall AI tests passed");
  process.exit(fail ? 1 : 0);
})();
