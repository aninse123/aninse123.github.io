// Outreach module (Phase 1) — shared constants.
//
// Every value here traces to a decision in "Outreach - Architecture Spec.md"
// (Documents\Douro Partners). Firestore settings (outreachSettings/global)
// override DEFAULT_SETTINGS at runtime; these are only the fallbacks used
// before the Settings screen has saved anything.

const { defineSecret } = require("firebase-functions/params");

const REGION = "us-central1"; // same default region as the auth blocking functions

// Same two admins as index.js, firestore.rules and storage.rules — keep in sync.
const ADMIN_EMAILS = ["andre.rocha@douropartners.pt", "antonio.carvalho@douropartners.pt"];
const OWNER_BY_ADMIN = {
  "andre.rocha@douropartners.pt": "andre",
  "antonio.carvalho@douropartners.pt": "antonio",
};

// Secrets live only in Secret Manager (set with `firebase functions:secrets:set`),
// never in Firestore or client code — the notifySecret lesson (spec §11).
const RESEND_SEND_KEY = defineSecret("RESEND_SEND_KEY");             // sending-only key, mail.douropartners-team.pt
const RESEND_READ_KEY = defineSecret("RESEND_READ_KEY");             // full-access key: received emails, usage refresh
const RESEND_WEBHOOK_SECRET = defineSecret("RESEND_WEBHOOK_SECRET"); // Svix signing secret from the Resend webhook page
const UNSUBSCRIBE_SECRET = defineSecret("UNSUBSCRIBE_SECRET");       // random, HMAC for unsubscribe tokens

// Netlify rewrites douropartners.pt/u/* to the outreachUnsubscribe function (netlify.toml).
const UNSUBSCRIBE_BASE_URL = "https://douropartners.pt/u/";

// Approved test recipients (confirmed by André 2026-09-24). While testMode is
// on, outreachSend refuses every other address — the server-side guard that
// keeps a UI bug from emailing a real company before go-live (spec §11).
const TEST_RECIPIENTS = [
  "andrenorocha@gmail.com",
  "andrerochaaero@gmail.com",
  "amobnc92@gmail.com",
  "douropartners.team@gmail.com",
  "andre.rocha@douropartners.pt",
  "antonio.carvalho@douropartners.pt",
  "andre.rocha@mail.douropartners-team.pt",
  "a.rocha@mail.douropartners-team.pt",
  "an.rocha@mail.douropartners-team.pt",
  "rocha.andre@mail.douropartners-team.pt",
  "antonio.carvalho@mail.douropartners-team.pt",
  "a.carvalho@mail.douropartners-team.pt",
  "an.carvalho@mail.douropartners-team.pt",
  "carvalho.antonio@mail.douropartners-team.pt",
  "andre.rocha@douropartners-team.pt",
  "antonio.carvalho@douropartners-team.pt",
  // Resend's simulator (approved 2026-09-24); "+label" variants are accepted too.
  "delivered@resend.dev",
  "bounced@resend.dev",
  "complained@resend.dev",
  "suppressed@resend.dev",
];

const DEFAULT_SETTINGS = {
  automationBudget: 80,   // Phase 2 automations stop here; manual sends and replies never do
  dailyTarget: 100,       // soft line for the whole Resend account: warn + confirm above it, never block
  budgetDayTz: "UTC",     // Resend's daily quota is a UTC calendar day
  sendWindow: { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00", tz: "Europe/Lisbon" },
  testMode: true,
  testRecipients: TEST_RECIPIENTS,
  blockPersonalDomains: true,
  complianceBlockId: null, // required once testMode is off (spec §10)
};

const DEFAULT_SENDER_CAP = 25; // per-address daily limit for new outreach (Q13)

// Initial sender registry, written once by outreachAdmin {action:'seed'} and
// never overwritten. Only an.rocha has its Resend forward today (receiving test
// 2026-09-23); the other three stopped addresses start "paused" until theirs is
// added, and the four still warming in Instantly start "warming" (spec §3.1).
const SEED_SENDERS = [
  { local: "an.rocha",          owner: "andre",   displayName: "André Rocha",      status: "active" },
  { local: "rocha.andre",       owner: "andre",   displayName: "André Rocha",      status: "paused" },
  { local: "andre.rocha",       owner: "andre",   displayName: "André Rocha",      status: "warming" },
  { local: "a.rocha",           owner: "andre",   displayName: "André Rocha",      status: "warming" },
  { local: "an.carvalho",       owner: "antonio", displayName: "António Carvalho", status: "paused" },
  { local: "carvalho.antonio",  owner: "antonio", displayName: "António Carvalho", status: "paused" },
  { local: "antonio.carvalho",  owner: "antonio", displayName: "António Carvalho", status: "warming" },
  { local: "a.carvalho",        owner: "antonio", displayName: "António Carvalho", status: "warming" },
];
const SENDER_DOMAIN = "mail.douropartners-team.pt";

// Free-mail / ISP domains: shared by unrelated people, so (a) recipients on them
// are likely natural persons and blocked while blockPersonalDomains is on
// (Lei 41/2004, spec §10), and (b) a matching domain proves nothing when filing
// an inbound email under a company (spec §7.3 rule 3).
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.pt", "hotmail.fr", "hotmail.es", "hotmail.co.uk",
  "outlook.com", "outlook.pt", "live.com", "live.com.pt", "live.co.uk", "msn.com",
  "yahoo.com", "yahoo.com.br", "yahoo.es", "yahoo.fr", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com",
  "sapo.pt", "iol.pt", "netcabo.pt", "clix.pt", "telepac.pt", "mail.telepac.pt", "portugalmail.pt",
  "oninet.pt", "zonmail.pt", "vodafone.pt", "meo.pt", "net.novis.pt", "netvisao.pt",
  "gmx.com", "gmx.net", "gmx.pt", "mail.com", "protonmail.com", "proton.me", "zoho.com", "yandex.com",
]);

const MATCH_WINDOW_DAYS = 90;                 // spec §7.3 rule 2
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // bigger files stay in Gmail (spec §7.8)
const MAX_INLINE_HTML_BYTES = 500 * 1024;      // bigger bodies go to Storage (Firestore docs cap at 1 MB)
const RISKY_EXTENSIONS = new Set([
  "exe", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "jse", "jar", "html", "htm", "svg",
  "docm", "xlsm", "pptm", "dotm", "xltm", "zip", "rar", "7z", "iso", "img", "lnk",
]);

module.exports = {
  REGION, ADMIN_EMAILS, OWNER_BY_ADMIN,
  RESEND_SEND_KEY, RESEND_READ_KEY, RESEND_WEBHOOK_SECRET, UNSUBSCRIBE_SECRET,
  UNSUBSCRIBE_BASE_URL, TEST_RECIPIENTS, DEFAULT_SETTINGS, DEFAULT_SENDER_CAP,
  SEED_SENDERS, SENDER_DOMAIN, FREE_MAIL_DOMAINS, MATCH_WINDOW_DAYS,
  MAX_ATTACHMENT_BYTES, MAX_INLINE_HTML_BYTES, RISKY_EXTENSIONS,
};
