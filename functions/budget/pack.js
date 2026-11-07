// Budget v2, Stage 5b — sending the accountant pack as a link and a code.
//
//   budgetPackLink (callable, budget.edit, switch budget.packLink)
//       send   { packId, recipients[], codeMode: "email"|"screen", lang?: "pt"|"en", origin? }
//              builds the zip (the pack's Excel, which the page uploaded to budget-packs/<id>/pack.xlsx, plus its receipts), stores the
//              hashes of a fresh token and code, emails the link (and the code, separately, unless codeMode is "screen")
//       revoke { packId }  the link stops working at once and the zip is deleted
//   budgetPackDownload (public, <site>/p/<packId>/<token>, a Netlify rewrite like /u/*)
//       GET   → a small page asking for the 6-digit code (nothing about the pack is shown until the token is right)
//       POST  → with the right code, the zip; wrong codes count and lock the link after 5
//
// Secrets live only as salted hashes in budgetPackSecrets (no browser can read it); the non-secret state (expiry, recipients, downloads,
// revoked, locked) is in budgetPackLinks, which the budget page may read but never write.
// On the staging site a pack can only be sent to team addresses (the rule for every test send).

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const P = require("../access/perms");
const F = require("../features");
const { sendEmail } = require("../outreach/resend");
const { RESEND_READ_KEY, REGION } = require("../outreach/config");
const { buildOutreachHtml } = require("../outreach/branded");
const { escapeHtml } = require("../outreach/util");
const U = require("./pack_util");

const db = () => getFirestore();
const bucket = () => getStorage().bucket();
const fail = (code, reason, message) => { throw new HttpsError(code, message, { reason }); };
const xlsxPath = (id) => `budget-packs/${id}/pack.xlsx`;
const zipPath = (id) => `budget-packs/${id}/pack.zip`;

async function isTeamAddress(email) {
  try { return (await db().doc(`team/${email}`).get()).exists; } catch (e) { return false; }
}

// ── send ──
async function sendPack(data, by, request) {
  await F.requireFeature(request, "budget.v2", "budget.packLink");
  await P.loadIdentity();
  const I = P.identity();
  if (!I.noreplyFrom || !I.portalOrigins.length) fail("failed-precondition", "not_configured", "The portal's sender address and web address are not set up yet (instance settings).");
  const packId = String(data.packId || "");
  if (!/^[A-Za-z0-9]{10,40}$/.test(packId)) fail("invalid-argument", "bad_pack", "Choose a pack.");
  const snap = await db().doc(`budgetPacks/${packId}`).get();
  if (!snap.exists) fail("not-found", "no_pack", "That pack does not exist.");
  const pack = snap.data();
  if (pack.status !== "created") fail("failed-precondition", "pack_undone", "This pack was undone: create it again first.");

  const { list: recipients, bad, tooMany } = U.cleanRecipients(data.recipients);
  if (bad.length) fail("invalid-argument", "bad_recipient", `Not an email address: ${bad[0]}`);
  if (!recipients.length) fail("invalid-argument", "no_recipient", "Add the accountant's email address.");
  if (tooMany) fail("invalid-argument", "too_many_recipients", `At most ${U.LIMITS.maxRecipients} addresses.`);
  if (F.siteOf(request) === "staging") {
    for (const r of recipients) if (!(await isTeamAddress(r))) fail("failed-precondition", "staging_team_only", `On the staging site a pack can only be sent to team addresses (${r} is not one).`);
  }
  const codeMode = data.codeMode === "screen" ? "screen" : "email";
  const lang = data.lang === "en" ? "en" : "pt";

  // What goes in the zip: the Excel the page uploaded, and the receipts the pack's items own.
  let xlsx;
  try { [xlsx] = await bucket().file(xlsxPath(packId)).download(); } catch (e) { fail("failed-precondition", "no_xlsx", "The pack's Excel file is not uploaded yet. Try again."); }
  const refs = (pack.itemIds || []).map((id) => db().doc(`budgetItems/${id}`));
  const items = [];
  for (let i = 0; i < refs.length; i += 300) items.push(...(await db().getAll(...refs.slice(i, i + 300))));
  const allowed = new Set();
  for (const it of items) if (it.exists) for (const a of it.data().attachments || []) if (a && a.filename) allowed.add(`budget/${a.filename}`);
  const entries = [{ name: `Accountant-pack-${pack.from}_${pack.to}.xlsx`, data: xlsx }];
  const skipped = [];
  let bytes = xlsx.length;
  for (const f of pack.files || []) {
    const path = String((f && f.storagePath) || "");
    if (!allowed.has(path)) { skipped.push({ name: f && f.name, why: "not one of this pack's receipts" }); continue; }
    let buf;
    try { [buf] = await bucket().file(path).download(); } catch (e) { skipped.push({ name: f.name, why: "the file is no longer stored" }); continue; }
    bytes += buf.length;
    if (bytes > U.LIMITS.maxBytes) fail("failed-precondition", "pack_too_large", `This pack is larger than ${Math.round(U.LIMITS.maxBytes / 1048576)} MB with its receipts. Create it for a shorter period (for example half a month).`);
    entries.push({ name: `receipts/${U.safeEntryName(f.name)}`, data: buf });
  }
  if (skipped.length) entries.push({ name: "README.txt", data: Buffer.from(`Some receipts could not be included:\n\n${skipped.map((s) => `- ${s.name || "?"}: ${s.why}`).join("\n")}\n`, "utf8") });
  const zip = U.zipStored(entries);
  await bucket().file(zipPath(packId)).save(zip, { contentType: "application/zip", resumable: false });

  // A fresh token and code replace any earlier ones (the old link stops working).
  const sec = U.newSecret(), expiresMs = Date.now() + U.LIMITS.days * 86400000;
  await db().doc(`budgetPackSecrets/${packId}`).set({ tokenHash: U.hashSecret(sec.token, sec.salt), codeHash: U.hashSecret(sec.code, sec.salt), salt: sec.salt, createdAt: FieldValue.serverTimestamp() });
  await db().doc(`budgetPackLinks/${packId}`).set({
    packId, from: pack.from, to: pack.to, createdBy: by, createdAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(expiresMs), recipients, codeMode, lang,
    zipBytes: zip.length, fileCount: entries.filter((e) => e.name.startsWith("receipts/")).length, skipped: skipped.length, revoked: false, locked: false, attempts: 0, downloads: 0, lastDownloadAt: null, log: [], emailed: false,
  });

  const reqOrigin = request && request.rawRequest && request.rawRequest.headers ? request.rawRequest.headers.origin : "";   // the site the person is on (staging links stay on staging)
  const base = I.portalOrigins.includes(reqOrigin) ? reqOrigin : I.portalOrigins.includes(data.origin) ? data.origin : I.portalOrigins[0];
  const url = `${base}/p/${packId}/${sec.token}`;
  try {
    const m1 = U.linkEmail({ lang, org: I.orgName, from: pack.from, to: pack.to, url, expiresAtMs: expiresMs, by, codeMode });
    await sendEmail(RESEND_READ_KEY.value(), { from: I.noreplyFrom, to: recipients, reply_to: by, subject: m1.subject, text: m1.message, html: buildOutreachHtml({ message: m1.message }) });
    if (codeMode === "email") {
      const m2 = U.codeEmail({ lang, org: I.orgName, from: pack.from, to: pack.to, code: sec.code });
      await sendEmail(RESEND_READ_KEY.value(), { from: I.noreplyFrom, to: recipients, reply_to: by, subject: m2.subject, text: m2.message, html: buildOutreachHtml({ message: m2.message }) });
    }
  } catch (e) {
    // The mail did not go out: nobody has the link, so close it rather than leave a live link nobody knows about.
    await db().doc(`budgetPackLinks/${packId}`).update({ revoked: true, revokedAt: FieldValue.serverTimestamp(), revokedBy: "system", emailError: String(e.message || e).slice(0, 200) });
    try { await bucket().file(zipPath(packId)).delete(); } catch (e2) { /* nothing to remove */ }
    logger.error("budgetPackLink: email failed", { packId, message: e.message });
    fail("unavailable", "email_failed", `The email could not be sent (${e.message || "unknown error"}). Nothing was shared; try again.`);
  }
  await db().doc(`budgetPackLinks/${packId}`).update({ emailed: true, sentAt: FieldValue.serverTimestamp() });
  logger.info("budgetPackLink: sent", { packId, by, recipients: recipients.length, codeMode });
  return { sent: true, url, expiresAt: expiresMs, codeMode, recipients, bytes: zip.length, skipped: skipped.length, code: codeMode === "screen" ? sec.code : undefined };
}

// ── revoke ──
async function revokePack(data, by) {
  const packId = String(data.packId || "");
  if (!/^[A-Za-z0-9]{10,40}$/.test(packId)) fail("invalid-argument", "bad_pack", "Choose a pack.");
  const ref = db().doc(`budgetPackLinks/${packId}`), snap = await ref.get();
  if (!snap.exists) fail("not-found", "no_link", "This pack has no link.");
  await ref.update({ revoked: true, revokedAt: FieldValue.serverTimestamp(), revokedBy: by });
  try { await bucket().file(zipPath(packId)).delete(); } catch (e) { /* already gone */ }
  logger.info("budgetPackLink: revoked", { packId, by });
  return { revoked: true };
}

exports.budgetPackLink = onCall({ region: REGION, secrets: [RESEND_READ_KEY] }, async (request) => {
  const by = P.requirePerm(request, "budget.edit", "You need permission to edit the budget.");
  const data = request.data || {};
  switch (data.action) {
    case "send": return sendPack(data, by, request);
    case "revoke": return revokePack(data, by);
    default: fail("invalid-argument", "bad_action", `Unknown action "${data.action}".`);
  }
});

// ── the public page ──
function page(title, bodyHtml, org) {
  return `<!DOCTYPE html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)} — ${escapeHtml(org)}</title>
<style>body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f6f6f4;color:#222}
main{max-width:460px;margin:12vh auto;padding:32px 28px;background:#fff;border:1px solid #e4e3de;border-radius:8px}
h1{font-size:20px;margin:0 0 12px}p{font-size:15px;line-height:1.5;margin:0 0 16px}
input[type=text]{font:inherit;font-size:22px;letter-spacing:.35em;text-align:center;width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #bbb;border-radius:6px;margin-bottom:14px}
button{font:inherit;font-size:15px;padding:10px 18px;border:0;border-radius:6px;background:#1f3b57;color:#fff;cursor:pointer}
button:focus-visible,input:focus-visible{outline:3px solid #9cc3e6;outline-offset:2px}.err{color:#a33}small{color:#777}</style></head>
<body><main>${bodyHtml}</main></body></html>`;
}
const GENERIC = "<h1>Link inválido ou expirado</h1><p>Este link não é válido ou já não está ativo. Peça um novo a quem o enviou.</p>";

async function download(req, res) {
  res.set("Cache-Control", "no-store"); res.set("X-Robots-Tag", "noindex, nofollow"); res.set("Referrer-Policy", "no-referrer");
  await P.loadIdentity();
  const org = P.identity().orgName || "";
  const parsed = U.parsePath(req.path);
  if (!parsed) { res.status(400).send(page("Link inválido", GENERIC, org)); return; }
  const { id, token } = parsed;
  const [secSnap, linkSnap] = await Promise.all([db().doc(`budgetPackSecrets/${id}`).get(), db().doc(`budgetPackLinks/${id}`).get()]);
  const secrets = secSnap.exists ? secSnap.data() : null, link = linkSnap.exists ? linkSnap.data() : null;
  const st = U.linkState({ secrets, link, token });
  if (!st.ok) { res.status(st.reason === "invalid" ? 400 : 410).send(page("Link inválido", GENERIC, org)); return; }

  const form = (error) => page("Pack contabilístico", `<h1>Pack contabilístico</h1><p>${escapeHtml(org)} · ${escapeHtml(link.from)} a ${escapeHtml(link.to)}</p>
<p>Escreva o código de 6 dígitos que recebeu.</p>${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
<form method="POST"><input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" pattern="[0-9 ]*" aria-label="Código de 6 dígitos" autofocus required><button type="submit">Descarregar</button></form>
<p style="margin-top:18px"><small>O link funciona até ${escapeHtml(U.fmtDate(U.msOf(link.expiresAt), "pt"))}.</small></p>`, org);

  if (req.method === "GET") { res.status(200).send(form("")); return; }
  if (req.method !== "POST") { res.status(405).send("Method not allowed"); return; }

  let code = "";
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) code = req.body.code;
  else { const raw = req.rawBody ? req.rawBody.toString("utf8") : String(req.body || ""); code = new URLSearchParams(raw).get("code"); }
  const chk = U.checkCode({ secrets, link, code });
  if (!chk.ok) {
    if (chk.typo) { res.status(400).send(form("O código tem 6 dígitos.")); return; }
    await db().doc(`budgetPackLinks/${id}`).update({ attempts: FieldValue.increment(1), ...(chk.lock ? { locked: true, lockedAt: FieldValue.serverTimestamp() } : {}) });
    if (chk.lock) { logger.warn("budgetPackDownload: locked after wrong codes", { id }); res.status(410).send(page("Link bloqueado", "<h1>Link bloqueado</h1><p>Foram introduzidos demasiados códigos errados. Peça um novo link a quem o enviou.</p>", org)); return; }
    res.status(403).send(form(`Código errado. Tentativas restantes: ${chk.attemptsLeft}.`));
    return;
  }
  let zip;
  try { [zip] = await bucket().file(zipPath(id)).download(); }
  catch (e) { logger.error("budgetPackDownload: zip missing", { id, message: e.message }); res.status(500).send(page("Erro", "<h1>Não foi possível descarregar</h1><p>Tente mais tarde ou peça um novo link.</p>", org)); return; }
  const entry = { at: new Date().toISOString(), ua: String(req.get ? req.get("user-agent") || "" : "").slice(0, 80) };
  await db().doc(`budgetPackLinks/${id}`).update({ downloads: FieldValue.increment(1), lastDownloadAt: FieldValue.serverTimestamp(), log: [...(link.log || []), entry].slice(-U.LIMITS.logKeep) });
  const fname = `${U.safeEntryName(org, "pack")}-pack-${link.from}_${link.to}.zip`.replace(/\s+/g, "-");
  res.set("Content-Type", "application/zip"); res.set("Content-Disposition", `attachment; filename="${fname}"`); res.set("Content-Length", String(zip.length));
  res.status(200).send(zip);
}

exports.budgetPackDownload = onRequest({ region: REGION }, async (req, res) => {
  try { await download(req, res); }
  catch (e) { logger.error("budgetPackDownload failed", { message: e.message }); if (!res.headersSent) res.status(500).send("Error"); }
});

module.exports.sendPack = sendPack;
module.exports.revokePack = revokePack;
module.exports.download = download;
