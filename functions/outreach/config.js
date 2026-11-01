// Outreach module (Phase 1) — shared constants.
//
// Every value here traces to a decision in "Outreach - Architecture Spec.md"
// (Documents\Douro Partners). Firestore settings (outreachSettings/global)
// override DEFAULT_SETTINGS at runtime; these are only the fallbacks used
// before the Settings screen has saved anything.

const { defineSecret } = require("firebase-functions/params");
const P = require("../access/perms");

const REGION = "us-central1"; // matches the /u/* rewrite in netlify.toml (the auth blocking functions run in us-east1)

// Who the admins and founders are (and their short keys) comes from the
// instance settings: access/perms.js (P.adminEmails(), P.keyOf()).

// Secrets live only in Secret Manager (set with `firebase functions:secrets:set`),
// never in Firestore or client code — the notifySecret lesson (spec §11).
const RESEND_SEND_KEY = defineSecret("RESEND_SEND_KEY");             // sending-only key, limited to the outreach sending domain
const RESEND_READ_KEY = defineSecret("RESEND_READ_KEY");             // full-access key: received emails, usage refresh
const RESEND_WEBHOOK_SECRET = defineSecret("RESEND_WEBHOOK_SECRET"); // Svix signing secret from the Resend webhook page
const UNSUBSCRIBE_SECRET = defineSecret("UNSUBSCRIBE_SECRET");       // random, HMAC for unsubscribe tokens

// This team's domains, approved test addresses and sender seeds live in the
// instance settings (instance/settings.outreach, functions/instance.js), read
// through these accessors after `await P.loadIdentity()` (store.getSettings does).
// An empty test list means nothing can be sent in test mode (fails safe).
const O = () => P.identity().outreach;
const senderDomain = () => O().senderDomain;
const relationshipDomain = () => O().relationshipDomain;
const unsubscribeBaseUrl = () => O().unsubscribeBaseUrl;
const testRecipients = () => O().testRecipients.slice();
const ccDomains = () => O().ccDomains.slice();
const seedSenders = () => O().seedSenders;
const relationshipSenders = () => O().relationshipSenders;
const orgName = () => P.identity().orgName;
// The signature under a cold sender's name: the lines from the settings.
const signatureLines = () => O().signatureLines;

const DEFAULT_SETTINGS = {
  automationBudget: 80,   // Phase 2 automations stop here; manual sends and replies never do
  dailyTarget: 100,       // soft line for the whole Resend account: warn + confirm above it, never block
  budgetDayTz: "UTC",     // Resend's daily quota is a UTC calendar day
  sendWindow: { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00", tz: "Europe/Lisbon" },
  testMode: true,
  testRecipients: [], // filled from the instance settings by store.getSettings
  campaignTestRecipient: null, // test mode: every campaign email goes here (C10); must be on the approved list
  blockPersonalDomains: false, // optional rule, off by default (Douro's live value is already false)
  complianceBlockId: null, // the saved email footer ("default"); optional since CCSL (9 Oct)
  footerDefaults: { company: false, oneToOne: false }, // CCSL: footer off unless chosen
  aiEnabled: false,          // Phase 4: {{ai.opener}} — also needs the ANTHROPIC_API_KEY secret
  aiModel: "claude-opus-5",
  aiDailyCap: 100,
};

const DEFAULT_SENDER_CAP = 25; // per-address daily limit for new outreach (Q13)

// Initial senders (outreachSenders) are seeded by outreachAdmin {action:'seed'} from
// instance/settings.outreach.seedSenders and .relationshipSenders - never overwritten.
// Relationship senders are for investors, press and people you already know; never
// cold company outreach. They send with the full-access key.
const RELATIONSHIP_SENDER_CAP = 200;

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
  "net.sapo.pt", "netmadeira.com", // 19 Oct: internet-provider mailboxes (26 companies)
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
  REGION,
  RESEND_SEND_KEY, RESEND_READ_KEY, RESEND_WEBHOOK_SECRET, UNSUBSCRIBE_SECRET,
  senderDomain, relationshipDomain, unsubscribeBaseUrl, testRecipients, ccDomains, seedSenders, relationshipSenders, orgName, signatureLines,
  DEFAULT_SETTINGS, DEFAULT_SENDER_CAP, RELATIONSHIP_SENDER_CAP, FREE_MAIL_DOMAINS, MATCH_WINDOW_DAYS,
  MAX_ATTACHMENT_BYTES, MAX_INLINE_HTML_BYTES, RISKY_EXTENSIONS,
};
