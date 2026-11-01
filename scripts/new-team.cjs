// Sets up the files for a new team (key in hand, first version).
//
//   node scripts/new-team.cjs pilot                      asks the questions
//   node scripts/new-team.cjs pilot --answers a.json     no questions (same fields)
//
// Writes instances/<alias>/{instance.json, firebase-web.json} and the
// .firebaserc alias, validates them, and prints what is still manual. It never
// touches Firebase, Resend or the network: seeding and deploying are separate,
// explicit steps (scripts/seed-instance.cjs, scripts/deploy.cjs).
const fs = require("fs");
const readline = require("readline");
const { createInstanceFiles, checklist } = require("./lib/new-team.cjs");

const alias = process.argv[2];
const die = (m) => { console.error(m); process.exit(1); };
if (!alias || alias.startsWith("--")) die("Usage: node scripts/new-team.cjs <alias> [--answers file.json]");
const ai = process.argv.indexOf("--answers");

async function ask() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const q = (t, d) => new Promise((res) => rl.question(d ? `${t} [${d}]: ` : `${t}: `, (v) => res(v.trim() || d || "")));
  const a = { alias };
  a.orgName = await q("Organisation name (shown in emails and pages)");
  a.projectId = await q("Firebase project id (create it first)");
  a.productionHost = await q("Live web address host (e.g. portal.example.com)");
  a.relationshipDomain = await q("Domain for people you already know (relationship emails)", a.productionHost.replace(/^portal\./, "").replace(/^www\./, ""));
  a.senderDomain = await q("Sending domain for outreach (a subdomain, e.g. mail.example.com)");
  a.people = [];
  for (let n = 1; n <= 3; n++) {
    const name = await q(n === 1 ? "Admin's full name" : `Person ${n}'s full name (blank to stop)`);
    if (!name) break;
    const email = await q("  email");
    a.people.push({ name, email });
  }
  a.testRecipients = await q("Approved test email addresses, comma separated (test mode sends only to these)");
  rl.close();
  return a;
}

(async () => {
  const answers = ai > -1 ? { alias, ...JSON.parse(fs.readFileSync(process.argv[ai + 1], "utf8")) } : await ask();
  let out;
  try { out = createInstanceFiles(answers); } catch (e) { die("Not created: " + e.message); }
  console.log(`\nCreated ${require("path").relative(process.cwd(), out.dir)}/ and the .firebaserc alias "${alias}".`);
  const todo = out.problems.filter((p) => !/apiKey|messagingSenderId|appId/.test(p));
  if (todo.length) console.log("\nStill to fix in instance.json:\n - " + todo.join("\n - "));
  console.log("\nWhat is left (manual, in this order):\n" + checklist(alias, out.cfg).map((l) => "  " + l).join("\n"));
})();
