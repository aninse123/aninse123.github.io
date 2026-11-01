// Writes a team's instance settings (instance/settings + instance/public) from
// instances/<alias>/instance.json. Dry run by default: it validates the file,
// shows what is there now and what would be written, and writes nothing.
//
//   node scripts/seed-instance.cjs douro                      (dry run)
//   node scripts/seed-instance.cjs douro --write --project douro-partners
//
// Writing needs --project to repeat the project id from the file, so a team's
// settings can never land in another team's project by mistake. Uses the
// Firebase CLI login (run `firebase login` first). Add-only: it replaces just
// these two documents and touches nothing else.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { validateInstance, SETTINGS_PATH, PUBLIC_PATH } = require("../functions/instance");

const alias = process.argv[2];
const write = process.argv.includes("--write");
const pi = process.argv.indexOf("--project");
const projectArg = pi > -1 ? process.argv[pi + 1] : null;

function die(msg) { console.error(msg); process.exit(1); }
if (!alias || alias.startsWith("--")) die("Usage: node scripts/seed-instance.cjs <alias> [--write --project <id>]");

const file = path.join(__dirname, "..", "instances", alias, "instance.json");
if (!fs.existsSync(file)) die(`No ${file}`);
const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
if (cfg.alias !== alias) die(`instance.json says alias "${cfg.alias}", expected "${alias}"`);
if (!cfg.projectId) die("instance.json needs a projectId");

const problems = validateInstance(cfg.settings, cfg.public);
if (problems.length) die("Not valid:\n - " + problems.join("\n - "));

const { fields } = require("./lib/firestore-encode.cjs"); // Firestore REST value encoding (null stays null)

const base = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents`;
const token = () => JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/configstore/firebase-tools.json"), "utf8")).tokens.access_token;
const headers = () => ({ Authorization: "Bearer " + token(), "Content-Type": "application/json" });

(async () => {
  const docs = [[SETTINGS_PATH, cfg.settings], [PUBLIC_PATH, cfg.public]];
  console.log(`Instance "${alias}" -> project ${cfg.projectId}  (${write ? "WRITE" : "dry run"})`);
  for (const [p, data] of docs) {
    const r = await fetch(`${base}/${p}`, { headers: headers() });
    const state = r.status === 404 ? "does not exist yet" : r.ok ? "exists (would be replaced)" : `could not be read (HTTP ${r.status})`;
    console.log(`\n${p}: ${state}\n${JSON.stringify(data, null, 2)}`);
    if (!r.ok && r.status !== 404) die(`Stopping: ${p} ${state}. If it is 401, run \`firebase projects:list\` to refresh the login.`);
  }
  if (!write) { console.log("\nDry run only. Nothing written."); return; }
  if (projectArg !== cfg.projectId) die(`\nRefusing to write: pass --project ${cfg.projectId} to confirm the target.`);
  for (const [p, data] of docs) {
    const r = await fetch(`${base}/${p}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ fields: fields(data) }) });
    if (!r.ok) die(`Write of ${p} failed: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
    console.log(`Wrote ${p}`);
  }
})();
