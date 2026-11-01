// Creates the files for a new team's instance from a set of answers (WP9).
// Pure file work: no network, nothing deployed. scripts/new-team.cjs asks the
// questions; tests call this directly.
const fs = require("fs");
const path = require("path");
const { ROOT, checkAlias } = require("./instance-build.cjs");
const { normalizeInstance } = require("../../functions/instance");

const slug = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
const csv = (v) => (Array.isArray(v) ? v : String(v || "").split(/[,;\s]+/)).map((x) => x.trim()).filter(Boolean);

// answers: alias, orgName, projectId, productionHost, portalPath?, logoUrl?, noreplyLocal?,
//          people: [{ name, email, key? }] (first one is the admin),
//          senderDomain, relationshipDomain, testRecipients, web: { apiKey, ... } (optional)
function buildInstance(a) {
  const people = (a.people || []).map((p) => ({ name: String(p.name || "").trim(), email: String(p.email || "").trim().toLowerCase(), key: p.key || slug(String(p.name || "").split(/\s+/)[0]) }));
  const host = String(a.productionHost || "").trim().toLowerCase();
  const rel = String(a.relationshipDomain || host).trim().toLowerCase();
  const org = String(a.orgName || "").trim();
  const noreply = `${a.noreplyLocal || "noreply"}@${rel}`;
  const owners = people.map((p) => ({ email: p.email, owner: p.key, displayName: p.name }));
  return {
    alias: a.alias,
    projectId: a.projectId,
    settings: {
      adminEmails: people.length ? [people[0].email] : [],
      founders: people.map((p) => ({ email: p.email, key: p.key, name: p.name })),
      portalOrigins: [`https://${host}`],
      noreplyFrom: `${org} <${noreply}>`,
      productionHosts: [host],
      outreach: {
        senderDomain: String(a.senderDomain || "").trim().toLowerCase(),
        relationshipDomain: rel,
        unsubscribeBaseUrl: `https://${host}/u/`,
        ccDomains: [rel, String(a.senderDomain || "").trim().toLowerCase()].filter(Boolean),
        testRecipients: csv(a.testRecipients).map((e) => e.toLowerCase()),
        seedSenders: people.map((p) => ({ local: p.key, owner: p.key, displayName: p.name, status: "paused" })),
        relationshipSenders: [...owners, { email: noreply, owner: null, displayName: org }],
        signatureLines: [org, host],
      },
    },
    public: {
      orgName: org,
      logoUrl: a.logoUrl || "",
      portalUrl: `https://${host}${a.portalPath || "/portal/"}`,
      contacts: people.map((p) => ({ name: p.name.split(/\s+/)[0], email: p.email })),
    },
  };
}

function createInstanceFiles(a, root = ROOT) {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(String(a.alias || ""))) throw new Error("The alias must be lowercase letters, digits and dashes (e.g. pilot).");
  if (a.alias === "douro") throw new Error('"douro" is taken.');
  const dir = path.join(root, "instances", a.alias);
  if (fs.existsSync(dir)) throw new Error(`instances/${a.alias} already exists - not overwriting.`);
  const cfg = buildInstance(a);
  if (!cfg.projectId) throw new Error("The Firebase project id is required.");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "instance.json"), JSON.stringify(cfg, null, 2) + "\n");
  const web = { apiKey: "", authDomain: `${cfg.projectId}.firebaseapp.com`, projectId: cfg.projectId, storageBucket: `${cfg.projectId}.firebasestorage.app`, messagingSenderId: "", appId: "", ...(a.web || {}) };
  fs.writeFileSync(path.join(dir, "firebase-web.json"), JSON.stringify(web, null, 2) + "\n");
  const rcFile = path.join(root, ".firebaserc");
  const rc = fs.existsSync(rcFile) ? JSON.parse(fs.readFileSync(rcFile, "utf8")) : { projects: {} };
  rc.projects = { ...rc.projects, [a.alias]: cfg.projectId };
  fs.writeFileSync(rcFile, JSON.stringify(rc, null, 2) + "\n");
  return { dir, cfg, problems: checkAlias(a.alias, root) };
}

// What is still manual, in the order to do it (printed after the files exist).
function checklist(alias, cfg) {
  const p = cfg.projectId, o = cfg.settings.outreach;
  return [
    `1. Firebase: create project ${p}, switch it to Blaze, add budget alerts (EUR 10 / 25 / 50). Use a billing account separate from Douro's.`,
    `2. Firebase: add a Web app, copy its config into instances/${alias}/firebase-web.json (apiKey, messagingSenderId, appId).`,
    `3. Firebase: enable Authentication with Identity Platform, email-link sign-in, and add ${cfg.settings.productionHosts[0]} to the authorised domains. Create Firestore (europe-west) and Storage.`,
    `4. Resend: new account; verify ${o.senderDomain} (sending) and ${o.relationshipDomain} (relationship) - add the DNS records; create a sending-only key and a full-access key.`,
    `5. Secrets, one at a time:  firebase functions:secrets:set RESEND_SEND_KEY --project ${p}   (then RESEND_READ_KEY, RESEND_WEBHOOK_SECRET, UNSUBSCRIBE_SECRET [any long random string], ANTHROPIC_API_KEY only if the AI opener is used).`,
    `6. Resend webhook: point it at the resendWebhook function URL of ${p} and paste its signing secret into RESEND_WEBHOOK_SECRET.`,
    `7. node scripts/build-instance.cjs ${alias} --out build/${alias}/portal   (their pages, with their own identity and Firebase config).`,
    `8. node scripts/seed-instance.cjs ${alias}   then   --write --project ${p}   (their settings documents).`,
    `9. node scripts/deploy.cjs ${alias} --only rules,functions   then   --go --project ${p}.`,
    `10. Host build/${alias}/portal (Firebase Hosting for the pilot; Phase 1), sign in as ${cfg.settings.adminEmails[0]}, open Team & access -> seed, then Outreach -> Settings -> seed senders.`,
    `11. Run the smoke test in docs/DEVELOPER-GUIDE.md ("New team smoke test"): admin and non-admin sign-in, a refused stranger, a test email in test mode, a second person invited, a denied write.`,
    `Every step that hurt goes in the learning log (Documents\\Douro Partners\\Portal - Distribution Plan.md).`,
  ];
}

module.exports = { buildInstance, createInstanceFiles, checklist };
