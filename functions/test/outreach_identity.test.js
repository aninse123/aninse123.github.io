// A second team's outreach (distribution plan, Phase 0 / WP5): sending domains,
// sender seeds, approved test addresses and Cc domains come from the instance
// settings; nothing of Douro's leaks in; an empty test list sends nothing.
process.env.GCLOUD_PROJECT = "pilot-test"; // not "douro-partners": the built-in Douro fallback stays off
const F = require("./fake_firebase.js");
const dns = require("dns").promises;
dns.resolveMx = async (d) => [{ exchange: "mx." + d, priority: 10 }];
const sends = [];
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.endsWith("/emails") && opts.method === "POST") sends.push({ body: JSON.parse(opts.body), auth: opts.headers.Authorization });
  const hdrs = new Map([["x-resend-daily-quota", "5"], ["x-resend-monthly-quota", "50"]]);
  return { ok: true, status: 200, headers: { get: (h) => hdrs.get(h.toLowerCase()) ?? null }, text: async () => JSON.stringify({ id: "rs_" + sends.length }) };
};
const fns = require("../index.js");
const P = require("../access/perms.js");
const C = require("../outreach/config.js");
const U = require("../outreach/campaign_util.js");
const store = F.store;
const I = require("../instance.js");

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "ana@example.test", role: "admin", perms: P.ALL } } };
const quiet = (fn) => async (...a) => { const o = console.error, w = console.warn; console.error = console.warn = () => {}; try { return await fn(...a); } finally { console.error = o; console.warn = w; } };
const settingsFor = (outreach) => ({
  adminEmails: ["ana@example.test"],
  founders: [{ email: "ana@example.test", key: "ana", name: "Ana Admin" }, { email: "bo@example.test", key: "bo", name: "Bo Partner" }],
  portalOrigins: ["https://example.test"], productionHosts: ["example.test"], outreach,
});
const OUTREACH = {
  senderDomain: "mail.example.test", relationshipDomain: "example.test", unsubscribeBaseUrl: "https://example.test/u/",
  ccDomains: ["example.test", "mail.example.test"], testRecipients: ["ana@example.test", "tester@gmail.com"],
  seedSenders: [{ local: "ana.a", owner: "ana", displayName: "Ana Admin", status: "active" }],
  relationshipSenders: [{ email: "ana@example.test", owner: "ana", displayName: "Ana Admin" }, { email: "noreply@example.test", owner: null, displayName: "Example Fund" }],
  signatureLines: ["Example Fund", "www.example.test"],
};

(async () => {
  // ── The Douro fallback equals the seed file (so Douro behaves as before) ──
  const seed = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "..", "instances", "douro", "instance.json"), "utf8"));
  ok("the seed file is a valid instance (validateInstance finds nothing)", I.validateInstance(seed.settings, seed.public).length === 0);

  // ── Not seeded, not Douro's project: nothing configured, nothing from Douro ──
  P._resetIdentity();
  await quiet(() => P.loadIdentity({ force: true }))();
  ok("not seeded: no domains, no test addresses, no senders", C.senderDomain() === "" && C.testRecipients().length === 0 && C.seedSenders().length === 0 && C.relationshipSenders().length === 0);
  const st0 = await quiet(() => require("../outreach/store.js").getSettings())();
  ok("settings default: test mode on, free-mail rule off, empty approved list", st0.testMode === true && st0.blockPersonalDomains === false && st0.testRecipients.length === 0);
  ok("Cc is refused when no domain is configured", (() => { try { U.normalizeCc(["x@example.test"]); return false; } catch (e) { return e.reason === "bad_cc" || /Cc/.test(e.message); } })());

  // ── Seed a second team ──
  store.set("instance/settings", settingsFor(OUTREACH));
  store.set("instance/public", { orgName: "Example Fund", portalUrl: "https://example.test/portal/", contacts: [{ name: "Ana", email: "ana@example.test" }] });
  await P.loadIdentity({ force: true });
  ok("valid: their settings pass validateInstance", I.validateInstance(settingsFor(OUTREACH), { orgName: "Example Fund", portalUrl: "https://example.test/portal/", contacts: [{ name: "Ana", email: "ana@example.test" }] }).length === 0);
  ok("accessors give their domains and addresses", C.senderDomain() === "mail.example.test" && C.relationshipDomain() === "example.test" && C.unsubscribeBaseUrl() === "https://example.test/u/" && C.testRecipients().includes("tester@gmail.com") && C.orgName() === "Example Fund");

  const sd = await fns.outreachAdmin({ ...ADMIN, data: { action: "seed" } });
  const sender = store.get("outreachSenders/ana.a@mail.example.test");
  ok("seed: their senders on their domain with their signature, none of Douro's", sender && sender.domain === "mail.example.test" && sender.signature === "Ana Admin\nExample Fund\nwww.example.test" && sender.inboundAlias === "ana.a"
    && ![...store.keys()].some((k) => /douro/i.test(k)));
  const rel = store.get("outreachSenders/ana@example.test"), noreply = store.get("outreachSenders/noreply@example.test");
  ok("seed: relationship senders on their domain; the noreply one is signed with the organisation", rel.kind === "relationship" && rel.domain === "example.test" && noreply.signature === "Example Fund");
  const gs = store.get("outreachSettings/global");
  ok("seed: settings carry their approved test list and the free-mail rule is off", gs.testRecipients.join() === OUTREACH.testRecipients.join() && gs.blockPersonalDomains === false && gs.campaignTestRecipient === null);

  // ── Cc: only their own domains ──
  ok("Cc accepts their addresses, refuses Douro's and outsiders", U.normalizeCc(["bo@example.test"]).length === 1
    && (() => { try { U.normalizeCc(["andre.rocha@douropartners.pt"]); return false; } catch (e) { return /@example\.test/.test(e.message) && !/douro/i.test(e.message.split(": not")[0]); } })());

  // ── Test mode with an empty approved list sends nothing ──
  store.set("instance/settings", settingsFor({ ...OUTREACH, testRecipients: [] }));
  await P.loadIdentity({ force: true });
  store.set("outreachSettings/global", { testMode: true, testRecipients: [] });
  store.set("outreachSenders/ana.a@mail.example.test", { ...sender, status: "active" });
  const before = sends.length;
  let refused;
  try { await fns.outreachSend({ ...ADMIN, data: { senderId: "ana.a@mail.example.test", to: "someone@company.pt", subject: "Hi", text: "Hello" } }); } catch (e) { refused = e; }
  ok("test mode with an empty approved list: the send is refused and nothing goes out", !!refused && sends.length === before);

  // ── Production vs staging follows their own hosts (WP7) ──
  const Feat = require("../features/index.js");
  store.set("instance/settings", settingsFor(OUTREACH));
  await P.loadIdentity({ force: true });
  ok("their production host is production, anything else is staging, Douro's host is just another staging", Feat.siteOfOrigin("https://example.test") === "production"
    && Feat.siteOfOrigin("https://preview--example.netlify.app") === "staging" && Feat.siteOfOrigin("https://douropartners.pt") === "staging" && Feat.siteOfOrigin("nonsense") === "production");
  P._resetIdentity(); store.delete("instance/settings"); await quiet(() => P.loadIdentity({ force: true }))();
  ok("not seeded: every origin counts as the stricter production site", Feat.siteOfOrigin("https://anything.test") === "production");

  console.log(fail ? `\n${fail} FAILED` : "\nAll passed");
  process.exitCode = fail ? 1 : 0;
})();
