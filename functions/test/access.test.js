// Team access (Phase 1): permission maths, the teamAccess callable, sign-in
// claims from the blocking functions, suspension / end dates, and the
// permission checks in the Outreach callables.
const F = require("./fake_firebase.js");
const crypto = require("crypto");
const fns = require("../index.js");
const P = require("../access/perms.js");
const T = require("../access/team.js");
const { store, authCalls, Timestamp } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const PARTNER = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const as = (email, perms) => ({ auth: { token: { email, perms } } });
const call = async (fn, req, data) => { try { return await fns[fn]({ ...req, data }); } catch (e) { return { err: e }; } };
const team = (data, req = PARTNER) => call("teamAccess", req, data);
const signIn = async (email, uid = "u_" + email) => { try { return { res: await fns.beforeSignIn({ data: { email, uid } }) }; } catch (e) { return { err: e }; } };
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

(async () => {
  // ── Permission maths ──
  ok("partner = every permission, also any added later", P.effectivePerms({ roleId: "partner" }, null).length === P.ALL.length);
  ok("role + extra − removed", JSON.stringify(P.effectivePerms({ roleId: "x", extraPerms: ["net.edit", "bogus"], removedPerms: ["search.edit"] }, { perms: ["search.view", "search.edit"] })) === JSON.stringify(["search.view", "net.edit"]));
  ok("dates: before start / after end → not active; suspended → not active", !P.isActive({ status: "active", startsAt: new Date(Date.now() + 86400000) }) && !P.isActive({ status: "active", endsAt: new Date(Date.now() - 1000) }) && !P.isActive({ status: "suspended" }) && P.isActive({ status: "invited" }));
  ok("partner by email always gets everything, even without a team record", P.claimsFor("antonio.carvalho@douropartners.pt", null, null).perms.length === P.ALL.length);

  // ── Only partners manage access ──
  ok("an intern can't use Team & access", (await team({ action: "seed" }, as("maria@douropartners.pt", ["search.view"]))).err?.details?.reason === "no_permission");
  const sd = await team({ action: "seed" });
  ok("seed: default roles (not Partner) + both partners' records", sd.created === 5 && store.get("roles/intern").perms.includes("search.view") && !store.get("roles/partner") && store.get("team/andre.rocha@douropartners.pt").key === "andre");
  ok("seed again: nothing new", (await team({ action: "seed" })).created === 0);

  // ── Invite ──
  ok("invite needs a valid email / name / key / role", (await team({ action: "invite", member: { email: "x", name: "X", key: "x1", roleId: "intern" } })).err?.details?.reason === "bad_email"
    && (await team({ action: "invite", member: { email: "m@d.pt", name: "M", key: "M!", roleId: "intern" } })).err?.details?.reason === "bad_key"
    && (await team({ action: "invite", member: { email: "m@d.pt", name: "M", key: "maria", roleId: "nope" } })).err?.details?.reason === "bad_role");
  ok("nobody can be invited as Partner", (await team({ action: "invite", member: { email: "m@d.pt", name: "M", key: "maria", roleId: "partner" } })).err?.details?.reason === "partner_locked");
  ok("short name must be unique", (await team({ action: "invite", member: { email: "m@d.pt", name: "M", key: "andre", roleId: "intern" } })).err?.details?.reason === "key_taken");
  const end = new Date(Date.now() + 90 * 86400000).toISOString();
  const inv = await team({ action: "invite", member: { email: "Maria@DouroPartners.pt", name: "Maria Silva", key: "maria", roleId: "intern", endsAt: end, ndaSigned: true } });
  const mdoc = store.get("team/maria@douropartners.pt");
  ok("invited: record by email, status invited, end date kept", inv.email === "maria@douropartners.pt" && mdoc.status === "invited" && mdoc.endsAt.toMillis() > Date.now() && mdoc.invitedBy === "andre.rocha@douropartners.pt");
  ok("login list (hashes only) includes her and the partners", store.get("config/teamEmailHashes").hashes.includes(sha("maria@douropartners.pt")) && store.get("config/teamEmailHashes").hashes.includes(sha("andre.rocha@douropartners.pt")));
  ok("audit entry for the invite", [...store.entries()].some(([p, d]) => p.startsWith("accessAudit/") && d.action === "invite" && d.target === "maria@douropartners.pt"));
  ok("inviting the same person again is refused", (await team({ action: "invite", member: { email: "maria@douropartners.pt", name: "M", key: "maria2", roleId: "intern" } })).err?.details?.reason === "exists");

  // ── Sign-in ──
  const s1 = await signIn("maria@douropartners.pt", "uid-maria");
  const mc = s1.res?.customClaims;
  ok("first sign-in: allowed, claims = Intern permissions + key", mc?.role === "intern" && mc.key === "maria" && mc.perms.includes("search.edit") && !mc.perms.includes("search.delete") && !mc.perms.includes("out.send"));
  ok("…and becomes active with her user id recorded", store.get("team/maria@douropartners.pt").status === "active" && store.get("team/maria@douropartners.pt").uid === "uid-maria");
  const ps = await signIn("andre.rocha@douropartners.pt", "uid-andre");
  ok("partner signs in with everything", ps.res?.customClaims?.role === "partner" && ps.res.customClaims.perms.length === P.ALL.length);
  store.set("config/allowedEmailHashes", { hashes: [sha("investor@fundo.pt")] });
  ok("an investor signs in as before (no team claims)", (await signIn("investor@fundo.pt")).res === undefined);
  ok("a stranger is refused", (await signIn("random@gmail.com")).err?.code === "permission-denied");

  // ── Changes reach her account at once ──
  authCalls.length = 0;
  await team({ action: "update", email: "maria@douropartners.pt", member: { extraPerms: ["net.edit"], removedPerms: ["out.tasks"] } });
  const cl = authCalls.find((c) => c.op === "claims" && c.uid === "uid-maria")?.claims;
  ok("extra / removed permissions: claims refreshed on her account", cl && cl.perms.includes("net.edit") && !cl.perms.includes("out.tasks"));
  ok("a partner's role can't be changed", (await team({ action: "update", email: "antonio.carvalho@douropartners.pt", member: { roleId: "viewer" } })).err?.details?.reason === "partner_locked");
  authCalls.length = 0;
  const sr = await team({ action: "saveRole", roleId: "intern", role: { name: "Intern", perms: ["search.view", "out.view", "access.manage"] } });
  const cl2 = authCalls.find((c) => c.op === "claims" && c.uid === "uid-maria")?.claims;
  ok("editing a role updates everyone with it; managing access can't be given to a role", sr.updated === 1 && cl2 && !cl2.perms.includes("search.edit") && !store.get("roles/intern").perms.includes("access.manage"));
  ok("the Partner role can't be edited", (await team({ action: "saveRole", roleId: "partner", role: { name: "x", perms: [] } })).err?.details?.reason === "partner_locked");
  ok("a role in use can't be deleted", (await team({ action: "deleteRole", roleId: "intern" })).err?.details?.reason === "role_in_use");

  // ── Suspend / reactivate / end ──
  authCalls.length = 0;
  await team({ action: "suspend", email: "maria@douropartners.pt" });
  ok("suspend: claims emptied, sessions revoked, account disabled", authCalls.some((c) => c.op === "claims" && c.claims.perms.length === 0) && authCalls.some((c) => c.op === "revoke") && authCalls.some((c) => c.op === "update" && c.props.disabled === true));
  ok("suspended: sign-in refused, off the login list", (await signIn("maria@douropartners.pt", "uid-maria")).err?.code === "permission-denied" && !store.get("config/teamEmailHashes").hashes.includes(sha("maria@douropartners.pt")));
  await team({ action: "reactivate", email: "maria@douropartners.pt" });
  ok("reactivate: signs in again", (await signIn("maria@douropartners.pt", "uid-maria")).res?.customClaims?.role === "intern");
  ok("partners can't be suspended", (await team({ action: "suspend", email: "antonio.carvalho@douropartners.pt" })).err?.details?.reason === "partner_locked");

  // A former team member who is also an investor signs in as an investor only
  await team({ action: "invite", member: { email: "investor@fundo.pt", name: "Inv", key: "inv", roleId: "viewer" } });
  await team({ action: "end", email: "investor@fundo.pt" });
  const iv = await signIn("investor@fundo.pt");
  ok("ended team member who is an investor: investor sign-in, no team permissions", iv.res?.customClaims?.perms?.length === 0 && iv.res.customClaims.role === null);

  // ── End date (daily job) ──
  store.set("team/maria@douropartners.pt", { ...store.get("team/maria@douropartners.pt"), endsAt: Timestamp.fromDate(new Date(Date.now() - 1000)) });
  const ended = await T.runTeamExpiry();
  ok("past the end date: access ended by the daily job", ended === 1 && store.get("team/maria@douropartners.pt").status === "ended" && [...store.entries()].some(([p, d]) => p.startsWith("accessAudit/") && d.action === "expired"));
  ok("…and can no longer sign in", (await signIn("maria@douropartners.pt", "uid-maria")).err?.code === "permission-denied");

  // ── Outreach callables check permissions (partners pass by email, as before) ──
  const intern = as("maria@douropartners.pt", ["search.view", "search.edit", "out.view", "out.tasks", "net.view"]);
  const analyst = as("rui@douropartners.pt", ["out.view", "out.campaigns", "out.draft"]);
  ok("intern can't create campaigns or send", (await call("outreachCampaign", intern, { action: "save", campaign: { name: "x" } })).err?.details?.reason === "not_admin" && (await call("outreachSend", intern, {})).err?.details?.reason === "not_admin");
  const task = await call("outreachCampaign", intern, { action: "completeTask", taskId: "nope", outcome: "done" });
  ok("intern may complete tasks (passes the check; fails later on the missing task)", task.err?.details?.reason !== "not_admin");
  const draft = await call("outreachCampaign", analyst, { action: "save", campaign: { name: "Analista" } });
  ok("analyst prepares a campaign but can't start it (starting sends emails)", !!draft.campaignId && (await call("outreachCampaign", analyst, { action: "setStatus", campaignId: draft.campaignId, status: "active" })).err?.details?.reason === "not_admin");
  ok("Outreach settings need out.admin", (await call("outreachAdmin", analyst, { action: "seed" })).err?.code === "permission-denied");
  ok("relationship sends: Network page needs net.email, the admin notices need portal.admin", (await call("outreachPeopleSend", as("x@d.pt", ["net.view"]), { context: "network", recipients: [{ email: "a@b.pt" }], subject: "s", message: "m" })).err?.details?.reason === "not_admin"
    && (await call("outreachPeopleSend", as("x@d.pt", ["net.email"]), { context: "portal", recipients: [{ email: "a@b.pt" }], subject: "s", message: "m" })).err?.details?.reason === "not_admin");

  // A failing team lookup never locks partners or investors out
  const origDoc = F.fakeDb.doc;
  F.fakeDb.doc = (path) => (String(path).startsWith("team/") ? { get: async () => { throw new Error("firestore down"); } } : origDoc(path));
  ok("team lookup error: partner still signs in (by email)", !(await signIn("antonio.carvalho@douropartners.pt")).err);
  ok("team lookup error: investor still signs in", !(await signIn("investor@fundo.pt")).err);
  F.fakeDb.doc = origDoc;

  console.log(fail ? `\n${fail} FAILED` : "\nall access tests passed");
  process.exit(fail ? 1 : 0);
})();
