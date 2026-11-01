// Instance settings (distribution plan, Phase 0 / WP1): normalising, validating,
// loading with a cache, and failing closed.
const F = require("./fake_firebase.js");
const I = require("../instance.js");
const { store } = F;
const fs = require("fs");
const path = require("path");

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

const SETTINGS = {
  adminEmails: ["Admin@Example.test", "admin@example.test"],
  founders: [{ email: "admin@example.test", key: "ana", name: "Ana Admin" }, { email: "Bo@Example.test", key: "bo", name: "Bo Partner" }],
  portalOrigins: ["https://example.test/", "https://staging.example.test"],
  noreplyFrom: "Example <noreply@example.test>",
  productionHosts: ["Example.test"],
};
const PUBLIC = { orgName: "Example Fund", logoUrl: "https://example.test/logo.png", portalUrl: "https://example.test/portal/", contacts: [{ name: "Ana", email: "admin@example.test" }, { name: "Bo", email: "bo@example.test" }] };

(async () => {
  // ── normalising ──
  const n = I.normalizeInstance(SETTINGS, PUBLIC);
  ok("emails are lower-cased and de-duplicated; configured when there is an admin", n.configured && JSON.stringify(n.adminEmails) === '["admin@example.test"]');
  ok("founders keep key and name, emails lower-cased", n.founders.length === 2 && n.founders[1].email === "bo@example.test" && I.founderKey(n, "BO@example.test") === "bo" && I.founderName(n, "admin@example.test") === "Ana Admin");
  ok("origins lose their trailing slash; hosts are lower-cased", n.portalOrigins[0] === "https://example.test" && n.productionHosts[0] === "example.test");
  ok("isAdminEmail is case-insensitive and false for a non-admin or empty", I.isAdminEmail(n, " ADMIN@example.test ") && !I.isAdminEmail(n, "bo@example.test") && !I.isAdminEmail(n, "") && !I.isAdminEmail(n, null));
  ok("an unknown person has no key or name", I.founderKey(n, "x@example.test") === null && I.founderName(n, "x@example.test") === null);
  const junk = I.normalizeInstance({ adminEmails: ["not-an-email", 5, null], founders: [{ email: "a@b.test", key: "Bad Key!", name: "A" }, { email: "c@d.test", key: "cd", name: "" }, { key: "x", name: "X" }] }, { contacts: [{ name: "", email: "a@b.test" }, { name: "A" }] });
  ok("junk is dropped, never thrown on: not configured, no founders, no contacts", !junk.configured && !junk.adminEmails.length && !junk.founders.length && !junk.contacts.length);
  const none = I.normalizeInstance(null, undefined);
  ok("nothing at all = not configured, empty lists", !none.configured && !none.adminEmails.length && none.orgName === "");
  ok("the sign-in refusal line names the contacts", I.contactLine(n) === "contact Ana (admin@example.test) or Bo (bo@example.test)"
    && I.contactLine(I.normalizeInstance(SETTINGS, { orgName: "X", contacts: [{ name: "Ana", email: "admin@example.test" }] })) === "contact Ana (admin@example.test)"
    && I.contactLine(none) === "contact the portal administrator");

  // ── validating (what the seed script checks before writing) ──
  ok("a good file has no problems (admin listed as founder)", I.validateInstance({ ...SETTINGS, adminEmails: ["admin@example.test"], outreach: { senderDomain: "mail.example.test", relationshipDomain: "example.test", unsubscribeBaseUrl: "https://example.test/u/", ccDomains: ["example.test"], testRecipients: ["admin@example.test"], relationshipSenders: [{ email: "admin@example.test", owner: "admin", displayName: "Admin" }] } }, PUBLIC).length === 0
    && I.validateInstance({ ...SETTINGS, adminEmails: ["admin@example.test"] }, PUBLIC).some((x) => /outreach/.test(x)));
  const GOOD_OUT = { senderDomain: "mail.example.test", relationshipDomain: "example.test", unsubscribeBaseUrl: "https://example.test/u/", ccDomains: ["example.test"], testRecipients: ["admin@example.test"], relationshipSenders: [{ email: "admin@example.test", owner: "admin", displayName: "Admin" }] };
  const vOut = (o, pub = PUBLIC) => I.validateInstance({ ...SETTINGS, adminEmails: ["admin@example.test"], outreach: { ...GOOD_OUT, ...o } }, pub);
  ok("an unsubscribe base address that is empty, not https or lacks the final / is flagged", ["", "http://example.test/u/", "https://example.test/u", "example.test/u/"].every((u) => vOut({ unsubscribeBaseUrl: u }).some((m) => /unsubscribeBaseUrl/.test(m))));
  ok("a missing portal address is flagged (the branded emails link to it)", vOut({}, { ...PUBLIC, portalUrl: "" }).some((m) => /portalUrl/.test(m)) && !vOut({}).some((m) => /portalUrl|unsubscribe/.test(m)));
  const bad = I.validateInstance({ adminEmails: [], founders: [], portalOrigins: [], productionHosts: [] }, {});
  ok("an empty file reports every missing part", bad.length >= 5 && bad.some((m) => /adminEmails/.test(m)) && bad.some((m) => /orgName/.test(m)) && bad.some((m) => /contacts/.test(m)));
  ok("an admin who is not a founder is flagged (no key or name to work with)", I.validateInstance({ ...SETTINGS, adminEmails: ["ghost@example.test"] }, PUBLIC).some((m) => /ghost@example.test/.test(m)));
  ok("an invalid entry is flagged, not silently dropped", I.validateInstance({ ...SETTINGS, adminEmails: ["admin@example.test", "nope"] }, PUBLIC).some((m) => /invalid or duplicate/.test(m)));

  // ── loading ──
  store.delete(I.SETTINGS_PATH); store.delete(I.PUBLIC_PATH); // the fake starts with Douro seeded
  I._reset();
  const errs = []; const origErr = console.error; console.error = (...a) => errs.push(a.join(" "));
  const empty = await I.getInstance();
  ok("no documents: fail closed (not configured, nobody is admin) and say so in the log", !empty.configured && !I.isAdminEmail(empty, "admin@example.test") && errs.some((m) => /nobody is an admin/.test(m)));
  console.error = origErr;

  store.set(I.SETTINGS_PATH, SETTINGS); store.set(I.PUBLIC_PATH, PUBLIC);
  const cached = await I.getInstance();
  ok("a document written after the first read is not seen until the cache expires", !cached.configured);
  const fresh = await I.getInstance({ force: true });
  ok("force reloads: admin, founders, contacts and branding come through", fresh.configured && I.isAdminEmail(fresh, "admin@example.test") && fresh.founders.length === 2 && fresh.orgName === "Example Fund" && fresh.contacts.length === 2);
  store.set(I.SETTINGS_PATH, { ...SETTINGS, adminEmails: ["new@example.test"] });
  ok("inside the 60 s window the cached copy is served", I.isAdminEmail(await I.getInstance(), "admin@example.test"));
  ok("after force the new admin is seen", I.isAdminEmail(await I.getInstance({ force: true }), "new@example.test"));

  // A read failure keeps the last good copy; with none, fails closed.
  const realGet = store.get.bind(store);
  store.get = () => { throw new Error("boom"); };
  console.error = () => {};
  const kept = await I.getInstance({ force: true });
  I._reset();
  const closed = await I.getInstance({ force: true });
  console.error = origErr; store.get = realGet;
  ok("unreadable settings: the last good copy is kept", kept.configured && I.isAdminEmail(kept, "new@example.test"));
  ok("unreadable settings and no earlier copy: fail closed", !closed.configured);

  // ── Douro's seed file stays valid and reproduces today's values ──
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "../../instances/douro/instance.json"), "utf8"));
  ok("instances/douro/instance.json passes validation", I.validateInstance(cfg.settings, cfg.public).length === 0);
  const d = I.normalizeInstance(cfg.settings, cfg.public);
  const P = require("../access/perms.js");
  P._resetIdentity();
  ok("with nothing seeded there is no built-in fallback, not even for Douro", P.adminEmails().length === 0 && P.partnerEmails().length === 0 && !P.isAdminEmail("andre.rocha@douropartners.pt"));
  ok("Douro's contact line keeps today's sign-in refusal wording", I.contactLine(d) === "contact André (andre.rocha@douropartners.pt) or António (antonio.carvalho@douropartners.pt)");

  console.log(fail ? `\n${fail} FAILED` : "\nAll passed");
  process.exitCode = fail ? 1 : 0;
})();
