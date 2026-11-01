// Builds the two per-team page files from instances/<alias>/ (Phase 0 / WP8):
//   portal/instance-config.js  - from instance.json (who the admin and founders are, contacts, live hosts)
//   portal/firebase-config.js  - the Firebase web config block, from firebase-web.json
// and checks that an alias, its Firebase project and the files in the repo agree,
// so a build for one team can never be deployed to another team's project.
const fs = require("fs");
const path = require("path");
const { validateInstance, normalizeInstance } = require("../../functions/instance");

const ROOT = path.join(__dirname, "..", "..");
const q = (s) => "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
const list = (a) => "[" + a.map(q).join(", ") + "]";

function loadInstance(alias, root = ROOT) {
  const dir = path.join(root, "instances", alias);
  const file = path.join(dir, "instance.json");
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(String(alias || ""))) throw new Error(`"${alias}" is not a valid alias (lowercase letters, digits, dashes)`);
  if (!fs.existsSync(file)) throw new Error(`No ${path.relative(root, file)}`);
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  const webFile = path.join(dir, "firebase-web.json");
  const web = fs.existsSync(webFile) ? JSON.parse(fs.readFileSync(webFile, "utf8")) : null;
  return { cfg, web, dir };
}

function renderInstanceConfig(cfg) {
  const inst = normalizeInstance(cfg.settings, cfg.public);
  const first = (n) => String(n).trim().split(/\s+/)[0];
  const noreplyEmail = (/<([^>]+)>/.exec(inst.noreplyFrom) || [, inst.noreplyFrom])[1] || '';
  const founders = inst.founders.map((f) => `    { email: ${q(f.email)}, key: ${q(f.key)}, name: ${q(f.name)}, shortName: ${q(first(f.name))} },`).join("\n");
  const contacts = inst.contacts.map((c) => `    { name: ${q(c.name)}, email: ${q(c.email)} },`).join("\n");
  return `// This team's identity for the pages — who the admin and founders are, who to
// contact, which hostnames are the live site. One file per team: GENERATED from
// instances/<alias>/instance.json by scripts/build-instance.cjs (do not edit by
// hand; a test fails if it drifts from the settings file).
//
// The pages decide who is Admin from the sign-in token (role === 'admin'); this
// file only supplies the lists that need to exist before a token does (the
// login screen) and the names shown next to people.
export const INSTANCE = {
  orgName: ${q(inst.orgName)},
  noreplyEmail: ${q(noreplyEmail)},
  ownDomain: ${q(inst.outreach.relationshipDomain)},
  productionHosts: ${list(inst.productionHosts)},
  adminEmails: ${list(inst.adminEmails)},
  // email, short key (owner / sender), first name for badges and labels
  founders: [
${founders}
  ],
  // Who to write to when someone has no access
  contacts: [
${contacts}
  ],
};
export const founderByEmail = (email) => INSTANCE.founders.find((f) => f.email === String(email || '').trim().toLowerCase()) || null;
export const isAdminEmail = (email) => INSTANCE.adminEmails.includes(String(email || '').trim().toLowerCase());
`;
}

const WEB_KEYS = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"];
function renderFirebaseConfig(source, web) {
  const nl = source.includes("\r\n") ? "\r\n" : "\n";
  const block = "const firebaseConfig = {" + nl + WEB_KEYS.map((k, i) => `  ${(k + ":").padEnd(19)}${JSON.stringify(web[k])}${i < WEB_KEYS.length - 1 ? "," : ""}`).join(nl) + nl + "};";
  const re = /const firebaseConfig = \{[\s\S]*?\};/;
  if (!re.test(source)) throw new Error("portal/firebase-config.js has no firebaseConfig block");
  return source.replace(re, () => block);
}

// Problems that make a deploy for this alias unsafe (empty = fine).
function checkAlias(alias, root = ROOT) {
  const out = [];
  let inst;
  try { inst = loadInstance(alias, root); } catch (e) { return [e.message]; }
  const { cfg, web } = inst;
  if (cfg.alias !== alias) out.push(`instance.json says alias "${cfg.alias}", expected "${alias}"`);
  if (!cfg.projectId) out.push("instance.json needs a projectId");
  out.push(...validateInstance(cfg.settings, cfg.public));
  if (!web) out.push("instances/" + alias + "/firebase-web.json is missing (the Firebase web config of the project)");
  else {
    for (const k of WEB_KEYS) if (!web[k]) out.push(`firebase-web.json: ${k} is missing`);
    if (web.projectId && web.projectId !== cfg.projectId) out.push(`firebase-web.json is for project ${web.projectId}, instance.json says ${cfg.projectId}`);
  }
  const rcFile = path.join(root, ".firebaserc");
  const rc = fs.existsSync(rcFile) ? JSON.parse(fs.readFileSync(rcFile, "utf8")) : { projects: {} };
  if ((rc.projects || {})[alias] !== cfg.projectId) out.push(`.firebaserc must map the alias "${alias}" to ${cfg.projectId} (found ${(rc.projects || {})[alias] || "nothing"})`);
  return out;
}

// Copies portal/ to outDir with this team's two files substituted.
function stagePortal(alias, outDir, root = ROOT) {
  const { cfg, web } = loadInstance(alias, root);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.cpSync(path.join(root, "portal"), outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "instance-config.js"), renderInstanceConfig(cfg));
  const src = fs.readFileSync(path.join(root, "portal", "firebase-config.js"), "utf8");
  fs.writeFileSync(path.join(outDir, "firebase-config.js"), renderFirebaseConfig(src, web));
  return outDir;
}

module.exports = { ROOT, loadInstance, renderInstanceConfig, renderFirebaseConfig, checkAlias, stagePortal, WEB_KEYS };
