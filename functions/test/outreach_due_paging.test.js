// Scheduler: due enrolments of campaigns outside their sending window never
// hold up open campaigns (the due query pages on past them).
const F = require("./fake_firebase.js");
const dns = require("dns").promises;
dns.resolveMx = async (d) => [{ exchange: "mx." + d, priority: 10 }];
const sends = [];
global.fetch = async (url, opts = {}) => {
  if (String(url).endsWith("/emails") && opts.method === "POST") sends.push(JSON.parse(opts.body));
  const hdrs = new Map([["x-resend-daily-quota", "5"], ["x-resend-monthly-quota", "50"]]);
  return { ok: true, status: 200, headers: { get: (h) => hdrs.get(h.toLowerCase()) ?? null }, text: async () => JSON.stringify({ id: "rs_" + sends.length }) };
};
const fns = require("../index.js");
const { runScheduler } = require("../outreach/scheduler.js");
const { store } = F;
const { Timestamp } = require("firebase-admin/firestore");

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = (data) => fns.outreachCampaign({ ...ADMIN, data });

(async () => {
  const now = new Date("2026-09-29T10:30:00+01:00"); // Tuesday, inside the default window
  store.set("outreachSettings/global", { testMode: false, complianceBlockId: "cb" });
  store.set("outreachCompliance/cb", { legalEntityLine: "Douro Partners, Lda", footerText: "Remover: {{unsubscribeUrl}}" });
  await fns.outreachAdmin({ ...ADMIN, data: { action: "seed" } });
  store.set("outreachTemplates/t", { name: "T", status: "active", variants: [{ key: "A", subject: "Olá", body: "Olá." }] });

  // Campaign A: sends only on Saturdays → closed now; 205 enrolments due since yesterday
  store.set("outreachCampaigns/A", { name: "Fim de semana", status: "active", audienceType: "companies", sendWindow: { days: [6], from: "09:00", to: "18:00", tz: "Europe/Lisbon" }, steps: [{ id: "s1", channel: "email", templateId: "t", wait: { days: 0 } }], pacing: { newPerDay: 20 } });
  const yesterday = Timestamp.fromDate(new Date(now.getTime() - 86400000));
  for (let i = 0; i < 205; i++) store.set(`outreachEnrolments/a${String(i).padStart(3, "0")}`, { campaignId: "A", status: "active", nextActionAt: yesterday, currentStep: 0, companyId: `c${i}`, history: [], variants: {} });

  // Campaign B: open, one person due now
  const cid = (await camp({ action: "save", campaign: { name: "Aberta", audienceType: "people", approvalDefault: "auto", senderPolicy: { mode: "fixed", senderIds: ["andre.rocha@douropartners.pt"] }, steps: [{ templateId: "t" }] } })).campaignId;
  await camp({ action: "enrolPeople", campaignId: cid, people: [{ email: "ana@fundo.pt", name: "Ana" }] });
  await camp({ action: "setStatus", campaignId: cid, status: "active" });

  const r = await runScheduler({ now, gap: null, rand: () => 0 });
  ok("the open campaign's email goes out although 205 closed-window enrolments are due first", r.sent === 1 && sends.length === 1 && sends[0].to[0] === "ana@fundo.pt");
  ok("closed-window enrolments are left as they were", [...store.entries()].filter(([p, d]) => p.startsWith("outreachEnrolments/a") && d.status === "active" && d.currentStep === 0).length === 205);

  console.log(fail ? `\n${fail} FAILED` : "\nall due-paging tests passed");
  process.exit(fail ? 1 : 0);
})();
