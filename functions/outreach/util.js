// Outreach module — pure helpers (no Firebase imports, so they can be unit
// tested in plain Node).

const crypto = require("crypto");
const dns = require("dns").promises;
const { FREE_MAIL_DOMAINS } = require("./config");

// "André Rocha <Andre@X.pt>" → { name: "André Rocha", email: "andre@x.pt" }
function parseAddress(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: "", email: s.toLowerCase() };
}

function normEmail(raw) {
  return parseAddress(raw).email;
}

function domainOf(email) {
  const at = String(email || "").lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).toLowerCase();
}

function localOf(email) {
  const at = String(email || "").lastIndexOf("@");
  return at < 0 ? "" : email.slice(0, at).toLowerCase();
}

function isFreeMail(domain) {
  return FREE_MAIL_DOMAINS.has(String(domain || "").toLowerCase());
}

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;
function isValidEmail(email) {
  return EMAIL_RE.test(String(email || ""));
}

// Resend's simulator accepts "bounced+label@resend.dev"; treat the label as
// part of the approved address so V4 tests can tag scenarios.
function isTestRecipient(email, list) {
  const e = normEmail(email);
  const allowed = new Set((list || []).map(normEmail));
  if (allowed.has(e)) return true;
  if (domainOf(e) === "resend.dev") {
    const base = localOf(e).split("+")[0] + "@resend.dev";
    return allowed.has(base);
  }
  return false;
}

// UTC calendar day — Resend's daily quota resets at 00:00 UTC.
function utcDayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

// Refuses dead domains before they turn into hard bounces (spec §7.7).
// Returns { ok:true } | { ok:false, reason:'no_mx' } | { ok:false, reason:'dns_error' }.
async function checkMx(domain, resolver = dns.resolveMx) {
  try {
    const records = await resolver(domain);
    return records && records.length ? { ok: true } : { ok: false, reason: "no_mx" };
  } catch (e) {
    if (e && (e.code === "ENOTFOUND" || e.code === "ENODATA")) return { ok: false, reason: "no_mx" };
    return { ok: false, reason: "dns_error" };
  }
}

// Resend's received-email API returns some header values as JSON-encoded
// arrays (e.g. "received") and others as plain strings (seen in the
// 2026-09-23 receiving test). Always hand back a single string.
function headerValue(headers, name) {
  if (!headers) return "";
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(" ");
  const s = String(v);
  if (s.startsWith("[") || s.startsWith("\"")) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map((x) => (typeof x === "string" ? x : x?.text || "")).join(" ");
      if (typeof parsed === "string") return parsed;
    } catch (e) { /* not JSON — use as-is */ }
  }
  return s;
}

function extractMessageIds(s) {
  return String(s || "").match(/<[^<>\s]+>/g) || [];
}

// Out-of-office and other automatic replies are stored but never count as a
// reply (spec §7.3).
const AUTO_SUBJECT_RE = /^\s*(auto(matic)?\s*(reply|response)|out of office|resposta autom[aá]tica|ausente|aus[eê]ncia|f[eé]rias|fora do escrit[oó]rio|abwesenheit|r[eé]ponse automatique)/i;
function isAutoReply(headers, subject) {
  const autoSubmitted = headerValue(headers, "auto-submitted").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  if (headerValue(headers, "x-autoreply") || headerValue(headers, "x-autorespond")) return true;
  if (/auto_reply|autoreply/i.test(headerValue(headers, "precedence"))) return true;
  return AUTO_SUBJECT_RE.test(String(subject || ""));
}

// A reply asking to be removed gets a *suggested* unsubscribe the user
// confirms — never automatic (spec §7.3).
const UNSUB_INTENT_RE = /\b(remover|remova|removam|retirar da lista|n[aã]o (quero|pretendo|desejo) (receber|ser contactad)|unsubscribe|opt[- ]?out)\b/i;
function looksLikeUnsubscribe(text) {
  return UNSUB_INTENT_RE.test(String(text || ""));
}

// Reply text with the quoted history cut off, for thread previews. Handles
// Gmail EN/PT ("On … wrote:" / "Em … escreveu:", sometimes wrapped over two
// lines), Outlook ("-----Original Message-----", "De: … Enviada:" / "From: … Sent:")
// and ">"-quoted blocks.
function stripQuoted(text) {
  const t = String(text || "").replace(/\r\n/g, "\n");
  const patterns = [
    /^On .{0,200}?wrote:\s*$/ms,
    /^Em .{0,200}?escreveu:\s*$/ms,
    /^-{2,}\s*(Original Message|Mensagem original)\s*-{2,}/mi,
    /^(De|From):\s.*\n(Enviad[ao]|Sent|Data|Date):/mi,
    /^_{8,}\s*$/m,
  ];
  let cut = t.length;
  for (const re of patterns) {
    const m = re.exec(t);
    if (m && m.index < cut) cut = m.index;
  }
  const lines = t.slice(0, cut).split("\n");
  // Drop a trailing run of ">" quoted lines and blank lines.
  while (lines.length && (/^\s*>/.test(lines[lines.length - 1]) || !lines[lines.length - 1].trim())) lines.pop();
  return lines.join("\n").trim();
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

function sanitizeFilename(name) {
  const cleaned = String(name || "attachment").normalize("NFKD").replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim();
  return (cleaned || "attachment").slice(0, 120);
}

function extensionOf(name) {
  const m = String(name || "").toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return m ? m[1] : "";
}

// Unsubscribe tokens carry only the message id (never the email address —
// no personal data in URLs) plus an HMAC so links can't be forged or guessed.
function makeUnsubToken(messageId, secret) {
  const sig = crypto.createHmac("sha256", secret).update(messageId).digest("base64url").slice(0, 32);
  return `${messageId}.${sig}`;
}

function verifyUnsubToken(token, secret) {
  const s = String(token || "");
  const dot = s.lastIndexOf(".");
  if (dot <= 0) return null;
  const messageId = s.slice(0, dot);
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(messageId)) return null;
  const expected = makeUnsubToken(messageId, secret);
  const a = Buffer.from(s), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? messageId : null;
}

// Resend signs webhooks with Svix: HMAC-SHA256 over "id.timestamp.body",
// key = base64 part of the "whsec_…" secret, header "v1,<sig> [v1,<sig2>…]".
function verifySvixSignature(rawBody, headers, secret, nowSec = Math.floor(Date.now() / 1000)) {
  const id = headers["svix-id"], ts = headers["svix-timestamp"], sigHeader = headers["svix-signature"];
  if (!id || !ts || !sigHeader || !secret) return false;
  const tsNum = parseInt(ts, 10);
  if (!Number.isFinite(tsNum) || Math.abs(nowSec - tsNum) > 300) return false; // reject stale/replayed (> 5 min)
  const key = Buffer.from(String(secret).replace(/^whsec_/, ""), "base64");
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "");
  const expected = Buffer.from(crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64"));
  return String(sigHeader).split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig);
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}

// Resend sends tags either as an object ({ om: "…" }) in webhooks or as
// [{ name, value }] elsewhere — accept both.
function tagValue(tags, name) {
  if (!tags) return null;
  if (Array.isArray(tags)) return tags.find((t) => t && t.name === name)?.value || null;
  return tags[name] || null;
}

module.exports = {
  parseAddress, normEmail, domainOf, localOf, isFreeMail, isValidEmail, isTestRecipient,
  utcDayKey, checkMx, headerValue, extractMessageIds, isAutoReply, looksLikeUnsubscribe,
  stripQuoted, htmlToText, escapeHtml, sanitizeFilename, extensionOf,
  makeUnsubToken, verifyUnsubToken, verifySvixSignature, tagValue,
};
