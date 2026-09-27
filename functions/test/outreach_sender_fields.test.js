// T4 — {{sender.phone}} / {{sender.email}} / {{sender.name}}: a team member's
// contact details (Team) reach the directory; emails fill them from the
// sending address and its owner; tasks can name who signs.
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
const { store } = F;
let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const PARTNER = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const team = async (data) => { try { return await fns.teamAccess({ ...PARTNER, data }); } catch (e) { return { err: e }; } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...PARTNER, data }); } catch (e) { return { err: e }; } };

(async () => {
  await team({ action: "seed" });
  ok("bad phone refused", (await team({ action: "update", email: "andre.rocha@douropartners.pt", member: { contactPhone: "ligue-me!" } })).err?.details?.reason === "bad_phone");
  ok("bad contact email refused", (await team({ action: "update", email: "andre.rocha@douropartners.pt", member: { contactEmail: "nope" } })).err?.details?.reason === "bad_contact_email");
  const u = await team({ action: "update", email: "andre.rocha@douropartners.pt", member: { contactPhone: "+351 912 345 678" } });
  const dir = store.get("teamDirectory/andre");
  ok("partner saves a phone: stored and in the directory; email defaults to the @douropartners.pt sign-in", !u.err && store.get("team/andre.rocha@douropartners.pt").roleId === "partner" && dir.contactPhone === "+351 912 345 678" && dir.contactEmail === "andre.rocha@douropartners.pt");
  await team({ action: "invite", member: { email: "maria@gmail.com", name: "Maria Silva", key: "maria", roleId: "intern" } });
  ok("a personal sign-in email never goes into the directory", store.get("teamDirectory/maria").contactEmail === null);

  // Email: sender.email = the sending address, sender.phone = its owner's
  store.set("outreachSettings/global", { testMode: false, complianceBlockId: "cb" });
  store.set("outreachCompliance/cb", { legalEntityLine: "Douro Partners, Lda", footerText: "Remover: {{unsubscribeUrl}}" });
  await fns.outreachAdmin({ ...PARTNER, data: { action: "seed" } });
  const sid = "an.rocha@mail.douropartners-team.pt";
  store.set(`outreachSenders/${sid}`, { ...store.get(`outreachSenders/${sid}`), status: "active", owner: "andre" });
  store.set("searchCompanies/c1", { name: "EMPRESA TESTE, LDA", companyEmail: "geral@empresa.pt", owner: "andre" });
  await fns.outreachSend({ ...PARTNER, data: { companyId: "c1", senderId: sid, subject: "Olá", body: "Sou {{sender.name}}: {{sender.phone}} / {{sender.email}}" } });
  ok("email fills name, the owner's phone and the sending address", /\+351 912 345 678 \/ an\.rocha@mail\.douropartners-team\.pt/.test(sends[0]?.text || "") && /Sou \S/.test(sends[0]?.text || ""));

  // Campaign signer + task override
  const c = await camp({ action: "save", campaign: { name: "Cartas", signer: "maria", steps: [{ channel: "letter" }] } });
  ok("campaign keeps who signs letters", store.get(`outreachCampaigns/${c.campaignId}`).signer === "maria");
  const c2 = await camp({ action: "save", campaign: { name: "Cartas 2", signer: "NOT A KEY", steps: [{ channel: "letter" }] } });
  ok("an invalid signer falls back to the company's owner", store.get(`outreachCampaigns/${c2.campaignId}`).signer === "owner");
  store.set("outreachTasks/t1", { status: "open", channel: "letter", campaignId: c.campaignId, companyId: "c1" });
  ok("a task's signer can be changed to someone on the team", !(await camp({ action: "updateTask", taskId: "t1", signer: "antonio" })).err && store.get("outreachTasks/t1").signer === "antonio");
  ok("…not to someone unknown", (await camp({ action: "updateTask", taskId: "t1", signer: "ghost" })).err?.details?.reason === "bad_signer");
  ok("…and back to the campaign's choice (null)", !(await camp({ action: "updateTask", taskId: "t1", signer: null })).err && store.get("outreachTasks/t1").signer === null);

  console.log(fail ? `\n${fail} FAILED` : "\nall sender-field tests passed");
  process.exit(fail ? 1 : 0);
})();
