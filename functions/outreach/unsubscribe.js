// outreachUnsubscribe — douropartners.pt/u/<token> (Netlify rewrite).
//
// GET never unsubscribes: company security scanners open every link in an
// email, so a GET only shows a confirm button. The actual opt-out is a POST —
// either that button, or the mail client's one-click unsubscribe (RFC 8058,
// body "List-Unsubscribe=One-Click"). Both feed the suppression list (spec §10).

const { onRequest } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { REGION, UNSUBSCRIBE_SECRET } = require("./config");
const { verifyUnsubToken, normEmail, escapeHtml } = require("./util");
const store = require("./store");
const { stopCompanyEnrolments } = require("./campaigns");

const { db, FieldValue } = store;

function page(title, bodyHtml) {
  return `<!DOCTYPE html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)} — Douro Partners</title>
<style>body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f6f6f4;color:#222}
main{max-width:480px;margin:12vh auto;padding:32px 28px;background:#fff;border:1px solid #e4e3de;border-radius:8px}
h1{font-size:20px;margin:0 0 12px}p{font-size:15px;line-height:1.5;margin:0 0 16px}
button{font:inherit;font-size:15px;padding:10px 18px;border:0;border-radius:6px;background:#1f3b57;color:#fff;cursor:pointer}
button:focus-visible{outline:3px solid #9cc3e6;outline-offset:2px}small{color:#777}</style></head>
<body><main>${bodyHtml}</main></body></html>`;
}

exports.outreachUnsubscribe = onRequest({ region: REGION, secrets: [UNSUBSCRIBE_SECRET] }, async (req, res) => {
  res.set("Cache-Control", "no-store");
  const token = decodeURIComponent(String(req.path || "").split("/").filter(Boolean).pop() || "");
  const messageId = verifyUnsubToken(token, UNSUBSCRIBE_SECRET.value());
  if (!messageId) {
    res.status(400).send(page("Link inválido", "<h1>Link inválido</h1><p>Este link de remoção não é válido. Pode responder ao email com a palavra \"remover\".</p>"));
    return;
  }

  if (req.method === "GET") {
    res.status(200).send(page("Remover contacto", `<h1>Deixar de receber emails</h1>
<p>Confirme que não pretende receber mais emails da Douro Partners neste endereço.</p>
<form method="POST"><button type="submit">Confirmar remoção</button></form>`));
    return;
  }
  if (req.method !== "POST") { res.status(405).send("Method not allowed"); return; }

  try {
    const msgSnap = await db().doc(`outreachMessages/${messageId}`).get();
    if (!msgSnap.exists) throw new Error("message not found");
    const msg = msgSnap.data();
    const email = normEmail((msg.to || [])[0]);
    const thread = msg.threadId ? (await db().doc(`outreachThreads/${msg.threadId}`).get()).data() : null;
    const oneClick = /List-Unsubscribe=One-Click/i.test(typeof req.rawBody === "object" ? req.rawBody.toString("utf8") : String(req.body || ""));

    await store.addSuppression(email, { reason: "unsubscribed", source: oneClick ? "one_click" : "link", companyId: thread?.companyId || null, by: "recipient" });
    if (msg.threadId) await db().doc(`outreachThreads/${msg.threadId}`).update({ status: "closed", unsubscribedAt: FieldValue.serverTimestamp() });
    await store.setCompanyOutreachStatus(thread?.companyId || null, "unsubscribed", !!msg.isTest);
    await stopCompanyEnrolments(thread?.companyId || null, "Unsubscribed");

    res.status(200).send(page("Removido", "<h1>Pedido registado</h1><p>Não voltará a receber emails nossos neste endereço.</p><p><small>Douro Partners</small></p>"));
  } catch (e) {
    logger.error("outreachUnsubscribe failed", { messageId, message: e.message });
    res.status(500).send(page("Erro", "<h1>Não foi possível concluir</h1><p>Tente novamente mais tarde, ou responda ao email com a palavra \"remover\".</p>"));
  }
});
