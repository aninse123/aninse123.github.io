// End-to-end flow tests for functions/outreach against the in-memory fake
// (fake_firebase.js). Resend's API and DNS are mocked; nothing leaves the machine.
const F = require("./fake_firebase.js");
const dns = require("dns").promises;
const crypto = require("crypto");

let mxFail = new Set();
dns.resolveMx = async (d) => { if (mxFail.has(d)) { const e = new Error("nx"); e.code = "ENOTFOUND"; throw e; } return [{ exchange: "mx." + d, priority: 10 }]; };

// ── Resend API mock ──
const calls = [];
let nextSendError = null;
let bounceDuringSend = false;
let quotaDaily = 41;
const receivedEmails = {};
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, method: opts.method || "GET", headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
  if (u.endsWith("/emails") && opts.method === "POST" && !nextSendError) quotaDaily++; // Resend's header reflects the send just made
  const hdrs = new Map([["x-resend-daily-quota", String(quotaDaily)], ["x-resend-monthly-quota", String(900 + quotaDaily)]]);
  const resp = (status, obj) => ({ ok: status < 300, status, headers: { get: (h) => hdrs.get(h.toLowerCase()) ?? null }, text: async () => JSON.stringify(obj), arrayBuffer: async () => Buffer.alloc(obj.__size || 10) });
  if (u.startsWith("https://files.test/")) return resp(200, { __size: Number(u.split("/").pop()) });
  if (u.endsWith("/emails") && opts.method === "POST") {
    if (nextSendError) { const e = nextSendError; nextSendError = e.persist ? e : null; return resp(e.status, { name: e.name, message: e.message }); }
    const rid = "rs_" + calls.length;
    // Race reproduction: Resend's bounce webhook lands before outreachSend records "sent".
    if (bounceDuringSend) { bounceDuringSend = false; const om = JSON.parse(opts.body).tags[0].value; await webhook({ type: "email.bounced", data: { email_id: rid, tags: { om }, bounce: { type: "Permanent" } } }); }
    return resp(200, { id: rid });
  }
  let m;
  if ((m = u.match(/\/emails\/receiving\/([^/?]+)\/attachments/))) return resp(200, { object: "list", data: receivedEmails[m[1]]?.attachments || [] });
  if ((m = u.match(/\/emails\/receiving\/([^/?]+)$/))) return resp(200, receivedEmails[m[1]]);
  if ((m = u.match(/\/emails\/([^/?]+)$/))) return resp(200, { id: m[1], text: "Olá, quinta às 10h confirmado.\n\nOn Thu wrote:\n> antes", html: "<p>Olá</p>", subject: "Re: Teste" });
  if (u.endsWith("/domains")) return resp(200, { data: [] });
  return resp(404, { message: "not mocked " + u });
};

const fns = require("../index.js");
const { store, storageFiles } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const call = async (fn, data, auth = ADMIN) => { try { return { res: await fn({ ...auth, data }) }; } catch (e) { return { err: e }; } };
const docs = (coll) => [...store.entries()].filter(([p]) => p.startsWith(coll + "/")).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));
const lastSend = () => calls.filter((c) => c.url.endsWith("/emails") && c.method === "POST").pop();

function makeRes() {
  const r = { code: 200, body: "", headers: {} };
  return { r, res: { status(c) { r.code = c; return this; }, send(b) { r.body = b; return this; }, set(k, v) { r.headers[k] = v; return this; } } };
}
const HOOK_KEY = Buffer.from("hook-key");
async function webhook(evt, { badSig = false, svixId } = {}) {
  const body = JSON.stringify(evt);
  const id = svixId || "msg_" + crypto.randomBytes(4).toString("hex");
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac("sha256", HOOK_KEY).update(`${id}.${ts}.${body}`).digest("base64");
  const { r, res } = makeRes();
  await fns.resendWebhook({ method: "POST", rawBody: Buffer.from(body), headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${badSig ? "AAAA" : sig}` } }, res);
  return r;
}

(async () => {
  // A real-looking company in the Search CRM.
  store.set("searchCompanies/co1", { name: "Metalúrgica Silva, Lda.", companyEmail: "geral@metalurgica-silva.pt", concelho: "Braga", owner: null, outreachAttempts: 2 });

  console.log("=== seed ===");
  const seed = await call(fns.outreachAdmin, { action: "seed" });
  ok("seed creates settings + 8 senders", seed.res.created.length === 9);
  ok("an.rocha active, rocha.andre paused, andre.rocha warming",
    store.get("outreachSenders/an.rocha@mail.douropartners-team.pt").status === "active" &&
    store.get("outreachSenders/rocha.andre@mail.douropartners-team.pt").status === "paused" &&
    store.get("outreachSenders/andre.rocha@mail.douropartners-team.pt").status === "warming");
  ok("seed is idempotent", (await call(fns.outreachAdmin, { action: "seed" })).res.created.length === 0);
  ok("settings start in testMode", store.get("outreachSettings/global").testMode === true);

  console.log("\n=== outreachSend guards ===");
  const S = "an.rocha@mail.douropartners-team.pt";
  let r = await call(fns.outreachSend, { companyId: "co1", senderId: S, subject: "x", body: "y" }, { auth: { token: { email: "someone@gmail.com" } } });
  ok("non-admin refused", r.err?.code === "permission-denied");
  r = await call(fns.outreachSend, { companyId: "co1", senderId: S, subject: "x", body: "y" });
  ok("test mode refuses the real company email", r.err?.details?.reason === "test_mode");
  r = await call(fns.outreachSend, { companyId: "co1", senderId: "rocha.andre@mail.douropartners-team.pt", to: "andrenorocha@gmail.com", subject: "x", body: "y" });
  ok("paused sender can't start outreach", r.err?.details?.reason === "sender_not_active");
  r = await call(fns.outreachSend, { companyId: "co1", senderId: S, to: "andrenorocha@gmail.com", subject: "Olá {{company.cae}}", body: "y" });
  ok("missing variable refused and named", r.err?.details?.reason === "missing_variables" && r.err.details.missing.includes("company.cae"));
  mxFail.add("resend.dev");
  r = await call(fns.outreachSend, { companyId: "co1", senderId: S, to: "delivered@resend.dev", subject: "x", body: "y" });
  ok("domain without MX refused", r.err?.details?.reason === "no_mx");
  mxFail.clear();
  store.set("outreachSuppression/amobnc92@gmail.com", { email: "amobnc92@gmail.com", reason: "unsubscribed" });
  r = await call(fns.outreachSend, { companyId: "co1", senderId: S, to: "amobnc92@gmail.com", subject: "x", body: "y" });
  ok("suppressed address refused", r.err?.details?.reason === "suppressed");

  console.log("\n=== successful test send ===");
  const sendCallsBefore = calls.length;
  r = await call(fns.outreachSend, { companyId: "co1", senderId: S, to: "andrenorocha@gmail.com", subject: "Search funds — {{company.shortName}}", body: "Olá {{contact.firstName|equipa da}} {{company.shortName}},\n\nTeste.", requestId: "reqAAAAAAAAAAAA1" });
  ok("send succeeds", r.res?.ok === true && r.res.messageId === "reqAAAAAAAAAAAA1");
  const sent = lastSend();
  ok("one Resend call", calls.length === sendCallsBefore + 1);
  ok("from = display name + alias", sent.body.from === "André Rocha <an.rocha@mail.douropartners-team.pt>");
  ok("subject rendered with short name", sent.body.subject === "Search funds — Metalúrgica Silva");
  ok("fallback used for empty contact name", sent.body.text.startsWith("Olá equipa da Metalúrgica Silva,"));
  ok("no custom Message-ID (Resend assigns it)", !("Message-ID" in sent.body.headers));
  ok("List-Unsubscribe via douropartners.pt/u/", /^<https:\/\/douropartners\.pt\/u\/reqAAAAAAAAAAAA1\.[\w-]+>$/.test(sent.body.headers["List-Unsubscribe"]));
  ok("one-click header", sent.body.headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click");
  ok("om tag + idempotency key", sent.body.tags[0].value === "reqAAAAAAAAAAAA1" && sent.headers["Idempotency-Key"] === "reqAAAAAAAAAAAA1");
  ok("test footer present (no compliance block yet)", sent.body.text.includes("[TESTE]"));
  const msg1 = store.get("outreachMessages/reqAAAAAAAAAAAA1");
  ok("message stored as sent, isTest", msg1.status === "sent" && msg1.resendId && msg1.isTest === true);
  const thread1Id = msg1.threadId;
  const thread1 = store.get("outreachThreads/" + thread1Id);
  ok("thread stored with contactDomain + owner", thread1.contactDomain === "gmail.com" && thread1.owner === "andre" && thread1.companyId === "co1");
  const acts = docs("searchActivities");
  ok("activity is email_test with [TEST] title", acts.length === 1 && acts[0].type === "email_test" && acts[0].title.startsWith("[TEST] "));
  ok("real company fields untouched in test mode", store.get("searchCompanies/co1").outreachAttempts === 2 && !store.get("searchCompanies/co1").outreachStatus);
  const day = new Date().toISOString().slice(0, 10);
  ok("daily counters bumped", store.get("outreachDaily/" + day).outreachSent === 1 && store.get("outreachDaily/" + day).bySender["an_rocha_mail_douropartners-team_pt"] === 1);
  ok("usage recorded from headers", store.get("outreachUsage/" + day).resendDailyUsed === quotaDaily);
  r = await call(fns.outreachSend, { companyId: "co1", senderId: S, to: "andrenorocha@gmail.com", subject: "x", body: "y", requestId: "reqAAAAAAAAAAAA1" });
  ok("same requestId is a no-op", r.res?.duplicate === true && calls.length === sendCallsBefore + 1);

  console.log("\n=== budget ===");
  store.set("outreachUsage/" + day, { resendDailyUsed: 100, portalTotalAtReading: store.get("outreachDaily/" + day).total });
  r = await call(fns.outreachSend, { companyId: "co1", senderId: S, to: "andrerochaaero@gmail.com", subject: "x", body: "y" });
  ok("over target asks for confirmation", r.err?.details?.reason === "over_target" && r.err.details.used === 100);
  quotaDaily = 100;
  r = await call(fns.outreachSend, { companyId: "co1", senderId: S, to: "andrerochaaero@gmail.com", subject: "x", body: "y", confirmOverTarget: true });
  ok("confirmed send goes through above target", r.res?.ok === true && r.res.warnings.length === 1);
  store.set("outreachDaily/" + day, { ...store.get("outreachDaily/" + day), bySender: { "an_rocha_mail_douropartners-team_pt": 25 } });
  r = await call(fns.outreachSend, { companyId: "co1", senderId: S, to: "andrerochaaero@gmail.com", subject: "x", body: "y", confirmOverTarget: true });
  ok("per-address cap (25) blocks new outreach", r.err?.details?.reason === "sender_cap");
  store.set("outreachDaily/" + day, { ...store.get("outreachDaily/" + day), bySender: {} });
  store.set("outreachUsage/" + day, { resendDailyUsed: 50, portalTotalAtReading: store.get("outreachDaily/" + day).total });
  quotaDaily = 50;

  console.log("\n=== Resend errors ===");
  nextSendError = { status: 422, name: "validation_error", message: "Invalid `to` field" };
  r = await call(fns.outreachSend, { companyId: "co1", senderId: S, to: "andrerochaaero@gmail.com", subject: "x", body: "y" });
  ok("validation error surfaces as internal with Resend's message", r.err?.code === "internal" && r.err.message.includes("Invalid `to` field"));
  nextSendError = { status: 429, name: "daily_quota_exceeded", message: "You have reached your daily email quota" };
  r = await call(fns.outreachSend, { companyId: "co1", senderId: S, to: "andrerochaaero@gmail.com", subject: "x", body: "y" });
  ok("quota error surfaces as resource-exhausted", r.err?.code === "resource-exhausted" && r.err.details.reason === "daily_quota_exceeded");
  ok("failed message kept with status failed", docs("outreachMessages").some((m) => m.status === "failed"));

  console.log("\n=== webhook: signature, delivery, duplicates ===");
  let w = await webhook({ type: "email.delivered", data: { email_id: msg1.resendId, tags: { om: "reqAAAAAAAAAAAA1" } } }, { badSig: true });
  ok("bad signature → 401", w.code === 401);
  w = await webhook({ type: "email.delivered", created_at: new Date().toISOString(), data: { email_id: msg1.resendId, tags: { om: "reqAAAAAAAAAAAA1" }, message_id: "<om-reqAAAAAAAAAAAA1@mail.douropartners-team.pt>" } }, { svixId: "msg_dup1" });
  ok("delivered → status delivered", w.body === "ok" && store.get("outreachMessages/reqAAAAAAAAAAAA1").status === "delivered");
  ok("Resend's Message-ID stored on message and thread", store.get("outreachMessages/reqAAAAAAAAAAAA1").rfcMessageId === "<om-reqAAAAAAAAAAAA1@mail.douropartners-team.pt>" && store.get("outreachThreads/" + thread1Id).rfcIds.includes("<om-reqAAAAAAAAAAAA1@mail.douropartners-team.pt>"));
  w = await webhook({ type: "email.delivered", data: { email_id: msg1.resendId, tags: { om: "reqAAAAAAAAAAAA1" } } }, { svixId: "msg_dup1" });
  ok("same svix-id → duplicate", w.body === "duplicate");
  w = await webhook({ type: "email.sent", data: { email_id: "investor-notify-1", from: "Douro Partners <noreply@douropartners.pt>", to: ["investor@x.com"] } });
  ok("investor email event ignored", w.body === "ignored");
  w = await webhook({ type: "email.delivered", data: { email_id: "warmup-1", from: "andre.rocha@mail.douropartners-team.pt", to: ["pool@x.com"] } });
  ok("warm-up event ignored", w.body === "ignored");
  w = await webhook({ type: "email.sent", data: { email_id: "late", tags: { om: "reqAAAAAAAAAAAA1" } } });
  ok("late 'sent' doesn't downgrade delivered", store.get("outreachMessages/reqAAAAAAAAAAAA1").status === "delivered");

  console.log("\n=== webhook: bounce → suppression ===");
  r = await call(fns.outreachSend, { companyId: "co1", senderId: S, to: "bounced+v4@resend.dev", subject: "x", body: "y" });
  const bId = r.res.messageId;
  w = await webhook({ type: "email.bounced", data: { email_id: r.res.resendId, tags: { om: bId }, bounce: { type: "Permanent", subType: "General" } } });
  ok("hard bounce → message bounced", store.get("outreachMessages/" + bId).status === "bounced");
  ok("hard bounce → suppression", store.get("outreachSuppression/bounced+v4@resend.dev")?.reason === "hard_bounce");
  ok("hard bounce → thread bounced", store.get("outreachThreads/" + r.res.threadId).status === "bounced");
  r = await call(fns.outreachSend, { companyId: "co1", senderId: S, to: "bounced+v4@resend.dev", subject: "x", body: "y" });
  ok("next send to the bounced address refused", r.err?.details?.reason === "suppressed");
  bounceDuringSend = true;
  r = await call(fns.outreachSend, { companyId: "co1", senderId: S, to: "bounced+race@resend.dev", subject: "x", body: "y" });
  ok("bounce that beats the send's own update isn't overwritten by 'sent'", r.res?.ok === true && store.get("outreachMessages/" + r.res.messageId).status === "bounced");
  w = await webhook({ type: "email.complained", data: { email_id: "x", tags: { om: r.res.messageId } } });
  w = await webhook({ type: "email.delivered", data: { email_id: "x", tags: { om: r.res.messageId } } });
  ok("a later 'delivered' never downgrades a complaint", store.get("outreachMessages/" + r.res.messageId).status === "complained");

  console.log("\n=== inbound: reply matched by headers, with attachments ===");
  receivedEmails["in1"] = {
    from: "andrenorocha@gmail.com", subject: "Re: Search funds — Metalúrgica Silva", message_id: "<reply-1@mail.gmail.com>",
    text: "Claro, quinta às 10h?\n\nOn Wed, 23 Sept 2026 at 18:43, André <an.rocha@mail.douropartners-team.pt> wrote:\n> Olá",
    html: "<p>Claro</p>",
    headers: { "from": "\"André Rocha\" <andrenorocha@gmail.com>", "in-reply-to": "<om-reqAAAAAAAAAAAA1@mail.douropartners-team.pt>", "references": "<om-reqAAAAAAAAAAAA1@mail.douropartners-team.pt>", "to": "an.rocha@mail.douropartners-team.pt" },
    attachments: [
      { id: "att1", filename: "Proposta 2026.pdf", size: 1200, content_type: "application/pdf", content_disposition: "attachment", download_url: "https://files.test/1200" },
      { id: "att2", filename: "video.mp4", size: 20 * 1024 * 1024, content_type: "video/mp4", content_disposition: "attachment", download_url: "https://files.test/big" },
      { id: "att3", filename: "macro.xlsm", size: 500, content_type: "application/vnd.ms-excel", content_disposition: "attachment", download_url: "https://files.test/500" },
    ],
  };
  w = await webhook({ type: "email.received", data: { email_id: "in1", from: "andrenorocha@gmail.com", to: ["an.rocha@teniokarau.resend.app"], attachments: [{ id: "att1" }] } });
  const inMsg = docs("outreachMessages").find((m) => m.resendId === "in1");
  ok("reply stored on the original thread (header match)", w.body === "ok" && inMsg?.threadId === thread1Id && inMsg.matchRule === "headers");
  ok("snippet strips quoted history", inMsg.snippet === "Claro, quinta às 10h?");
  const t1b = store.get("outreachThreads/" + thread1Id);
  ok("thread → replied, unread, lastInboundRfcId", t1b.status === "replied" && t1b.unread === true && t1b.lastInboundRfcId === "<reply-1@mail.gmail.com>" && t1b.repliedAt);
  ok("small attachment saved to Storage", inMsg.attachments[0].storagePath?.startsWith(`outreach/${thread1Id}/`) && storageFiles.size >= 1);
  ok("20 MB attachment skipped (too_large)", inMsg.attachments[1].skippedReason === "too_large" && !inMsg.attachments[1].storagePath);
  ok("macro file kept but flagged", inMsg.attachments[2].flagged === true && inMsg.attachments[2].storagePath);
  ok("inbound activity written (test)", docs("searchActivities").some((a) => a.direction === "in" && a.type === "email_test"));
  ok("received counted, not in sender cap", store.get("outreachDaily/" + day).received === 1);
  w = await webhook({ type: "email.received", data: { email_id: "in1", from: "andrenorocha@gmail.com", to: ["an.rocha@teniokarau.resend.app"] } });
  ok("re-delivered received event not stored twice", docs("outreachMessages").filter((m) => m.resendId === "in1").length === 1);

  console.log("\n=== reply from the portal threads correctly ===");
  r = await call(fns.outreachSend, { threadId: thread1Id, body: "Quinta às 10h, combinado." });
  const rep = lastSend();
  ok("reply sent", r.res?.ok === true);
  ok("In-Reply-To = prospect's message", rep.body.headers["In-Reply-To"] === "<reply-1@mail.gmail.com>");
  ok("References carry the chain", rep.body.headers["References"].includes("<om-reqAAAAAAAAAAAA1@mail.douropartners-team.pt>") && rep.body.headers["References"].includes("<reply-1@mail.gmail.com>"));
  ok("subject gets Re:", rep.body.subject === "Re: Search funds — Metalúrgica Silva");
  ok("reply quotes the prospect's message above the footer", rep.body.text.includes("escreveu:\n> Claro, quinta às 10h?") && rep.body.text.indexOf("escreveu:") < rep.body.text.indexOf("\n--\n"));
  ok("thread → waiting, read", store.get("outreachThreads/" + thread1Id).status === "waiting" && store.get("outreachThreads/" + thread1Id).unread === false);
  ok("counted as reply", store.get("outreachDaily/" + day).repliesSent === 1);

  console.log("\n=== inbound: domain rule and unmatched ===");
  store.set("outreachThreads/tDom", { companyId: "co1", contactEmail: "geral@metalurgica-silva.pt", contactDomain: "metalurgica-silva.pt", senderId: S, owner: "andre", lastMessageAt: F.Timestamp.now(), rfcIds: [], isTest: true });
  receivedEmails["in2"] = { from: "joao@metalurgica-silva.pt", subject: "Search funds", message_id: "<fresh-2@metalurgica-silva.pt>", text: "Bom dia, sou o dono. Falamos?", headers: { from: "João Silva <joao@metalurgica-silva.pt>" } };
  await webhook({ type: "email.received", data: { email_id: "in2", from: "joao@metalurgica-silva.pt", to: ["an.rocha@teniokarau.resend.app"] } });
  const in2 = docs("outreachMessages").find((m) => m.resendId === "in2");
  const t2 = store.get("outreachThreads/" + in2.threadId);
  ok("colleague at same company → new thread under that company", in2.matchRule === "domain" && t2.companyId === "co1" && in2.threadId !== "tDom" && t2.contactName === "João Silva");
  receivedEmails["in3"] = { from: "promo@spammy.biz", subject: "Great offer", message_id: "<s@spammy.biz>", text: "Buy now", headers: {} };
  await webhook({ type: "email.received", data: { email_id: "in3", from: "promo@spammy.biz", to: ["an.rocha@teniokarau.resend.app"] } });
  const in3 = docs("outreachMessages").find((m) => m.resendId === "in3");
  ok("unknown sender → unmatched thread, no company", store.get("outreachThreads/" + in3.threadId).unmatched === true && !store.get("outreachThreads/" + in3.threadId).companyId);
  receivedEmails["in4"] = { from: "andrenorocha@gmail.com", subject: "Resposta automática: Search funds", message_id: "<auto@x>", text: "Estou ausente até dia 30.", headers: { "auto-submitted": "auto-replied", "in-reply-to": "<om-reqAAAAAAAAAAAA1@mail.douropartners-team.pt>" } };
  const repliedAtBefore = store.get("outreachThreads/" + thread1Id).status;
  await webhook({ type: "email.received", data: { email_id: "in4", from: "andrenorocha@gmail.com", to: ["an.rocha@teniokarau.resend.app"] } });
  const in4 = docs("outreachMessages").find((m) => m.resendId === "in4");
  ok("auto-reply flagged and doesn't flip thread to replied", in4.isAutoReply === true && store.get("outreachThreads/" + thread1Id).status === repliedAtBefore);
  receivedEmails["in5"] = { from: "andrenorocha@gmail.com", subject: "Re: Search funds", message_id: "<r5@x>", text: "Por favor remover o nosso email da vossa lista.", headers: { "in-reply-to": "<reply-1@mail.gmail.com>" } };
  await webhook({ type: "email.received", data: { email_id: "in5", from: "andrenorocha@gmail.com", to: ["an.rocha@teniokarau.resend.app"] } });
  ok("'remover' reply gets a suggested unsubscribe (not automatic)", docs("outreachMessages").find((m) => m.resendId === "in5").suggestUnsubscribe === true && !store.get("outreachSuppression/andrenorocha@gmail.com"));

  console.log("\n=== Gmail 'Send as' reply recorded ===");
  w = await webhook({ type: "email.sent", data: { email_id: "gm1", from: "André Rocha <an.rocha@mail.douropartners-team.pt>", to: ["andrenorocha@gmail.com"], subject: "Re: Teste", message_id: "<gmail-sent-1@mail.gmail.com>" } });
  const gm = docs("outreachMessages").find((m) => m.resendId === "gm1");
  ok("Gmail reply stored on thread with via gmail", w.body === "ok" && gm?.via === "gmail" && gm.threadId === thread1Id && gm.snippet === "Olá, quinta às 10h confirmado.");
  ok("thread → waiting after Gmail reply", store.get("outreachThreads/" + thread1Id).status === "waiting");
  w = await webhook({ type: "email.sent", data: { email_id: "gm2", from: "andre.rocha@mail.douropartners-team.pt", to: ["someone@x.pt"] } });
  ok("email.sent from a warming address ignored", w.body === "ignored");

  console.log("\n=== unsubscribe endpoint ===");
  const unsubUrl = sent.body.headers["List-Unsubscribe"].slice(1, -1);
  const token = unsubUrl.split("/u/")[1];
  let m1 = makeRes();
  await fns.outreachUnsubscribe({ method: "GET", path: "/" + token, rawBody: Buffer.from("") }, m1.res);
  ok("GET shows confirm page, no suppression yet", m1.r.code === 200 && m1.r.body.includes("Confirmar remoção") && !store.get("outreachSuppression/andrenorocha@gmail.com"));
  m1 = makeRes();
  await fns.outreachUnsubscribe({ method: "POST", path: "/" + token, rawBody: Buffer.from("List-Unsubscribe=One-Click") }, m1.res);
  const sup = store.get("outreachSuppression/andrenorocha@gmail.com");
  ok("one-click POST suppresses", m1.r.code === 200 && sup?.reason === "unsubscribed" && sup.source === "one_click");
  m1 = makeRes();
  await fns.outreachUnsubscribe({ method: "POST", path: "/" + token.replace(/.$/, (c) => (c === "A" ? "B" : "A")), rawBody: Buffer.from("") }, m1.res);
  ok("tampered token → 400", m1.r.code === 400);

  console.log("\n=== usage estimate between sends (V7) ===");
  ok("no scheduled refresh function any more", typeof fns.outreachUsageRefresh === "undefined");
  const u = store.get("outreachUsage/" + day), dT = store.get("outreachDaily/" + day).total;
  ok("reading notes the portal counter at that moment", typeof u.portalTotalAtReading === "number" && u.portalTotalAtReading <= dT);
  store.set("outreachUsage/" + day, { ...u, resendDailyUsed: 99, portalTotalAtReading: dT - 1 });
  r = await call(fns.outreachSend, { companyId: "co1", senderId: S, to: "delivered+v7@resend.dev", subject: "x", body: "y" });
  ok("portal activity since the reading counts toward the target (99 + 1 = 100)", r.err?.details?.reason === "over_target" && r.err.details.used === 100);
  store.set("outreachUsage/" + day, { ...u, resendDailyUsed: 10, portalTotalAtReading: dT });

  console.log("\n=== clear test data ===");
  store.set("searchActivities/real1", { companyId: "co1", type: "note", isTest: false });
  const c = await call(fns.outreachAdmin, { action: "clearTestData" });
  ok("test threads/messages/activities removed", docs("outreachThreads").length === 0 && docs("outreachMessages").length === 0 && docs("searchActivities").length === 1 && c.res.threads > 0);
  ok("real activity kept", !!store.get("searchActivities/real1"));
  ok("test attachments removed from Storage", [...storageFiles.keys()].length === 0);

  console.log(fail ? `\n${fail} FAILED` : "\nALL PASSED");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
