// Builds one team's portal files from instances/<alias>/.
//
//   node scripts/build-instance.cjs douro --check     fail if portal/instance-config.js or
//                                                     portal/firebase-config.js differ from the build (Douro lives in place)
//   node scripts/build-instance.cjs douro --write     regenerate those two files in portal/ (Douro only)
//   node scripts/build-instance.cjs pilot --out build/pilot/portal    stage a full copy of portal/ for another team
const fs = require("fs");
const path = require("path");
const B = require("./lib/instance-build.cjs");

const alias = process.argv[2];
const flag = (f) => process.argv.includes(f);
const oi = process.argv.indexOf("--out");
const die = (m) => { console.error(m); process.exit(1); };
if (!alias || alias.startsWith("--")) die("Usage: node scripts/build-instance.cjs <alias> --check | --write | --out <dir>");

const problems = B.checkAlias(alias);
if (problems.length) die("Not ready:\n - " + problems.join("\n - "));
const { cfg, web } = B.loadInstance(alias);
const cfgFile = path.join(B.ROOT, "portal", "instance-config.js"), fbFile = path.join(B.ROOT, "portal", "firebase-config.js");
const wantCfg = B.renderInstanceConfig(cfg);
const wantFb = B.renderFirebaseConfig(fs.readFileSync(fbFile, "utf8"), web);

if (oi > -1) { console.log("Staged:", B.stagePortal(alias, path.resolve(process.argv[oi + 1]))); process.exit(0); }
const CRLF = "\r\n", LF = "\n";
const lf = (t) => t.split(CRLF).join(LF);
const same = lf(fs.readFileSync(cfgFile, "utf8")) === lf(wantCfg) && lf(fs.readFileSync(fbFile, "utf8")) === lf(wantFb);
if (flag("--write")) {
  const crlf = fs.readFileSync(cfgFile, "utf8").includes(CRLF);
  fs.writeFileSync(cfgFile, crlf ? lf(wantCfg).split(LF).join(CRLF) : wantCfg);
  fs.writeFileSync(fbFile, wantFb);
  console.log(`portal/ now carries "${alias}" (${cfg.projectId}).`);
} else if (flag("--check")) {
  if (!same) die(`portal/instance-config.js or portal/firebase-config.js do not match "${alias}". Run with --write (Douro) or --out <dir> (another team).`);
  console.log(`OK: portal/ matches "${alias}" (${cfg.projectId}).`);
} else die("Say what to do: --check, --write or --out <dir>");
