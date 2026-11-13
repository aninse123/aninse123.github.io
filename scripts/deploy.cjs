// Deploys one team's backend (rules and/or functions) after checking that the
// alias, the Firebase project and the repo agree, and that the tests pass.
//
//   node scripts/deploy.cjs douro --only rules                    plan only: what would run, nothing deployed
//   node scripts/deploy.cjs douro --only rules,functions --go --project douro-partners
//
// - The project always comes from instances/<alias>/instance.json and is passed
//   to the Firebase CLI explicitly (never the "default" alias), so a build for one
//   team cannot go to another team's project.
// - --go needs --project <id> repeating that id, like the seed script.
// - Hosting is not handled here yet (Phase 1: the pilot's Firebase Hosting);
//   Douro's pages go out through Netlify (staging, then main).
// - --skip-tests exists for emergencies only and is printed loudly.
// - 13 Nov (Claude connector, B10): staging and production share one Firebase
//   project and the folder is shared by several task chats, so a deploy says
//   exactly what goes out:
//     --functions a,b,c   only these functions (names checked against functions/index.js)
//     refuses while the files being deployed have uncommitted changes (functions/,
//     or firestore.rules / storage.rules), unless --allow-dirty is given
//     prints the commit, and what changed in those files since the last deploy
//     from this computer (log kept in ~/.douro-deploy-log.json, outside the repo)
//   node scripts/deploy.cjs douro --only functions --functions claudeMcp,claudeConnect --go --project douro-partners
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const B = require("./lib/instance-build.cjs");

const alias = process.argv[2];
const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const flag = (f) => process.argv.includes(f);
const die = (m) => { console.error(m); process.exit(1); };
const TARGETS = { rules: ["firestore:rules", "storage"], functions: ["functions"], firestore: ["firestore"], storage: ["storage"] };

if (!alias || alias.startsWith("--")) die("Usage: node scripts/deploy.cjs <alias> --only rules|functions[,..] [--go --project <id>] [--skip-tests]");
const only = (arg("--only") || "").split(",").filter(Boolean);
if (!only.length) die("Say what to deploy: --only rules, functions or rules,functions");
for (const o of only) if (!TARGETS[o]) die(`"${o}" is not deployable here (${Object.keys(TARGETS).join(", ")}). Hosting is not handled by this script yet.`);

const problems = B.checkAlias(alias);
if (problems.length) die("Not ready:\n - " + problems.join("\n - "));
const { cfg } = B.loadInstance(alias);
const project = cfg.projectId;

const run = (label, cmd, args, opts = {}) => {
  console.log(`\n> ${label}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true, cwd: B.ROOT, ...opts });
  if (r.status !== 0) die(`${label} failed - nothing deployed.`);
};

// Which functions (B10): every one, or exactly the names given.
const fnNames = (arg("--functions") || "").split(",").map((x) => x.trim()).filter(Boolean);
if (fnNames.length && !only.includes("functions")) die("--functions needs --only functions.");
if (fnNames.length) {
  const r = spawnSync("node", ["-e", "require('./test/fake_firebase');process.stdout.write(Object.keys(require('./index.js')).join(','))"], { cwd: path.join(B.ROOT, "functions"), encoding: "utf8" });
  const known = new Set(String(r.stdout || "").split(",").filter(Boolean));
  if (!known.size) die("Couldn't list the functions in functions/index.js:\n" + (r.stderr || ""));
  const unknown = fnNames.filter((n) => !known.has(n));
  if (unknown.length) die(`Not functions of this codebase: ${unknown.join(", ")}`);
}
const only2 = [...new Set(only.flatMap((o) => (o === "functions" && fnNames.length ? fnNames.map((n) => `functions:${n}`) : TARGETS[o])))];
const cmd = `firebase deploy --project ${project} --only ${only2.join(",")}`;

// What goes out: the commit, uncommitted files, changes since the last deploy (B10).
const git = (...a) => String(spawnSync("git", a, { cwd: B.ROOT, encoding: "utf8" }).stdout || "").trim();
const PATHS = { functions: ["functions"], rules: ["firestore.rules", "storage.rules"], firestore: ["firestore.rules", "firestore.indexes.json"], storage: ["storage.rules"] };
const watched = [...new Set(only.flatMap((o) => PATHS[o] || []))];
const head = git("rev-parse", "--short", "HEAD");
const dirty = git("status", "--porcelain", "--", ...watched);
const LOG = path.join(os.homedir(), ".douro-deploy-log.json");
let log = {}; try { log = JSON.parse(fs.readFileSync(LOG, "utf8")); } catch (e) { log = {}; }
console.log(`Team "${alias}" -> Firebase project ${project}`);
console.log(`Commit: ${git("log", "-1", "--format=%h %s")}`);
for (const t of only2) {
  const last = log[`${project}:${t}`];
  if (!last) { console.log(`${t}: no earlier deploy recorded on this computer`); continue; }
  const files = git("diff", "--stat", `${last.commit}..HEAD`, "--", ...watched).split("\n").slice(-1)[0];
  console.log(`${t}: last deployed ${last.at.slice(0, 16).replace("T", " ")} at ${last.commit}; since then: ${files || "no changes in " + watched.join(", ")}`);
}
if (dirty) console.log(`Uncommitted changes in what would be deployed:\n${dirty}`);
console.log(`Would run: ${cmd}`);
if (!flag("--go")) { console.log("\nPlan only. Add --go --project " + project + " to run the checks and deploy."); process.exit(0); }
if (arg("--project") !== project) die(`Refusing: pass --project ${project} to confirm the target.`);
if (dirty && !flag("--allow-dirty")) die("Refusing: commit these changes first (or add --allow-dirty), so what goes live is a known commit.");
if (dirty) console.warn("\n!!! --allow-dirty: uncommitted changes are being deployed !!!");

// Offline gate
run("portal files match this team", "node", ["scripts/build-instance.cjs", alias, "--check"]);
if (flag("--skip-tests")) console.warn("\n!!! --skip-tests: the test suites were NOT run !!!");
else {
  run("functions tests", "npm", ["test"], { cwd: path.join(B.ROOT, "functions") });
  run("portal tests", "node", ["tests/portal/run-all.mjs"]);
  if (only.includes("rules")) run("rules tests (Google test endpoint, deploys nothing)", "node", ["tests/rules/check_rules.cjs"]);
}
run(`deploy to ${project}`, "firebase", cmd.split(" ").slice(1));
for (const t of only2) log[`${project}:${t}`] = { at: new Date().toISOString(), commit: head, dirty: !!dirty };
try { fs.writeFileSync(LOG, JSON.stringify(log, null, 2)); } catch (e) { console.warn("Couldn't write " + LOG + ": " + e.message); }
console.log(`\nDeployed ${only.join(" + ")} to ${project}. Now check it in the browser (sign in, open Team & access).`);
