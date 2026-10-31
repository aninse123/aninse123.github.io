// A second team (distribution plan, Phase 0 / WP2): the admin, founders and
// contact lines come from instance settings, nothing from Douro leaks in, and
// a project that is not Douro's fails closed until it is seeded.
process.env.GCLOUD_PROJECT = "pilot-test"; // not "douro-partners": the built-in Douro fallback must stay off
const F = require("./fake_firebase.js");
const crypto = require("crypto");
const fns = require("../index.js");
const P = require("../access/perms.js");
const I = require("../instance.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const call = async (fn, req, data) => { try { return await fns[fn]({ ...req, data }); } catch (e) { return { err: e }; } };
const signIn = async (email, customClaims) => { try { return { res: await fns.beforeSignIn({ data: { email, uid: "u_" + email, customClaims } }) }; } catch (e) { return { err: e }; } };
const DOURO_ADMIN = "andre.rocha@douropartners.pt";

(async () => {
  const quiet = (fn) => async (...a) => { const o = console.error, w = console.warn; console.error = console.warn = () => {}; try { return await fn(...a); } finally { console.error = o; console.warn = w; } };

  // ── Not seeded, not Douro's project: fail closed ──
  P._resetIdentity();
  await quiet(() => P.loadIdentity({ force: true }))();
  ok("not seeded outside the Douro project: nobody is admin by email, Douro's admin included", !P.isAdminEmail(DOURO_ADMIN) && P.adminEmails().length === 0 && P.partnerEmails().length === 0);
  const refused = await quiet(signIn)(DOURO_ADMIN);
  ok("so Douro's admin is refused here, with a neutral message", refused.err?.code === "permission-denied" && /contact the portal administrator/.test(refused.err.message) && !/douropartners/i.test(refused.err.message));
  ok("claims for Douro's admin email are not admin claims here", P.claimsFor(DOURO_ADMIN, null, null).role !== "admin");

  // ── Seed a second team ──
  store.set("instance/settings", {
    adminEmails: ["ana@example.test"],
    founders: [{ email: "ana@example.test", key: "ana", name: "Ana Admin" }, { email: "bo@example.test", key: "bo", name: "Bo Partner" }],
    portalOrigins: ["https://example.test"], noreplyFrom: "Example <noreply@example.test>", productionHosts: ["example.test"],
  });
  store.set("instance/public", { orgName: "Example Fund", contacts: [{ name: "Ana", email: "ana@example.test" }, { name: "Bo", email: "bo@example.test" }] });
  await P.loadIdentity({ force: true });
  ok("seeded: their admin and founders are the lists in use", P.isAdminEmail("Ana@Example.test") && !P.isAdminEmail("bo@example.test") && P.keyOf("bo@example.test") === "bo" && P.nameOf("ana@example.test") === "Ana Admin");

  const ana = await signIn("ana@example.test");
  ok("their admin signs in with the admin role, every permission and her own key", ana.res?.customClaims?.role === "admin" && ana.res.customClaims.perms.length === P.ALL.length && ana.res.customClaims.key === "ana");
  const andre = await signIn(DOURO_ADMIN);
  ok("Douro's admin is not their admin: refused, and the message names their contacts, not Douro's", andre.err?.code === "permission-denied"
    && andre.err.message === "This email doesn't have access to the portal. If you think it should, contact Ana (ana@example.test) or Bo (bo@example.test)." && !/douropartners/i.test(andre.err.message));

  // ── Their team is created from their settings ──
  const ADMIN = { auth: { token: { email: "ana@example.test", role: "admin", perms: P.ALL } } };
  const sd = await call("teamAccess", ADMIN, { action: "seed" });
  ok("seed creates their two founders only: Ana as Admin, Bo as Partner, with the names from the settings",
    sd.created >= 2 && store.get("team/ana@example.test")?.roleId === "admin" && store.get("team/ana@example.test")?.name === "Ana Admin"
    && store.get("team/bo@example.test")?.roleId === "partner" && store.get("team/bo@example.test")?.key === "bo"
    && !store.has("team/" + DOURO_ADMIN) && !store.has("team/antonio.carvalho@douropartners.pt"));
  const hashes = store.get("config/teamEmailHashes").hashes;
  ok("the login list has their people and none of Douro's", hashes.includes(sha("ana@example.test")) && hashes.includes(sha("bo@example.test")) && !hashes.includes(sha(DOURO_ADMIN)));

  // ── Nobody gets admin by any other route ──
  const bo = await signIn("bo@example.test");
  ok("a founder who is not the admin is a partner, not an admin", bo.res?.customClaims?.role === "partner" && !bo.res.customClaims.perms.includes("access.manage"));
  const BO_TOKEN = { auth: { token: { email: "bo@example.test", role: "partner", perms: P.ALL } } }; // a token that lists everything
  ok("the partner is refused Admin-only permissions whatever the token lists", !P.hasPerm(BO_TOKEN, "access.manage") && !P.hasPerm(BO_TOKEN, "out.admin") && P.hasPerm(BO_TOKEN, "search.view"));
  ok("the admin role on a token is enough for the admin; Douro's admin address without it is not", P.hasPerm(ADMIN, "access.manage") && !P.hasPerm({ auth: { token: { email: DOURO_ADMIN } } }, "access.manage"));
  const tryPromote = await call("teamAccess", BO_TOKEN, { action: "update", email: "bo@example.test", member: { roleId: "admin" } });
  ok("a partner cannot make themselves admin through Team & access", !!tryPromote.err);
  const promoteByAdmin = await call("teamAccess", ADMIN, { action: "update", email: "bo@example.test", member: { roleId: "admin" } });
  const bo2 = await signIn("bo@example.test");
  ok("not even the admin can hand out the admin role: refused (partner_locked), Bo stays a partner and signs in as one", promoteByAdmin.err?.details?.reason === "partner_locked" && store.get("team/bo@example.test").roleId === "partner" && bo2.res?.customClaims?.role === "partner");
  const susp = await call("teamAccess", ADMIN, { action: "suspend", email: "ana@example.test" });
  ok("their admin cannot be suspended", susp.err?.details?.reason === "partner_locked");

  // ── Stale team claims are cleared; nothing else is touched ──
  store.set("config/allowedEmailHashes", { hashes: [sha("old@example.test"), sha("plain@example.test")] });
  const stale = await signIn("old@example.test", { role: "admin", perms: P.ALL.slice(), key: "old" });
  ok("a former admin who is still an investor loses the old admin claims at the next sign-in", stale.res?.customClaims?.role === null && stale.res.customClaims.perms.length === 0);
  const plain = await signIn("plain@example.test", {});
  ok("an investor with no claims is left exactly as before (no write)", plain.res === undefined);
  const realGet = store.get.bind(store);
  store.get = (k) => { if (String(k).startsWith("team/")) throw new Error("boom"); return realGet(k); };
  const down = await quiet(signIn)("old@example.test", { role: "admin", perms: P.ALL.slice(), key: "old" });
  store.get = realGet;
  ok("if the team lookup itself fails, claims are left alone (no accidental wipe)", down.res === undefined);

  console.log(fail ? `\n${fail} FAILED` : "\nAll passed");
  process.exitCode = fail ? 1 : 0;
})();
