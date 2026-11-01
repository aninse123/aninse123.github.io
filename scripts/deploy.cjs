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
const { spawnSync } = require("child_process");
const path = require("path");
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

const only2 = [...new Set(only.flatMap((o) => TARGETS[o]))];
const cmd = `firebase deploy --project ${project} --only ${only2.join(",")}`;

console.log(`Team "${alias}" -> Firebase project ${project}`);
console.log(`Would run: ${cmd}`);
if (!flag("--go")) { console.log("\nPlan only. Add --go --project " + project + " to run the checks and deploy."); process.exit(0); }
if (arg("--project") !== project) die(`Refusing: pass --project ${project} to confirm the target.`);

// Offline gate
run("portal files match this team", "node", ["scripts/build-instance.cjs", alias, "--check"]);
if (flag("--skip-tests")) console.warn("\n!!! --skip-tests: the test suites were NOT run !!!");
else {
  run("functions tests", "npm", ["test"], { cwd: path.join(B.ROOT, "functions") });
  run("portal tests", "node", ["tests/portal/run-all.mjs"]);
  if (only.includes("rules")) run("rules tests (Google test endpoint, deploys nothing)", "node", ["tests/rules/check_rules.cjs"]);
}
run(`deploy to ${project}`, "firebase", cmd.split(" ").slice(1));
console.log(`\nDeployed ${only.join(" + ")} to ${project}. Now check it in the browser (sign in, open Team & access).`);
