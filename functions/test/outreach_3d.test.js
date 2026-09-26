// Phase 3d — open/click tracking switch (Resend domain setting) and the
// "if they clicked a link" rule on email steps.
const F = require("./fake_firebase.js");
const dns = require("dns").promises;
dns.resolveMx = async (d) => [{ exchange: "mx." + d, priority: 10 }];
const calls = [];
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null });
  const hdrs = new Map([["x-resend-daily-quota", "5"], ["x-resend-monthly-quota", "50"]]);
  const resp = (obj) => ({ ok: true, status: 200, headers: { get: (h) => hdrs.get(h.toLowerCase()) ?? null }, text: async () => JSON.stringify(obj) });
  if (u.endsWith("/domains") && (opts.method || "GET") === "GET") return resp({ data: [{ id: "dom_other", name: "douropartners.pt" }, { id: "dom_out", name: "mail.douropartners-team.pt" }] });
  if (u.includes("/domains/") && opts.method === "PATCH") return resp({ id: "dom_out" });
  return resp({ id: "rs_" + calls.length });
};

const fns = require("../index.js");
const { runScheduler, stepMessageId } = require("../outreach/scheduler.js");
const { store, Timestamp } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const admin = async (data) => { try { return await fns.outreachAdmin({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
const get = (p) => store.get(p);
const run = (iso) => runScheduler({ now: new Date(iso), gap: null, rand: () => 0 });

(async () => {
  store.set("outreachSenders/an.rocha@mail.douropartners-team.pt", { email: "an.rocha@mail.douropartners-team.pt", displayName: "André Rocha", owner: "andre", status: "active", dailyCap: 25, signature: "A" });
  store.set("outreachTemplates/t1", { name: "Intro", status: "active", variants: [{ key: "A", subject: "Olá", body: "Corpo" }] });
  store.set("outreachTemplates/t2", { name: "Follow", status: "active", variants: [{ key: "A", subject: "x", body: "Seguimento" }] });
  for (const id of ["a", "b"]) store.set(`searchCompanies/${id}`, { name: `EMPRESA ${id}`, stage: "universe", companyEmail: `geral@${id}.pt`, owner: "andre" });

  // Tracking switch
  const on = await admin({ action: "setTracking", on: true });
  const patch = calls.find((c) => c.method === "PATCH");
  ok("setTracking: patches only the outreach domain in Resend", on.ok && patch && patch.url.endsWith("/domains/dom_out") && patch.body.open_tracking === true && patch.body.click_tracking === true);
  ok("setTracking: recorded in settings", get("outreachSettings/global").trackOpensClicks === true);

  // Campaign: email 1 → (if clicked: go to step 3) → email 2 → email 3
  const steps = [{ templateId: "t1" }, { templateId: "t2", wait: { days: 0 } }, { templateId: "t2", wait: { days: 0 }, newSubject: true }];
  const { campaignId } = await camp({ action: "save", campaign: { name: "Cliques", approvalDefault: "auto", steps } });
  await camp({ action: "save", campaignId, campaign: { steps: [{ id: "s1", templateId: "t1", branches: [{ outcome: "clicked", action: "goto", stepId: "s3" }] }, { id: "s2", templateId: "t2", wait: { days: 1, unit: "calendar" } }, { id: "s3", templateId: "t2", wait: { days: 0 }, newSubject: true }] } });
  await camp({ action: "enrol", campaignId, companyIds: ["a", "b"] });
  // Without tracking, a click rule can't start
  store.set("outreachSettings/global", { ...get("outreachSettings/global"), trackOpensClicks: false });
  const blocked = await camp({ action: "setStatus", campaignId, status: "active" });
  ok("click rule needs tracking on to start", /need open\/click tracking/.test(blocked.err?.message || ""));
  store.set("outreachSettings/global", { ...get("outreachSettings/global"), trackOpensClicks: true });
  ok("with tracking on it starts", (await camp({ action: "setStatus", campaignId, status: "active" })).status === "active");

  await run("2026-09-29T10:30:00+01:00");       // email 1 to a
  await run("2026-09-29T10:40:00+01:00");       // email 1 to b (one per address per run)
  // a clicked the link in email 1
  const m1a = stepMessageId(`${campaignId}_a`, "s1");
  store.set(`outreachMessages/${m1a}`, { ...get(`outreachMessages/${m1a}`), firstClickedAt: Timestamp.now() });
  const r = await run("2026-09-30T10:50:00+01:00"); // next day: step 2 is due
  const ea = get(`outreachEnrolments/${campaignId}_a`), eb = get(`outreachEnrolments/${campaignId}_b`);
  ok("clicked → jumps to step 3 (email 2 skipped), rule recorded", r.jumped === 1 && ea.currentStep === 2 && ea.rulesApplied?.s1 === "clicked");
  ok("no click → normal next step", eb.currentStep >= 1 && !eb.rulesApplied);
  await run("2026-09-30T11:00:00+01:00");
  ok("after the jump, step 3 is sent (not step 2)", !!get(`outreachMessages/${stepMessageId(`${campaignId}_a`, "s3")}`) && !get(`outreachMessages/${stepMessageId(`${campaignId}_a`, "s2")}`));

  // "end" rule (the first campaign is finished so the two don't compete for the one address)
  await camp({ action: "setStatus", campaignId, status: "finished" });
  const c2 = (await camp({ action: "save", campaign: { name: "Fim", approvalDefault: "auto", steps: [{ templateId: "t1" }, { templateId: "t2", wait: { days: 0 } }] } })).campaignId;
  await camp({ action: "save", campaignId: c2, campaign: { steps: [{ id: "s1", templateId: "t1", branches: [{ outcome: "clicked", action: "end" }] }, { id: "s2", templateId: "t2", wait: { days: 1, unit: "calendar" } }] } });
  store.set("searchCompanies/c", { name: "EMPRESA c", stage: "universe", companyEmail: "geral@c.pt", owner: "andre" });
  await camp({ action: "enrol", campaignId: c2, companyIds: ["c"] });
  await camp({ action: "setStatus", campaignId: c2, status: "active" });
  await run("2026-10-01T10:30:00+01:00");
  const m1c = stepMessageId(`${c2}_c`, "s1");
  store.set(`outreachMessages/${m1c}`, { ...get(`outreachMessages/${m1c}`), firstClickedAt: Timestamp.now() });
  await run("2026-10-02T10:40:00+01:00");
  ok("clicked + 'end' rule → completed, company released", get(`outreachEnrolments/${c2}_c`).status === "completed" && /clicked a link/.test(get(`outreachEnrolments/${c2}_c`).stopReason) && get("searchCompanies/c").activeCampaignId === undefined);

  const off = await admin({ action: "setTracking", on: false });
  ok("tracking can be switched off again", off.on === false && get("outreachSettings/global").trackOpensClicks === false && calls.filter((c) => c.method === "PATCH").pop().body.click_tracking === false);

  console.log(fail ? `\n${fail} FAILED` : "\nall 3d tests passed");
  process.exit(fail ? 1 : 0);
})();
