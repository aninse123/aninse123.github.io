// Reply / Reply all / edited To and Cc (12 Oct 2026): the first real reply
// came from a person (not the company address we wrote to) with a partner in
// Cc, and a reply from the Inbox went only to the company address. Now the
// Inbox sends replyTo / replyCc; every address is checked; our own addresses
// are dropped; a writer's draft keeps the recipients for approval. Synthetic
// data only.
const F = require("./fake_firebase.js");
const dns = require("dns").promises;
dns.resolveMx = async (d) => (d === "nomail.pt" ? [] : [{ exchange: "mx." + d, priority: 10 }]);
const sends = [];
global.fetch = async (url, opts = {}) => {
  if (String(url).endsWith("/emails") && opts.method === "POST") sends.push(JSON.parse(opts.body));
  const hdrs = new Map([["x-resend-daily-quota", "5"], ["x-resend-monthly-quota", "50"]]);
  return { ok: true, status: 200, headers: { get: (h) => hdrs.get(h.toLowerCase()) ?? null }, text: async () => JSON.stringify({ id: "rs_" + sends.length }) };
};
const fns = require("../index.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const INTERN = { auth: { token: { email: "maria@douropartners.pt", perms: ["out.view", "out.draft"], key: "maria" } } };
const call = async (who, data) => { try { return await fns.outreachSend({ ...who, data }); } catch (e) { return { err: e }; } };
const reason = (r) => r?.err?.details?.reason;
const SENDER = "a.rocha@mail.douropartners-team.pt";
const msg = (id) => store.get(`outreachMessages/${id}`);
const crypto = require("crypto");
async function webhook(evt) {
  const body = JSON.stringify(evt), id = "msg_" + crypto.randomBytes(4).toString("hex"), ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac("sha256", Buffer.from("hook-key")).update(`${id}.${ts}.${body}`).digest("base64");
  const r = { code: 200, body: "" };
  await fns.resendWebhook({ method: "POST", rawBody: Buffer.from(body), headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}` } },
    { status(c) { r.code = c; return this; }, send(b) { r.body = b; return this; }, set() { return this; } });
  return r;
}

(async () => {
  store.clear();
  store.set("outreachSettings/global", { testMode: false, dailyTarget: 100 });
  store.set(`outreachSenders/${SENDER}`, { email: SENDER, displayName: "André Rocha", owner: "andre", status: "active", dailyCap: 25 });
  store.set("teamDirectory/andre", { key: "andre", name: "André Rocha", partner: true, active: true });
  store.set("searchCompanies/co1", { name: "EMPRESA TESTE, LDA", companyEmail: "geral@empresa.pt", contacts: [] });
  store.set("outreachThreads/th1", { companyId: "co1", companyName: "EMPRESA TESTE, LDA", contactEmail: "geral@empresa.pt", contactDomain: "empresa.pt", senderId: SENDER, owner: "andre", subject: "Confidencial | Douro Partners", status: "replied", rfcIds: ["<a@x>"], lastInboundRfcId: "<a@x>", recipientKind: "company", isTest: false });
  store.set("outreachMessages/in1", { threadId: "th1", direction: "in", from: "Ana <ana@empresa.pt>", to: ["a.rocha@abc.resend.app"], cc: ["socio@outra.pt"], deliveredTo: SENDER, text: "Olá", status: "received", createdAt: new Date("2026-10-12T10:14:00Z") });

  // Without recipients: as before, the conversation's address.
  let r = await call(ADMIN, { threadId: "th1", body: "Obrigado.", requestId: "reqreply0000001" });
  ok("no replyTo → goes to the conversation's address only", r.ok && sends.length === 1 && JSON.stringify(sends[0].to) === '["geral@empresa.pt"]' && !sends[0].cc);

  // Reply all: To Ana, Cc the partner.
  r = await call(ADMIN, { threadId: "th1", body: "Obrigado a ambos.", replyTo: ["ana@empresa.pt"], replyCc: ["Sócio <socio@outra.pt>"], requestId: "reqreply0000002" });
  ok("reply all → Resend gets To Ana and Cc the partner", r.ok && JSON.stringify(sends[1].to) === '["ana@empresa.pt"]' && JSON.stringify(sends[1].cc) === '["socio@outra.pt"]');
  ok("…the message records the real To and Cc", JSON.stringify(msg(r.messageId).to) === '["ana@empresa.pt"]' && JSON.stringify(msg(r.messageId).cc) === '["socio@outra.pt"]');
  ok("…threading headers kept", sends[1].headers["In-Reply-To"] === "<a@x>");

  // Our own and forwarding addresses are dropped; duplicates between To and Cc too.
  r = await call(ADMIN, { threadId: "th1", body: "Ok.", replyTo: ["ana@empresa.pt", SENDER, "x@abc.resend.app"], replyCc: ["ana@empresa.pt", "socio@outra.pt"], requestId: "reqreply0000003" });
  ok("our addresses dropped, Cc doesn't repeat To", r.ok && JSON.stringify(sends[2].to) === '["ana@empresa.pt"]' && JSON.stringify(sends[2].cc) === '["socio@outra.pt"]');

  // Checks on every address.
  store.set("outreachSuppression/socio@outra.pt", { reason: "unsubscribed" });
  r = await call(ADMIN, { threadId: "th1", body: "Ok.", replyTo: ["ana@empresa.pt"], replyCc: ["socio@outra.pt"], requestId: "reqreply0000004" });
  ok("a suppressed Cc address is refused", reason(r) === "suppressed" && sends.length === 3);
  store.delete("outreachSuppression/socio@outra.pt");
  r = await call(ADMIN, { threadId: "th1", body: "Ok.", replyTo: ["ana@empresa.pt"], replyCc: ["alguem@nomail.pt"], requestId: "reqreply0000005" });
  ok("a Cc domain without mail servers is refused", reason(r) === "no_mx");
  r = await call(ADMIN, { threadId: "th1", body: "Ok.", replyTo: ["ana@empresa.pt"], replyCc: ["not-an-email"], requestId: "reqreply0000006" });
  ok("an invalid address is refused", reason(r) === "bad_recipient");
  r = await call(ADMIN, { threadId: "th1", body: "Ok.", replyTo: [SENDER], requestId: "reqreply0000007" });
  ok("only our own address in To → refused", reason(r) === "no_recipient");
  r = await call(ADMIN, { threadId: "th1", body: "Ok.", replyTo: Array.from({ length: 11 }, (_, i) => `p${i}@empresa.pt`), requestId: "reqreply0000008" });
  ok("more than 10 addresses → refused", reason(r) === "too_many_recipients");
  // The conversation's address being suppressed doesn't block a reply that doesn't go to it.
  store.set("outreachSuppression/geral@empresa.pt", { reason: "hard_bounce" });
  r = await call(ADMIN, { threadId: "th1", body: "Ok.", replyTo: ["ana@empresa.pt"], requestId: "reqreply0000009" });
  ok("suppressed company address doesn't block a reply to Ana", r.ok && JSON.stringify(sends[sends.length - 1].to) === '["ana@empresa.pt"]');
  store.delete("outreachSuppression/geral@empresa.pt");

  // Test mode: every address must be an approved test address.
  store.set("outreachSettings/global", { testMode: true, dailyTarget: 100, testRecipients: ["ana@empresa.pt"] });
  r = await call(ADMIN, { threadId: "th1", body: "Ok.", replyTo: ["ana@empresa.pt"], replyCc: ["socio@outra.pt"], requestId: "reqreply0000010" });
  ok("test mode: a Cc that isn't a test address is refused", reason(r) === "test_mode");
  store.set("outreachSettings/global", { testMode: false, dailyTarget: 100 });

  // A writer's draft keeps the recipients; approving sends to them.
  const before = sends.length;
  r = await call(INTERN, { threadId: "th1", body: "Rascunho.", replyTo: ["ana@empresa.pt"], replyCc: ["socio@outra.pt"], requestId: "reqreply0000011" });
  ok("intern: draft saved with To and Cc, nothing sent", r.draft && sends.length === before && JSON.stringify(msg(r.messageId).cc) === '["socio@outra.pt"]' && JSON.stringify(msg(r.messageId).request.replyTo) === '["ana@empresa.pt"]');
  const a = await call(ADMIN, { action: "approveDraft", messageId: r.messageId });
  ok("approved draft goes to the same To and Cc", a.ok && JSON.stringify(sends[before].to) === '["ana@empresa.pt"]' && JSON.stringify(sends[before].cc) === '["socio@outra.pt"]');

  // A bounce on an email to several people: nobody suppressed on a guess, the conversation is flagged.
  await webhook({ type: "email.bounced", data: { email_id: "rs_x", tags: { om: "reqreply0000002" }, bounce: { type: "Permanent" } } });
  ok("multi-recipient bounce → no suppression, conversation flagged", !store.get("outreachSuppression/ana@empresa.pt") && !store.get("outreachSuppression/socio@outra.pt")
    && JSON.stringify(store.get("outreachThreads/th1").recipientIssue?.addresses) === '["ana@empresa.pt","socio@outra.pt"]');
  // A spam complaint on it suppresses everyone it went to.
  await webhook({ type: "email.complained", data: { email_id: "rs_x", tags: { om: "reqreply0000002" } } });
  ok("multi-recipient complaint → all its addresses suppressed", !!store.get("outreachSuppression/ana@empresa.pt") && !!store.get("outreachSuppression/socio@outra.pt"));

  if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
  console.log("\nALL PASSED");
})();
