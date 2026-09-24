// Outreach module — building the email body (spec §7.1–7.2).
//
// Three layers, kept apart on purpose: the *layout* (how a body is built —
// code, here), the *content* (template subject/body — Firestore) and the
// *compliance block* (legal footer — Firestore, injected by the layout, so no
// template can be sent without one).

const { escapeHtml } = require("./util");

const LEGAL_SUFFIX_RE = /[\s,]*(,?\s*(unipessoal|sociedade unipessoal)?\s*,?\s*(lda\.?|limitada|s\.?\s?a\.?|sgps|s\.?\s?g\.?\s?p\.?\s?s\.?|crl|ace)\.?)+\s*$/i;

function shortCompanyName(name) {
  const n = String(name || "").trim();
  const stripped = n.replace(LEGAL_SUFFIX_RE, "").replace(/[\s,-]+$/, "").trim();
  return stripped || n;
}

function firstName(full) {
  return String(full || "").trim().split(/\s+/)[0] || "";
}

// Variables a template may use, resolved from the company, contact and sender.
function buildContext({ company = {}, contactName = "", sender = {}, unsubscribeUrl = "" }) {
  return {
    company: {
      name: company.name || "",
      shortName: shortCompanyName(company.name),
      city: company.city || company.concelho || "",
      sector: company.sector || "",
      cae: company.caeDescription || company.caeCode || "",
    },
    contact: { firstName: firstName(contactName) },
    sender: { firstName: firstName(sender.displayName), signature: sender.signature || "" },
    unsubscribeUrl,
  };
}

// {{company.name}} or {{contact.firstName|Olá}} (fallback after the pipe).
// Returns the rendered text plus the variables that resolved to empty with no
// fallback — the send is refused if any are missing (spec §7.2).
function renderTemplate(str, ctx) {
  const missing = [];
  const text = String(str || "").replace(/\{\{\s*([\w.]+)\s*(?:\|([^}]*))?\}\}/g, (all, path, fallback) => {
    const value = path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), ctx);
    if (value != null && String(value).trim() !== "") return String(value);
    if (fallback != null) return fallback.trim();
    missing.push(path);
    return "";
  });
  return { text, missing: [...new Set(missing)] };
}

const TEST_FOOTER = "[TESTE] Rodapé legal ainda por configurar. Remover: {{unsubscribeUrl}}";

// The "plain" layout: text first, and an HTML part that mirrors it exactly —
// no images, colours or banner, which is what reads as a personal email.
function buildPlainEmail({ bodyText, signature, footerText, unsubscribeUrl }) {
  const body = String(bodyText || "").trim();
  const sig = String(signature || "").trim();
  const footer = String(footerText || "").trim();

  const textParts = [body];
  if (sig) textParts.push(sig);
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
    footer ? `<p style="margin:24px 0 0;font-size:11px;line-height:1.4;color:#888;">${linkify(para(footer))}</p>` : "",
    "</div></body></html>",
  ].join("");

  return { text, html };
}

function replySubject(subject) {
  const s = String(subject || "").trim();
  return /^(re|res|ref)\s*:/i.test(s) ? s : `Re: ${s}`;
}

module.exports = { shortCompanyName, firstName, buildContext, renderTemplate, buildPlainEmail, replySubject, TEST_FOOTER };
