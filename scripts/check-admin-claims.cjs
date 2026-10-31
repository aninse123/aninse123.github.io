// Read-only check before any rules change that relies on the admin claim:
// does each admin's account carry role "admin" in its stored custom claims?
// (Their next token carries exactly these.) Uses the Firebase CLI login.
//
//   node scripts/check-admin-claims.cjs douro
//
// Exit 0 only if every admin email has role "admin" with the full permission list.
const fs = require("fs");
const os = require("os");
const path = require("path");
const alias = process.argv[2];
if (!alias) { console.error("Usage: node scripts/check-admin-claims.cjs <alias>"); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "instances", alias, "instance.json"), "utf8"));
const tok = () => JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/configstore/firebase-tools.json"), "utf8")).tokens.access_token;

(async () => {
  let bad = 0;
  for (const email of cfg.settings.adminEmails) {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${cfg.projectId}/accounts:lookup`, {
      method: "POST", headers: { Authorization: "Bearer " + tok(), "Content-Type": "application/json" }, body: JSON.stringify({ email: [email] }),
    });
    const body = await r.json();
    if (!r.ok) { console.log(`ERROR  ${email}: HTTP ${r.status} ${JSON.stringify(body).slice(0, 200)} (401: run \`firebase projects:list\` to refresh the login)`); bad++; continue; }
    const u = (body.users || [])[0];
    if (!u) { console.log(`MISSING  ${email}: no account (has not signed in yet)`); bad++; continue; }
    let claims = {};
    try { claims = JSON.parse(u.customAttributes || "{}"); } catch (e) { /* none */ }
    const ok = claims.role === "admin" && Array.isArray(claims.perms) && claims.perms.length > 0;
    console.log(`${ok ? "OK     " : "NO CLAIM"}  ${email}: role=${claims.role} perms=${(claims.perms || []).length} key=${claims.key} lastSignIn=${u.lastLoginAt ? new Date(+u.lastLoginAt).toISOString() : "?"}`);
    if (!ok) bad++;
  }
  console.log(bad ? "\nNot safe to switch the rules to the admin claim yet." : "\nSafe: every admin account carries the admin claim.");
  process.exitCode = bad ? 1 : 0;
})();
