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
const icsFiles = {};
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, method: opts.method || "GET", headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
  if (u.endsWith("/emails") && opts.method === "POST" && !nextSendError) quotaDaily++; // Resend's header reflects the send just made
  const hdrs = new Map([["x-resend-daily-quota", String(quotaDaily)], ["x-resend-monthly-quota", String(900 + quotaDaily)]]);
  const resp = (status, obj) => ({ ok: status < 300, status, headers: { get: (h) => hdrs.get(h.toLowerCase()) ?? null }, text: async () => JSON.stringify(obj), arrayBuffer: async () => Buffer.alloc(obj.__size || 10) });
  if (u.startsWith("https://files.test/ics/")) { const body = icsFiles[u] || ""; return { ok: true, status: 200, headers: { get: () => null }, text: async () => body, arrayBuffer: async () => Buffer.from(body) }; }
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
const { store, storageFiles, Timestamp } = F;

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
  ok("seed creates settings + 8 outreach senders + 3 relationship senders (@douropartners.pt)", seed.res.created.length === 12 && seed.res.created.includes("outreachSenders/andre.rocha@douropartners.pt"));
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
  // 5 Nov: an extra general address of the company (added in Addresses → searchCompanies.reach) is one of its addresses, not "someone else's"
  store.set("searchCompanies/co1", { ...store.get("searchCompanies/co1"), reach: [{ id: "rx1", type: "email", value: "extra@metalurgica-silva.pt", status: "ok", primary: false }] });
  r = await call(fns.outreachSend, { companyId: "co1", senderId: S, subject: "x", body: "y", recipient: { email: "extra@metalurgica-silva.pt" } });
  ok("an extra company address from Addresses is accepted as a recipient (not refused as not the company's)", r.err?.details?.reason !== "recipient_not_found");
  r = await call(fns.outreachSend, { companyId: "co1", senderId: S, subject: "x", body: "y", recipient: { email: "stranger@elsewhere.pt" } });
  ok("an address that is not the company's is still refused", r.err?.details?.reason === "recipient_not_found");
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
  ok("no footer by default (CCSL, 9 Oct) and no [TESTE] placeholder", !sent.body.text.includes("\n--\n") && !sent.body.text.includes("[TESTE]"));
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
  ok("reply quotes the prospect's message at the end (B7)", rep.body.text.includes("escreveu:\n> Claro, quinta às 10h?") && rep.body.text.indexOf("escreveu:") > rep.body.text.indexOf("\n--\n"));
  const afterReply = store.get("outreachThreads/" + thread1Id);
  ok("thread → waiting; the one who answered has read it, the other partner has not (3 Nov)", afterReply.status === "waiting" && afterReply.unread === true && !!afterReply.readBy && Object.keys(afterReply.readBy).length === 1);
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
  // 6 Nov: a message a partner forwards from a personal address is filed by the company addresses written in it; a calendar answer goes to its invite's conversation
  receivedEmails["fw5"] = { from: "partner.me@gmail.com", subject: "FW: Reunião Metalúrgica Silva", message_id: "<fw-1@gmail.com>", text: "Bom dia André,\n\n-----Compromisso original-----\nPara: partner.me@gmail.com; geral@metalurgica-silva.pt; alguem@gmail.com\nAssunto: Reunião", headers: { from: "Partner <partner.me@gmail.com>" } };
  await webhook({ type: "email.received", data: { email_id: "fw5", from: "partner.me@gmail.com", to: ["an.rocha@teniokarau.resend.app"] } });
  const fw5 = docs("outreachMessages").find((m) => m.resendId === "fw5");
  ok("a forward from a personal address is filed under the one company whose address is in it (not unmatched)", fw5.matchRule === "forwarded" && store.get("outreachThreads/" + fw5.threadId).companyId === "co1" && store.get("outreachThreads/" + fw5.threadId).unmatched === false);
  receivedEmails["fw6"] = { from: "partner.you@gmail.com", subject: "Reunião Metalúrgica Silva", message_id: "<fw-2@gmail.com>", text: "geral@metalurgica-silva.pt", headers: { from: "partner.you@gmail.com" } };
  await webhook({ type: "email.received", data: { email_id: "fw6", from: "partner.you@gmail.com", to: ["an.rocha@teniokarau.resend.app"] } });
  ok("…only a FW:/Fwd: message (the same text without it stays unmatched)", store.get("outreachThreads/" + docs("outreachMessages").find((m) => m.resendId === "fw6").threadId).unmatched === true);
  receivedEmails["fw7"] = { from: "partner.him@gmail.com", subject: "FW: dois", message_id: "<fw-3@gmail.com>", text: "geral@metalurgica-silva.pt e info@spammy.biz", headers: { from: "partner.him@gmail.com" } };
  store.set("outreachThreads/tOther", { companyId: "co9", companyName: "OUTRA, LDA", contactEmail: "info@outra.pt", contactDomain: "outra.pt", senderId: S, lastMessageAt: F.Timestamp.now(), rfcIds: [], isTest: true });
  receivedEmails["fw7"].text = "geral@metalurgica-silva.pt e info@outra.pt";
  await webhook({ type: "email.received", data: { email_id: "fw7", from: "partner.him@gmail.com", to: ["an.rocha@teniokarau.resend.app"] } });
  ok("…and not when the addresses belong to two companies (nothing is guessed)", store.get("outreachThreads/" + docs("outreachMessages").find((m) => m.resendId === "fw7").threadId).unmatched === true);
  store.delete("outreachThreads/tOther");
  store.set("config/features", { flags: { "outreach.inviteManage": { staging: "on", production: "on" } } }); require("../features")._reset();
  store.set("outreachInvites/zz1_invite", { uid: "zz1@invite", threadId: "tDom", status: "active", title: "Reunião", guests: [{ email: "dono@empresa.pt", name: "Dono", status: "NEEDS-ACTION" }] });
  icsFiles["https://files.test/ics/zz1"] = "BEGIN:VCALENDAR\nMETHOD:REPLY\nBEGIN:VEVENT\nUID:zz1@invite\nSEQUENCE:0\nATTENDEE;CN=Partner;PARTSTAT=ACCEPTED:mailto:partner.me@gmail.com\nEND:VEVENT\nEND:VCALENDAR\n";
  receivedEmails["cal8"] = { from: "partner.me@gmail.com", subject: "Accepted: Reunião", message_id: "<cal-1@gmail.com>", text: "Partner has accepted this invitation.", headers: { from: "Partner <partner.me@gmail.com>" },
    attachments: [{ id: "cal1", filename: "invite.ics", size: 200, content_type: "application/ics", content_disposition: "attachment", download_url: "https://files.test/ics/zz1" }] };
  await webhook({ type: "email.received", data: { email_id: "cal8", from: "partner.me@gmail.com", to: ["an.rocha@teniokarau.resend.app"], attachments: [{ id: "cal1" }] } });
  const cal8 = docs("outreachMessages").find((m) => m.resendId === "cal8");
  ok("a calendar answer is filed in its invite's conversation (not the one the sender's address matched), quietly, and updates the guest line", cal8.isCalendarReply === true && cal8.threadId === "tDom" && store.get("outreachInvites/zz1_invite").guests.some((g) => g.email === "partner.me@gmail.com" && g.status === "ACCEPTED") && store.get("outreachThreads/tDom").lastDirection !== "in");
  store.delete("outreachInvites/zz1_invite"); store.delete("config/features"); require("../features")._reset();
  receivedEmails["in4"] = { from: "andrenorocha@gmail.com", subject: "Resposta automática: Search funds", message_id: "<auto@x>", text: "Estou ausente até dia 30.", headers: { "auto-submitted": "auto-replied", "in-reply-to": "<om-reqAAAAAAAAAAAA1@mail.douropartners-team.pt>" } };
  const repliedAtBefore = store.get("outreachThreads/" + thread1Id).status;
  await webhook({ type: "email.received", data: { email_id: "in4", from: "andrenorocha@gmail.com", to: ["an.rocha@teniokarau.resend.app"] } });
  const in4 = docs("outreachMessages").find((m) => m.resendId === "in4");
  ok("auto-reply flagged and doesn't flip thread to replied", in4.isAutoReply === true && store.get("outreachThreads/" + thread1Id).status === repliedAtBefore);
  ok("12 Oct: the conversation records the auto-reply (Inbox tag / filter, Sent tag)", store.get("outreachThreads/" + thread1Id).lastInboundAuto === true && !!store.get("outreachThreads/" + thread1Id).autoReplyAt);
  receivedEmails["in5"] = { from: "andrenorocha@gmail.com", subject: "Re: Search funds", message_id: "<r5@x>", text: "Por favor remover o nosso email da vossa lista.", headers: { "in-reply-to": "<reply-1@mail.gmail.com>" } };
  await webhook({ type: "email.received", data: { email_id: "in5", from: "andrenorocha@gmail.com", to: ["an.rocha@teniokarau.resend.app"] } });
  ok("'remover' reply gets a suggested unsubscribe (not automatic)", docs("outreachMessages").find((m) => m.resendId === "in5").suggestUnsubscribe === true && !store.get("outreachSuppression/andrenorocha@gmail.com"));

  console.log("\n=== Gmail 'Send as' reply recorded ===");
  w = await webhook({ type: "email.sent", data: { email_id: "gm1", from: "André Rocha <an.rocha@mail.douropartners-team.pt>", to: ["andrenorocha@gmail.com"], subject: "Re: Teste", message_id: "<gmail-sent-1@mail.gmail.com>" } });
  const gm = docs("outreachMessages").find((m) => m.resendId === "gm1");
  ok("Gmail reply stored on thread with via gmail", w.body === "ok" && gm?.via === "gmail" && gm.threadId === thread1Id && gm.snippet === "Olá, quinta às 10h confirmado.");
  ok("thread → waiting after Gmail reply; unread for both partners again (attentionAt, 3 Nov)", store.get("outreachThreads/" + thread1Id).status === "waiting" && store.get("outreachThreads/" + thread1Id).unread === true && !!store.get("outreachThreads/" + thread1Id).attentionAt);
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

  console.log("\n=== test send without a company (B10) ===");
  r = await call(fns.outreachSend, { senderId: S, to: "delivered+b10@resend.dev", subject: "Olá {{company.name}}", body: "Sobre a {{company.shortName}} em {{company.city}}." });
  ok("test mode: company fields show placeholders instead of refusing", r.res?.ok === true && JSON.stringify(lastSend().body).includes("Olá [Empresa]") && JSON.stringify(lastSend().body).includes("[Cidade]"));

  console.log("\n=== batch 5: signatures, forward ===");
  store.set(`outreachSenders/${S}`, { ...store.get(`outreachSenders/${S}`), signatures: [{ name: "Curta", text: "Assinatura curta XYZ" }] });
  r = await call(fns.outreachSend, { senderId: S, to: "delivered+sig@resend.dev", subject: "Assinatura", body: "Corpo.", signatureName: "Curta" });
  ok("I14: the chosen signature replaces the address's default", r.res?.ok === true && lastSend().body.text.includes("Corpo.\n\nAssinatura curta XYZ") && !lastSend().body.text.includes("Douro Partners\n\n--"));
  const sigThread = r.res.threadId;
  store.set("teamDirectory/antonio", { key: "antonio", contactEmail: "antonio.carvalho@douropartners.pt" });
  r = await call(fns.outreachSend, { action: "forward", threadId: sigThread, to: "someone@gmail.com", note: "x" });
  ok("I15: forward refused to an address outside the team", r.err?.details?.reason === "not_team");
  r = await call(fns.outreachSend, { action: "forward", threadId: sigThread, to: "antonio.carvalho@douropartners.pt", note: "Vê isto" });
  ok("I15: forward sends the conversation with the note to a team member, and records it", r.res?.ok === true && lastSend().body.to[0] === "antonio.carvalho@douropartners.pt" && lastSend().body.subject === "Fwd: Assinatura" && lastSend().body.text.startsWith("Vê isto") && lastSend().body.text.includes("Corpo.") && (store.get(`outreachThreads/${sigThread}`).forwards || []).some((f) => f.to === "antonio.carvalho@douropartners.pt"));

  console.log("\n=== batch 6: attachments (3 Nov) ===");
  storageFiles.set("outreach/files/f1/Apresentacao.pdf", { size: 7, meta: {}, buf: Buffer.from("PDFDATA") });
  store.set("outreachFiles/f1", { name: "Apresentação.pdf", filename: "Apresentacao.pdf", storagePath: "outreach/files/f1/Apresentacao.pdf", contentType: "application/pdf", size: 7, library: true });
  store.set("outreachFiles/bad", { name: "x.exe", filename: "x.exe", storagePath: "outreach/files/bad/x.exe", contentType: "application/x-msdownload", size: 10 });
  r = await call(fns.outreachSend, { senderId: S, to: "delivered+att@resend.dev", subject: "Com anexo", body: "Segue a apresentação.", attachments: ["f1"] });
  const att = lastSend().body.attachments;
  ok("an attached file is read from Storage and sent as base64 with its name and type", r.res?.ok === true && att?.length === 1 && att[0].filename === "Apresentacao.pdf" && att[0].content === Buffer.from("PDFDATA").toString("base64") && att[0].content_type === "application/pdf");
  const attMsg = docs("outreachMessages").find((x) => x.id === r.res.messageId);
  ok("the message records it, so it shows as a chip in the conversation", attMsg.attachments.length === 1 && attMsg.attachments[0].storagePath === "outreach/files/f1/Apresentacao.pdf" && attMsg.attachments[0].outgoing === true && attMsg.attachments[0].fileId === "f1");
  r = await call(fns.outreachSend, { senderId: S, to: "delivered+att2@resend.dev", subject: "Sem anexo", body: "Sem." });
  ok("an email without files sends no attachments field", r.res?.ok === true && lastSend().body.attachments === undefined);
  r = await call(fns.outreachSend, { senderId: S, to: "delivered+att3@resend.dev", subject: "x", body: "y", attachments: ["nope"] });
  ok("a file that is not in the library refuses the email", r.err?.details?.reason === "file_not_found");
  r = await call(fns.outreachSend, { senderId: S, to: "delivered+att4@resend.dev", subject: "x", body: "y", attachments: ["bad"] });
  ok("a file type that can run (exe) is refused", r.err?.details?.reason === "file_not_allowed");
  r = await call(fns.outreachSend, { threadId: sigThread, body: "Resposta com a apresentação.", attachments: ["f1", "f1"] });
  ok("a reply carries the file too (listed twice, sent once)", r.res?.ok === true && lastSend().body.attachments?.length === 1);
  storageFiles.delete("outreach/files/f1/Apresentacao.pdf");

  store.set("outreachMessages/inAtt", { threadId: sigThread, direction: "in", status: "received", from: "dono@empresa.pt", subject: "Re: Assinatura", text: "Segue o balanço.", companyId: "co1", isTest: true, attachments: [{ filename: "Balanco.pdf", storagePath: "outreach/t/in1/Balanco.pdf", size: 5, contentType: "application/pdf", flagged: false }, { filename: "macro.docm", storagePath: "outreach/t/in1/macro.docm", size: 5, contentType: "application/octet-stream", flagged: true }] });
  storageFiles.set("outreach/t/in1/Balanco.pdf", { size: 5, meta: {}, buf: Buffer.from("BALAN") });
  r = await call(fns.outreachSend, { action: "forward", threadId: sigThread, to: "antonio.carvalho@douropartners.pt", note: "Com o balanço", includeFiles: true });
  ok("Forward with the files of the conversation: the copied, not risky ones go along as attachments (the received one with its content)", r.res?.ok === true && (lastSend().body.attachments || []).some((x) => x.filename === "Balanco.pdf" && x.content === Buffer.from("BALAN").toString("base64")) && r.res.files === lastSend().body.attachments.length);

  // ── Calendar invites as objects (5 Nov): registered when sent, updated / cancelled with the same UID, answers filed quietly ──
  const Inv = require("../outreach/invites.js");
  store.set("config/features", { flags: { "outreach.inviteManage": { staging: "on", production: "on" } } }); require("../features")._reset();
  const icsReq = Inv.buildIcs({ method: "REQUEST", uid: "abc123@invite", sequence: 0, title: "Reunião — Glass Soft", start: new Date("2026-11-11T14:30:00Z"), end: new Date("2026-11-11T15:30:00Z"), location: "Marinha Grande", link: "https://meet.google.com/abc", description: "Notas aqui", organizer: { name: "André", email: "an.rocha@mail.example.test" }, attendees: [{ email: "dono@empresa.pt", name: "Dono" }, { email: "andre.rocha@douropartners.pt", name: "André" }] });
  storageFiles.set("outreach/files/ivf1/convite.ics", { size: icsReq.length, meta: {}, buf: Buffer.from(icsReq) });
  store.set("outreachFiles/ivf1", { name: "convite.ics", filename: "convite.ics", storagePath: "outreach/files/ivf1/convite.ics", contentType: "text/calendar; method=REQUEST; charset=UTF-8", size: icsReq.length, library: false });
  r = await call(fns.outreachSend, { threadId: sigThread, body: "Segue o convite.", attachments: ["ivf1"], replyTo: ["antonio.carvalho@douropartners.pt"], replyCc: [] });
  const invDoc = store.get("outreachInvites/abc123_invite");
  ok("an email with an invite registers it: the guests, who it went to, the thread, the notes without the link line", r.res?.ok === true && invDoc && invDoc.status === "active" && invDoc.threadId === sigThread && invDoc.to.join() === "antonio.carvalho@douropartners.pt" && invDoc.cc.length === 0 && invDoc.guests.length === 2 && invDoc.guests[0].status === "NEEDS-ACTION" && invDoc.notes === "Notas aqui" && invDoc.link === "https://meet.google.com/abc");
  store.set("outreachTasks/ivtask", { channel: "visit", status: "open", companyId: "co1", dueAt: Timestamp.fromDate(new Date("2026-11-11T14:30:00Z")) });
  store.set("searchActivities/ivact", { companyId: "co1", type: "meeting_scheduled", status: "open", date: Timestamp.fromDate(new Date("2026-11-11T14:30:00Z")) });
  store.set("outreachInvites/abc123_invite", { ...invDoc, taskId: "ivtask", meetingActivityId: "ivact" });
  r = await call(fns.outreachSend, { action: "inviteUpdate", uid: "abc123@invite", start: "2026-11-12T10:00:00Z", minutes: 45, title: "Reunião — Glass Soft (nova hora)", where: "Lisboa", link: "", notes: "Notas novas", guests: [{ email: "dono@empresa.pt", name: "Dono" }, { email: "novo@empresa.pt" }], note: "Mudámos a hora." });
  const sentUpd = lastSend(), updAtt = (sentUpd.body.attachments || []).find((x) => /ics/.test(x.filename));
  const updIcs = updAtt ? Inv.parseIcs(Buffer.from(updAtt.content, "base64").toString("utf8")) : {};
  ok("Update: the same UID, SEQUENCE 1, the new time and guests, as a REQUEST attached to a reply in the same conversation", r.res?.ok === true && updIcs.uid === "abc123@invite" && updIcs.sequence === 1 && updIcs.method === "REQUEST" && updIcs.start.toISOString() === "2026-11-12T10:00:00.000Z" && updIcs.end.toISOString() === "2026-11-12T10:45:00.000Z" && updIcs.attendees.map((x) => x.email).join() === "dono@empresa.pt,novo@empresa.pt" && sentUpd.body.to.join() === "antonio.carvalho@douropartners.pt" && sentUpd.body.text.includes("Mudámos a hora."));
  ok("Update: it goes to the original To and Cc and to whoever sends (André, who was not in the original); the invite, the visit task and the meeting follow", sentUpd.body.cc.includes("andre.rocha@douropartners.pt") && store.get("outreachInvites/abc123_invite").sequence === 1 && store.get("outreachInvites/abc123_invite").title === "Reunião — Glass Soft (nova hora)" && store.get("outreachInvites/abc123_invite").guests.every((g) => g.status === "NEEDS-ACTION") && store.get("outreachTasks/ivtask").dueAt.toDate().toISOString() === "2026-11-12T10:00:00.000Z" && store.get("searchActivities/ivact").date.toDate().toISOString() === "2026-11-12T10:00:00.000Z");
  const replyIcs = Inv.buildIcs({ method: "REPLY", uid: "abc123@invite", sequence: 1, title: "x", start: new Date("2026-11-12T10:00:00Z"), end: new Date("2026-11-12T10:45:00Z"), organizer: { name: "A", email: "an.rocha@mail.example.test" }, attendees: [{ email: "dono@empresa.pt", name: "Dono" }] }).replace("METHOD:REPLY", "METHOD:REPLY").replace("PARTSTAT=NEEDS-ACTION", "PARTSTAT=ACCEPTED");
  storageFiles.set("outreach/t/ivr/invite.ics", { size: replyIcs.length, meta: {}, buf: Buffer.from(replyIcs) });
  const ans = await Inv.applyReply([{ filename: "invite.ics", contentType: "text/calendar; method=REPLY", storagePath: "outreach/t/ivr/invite.ics" }]);
  ok("A calendar answer (Accepted) updates that guest's line and is recognised as an answer", ans && ans.uid === "abc123@invite" && store.get("outreachInvites/abc123_invite").guests.find((g) => g.email === "dono@empresa.pt").status === "ACCEPTED" && store.get("outreachInvites/abc123_invite").guests.find((g) => g.email === "novo@empresa.pt").status === "NEEDS-ACTION");
  ok("An .ics that is not an answer to one of our invites is ignored", (await Inv.applyReply([{ filename: "x.ics", contentType: "text/calendar", storagePath: "outreach/files/ivf1/convite.ics" }])) === null);
  r = await call(fns.outreachSend, { action: "inviteCancel", uid: "abc123@invite", note: "Cancelamos." });
  const sentCan = lastSend(), canIcs = Inv.parseIcs(Buffer.from((sentCan.body.attachments || []).find((x) => /ics/.test(x.filename)).content, "base64").toString("utf8"));
  ok("Cancel: the same UID, SEQUENCE 2, METHOD:CANCEL; the invite is cancelled, the visit task closed and the meeting cancelled", r.res?.ok === true && canIcs.method === "CANCEL" && canIcs.uid === "abc123@invite" && canIcs.sequence === 2 && store.get("outreachInvites/abc123_invite").status === "cancelled" && store.get("outreachTasks/ivtask").status === "cancelled" && store.get("searchActivities/ivact").status === "cancelled");
  r = await call(fns.outreachSend, { action: "inviteCancel", uid: "abc123@invite" });
  ok("a cancelled meeting cannot be changed or cancelled again", r.err?.details?.reason === "invite_closed");
  r = await call(fns.outreachSend, { action: "inviteUpdate", uid: "nope@invite", start: "2026-11-12T10:00:00Z", minutes: 30, guests: [{ email: "a@b.pt" }] });
  ok("an invite that is not registered is refused", r.err?.details?.reason === "invite_not_found");
  store.delete("config/features"); require("../features")._reset();
  for (const k of ["outreachInvites/abc123_invite", "outreachTasks/ivtask", "searchActivities/ivact", "outreachFiles/ivf1"]) store.delete(k);
  for (const k of [...storageFiles.keys()]) if (/(convite|invite)\.ics$/.test(k)) storageFiles.delete(k);
  for (const [k] of [...store.entries()]) if (k.startsWith("outreachFiles/") && !k.endsWith("/f1")) { const d = store.get(k); if (d && d.source === "invite") store.delete(k); }
  r = await call(fns.outreachSend, { action: "forward", threadId: sigThread, to: "antonio.carvalho@douropartners.pt", note: "Sem ficheiros" });
  ok("Forward without asking for files sends none", r.res?.ok === true && lastSend().body.attachments === undefined);
  storageFiles.delete("outreach/t/in1/Balanco.pdf");

  console.log("\n=== clear test data ===");
  store.set("searchActivities/real1", { companyId: "co1", type: "note", isTest: false });
  // Usage tab: the sends above were counted (test mode → "test"), per sending address and for the partner who sent them.
  const ud = store.get(`usageDaily/${require("../usage").lisbonDay()}`) || {};
  ok("Usage: emails sent here are counted as test manual sends, by address and for André", (ud.email?.test?.manual || 0) >= 1 && (ud.email?.sentBy?.andre || 0) >= 1 && Object.keys(ud.email?.bySender || {}).length >= 1 && !ud.email?.real?.manual);
  const c = await call(fns.outreachAdmin, { action: "clearTestData" });
  ok("test threads/messages/activities removed", docs("outreachThreads").length === 0 && docs("outreachMessages").length === 0 && docs("searchActivities").length === 1 && c.res.threads > 0);
  ok("real activity kept", !!store.get("searchActivities/real1"));
  ok("test attachments removed from Storage", [...storageFiles.keys()].length === 0);

  console.log(fail ? `\n${fail} FAILED` : "\nALL PASSED");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
