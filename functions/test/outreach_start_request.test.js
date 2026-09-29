// Team access B1 — someone who prepares campaigns without "approve" asks a
// partner to start it; the partner starts it or returns it with a note. A
// campaign that has started can't be changed / added to without "approve".
const F = require("./fake_firebase.js");
const fns = require("../index.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const PARTNER = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const INTERN = { auth: { token: { email: "maria@douropartners.pt", perms: ["out.view", "out.draft", "out.tasks", "out.campaigns", "search.view", "search.edit"], key: "maria" } } };
const call = async (data, who) => { try { return await fns.outreachCampaign({ ...who, data }); } catch (e) { return { err: e }; } };
const camp = (id) => store.get(`outreachCampaigns/${id}`);

(async () => {
  store.set("outreachSettings/global", { testMode: true });
  store.set("outreachTemplates/t1", { name: "Intro", status: "active", variants: [{ key: "A", subject: "Olá", body: "Texto" }] });
  store.set("outreachTemplates/t2", { name: "Outro", status: "active", variants: [{ key: "A", subject: "Olá 2", body: "Texto 2" }] });
  store.set("searchCompanies/c1", { name: "EMPRESA A, LDA", companyEmail: "a@a.pt", stage: "universe" });

  const made = await call({ action: "save", campaign: { name: "Metalurgia", steps: [{ templateId: "t1" }] } }, INTERN);
  const id = made.campaignId;
  ok("intern prepares a draft campaign", !!id && camp(id).status === "draft");
  ok("intern adds companies to the draft", !(await call({ action: "enrol", campaignId: id, companyIds: ["c1"] }, INTERN)).err);
  ok("intern can't start it", (await call({ action: "setStatus", campaignId: id, status: "active" }, INTERN)).err?.details?.reason === "not_admin");

  // Not ready → the request is refused with the same checks as Start
  const bad = await call({ action: "save", campaign: { name: "Vazia", steps: [{}] } }, INTERN);
  ok("asking to start a campaign that couldn't start is refused (same checks)", (await call({ action: "requestStart", campaignId: bad.campaignId }, INTERN)).err?.details?.reason === "not_ready");

  ok("intern asks to start, with a note", !(await call({ action: "requestStart", campaignId: id, note: "Pronta para arrancar" }, INTERN)).err
    && camp(id).startRequest?.by === "maria@douropartners.pt" && camp(id).startRequest.note === "Pronta para arrancar");
  ok("intern can't return it", (await call({ action: "returnStart", campaignId: id }, INTERN)).err?.details?.reason === "not_admin");

  // Partner returns → intern sees the note; asks again
  await call({ action: "returnStart", campaignId: id, note: "Muda o assunto" }, PARTNER);
  ok("partner returns it with a note", !camp(id).startRequest && camp(id).startReturn?.note === "Muda o assunto" && camp(id).startReturn.requestedBy === "maria@douropartners.pt");
  ok("returning again: nothing is waiting", (await call({ action: "returnStart", campaignId: id }, PARTNER)).err?.details?.reason === "not_waiting");
  await call({ action: "requestStart", campaignId: id }, INTERN);
  ok("asking again clears the returned note", !!camp(id).startRequest && !camp(id).startReturn);

  // Editing withdraws (intern); a partner's edit keeps it
  await call({ action: "save", campaignId: id, campaign: { name: "Metalurgia Norte", steps: [{ templateId: "t2" }] } }, INTERN);
  ok("intern edits after asking: the request is withdrawn", !camp(id).startRequest && camp(id).name === "Metalurgia Norte");
  await call({ action: "requestStart", campaignId: id }, INTERN);
  await call({ action: "save", campaignId: id, campaign: { name: "Metalurgia Norte", steps: [{ templateId: "t1" }] } }, PARTNER);
  ok("partner edits: the request stays", !!camp(id).startRequest);

  // Partner starts → request cleared
  const st = await call({ action: "setStatus", campaignId: id, status: "active" }, PARTNER);
  ok("partner starts it: active, request cleared", !st.err && camp(id).status === "active" && !camp(id).startRequest && !camp(id).startReturn);

  // Started campaign: intern can't change it, add to it or finish it; can pause
  store.set("searchCompanies/c2", { name: "EMPRESA B, LDA", companyEmail: "b@b.pt", stage: "universe" });
  ok("intern can't edit a started campaign", (await call({ action: "save", campaignId: id, campaign: { name: "X", steps: [{ templateId: "t1" }] } }, INTERN)).err?.details?.reason === "needs_approve");
  ok("intern can't add companies to a started campaign", (await call({ action: "enrol", campaignId: id, companyIds: ["c2"] }, INTERN)).err?.details?.reason === "needs_approve");
  ok("intern can't finish it", (await call({ action: "setStatus", campaignId: id, status: "finished" }, INTERN)).err?.details?.reason === "not_admin");
  ok("intern can pause it (safety)", !(await call({ action: "setStatus", campaignId: id, status: "paused" }, INTERN)).err && camp(id).status === "paused");
  ok("still can't edit while paused", (await call({ action: "save", campaignId: id, campaign: { name: "X", steps: [{ templateId: "t1" }] } }, INTERN)).err?.details?.reason === "needs_approve");
  // B9 / B10: once running, only partners change it — also removing / moving people.
  const en1 = `${id}_c1`;
  ok("B9: intern can't remove a company from a started campaign", (await call({ action: "enrolment", enrolmentId: en1, op: "remove" }, INTERN)).err?.details?.reason === "needs_approve");
  ok("B9: …nor pause or move one", (await call({ action: "enrolment", enrolmentId: en1, op: "pause" }, INTERN)).err?.details?.reason === "needs_approve"
    && (await call({ action: "enrolment", enrolmentId: en1, op: "move", targetCampaignId: made.campaignId }, INTERN)).err?.details?.reason === "needs_approve");
  ok("B10: intern asks to resume a paused campaign", !(await call({ action: "requestStart", campaignId: id, note: "Corrigi o assunto" }, INTERN)).err && camp(id).startRequest?.kind === "resume" && camp(id).status === "paused");
  ok("B10: partner returns it with a note — stays paused", !(await call({ action: "returnStart", campaignId: id, note: "Ainda não" }, PARTNER)).err && camp(id).status === "paused" && !camp(id).startRequest && camp(id).startReturn?.note === "Ainda não");
  await call({ action: "setStatus", campaignId: id, status: "finished" }, PARTNER);
  ok("asking to start a finished campaign is refused", (await call({ action: "requestStart", campaignId: id }, INTERN)).err?.details?.reason === "not_draft");
  const id2 = (await call({ action: "save", campaign: { name: "Segunda", steps: [{ templateId: "t1" }] } }, PARTNER)).campaignId;
  await call({ action: "enrol", campaignId: id2, companyIds: ["c1"] }, PARTNER);
  await call({ action: "setStatus", campaignId: id2, status: "active" }, PARTNER);
  ok("partner still adds companies to a started campaign", !(await call({ action: "enrol", campaignId: id2, companyIds: ["c2"] }, PARTNER)).err);

  console.log(fail ? `\n${fail} FAILED` : "\nall start-request tests passed");
  process.exit(fail ? 1 : 0);
})();
