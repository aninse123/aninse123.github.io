// Unit tests for the Outreach module's pure helpers (functions/outreach/util.js
// and render.js). Run: npm test (from functions/)
const path = require("path").join(__dirname, "..", "outreach") + "/";
const crypto = require("crypto");
const u = require(path + "util.js");
const r = require(path + "render.js");
const cfg = require(path + "config.js");

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

(async () => {
console.log("=== addresses ===");
ok("parses name + address", JSON.stringify(u.parseAddress('"André Rocha" <Andre.Rocha@Gmail.com>')) === JSON.stringify({ name: "André Rocha", email: "andre.rocha@gmail.com" }));
ok("bare address lower-cased", u.normEmail("Geral@Empresa.PT") === "geral@empresa.pt");
ok("domainOf", u.domainOf("geral@metalurgica-silva.pt") === "metalurgica-silva.pt");
ok("free mail detected", u.isFreeMail("sapo.pt") && u.isFreeMail("GMAIL.com") && !u.isFreeMail("metalurgica-silva.pt"));
ok("valid email", u.isValidEmail("geral@empresa.pt") && !u.isValidEmail("geral@") && !u.isValidEmail("n.a."));

console.log("\n=== test-mode allow list ===");
const list = cfg.TEST_RECIPIENTS;
ok("approved gmail passes", u.isTestRecipient("AndreNoRocha@gmail.com", list));
ok("António's gmail passes", u.isTestRecipient("amobnc92@gmail.com", list));
ok("resend simulator with +label passes", u.isTestRecipient("bounced+v4@resend.dev", list));
ok("unknown resend.dev address refused", !u.isTestRecipient("random@resend.dev", list));
ok("real company refused", !u.isTestRecipient("geral@empresa.pt", list));
ok("plus-label on gmail NOT accepted (only resend.dev)", !u.isTestRecipient("andrenorocha+x@gmail.com", list));

console.log("\n=== MX check (fake resolver) ===");
ok("records -> ok", (await u.checkMx("x.pt", async () => [{ exchange: "mx", priority: 10 }])).ok === true);
ok("ENOTFOUND -> no_mx", (await u.checkMx("x.pt", async () => { const e = new Error(); e.code = "ENOTFOUND"; throw e; })).reason === "no_mx");
ok("empty -> no_mx", (await u.checkMx("x.pt", async () => [])).reason === "no_mx");
ok("timeout -> dns_error", (await u.checkMx("x.pt", async () => { const e = new Error(); e.code = "ETIMEOUT"; throw e; })).reason === "dns_error");

console.log("\n=== headers as returned by Resend (from the 2026-09-23 test payload) ===");
const hdrs = {
  "references": "<CAKHxw=iw3WUAtVv7mkwGbgt_S27sTkRCPnttHE2Q=o46ZFN6OA@mail.gmail.com>",
  "in-reply-to": "<CAKHxw=iw3WUAtVv7mkwGbgt_S27sTkRCPnttHE2Q=o46ZFN6OA@mail.gmail.com>",
  "received": "[\"from mail9.mxsw1.infra.improvmx.com ...\",\"from mail-wm2-x11.google.com ...\"]",
  "from": "\"André Rocha\" <andrenorocha@gmail.com>",
  "to": "an.rocha@mail.douropartners-team.pt",
};
ok("plain header returned as-is", u.headerValue(hdrs, "in-reply-to").startsWith("<CAKHxw"));
ok("JSON-array header joined", u.headerValue(hdrs, "received").includes("improvmx") && !u.headerValue(hdrs, "received").startsWith("["));
ok("quoted From header parsed", u.parseAddress(u.headerValue(hdrs, "from")).email === "andrenorocha@gmail.com");
ok("message ids extracted", u.extractMessageIds(hdrs.references).length === 1);
ok("missing header -> ''", u.headerValue(hdrs, "x-nothing") === "");

console.log("\n=== auto-replies and unsubscribe intent ===");
ok("Auto-Submitted: auto-replied", u.isAutoReply({ "auto-submitted": "auto-replied" }, "Re: x"));
ok("Auto-Submitted: no is not auto", !u.isAutoReply({ "auto-submitted": "no" }, "Re: Search funds"));
ok("PT out-of-office subject", u.isAutoReply({}, "Resposta automática: Search funds em Portugal"));
ok("Ausência subject", u.isAutoReply({}, "Ausência do escritório"));
ok("normal reply not auto", !u.isAutoReply({}, "Re: Search funds em Portugal"));
ok("'remover' detected", u.looksLikeUnsubscribe("Por favor remover o nosso contacto."));
ok("'não quero receber' detected", u.looksLikeUnsubscribe("Não quero receber mais emails"));
ok("normal text not flagged", !u.looksLikeUnsubscribe("Claro, gostava de perceber melhor. Quinta-feira às 10h funciona?"));

console.log("\n=== quote stripping ===");
const gmailEn = "Olá André,\n\nClaro, gostava de perceber melhor. Quinta-feira às 10h funciona?\n\nAbraço,\nAndré\n\nOn Wed, 23 Sept 2026 at 18:43, Andre Rocha <andrerochaaero@gmail.com> wrote:\n\n> Olá André,\n>\n> Um search fund é...";
ok("Gmail EN (real test reply) stripped", u.stripQuoted(gmailEn).endsWith("Abraço,\nAndré") && !u.stripQuoted(gmailEn).includes("wrote"));
const gmailPtWrapped = "Obrigado, não temos interesse.\n\nEm qua., 23/09/2026 às 18:43, André Rocha <\nan.rocha@mail.douropartners-team.pt> escreveu:\n\n> Olá";
ok("Gmail PT wrapped over two lines stripped", u.stripQuoted(gmailPtWrapped) === "Obrigado, não temos interesse.");
const outlookPt = "Boa tarde,\nPodemos falar.\n\nDe: André Rocha <an.rocha@mail.douropartners-team.pt>\nEnviada: 23 de setembro de 2026 18:43\nPara: geral@empresa.pt";
ok("Outlook PT header block stripped", u.stripQuoted(outlookPt) === "Boa tarde,\nPodemos falar.");
ok("text without quote unchanged", u.stripQuoted("Só isto.") === "Só isto.");

console.log("\n=== unsubscribe tokens ===");
const secret = "test-secret";
const tok = u.makeUnsubToken("AbCdEf0123456789", secret);
ok("round-trips", u.verifyUnsubToken(tok, secret) === "AbCdEf0123456789");
ok("tampered id rejected", u.verifyUnsubToken(tok.replace("AbCd", "XbCd"), secret) === null);
ok("wrong secret rejected", u.verifyUnsubToken(tok, "other") === null);
ok("garbage rejected", u.verifyUnsubToken("nonsense", secret) === null);
ok("token holds no email address", !tok.includes("@"));

console.log("\n=== Svix signature ===");
const whsec = "whsec_" + Buffer.from("super-secret-key-bytes").toString("base64");
const body = JSON.stringify({ type: "email.delivered", data: { email_id: "x" } });
const id = "msg_2abc", ts = String(Math.floor(Date.now() / 1000));
const sig = crypto.createHmac("sha256", Buffer.from("super-secret-key-bytes")).update(`${id}.${ts}.${body}`).digest("base64");
const H = (s, t = ts) => ({ "svix-id": id, "svix-timestamp": t, "svix-signature": s });
ok("valid signature accepted", u.verifySvixSignature(Buffer.from(body), H(`v1,${sig}`), whsec));
ok("accepted when one of several signatures matches", u.verifySvixSignature(Buffer.from(body), H(`v1,AAAA v1,${sig}`), whsec));
ok("tampered body rejected", !u.verifySvixSignature(Buffer.from(body + " "), H(`v1,${sig}`), whsec));
ok("stale timestamp rejected", !u.verifySvixSignature(Buffer.from(body), H(`v1,${sig}`, String(Number(ts) - 600)), whsec));
ok("missing headers rejected", !u.verifySvixSignature(Buffer.from(body), {}, whsec));

console.log("\n=== tags ===");
ok("object tags", u.tagValue({ om: "abc" }, "om") === "abc");
ok("array tags", u.tagValue([{ name: "om", value: "abc" }], "om") === "abc");
ok("no tags", u.tagValue(undefined, "om") === null);

console.log("\n=== rendering ===");
ok("short name strips Lda", r.shortCompanyName("Metalúrgica Silva, Lda.") === "Metalúrgica Silva");
ok("short name strips Unipessoal Lda", r.shortCompanyName("Transportes Costa Unipessoal Lda") === "Transportes Costa");
ok("short name strips S.A.", r.shortCompanyName("Vinhos do Douro S.A.") === "Vinhos do Douro");
ok("short name keeps plain names", r.shortCompanyName("Padaria Central") === "Padaria Central");
// Real Orbis names from the Search CRM list (2026-09-25).
ok("brand before ' - ', normal case", r.shortCompanyName("DIMEXA - DISTRIBUICAO, IMPORTACAO E EXPORTACAO, LDA") === "Dimexa");
ok("single short all-caps word kept as acronym", r.shortCompanyName("SUE - SPORTS UNIFIED EUROPE, UNIPESSOAL, LDA") === "SUE");
ok("all-caps name title-cased, & kept", r.shortCompanyName("ANTONIO SARAIVA & FILHOS, LDA") === "Antonio Saraiva & Filhos");
ok("Unipessoal Lda stripped + title case", r.shortCompanyName("PORLABOFAR COMERCIAL, UNIPESSOAL, LDA") === "Porlabofar Comercial");
ok("brand before dash (long word)", r.shortCompanyName("TIMESTAMP - IT MANAGEMENT SOLUTIONS, LDA") === "Timestamp");
ok("PT connectors stay lower case", r.shortCompanyName("CASA DE PASTO DO ZE, LDA") === "Casa de Pasto do Ze");
ok("hyphenated word without spaces kept together", r.shortCompanyName("BRAGA-SUL COMERCIO, S.A.") === "Braga-Sul Comercio");
ok("mixed-case names untouched", r.shortCompanyName("Vinhos do Douro S.A.") === "Vinhos do Douro");
const ctx = r.buildContext({ company: { name: "Metalúrgica Silva, Lda.", concelho: "Braga", sector: "Metalurgia" }, sender: { displayName: "André Rocha", signature: "André Rocha\nDouro Partners" }, unsubscribeUrl: "https://douropartners.pt/u/abc.def" });
const t1 = r.renderTemplate("Olá {{contact.firstName|equipa da}} {{company.shortName}}, em {{company.city}}", ctx);
ok("fallback + variables render", t1.text === "Olá equipa da Metalúrgica Silva, em Braga" && t1.missing.length === 0);
const t2 = r.renderTemplate("CAE {{company.cae}}", ctx);
ok("empty variable without fallback reported missing", t2.missing.includes("company.cae"));
const t3 = r.renderTemplate("{{company.nope}}", ctx);
ok("unknown variable reported missing", t3.missing.includes("company.nope"));
ok("reply subject adds Re:", r.replySubject("Search funds") === "Re: Search funds");
ok("reply subject keeps existing Re:", r.replySubject("RE: Search funds") === "RE: Search funds");

const email = r.buildPlainEmail({ bodyText: "Olá,\n\nPrimeiro parágrafo.\n\nSegundo <b>não é HTML</b>.", signature: "André Rocha\nDouro Partners", footerText: "Remover: https://douropartners.pt/u/abc.def", unsubscribeUrl: "https://douropartners.pt/u/abc.def" });
ok("text part has body, signature and footer", email.text.includes("Primeiro parágrafo.") && email.text.includes("André Rocha\nDouro Partners") && email.text.includes("--\nRemover:"));
ok("HTML escapes user text", email.html.includes("&lt;b&gt;não é HTML&lt;/b&gt;") && !email.html.includes("<b>não"));
ok("HTML has no images", !/<img/i.test(email.html));
ok("unsubscribe URL linked in HTML footer", email.html.includes('<a href="https://douropartners.pt/u/abc.def"'));

console.log("\n=== reply quoting ===");
const qh = r.quoteHeader(new Date("2026-09-24T16:38:00Z"), "André Rocha", "andrenorocha@gmail.com");
ok("PT attribution line in Lisbon time", qh === "Em qui., 24/09/2026 às 17:38, André Rocha <andrenorocha@gmail.com> escreveu:");
ok("winter time handled (UTC+0)", r.quoteHeader(new Date("2026-12-03T10:05:00Z"), "", "x@y.pt") === "Em qui., 03/12/2026 às 10:05, <x@y.pt> escreveu:");
const q = r.buildQuote({ date: new Date("2026-09-24T16:38:00Z"), fromName: "André Rocha", fromEmail: "andrenorocha@gmail.com", text: "Recebido.\n\nOn Wed wrote:\n> Olá" });
const withQ = r.buildPlainEmail({ bodyText: "Sexta está ótimo.", signature: "André Rocha", footerText: "Remover: https://douropartners.pt/u/x.y", unsubscribeUrl: "https://douropartners.pt/u/x.y", quote: q });
ok("text: body, signature, quote, then footer last", withQ.text.startsWith("Sexta está ótimo.\n\nAndré Rocha\n\nEm qui., 24/09/2026 às 17:38") && withQ.text.includes("escreveu:\n> Recebido.\n> \n> On Wed wrote:\n>> Olá\n\n--\nRemover:"));
ok("html: blockquote before footer", withQ.html.indexOf("<blockquote") > 0 && withQ.html.indexOf("<blockquote") < withQ.html.indexOf("font-size:11px"));
ok("long quote capped", r.buildQuote({ date: new Date(), fromName: "", fromEmail: "a@b.pt", text: "linha\n".repeat(3000) }).text.endsWith("[…]"));
ok("empty quote -> null", r.buildQuote({ date: new Date(), fromEmail: "a@b.pt", text: "  " }) === null);

// Phase 3a — email name
ok("email name: typed name wins", r.emailNameOf({ emailName: " Silva & Filhos ", akaName: "SILVA", name: "METALURGICA SILVA, LDA" }) === "Silva & Filhos");
ok("email name: Orbis 'also known as' next, cleaned", r.emailNameOf({ akaName: "TEXTEIS DO NORTE, S.A.; TN", name: "TN - TEXTEIS DO NORTE E COMERCIO, S.A." }) === "Texteis do Norte");
ok("email name: '-' / n.a. ignored, legal name used", r.emailNameOf({ akaName: "n.a.", name: "DIMEXA - DISTRIBUICAO, LDA" }) === "Dimexa" && r.emailNameOf({ akaName: "-", name: "SUE, LDA" }) === "SUE");
ok("email name feeds {{company.shortName}}", r.buildContext({ company: { emailName: "Farmácia Sá da Bandeira", name: "FARMACIA SA DA BANDEIRA, S.A." } }).company.shortName === "Farmácia Sá da Bandeira");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASSED");
process.exit(fail ? 1 : 0);
})();
