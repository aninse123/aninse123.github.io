// Email name check (26 Oct 2026, switch "search.emailNameCheck"): flags the
// name used inside emails ({{company.shortName}}) when it looks wrong, so it is
// caught before Email 1 — in "Add companies", on the draft to approve, on the
// company's Overview and in a Search CRM filter.
//
// Warnings: an Orbis trade name naming another activity than the company's CAE
// ("Café Tony" for a fuel station, "Restaurante o Beleza" for animal feed),
// legal-form words left in ("SGPS", "S.A.U"), a short name that isn't in the
// legal name ("Pv" for Portugal Capital Ventures), all capitals, extra spaces.
// Note only: names over 45 characters (usually correct formal names). Never
// flagged: an acronym that starts the legal name (the brand), or a name someone
// confirmed with "Keep this name" (emailNameChecked.name).
//
// The page twin is portal/email-name-check.js; tests check both give the same answer.

const { shortCompanyName, emailNameOf } = require("./render");
const ACCENTS = require("./accents_pt.json"); // word without accents (lower case) → with accents

const strip = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const N = (s) => strip(s).toUpperCase();
// Activity words → CAE prefixes where the word is normal for the company.
const ACTIVITY = [
  [/\b(RESTAURANTE|CHURRASQUEIRA|MARISQUEIRA|PIZZARIA|TASCA|SNACK|CERVEJARIA|ADEGA TIPICA)\b/, ["56"]],
  [/\b(CAFE|PASTELARIA|CONFEITARIA|BAR)\b/, ["56", "107", "4724"]],
  [/\b(HOTEL|HOSTEL|RESIDENCIAL|PENSAO|ALOJAMENTO|TURISMO RURAL)\b/, ["55"]],
  [/\b(CLINICA|CONSULTORIO|LABORATORIO DE ANALISES)\b/, ["86", "75"]],
  [/\b(FARMACIA)\b/, ["4773"]],
  [/\b(ESCOLA|COLEGIO|EXPLICACOES|ACADEMIA)\b/, ["85"]],
  [/\b(CABELEIREIRO|BARBEARIA|ESTETICA)\b/, ["9602"]],
  [/\b(IMOBILIARIA)\b/, ["68"]],
  [/\b(STAND|OFICINA)\b/, ["45"]],
  [/\b(MINIMERCADO|SUPERMERCADO|MERCEARIA|TALHO|PADARIA|FRUTARIA)\b/, ["47", "1071", "101"]],
];
const LEGAL_FORM_IN_NAME = /(^|[\s,(])(lda|l\.da|limitada|unipessoal|s\.a\.u|s\.a\.r\.l|sgps|s\.g\.p\.s|e\.p\.e|s\.a)\.?(?=$|[\s,)])/i;
const LONG = 45;

// Portuguese accents restored word by word ("Construcoes" → "Construções").
function accent(s) {
  return String(s).replace(/[\p{L}]+/gu, (w) => {
    const a = ACCENTS[w.toLowerCase()];
    if (!a || strip(w) !== w) return w;
    return w === w.toUpperCase() && w.length > 1 ? a.toUpperCase() : w[0] === w[0].toUpperCase() ? a[0].toUpperCase() + a.slice(1) : a;
  });
}
// Where the name comes from: typed in the Search CRM, Orbis "Also known as", or the legal name.
function nameSource(c) {
  if (String(c?.emailName || "").trim()) return "typed";
  const aka = String(c?.akaName || "").split(/[;\n|]/)[0].trim();
  return aka && aka !== "-" && !/^n\.?a\.?$/i.test(aka) ? "trade" : "legal";
}
// The legal name's short form, with accents — the suggestion when a name is flagged.
function suggestedName(c) {
  const s = shortCompanyName(c?.name || "").replace(/\s*\bsociedade gestora de participa[cç][oõ]es sociais\b/gi, "").replace(/\s*\(?\bsgps\b\)?/gi, "").replace(/[\s,]+(s\.e|e\.p\.e)\.?$/i, "").replace(/\s*,\s*,/g, ",").replace(/[\s,-]+$/, "").trim();
  return accent(s || shortCompanyName(c?.name || ""));
}
// A short name that starts the legal name is its brand ("TN" for "TN - TRANSPORTES").
const startsLegal = (name, legal) => { const a = N(name).replace(/[^A-Z0-9&+]/g, ""), b = N(legal).replace(/[^A-Z0-9&+]/g, ""); return !!a && b.startsWith(a); };

// [{ kind, level: "warn" | "info", text }] for the name used in emails; [] when fine or confirmed.
function nameIssues(c) {
  const name = emailNameOf(c || {});
  if (!name || (c?.emailNameChecked && c.emailNameChecked.name === name)) return [];
  const legal = String(c?.name || ""), cae = String(c?.caeCode || ""), out = [];
  const en = N(name), lg = N(legal);
  for (const [re, okCae] of ACTIVITY) {
    const m = en.match(re);
    if (m && !lg.match(re) && !okCae.some((p) => cae.startsWith(p))) { out.push({ kind: "activity", level: "warn", text: `names a ${accent(m[0].toLowerCase())} — the company's CAE is ${cae || "unknown"}` }); break; }
  }
  if (LEGAL_FORM_IN_NAME.test(name) && !startsLegal(name, legal)) out.push({ kind: "legalform", level: "warn", text: "legal-form words in the name (Lda, S.A., SGPS…)" });
  const letters = name.replace(/[^\p{L}\p{N}]/gu, "");
  if (letters.length <= 3 && !startsLegal(name, legal)) out.push({ kind: "acronym", level: "warn", text: "a short name that isn't in the legal name" });
  if (name === name.toUpperCase() && /\p{Lu}{4,}/u.test(name) && name.trim().split(/\s+/).length > 1) out.push({ kind: "caps", level: "warn", text: "written in capitals" });
  if (/\s{2,}|^\s|\s$/.test(name)) out.push({ kind: "spaces", level: "warn", text: "extra spaces" });
  if (name.length > LONG && !out.length) out.push({ kind: "long", level: "info", text: `long (${name.length} characters) — fine for a formal name; shorten if the company uses a shorter one` });
  return out;
}
const hasWarning = (c) => nameIssues(c).some((i) => i.level === "warn");

// What "Add companies" and the draft card show for one company, or null when its name is fine.
function nameCheckOf(c, id) {
  const issues = nameIssues(c).filter((i) => i.level === "warn");
  if (!issues.length) return null;
  const sug = suggestedName(c);
  return { companyId: id || c.id || null, companyName: c.name || "", emailName: emailNameOf(c), source: nameSource(c), issues: issues.map((i) => i.text), suggestion: sug && sug !== emailNameOf(c) ? sug : null };
}

// Search words for a name (same shape as the Search CRM's companySearchFields), added when the email name changes.
function searchWordsFor(name) {
  const key = strip(String(name || "").replace(/[.,\-–—&/]/g, " ")).replace(/\s+/g, " ").trim().toUpperCase();
  const tokens = [...new Set(key.split(" ").filter((w) => w.length > 1))];
  const prefixes = new Set();
  for (const t of tokens) for (let i = 2; i <= t.length; i++) prefixes.add(t.slice(0, i));
  return { tokens, prefixes: [...prefixes] };
}

module.exports = { nameIssues, hasWarning, nameCheckOf, nameSource, suggestedName, accent, searchWordsFor, emailNameOf, LONG };
