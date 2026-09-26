// Outreach Phase 4 — AI-written opening line ({{ai.opener}}) per company.
// Spec: "Outreach Phase 3-4 - Contacts & Personalisation Spec.md".
//
// Safety and cost defaults:
// - Off until settings.aiEnabled is true AND the ANTHROPIC_API_KEY secret
//   holds a real key (deploys ask for it; "none" keeps AI off).
// - Only company-level business data is sent — no names, emails or phones,
//   no conversation history.
// - AI text is only used in steps that need approval (a person reads it),
//   plus the Compose "Suggest an opening" button (you edit before sending).
// - One call per company × template, cached in outreachAi/{companyId}_{templateId};
//   a daily cap (settings.aiDailyCap, default 100) counted in outreachDaily.aiCalls.

const { defineSecret } = require("firebase-functions/params");
const P = require("../access/perms"); // team access: who may call what
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { REGION, ADMIN_EMAILS } = require("./config");
const { normEmail, utcDayKey } = require("./util");
const { emailNameOf } = require("./render");
const store = require("./store");

const { db, FieldValue } = store;

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const DEFAULT_MODEL = "claude-opus-5";
const ALLOWED_MODELS = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"];
const DEFAULT_DAILY_CAP = 100;
const CACHE_DAYS = 90;

// Frozen, so it can be cached by the API across companies (prefix match).
const SYSTEM_PROMPT = `Escreves a frase de abertura de um email de prospeção B2B em português europeu (Portugal).

Contexto: a Douro Partners é um search fund português — dois empreendedores, André Rocha e António Carvalho, apoiados por investidores, que procuram uma empresa portuguesa de qualidade para adquirir e gerir a longo prazo, dando continuidade ao que o fundador construiu (por exemplo em situações de sucessão). O email vai para a empresa descrita nos dados.

Escreve UMA ou DUAS frases (máximo 45 palavras) que abram o email de forma pessoal e específica para esta empresa:
- Baseia-te APENAS nos factos fornecidos (setor, atividade, região, antiguidade, dimensão, evolução). Não inventes nada: se um facto não estiver nos dados, não o menciones.
- Tom sóbrio, respeitoso e concreto, como um empresário a escrever a outro. Sem elogios exagerados, sem jargão de marketing, sem pontos de exclamação.
- Não comeces com uma saudação ("Bom dia", "Caro…") nem com o nome de uma pessoa — isso já está no email. Não assines. Não faças perguntas.
- Não menciones valores exatos de faturação ou resultados; podes referir tendências de forma geral (por exemplo "o crescimento dos últimos anos").
- Usa o nome da empresa tal como é dado em "nome_no_email".
- Responde apenas com a frase, sem aspas nem explicações.`;

let clientFactory = null; // tests replace this
function getClient(apiKey) {
  if (clientFactory) return clientFactory(apiKey);
  const Anthropic = require("@anthropic-ai/sdk");
  const C = Anthropic.default || Anthropic;
  return new C({ apiKey, maxRetries: 2, timeout: 60000 });
}

function keyConfigured(value) {
  const v = String(value || "").trim();
  return v.length > 20 && !/^(none|off|no|-)$/i.test(v);
}

// Company facts sent to the model — business data only (no personal data).
function companyFacts(c) {
  const round = (n) => (n == null || isNaN(n) ? null : Math.round(Number(n)));
  const facts = {
    nome_no_email: emailNameOf(c),
    setor: c.sector || null,
    subsetor: c.subSector || null,
    atividade_cae: c.caeDescription || null,
    descricao: c.description ? String(c.description).slice(0, 1200) : null,
    concelho: c.concelho || c.city || null,
    regiao: c.nuts2 || null,
    ano_fundacao: c.yearFounded || null,
    forma_juridica: c.nationalLegalForm || c.legalForm || null,
    colaboradores: round(c.employees ?? c.computedEmployees),
    tendencia_faturacao: c.computedGrowthRecent == null ? null
      : c.computedGrowthRecent > 0.05 ? "a crescer" : c.computedGrowthRecent < -0.05 ? "a descer" : "estável",
    dimensao: c.computedRevenue == null ? null
      : c.computedRevenue >= 20e6 ? "média-grande" : c.computedRevenue >= 5e6 ? "média" : c.computedRevenue >= 1e6 ? "pequena-média" : "pequena",
  };
  return Object.fromEntries(Object.entries(facts).filter(([, v]) => v != null && v !== ""));
}

function aiError(code, reason, message) {
  return new HttpsError(code, message, { reason });
}

// Returns { text, cached } or throws HttpsError with a reason:
// ai_off | ai_no_key | ai_cap | ai_declined | ai_failed | company_not_found
async function getOpener({ companyId, templateId = null, templateBody = "", settings, apiKey, force = false }) {
  if (!settings.aiEnabled) throw aiError("failed-precondition", "ai_off", "AI openings are switched off (Settings → General).");
  if (!keyConfigured(apiKey)) throw aiError("failed-precondition", "ai_no_key", "No Anthropic API key is configured yet.");
  const cacheRef = db().doc(`outreachAi/${companyId}_${templateId || "compose"}`);
  if (!force) {
    const cur = await cacheRef.get();
    const at = cur.exists ? cur.data().createdAt?.toMillis?.() : null;
    if (cur.exists && cur.data().text && (!at || Date.now() - at < CACHE_DAYS * 86400000)) return { text: cur.data().text, cached: true };
  }
  const cSnap = await db().doc(`searchCompanies/${companyId}`).get();
  if (!cSnap.exists) throw aiError("not-found", "company_not_found", "Company not found.");
  const cap = Number(settings.aiDailyCap ?? DEFAULT_DAILY_CAP);
  const day = await store.getTodayDaily();
  if ((day.aiCalls || 0) >= cap) throw aiError("resource-exhausted", "ai_cap", `Today's AI limit (${cap}) is reached.`);

  const model = ALLOWED_MODELS.includes(settings.aiModel) ? settings.aiModel : DEFAULT_MODEL;
  const facts = companyFacts(cSnap.data());
  const excerpt = String(templateBody || "").replace(/\{\{\s*ai\.opener[^}]*\}\}/g, "[ABERTURA]").slice(0, 800);
  const userText = `Dados da empresa (JSON):\n${JSON.stringify(facts, null, 2)}${excerpt ? `\n\nO resto do email (para a abertura encaixar; [ABERTURA] é onde a tua frase entra):\n${excerpt}` : ""}`;

  await db().doc(`outreachDaily/${utcDayKey()}`).set({ aiCalls: FieldValue.increment(1) }, { merge: true });
  const client = getClient(apiKey);
  let res;
  try {
    const params = {
      model,
      max_tokens: 2000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userText }],
    };
    if (model !== "claude-haiku-4-5") params.output_config = { effort: "low" }; // short, simple task
    // Server-side fallback on a safety decline (Opus 5): Anthropic routes to
    // its recommended model instead of returning the refusal.
    res = model === "claude-opus-5"
      ? await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
      : await client.messages.create(params);
  } catch (e) {
    const Anthropic = clientFactory ? null : (() => { try { const A = require("@anthropic-ai/sdk"); return A.default || A; } catch (x) { return null; } })();
    const status = e?.status;
    logger.error("outreach AI call failed", { status, message: e?.message });
    if (Anthropic && e instanceof Anthropic.AuthenticationError) throw aiError("failed-precondition", "ai_no_key", "The Anthropic API key was rejected.");
    if (status === 429) throw aiError("resource-exhausted", "ai_failed", "The AI service is busy — try again in a minute.");
    throw aiError("unavailable", "ai_failed", `The AI service didn't answer (${status || "network"}).`);
  }
  if (res.stop_reason === "refusal") throw aiError("failed-precondition", "ai_declined", "The AI declined to write an opening for this company.");
  const text = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ")
    .replace(/\s+/g, " ").replace(/^["«“]+|["»”]+$/g, "").trim();
  if (!text) throw aiError("unavailable", "ai_failed", "The AI returned no text.");
  await cacheRef.set({ companyId, templateId, text, model: res.model || model, facts, createdAt: FieldValue.serverTimestamp(), usage: { in: res.usage?.input_tokens || 0, out: res.usage?.output_tokens || 0, cacheRead: res.usage?.cache_read_input_tokens || 0 } });
  return { text, cached: false };
}

// Callable: { action: "status" } → { enabled, keyConfigured, model, cap, usedToday }
//           { action: "opener", companyId, templateId?, force? } → { text, cached }
exports.outreachAi = onCall({ region: REGION, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120 }, async (request) => {
  const caller = normEmail(request.auth?.token?.email);
  if (!P.hasPerm(request, "out.draft") && !P.hasPerm(request, "out.send")) throw new HttpsError("permission-denied", "You don't have permission to use this.", { reason: "not_admin" });
  const data = request.data || {};
  const settings = await store.getSettings();
  if (data.action === "status") {
    const day = await store.getTodayDaily();
    return { enabled: !!settings.aiEnabled, keyConfigured: keyConfigured(ANTHROPIC_API_KEY.value()), model: ALLOWED_MODELS.includes(settings.aiModel) ? settings.aiModel : DEFAULT_MODEL, cap: Number(settings.aiDailyCap ?? DEFAULT_DAILY_CAP), usedToday: day.aiCalls || 0 };
  }
  if (data.action === "opener") {
    if (!data.companyId) throw new HttpsError("invalid-argument", "Choose a company.", { reason: "company_required" });
    let templateBody = "";
    if (data.templateId) {
      const t = await db().doc(`outreachTemplates/${data.templateId}`).get();
      templateBody = t.exists ? ((t.data().variants || [])[0]?.body || "") : "";
    }
    return getOpener({ companyId: String(data.companyId), templateId: data.templateId || null, templateBody, settings, apiKey: ANTHROPIC_API_KEY.value(), force: !!data.force });
  }
  throw new HttpsError("invalid-argument", `Unknown action "${data.action}".`, { reason: "bad_action" });
});

exports.getOpener = getOpener;
exports.companyFacts = companyFacts;
exports.keyConfigured = keyConfigured;
exports.ANTHROPIC_API_KEY = ANTHROPIC_API_KEY;
exports.SYSTEM_PROMPT = SYSTEM_PROMPT;
exports._setClientFactory = (f) => { clientFactory = f; };
