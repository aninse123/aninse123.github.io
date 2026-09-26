// Phase 5c — outreachPeopleSend (replaces the Netlify notify function):
// admin only, same templates, suppression rules per kind, combined sends,
// test-mode redirect, audit log, full-access key.
const F = require("./fake_firebase.js");
const batches = [];
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  let out = { id: "x" };
  if (u.endsWith("/emails/batch")) {
    const emails = JSON.parse(opts.body);
    batches.push({ emails, auth: opts.headers.Authorization, idem: opts.headers["Idempotency-Key"] });
    out = { data: emails.map((_, i) => ({ id: `rb_${batches.length}_${i}` })) };
  }
  const hdrs = new Map([["x-resend-daily-quota", "7"], ["x-resend-monthly-quota", "70"]]);
  return { ok: true, status: 200, headers: { get: (h) => hdrs.get(h.toLowerCase()) ?? null }, text: async () => JSON.stringify(out) };
};
const fns = require("../index.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const send = async (data, email = "andre.rocha@douropartners.pt") => { try { return await fns.outreachPeopleSend({ auth: { token: { email } }, data }); } catch (e) { return { err: e }; } };
const logs = () => [...store.entries()].filter(([p]) => p.startsWith("outreachPeopleSends/")).map(([, d]) => d);

(async () => {
  store.set("outreachSettings/global", { testMode: false });
  ok("admins only", (await send({ recipients: [{ email: "a@b.pt" }], subject: "s", message: "m" }, "someone@gmail.com")).err?.details?.reason === "not_admin");
  ok("subject and message required", (await send({ recipients: [{ email: "a@b.pt" }], subject: " ", message: "m" })).err?.details?.reason === "missing_fields");
  ok("bad address refused", (await send({ recipients: [{ email: "nope" }], subject: "s", message: "m" })).err?.details?.reason === "bad_email");
  ok("max 250", (await send({ recipients: Array.from({ length: 251 }, (_, i) => ({ email: `p${i}@x.pt` })), subject: "s", message: "m" })).err?.details?.reason === "too_many");

  // Investor notice: one email each, portal template, noreply by default, no CC
  store.set("outreachSuppression/unsub@fundo.pt", { reason: "unsubscribed" });
  store.set("outreachSuppression/bounce@fundo.pt", { reason: "hard_bounce" });
  const r1 = await send({ recipients: [{ email: "Ana@Alfa.pt", name: "Fundo Alfa" }, { email: "unsub@fundo.pt", name: "Fundo U" }, { email: "bounce@fundo.pt", name: "Fundo B" }], subject: "Novo documento", message: "Linha 1\nLinha 2", docName: "Relatório Q3", docCategory: "Report" });
  const b1 = batches[0];
  ok("notice: sent to Ana and the outreach-unsubscribed investor; the bounced address skipped", r1.sent === 2 && r1.skipped.length === 1 && r1.skipped[0].email === "bounce@fundo.pt");
  ok("notice: portal template with greeting, document card and button", /Dear <strong>Fundo Alfa<\/strong> team/.test(b1.emails[0].html) && /Relatório Q3/.test(b1.emails[0].html) && /View in Investor Portal/.test(b1.emails[0].html) && /Linha 1<br>Linha 2/.test(b1.emails[0].html));
  ok("notice: from noreply@, no CC, full-access key, idempotency key", b1.emails[0].from === "Douro Partners <noreply@douropartners.pt>" && !b1.emails[0].cc && b1.auth === "Bearer secret-RESEND_READ_KEY" && /-0$/.test(b1.idem));
  const l1 = logs()[0];
  ok("logged: kind notice, recipients, ids, who", l1.kind === "notice" && l1.sent === 2 && l1.resendIds.length === 2 && l1.by === "andre.rocha@douropartners.pt");
  ok("usage bar gets Resend's count", store.get(`outreachUsage/${new Date().toISOString().slice(0, 10)}`)?.resendDailyUsed === 7);

  // Outreach from André, combined: one email to the firm's team, António CC'd; any suppression skips
  const r2 = await send({ recipients: [{ email: "rui@firma.pt", name: "Rui" }, { email: "eva@firma.pt", name: "Eva" }, { email: "unsub@fundo.pt" }], subject: "Olá", message: "Texto", from: "andre", kind: "outreach", combined: true, docName: "Teaser", docUrl: "https://x/y.pdf" });
  const e2 = batches[1].emails;
  ok("outreach combined: one email, both in To, unsubscribed skipped", r2.sent === 1 && e2.length === 1 && e2[0].to.join(",") === "rui@firma.pt,eva@firma.pt" && r2.skipped[0].email === "unsub@fundo.pt");
  ok("outreach: from André, António in CC, outreach template with document link", e2[0].from === "André Rocha <andre.rocha@douropartners.pt>" && e2[0].cc[0] === "António Carvalho <antonio.carvalho@douropartners.pt>" && /View Document/.test(e2[0].html) && !/Investor Portal/.test(e2[0].html));
  ok("everyone suppressed → nothing sent", (await send({ recipients: [{ email: "unsub@fundo.pt" }], subject: "s", message: "m", kind: "outreach" })).sent === 0 && batches.length === 2);

  // Over 100 → split into batches
  await send({ recipients: Array.from({ length: 130 }, (_, i) => ({ email: `inv${i}@x.pt`, name: "I" })), subject: "Update", message: "m" });
  ok("130 notices → batches of 100 + 30", batches[2].emails.length === 100 && batches[3].emails.length === 30);

  // Test mode: everything to the test address, no CC, subject shows the intended recipients
  store.set("outreachSettings/global", { testMode: true, campaignTestRecipient: "andrenorocha@gmail.com" });
  const r5 = await send({ recipients: [{ email: "ana@alfa.pt", name: "Fundo Alfa" }], subject: "Novo documento", message: "m", from: "antonio", kind: "outreach" });
  const e5 = batches[4].emails[0];
  ok("test mode: redirected, no CC, subject tagged, logged as test", r5.isTest && e5.to[0] === "andrenorocha@gmail.com" && !e5.cc && e5.subject === "[TEST → ana@alfa.pt] Novo documento" && logs().some((l) => l.isTest && l.redirectedTo === "andrenorocha@gmail.com"));
  store.set("outreachSettings/global", { testMode: true });
  ok("test mode with no address set → the default campaign test address", (await send({ recipients: [{ email: "a@b.pt" }], subject: "s", message: "m" })).isTest && batches[5].emails[0].to[0] === "andrenorocha@gmail.com");

  console.log(fail ? `\n${fail} FAILED` : "\nall 5c tests passed");
  process.exit(fail ? 1 : 0);
})();
