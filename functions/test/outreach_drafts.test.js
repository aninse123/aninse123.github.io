// Team access Phase 2b — emails written by someone without "send" wait in
// To approve as manual drafts; a partner approves (sent now, all checks again)
// or returns them with a note.
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
const INTERN = { auth: { token: { email: "maria@douropartners.pt", perms: ["out.view", "out.draft", "out.tasks"], key: "maria" } } };
const VIEWER = { auth: { token: { email: "v@douropartners.pt", perms: ["out.view"] } } };
const send = async (req, data) => { try { return await fns.outreachSend({ ...req, data }); } catch (e) { return { err: e }; } };
const docs = (coll) => [...store.entries()].filter(([p]) => p.startsWith(coll + "/")).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));

(async () => {
  store.set("outreachSettings/global", { testMode: false, complianceBlockId: "cb" });
  store.set("outreachCompliance/cb", { legalEntityLine: "Douro Partners, Lda", footerText: "Remover: {{unsubscribeUrl}}" });
  await fns.outreachAdmin({ ...PARTNER, data: { action: "seed" } });
  store.set("outreachSenders/an.rocha@mail.douropartners-team.pt", { ...store.get("outreachSenders/an.rocha@mail.douropartners-team.pt"), status: "active" });
  store.set("searchCompanies/c1", { name: "EMPRESA TESTE, LDA", companyEmail: "geral@empresa.pt", owner: "andre" });
  const base = { companyId: "c1", senderId: "an.rocha@mail.douropartners-team.pt", subject: "Olá {{company.shortName}}", body: "Texto da Maria." };

  ok("view-only can't write emails", (await send(VIEWER, base)).err?.details?.reason === "not_admin");
  const d1 = await send(INTERN, base);
  const draft = store.get(`outreachMessages/${d1.messageId}`);
  ok("intern: saved as a manual draft, nothing sent", d1.draft === true && sends.length === 0 && draft.status === "draft" && draft.source === "manual" && draft.writtenBy === "maria@douropartners.pt" && draft.writtenByKey === "maria");
  ok("the draft is rendered and keeps the request to send it later", draft.subject === "Olá Empresa Teste" && draft.request.companyId === "c1" && draft.request.body === "Texto da Maria." && !docs("outreachThreads").length);
  ok("checks still run when writing (bad sender refused)", (await send(INTERN, { ...base, senderId: "nobody@x.pt" })).err != null);
  ok("an intern can't approve", (await send(INTERN, { action: "approveDraft", messageId: d1.messageId })).err?.details?.reason === "not_admin");

  const a1 = await send(PARTNER, { action: "approveDraft", messageId: d1.messageId, body: "Texto da Maria, revisto." });
  const sent = sends[0];
  ok("partner approves with an edit: sent once, edited text, from the chosen address", sends.length === 1 && /Texto da Maria, revisto\./.test(sent.text) && /an\.rocha@mail\.douropartners-team\.pt/.test(sent.from) && a1.writtenBy === "maria@douropartners.pt");
  const d1after = store.get(`outreachMessages/${d1.messageId}`);
  const real = store.get(`outreachMessages/${d1after.sentMessageId}`);
  ok("the draft record says it went out (draftSent); the email is its own record, marked as written by her", d1after.status === "draftSent" && real && real.writtenBy === "maria@douropartners.pt" && real.draftId === d1.messageId && real.status !== "draft");
  ok("a conversation now exists, activity logged", docs("outreachThreads").length === 1 && docs("searchActivities").some((a) => a.companyId === "c1"));
  ok("can't approve twice", (await send(PARTNER, { action: "approveDraft", messageId: d1.messageId })).err?.details?.reason === "not_waiting");

  // Reply draft + return
  const thread = docs("outreachThreads")[0];
  const d2 = await send(INTERN, { threadId: thread.id, body: "Resposta da Maria." });
  ok("reply written by the intern: a draft in the same conversation", d2.draft === true && store.get(`outreachMessages/${d2.messageId}`).isReply === true && sends.length === 1);
  await send(PARTNER, { action: "returnDraft", messageId: d2.messageId, note: "Mais curto, por favor." });
  const d2after = store.get(`outreachMessages/${d2.messageId}`);
  ok("returned with a note (nothing sent)", d2after.status === "returned" && d2after.returnNote === "Mais curto, por favor." && sends.length === 1);
  ok("a returned draft can't be approved", (await send(PARTNER, { action: "approveDraft", messageId: d2.messageId })).err?.details?.reason === "not_waiting");

  // A failing approval puts the draft back with the reason
  const d3 = await send(INTERN, base);
  store.set("outreachSenders/an.rocha@mail.douropartners-team.pt", { ...store.get("outreachSenders/an.rocha@mail.douropartners-team.pt"), status: "paused" });
  const a3 = await send(PARTNER, { action: "approveDraft", messageId: d3.messageId });
  ok("approval fails (address paused): draft back in the queue with the reason", a3.err != null && store.get(`outreachMessages/${d3.messageId}`).status === "draft" && !!store.get(`outreachMessages/${d3.messageId}`).lastError);

  // Partners still send directly
  store.set("outreachSenders/an.rocha@mail.douropartners-team.pt", { ...store.get("outreachSenders/an.rocha@mail.douropartners-team.pt"), status: "active" });
  const direct = await send(PARTNER, base);
  ok("partners send directly as before", !direct.draft && sends.length === 2);

  const pd = await send(PARTNER, { ...base, asDraft: true });
  ok("a partner can ask for a draft (preview as a writer): saved, not sent", pd.draft === true && sends.length === 2 && store.get(`outreachMessages/${pd.messageId}`).status === "draft");
  ok("asDraft doesn't let a view-only person write", (await send(VIEWER, { ...base, asDraft: true })).err?.details?.reason === "not_admin");

  console.log(fail ? `\n${fail} FAILED` : "\nall draft tests passed");
  process.exit(fail ? 1 : 0);
})();
