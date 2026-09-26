// Outreach module — building the email body (spec §7.1–7.2).
//
// Three layers, kept apart on purpose: the *layout* (how a body is built —
// code, here), the *content* (template subject/body — Firestore) and the
// *compliance block* (legal footer — Firestore, injected by the layout, so no
// template can be sent without one).

const { escapeHtml } = require("./util");

const LEGAL_SUFFIX_RE = /[\s,]*(,?\s*(unipessoal|sociedade unipessoal)?\s*,?\s*(lda\.?|limitada|s\.?\s?a\.?|sgps|s\.?\s?g\.?\s?p\.?\s?s\.?|crl|ace)\.?)+\s*$/i;

const PT_SMALL_WORDS = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "em", "para", "com"]);

// "DIMEXA - DISTRIBUICAO, IMPORTACAO E EXPORTACAO" → "Dimexa". Words are
// capitalised, Portuguese connectors stay lower case, hyphenated parts are
// each capitalised.
function titleCasePt(s) {
  return s.toLowerCase().split(/(\s+)/).map((w, i) => {
    if (!w.trim()) return w;
    if (i > 0 && PT_SMALL_WORDS.has(w)) return w;
    return w.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("-");
  }).join("");
}

// How the company is named inside an email: legal suffix dropped, only the
// brand before " - " (Orbis names are often "BRAND - DESCRIPTION, LDA"), and
// all-capitals names in normal case — except a single short word, which is
// usually an acronym (SUE, TAP, EDP).
function shortCompanyName(name) {
  const n = String(name || "").trim();
  let s = n.replace(LEGAL_SUFFIX_RE, "").replace(/[\s,-]+$/, "").trim() || n;
  const brand = s.split(/\s+[-–—]\s+/)[0].trim();
  if (brand.length >= 2) s = brand;
  if (s === s.toUpperCase() && /\p{Lu}/u.test(s) && !(/^\S+$/.test(s) && s.replace(/[^\p{L}]/gu, "").length <= 4)) s = titleCasePt(s);
  return s;
}

// The name used inside emails, {{company.shortName}} (Phase 3a, Q16): the
// "email name" typed in the Search CRM, else Orbis "Also known as" (first
// one, cleaned like the legal name), else the short form of the legal name.
function emailNameOf(company = {}) {
  const typed = String(company.emailName || "").trim();
  if (typed) return typed;
  const aka = String(company.akaName || "").split(/[;\n|]/)[0].trim();
  if (aka && aka !== "-" && !/^n\.?a\.?$/i.test(aka)) return shortCompanyName(aka);
  return shortCompanyName(company.name);
}

function firstName(full) {
  return String(full || "").trim().split(/\s+/)[0] || "";
}

// Variables a template may use, resolved from the company, contact and sender.
function buildContext({ company = {}, contactName = "", sender = {}, unsubscribeUrl = "", aiOpener = "" }) {
  return {
    company: {
      name: company.name || "",
      shortName: emailNameOf(company),
      city: company.city || company.concelho || "",
      sector: company.sector || "",
      cae: company.caeDescription || company.caeCode || "",
    },
    contact: { firstName: firstName(contactName) },
    sender: { firstName: firstName(sender.displayName), signature: sender.signature || "" },
    unsubscribeUrl,
    ai: { opener: aiOpener || "" }, // Phase 4 — written per company, only in approval steps
  };
}

// {{company.name}} or {{contact.firstName|Olá}} (fallback after the pipe).
// Returns the rendered text plus the variables that resolved to empty with no
// fallback — the send is refused if any are missing (spec §7.2).
// A fallback may itself contain fields — {{ai.opener|Escrevo-lhe sobre a
// {{company.shortName}}.}} — so fields are matched with nesting, not a regex.
function scanTemplate(str, onField) {
  const s = String(str || "");
  let out = "", i = 0;
  while (i < s.length) {
    const open = s.indexOf("{{", i);
    if (open < 0) { out += s.slice(i); break; }
    let depth = 0, j = open, close = -1;
    while (j < s.length) {
      if (s.startsWith("{{", j)) { depth++; j += 2; continue; }
      if (s.startsWith("}}", j)) { depth--; if (depth === 0) { close = j; break; } j += 2; continue; }
      j++;
    }
    if (close < 0) { out += s.slice(i); break; }
    out += s.slice(i, open);
    const m = /^\s*([\w.]+)\s*(?:\|([\s\S]*))?$/.exec(s.slice(open + 2, close));
    out += m ? onField(m[1], m[2] == null ? null : m[2].trim()) : s.slice(open, close + 2);
    i = close + 2;
  }
  return out;
}

function renderTemplate(str, ctx) {
  const missing = [];
  const render = (src) => scanTemplate(src, (path, fallback) => {
    const value = path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), ctx);
    if (value != null && String(value).trim() !== "") return String(value);
    if (fallback != null) return render(fallback);
    missing.push(path);
    return "";
  });
  const text = render(str);
  return { text, missing: [...new Set(missing)] };
}

const TEST_FOOTER = "[TESTE] Rodapé legal ainda por configurar. Remover: {{unsubscribeUrl}}";

const PT_WEEKDAYS = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];
const MAX_QUOTE_CHARS = 6000;

// "Em qui., 24/09/2026 às 17:38, André Rocha <x@y.pt> escreveu:" — Gmail's
// Portuguese attribution line, in Lisbon time.
function quoteHeader(date, fromName, fromEmail) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const wd = PT_WEEKDAYS[["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday)] || "";
  const who = fromName ? `${fromName} <${fromEmail}>` : `<${fromEmail}>`;
  return `Em ${wd}, ${parts.day}/${parts.month}/${parts.year} às ${parts.hour}:${parts.minute}, ${who} escreveu:`;
}

// The message being replied to, quoted the usual way (it already carries the
// earlier chain). Capped so a long thread can't bloat the email.
function buildQuote({ date, fromName, fromEmail, text }) {
  let t = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!t) return null;
  if (t.length > MAX_QUOTE_CHARS) t = t.slice(0, MAX_QUOTE_CHARS).replace(/\n[^\n]*$/, "") + "\n[…]";
  return { header: quoteHeader(date, fromName, fromEmail), text: t };
}

// The "plain" layout: text first, and an HTML part that mirrors it exactly —
// no images, colours or banner, which is what reads as a personal email.
// A reply quotes the previous message below the signature; the legal footer
// stays at the very bottom.
function buildPlainEmail({ bodyText, signature, footerText, unsubscribeUrl, quote = null }) {
  const body = String(bodyText || "").trim();
  const sig = String(signature || "").trim();
  const footer = String(footerText || "").trim();

  const textParts = [body];
  if (sig) textParts.push(sig);
  if (quote) textParts.push(quote.header + "\n" + quote.text.split("\n").map((l) => (l.startsWith(">") ? ">" + l : "> " + l)).join("\n"));
  if (footer) textParts.push("--\n" + footer);
  const text = textParts.join("\n\n") + "\n";

  const para = (s) => escapeHtml(s).replace(/\n/g, "<br>");
  const linkify = (html) => (unsubscribeUrl
    ? html.split(escapeHtml(unsubscribeUrl)).join(`<a href="${escapeHtml(unsubscribeUrl)}" style="color:#888;">${escapeHtml(unsubscribeUrl)}</a>`)
    : html);
  const html = [
    "<!DOCTYPE html><html><body style=\"margin:0;padding:0;\">",
    "<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222;\">",
    body.split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px;">${para(p)}</p>`).join(""),
    sig ? `<p style="margin:16px 0 0;">${para(sig)}</p>` : "",
    quote ? `<div style="margin:20px 0 0;"><div style="color:#555;">${escapeHtml(quote.header)}</div><blockquote style="margin:6px 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex;color:#555;">${para(quote.text)}</blockquote></div>` : "",
    footer ? `<p style="margin:24px 0 0;font-size:11px;line-height:1.4;color:#888;">${linkify(para(footer))}</p>` : "",
    "</div></body></html>",
  ].join("");

  return { text, html };
}

function replySubject(subject) {
  const s = String(subject || "").trim();
  return /^(re|res|ref)\s*:/i.test(s) ? s : `Re: ${s}`;
}

module.exports = { shortCompanyName, emailNameOf, firstName, buildContext, renderTemplate, buildPlainEmail, buildQuote, quoteHeader, replySubject, TEST_FOOTER };
