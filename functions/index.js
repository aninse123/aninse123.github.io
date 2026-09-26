// Auth blocking functions -- server-side allow-list enforcement for the
// magic-link login, closing security-assessment risk #1 ("anyone on the
// internet can get an authenticated session"). The client-side check in
// portal/login.html (isRegistered()) is cosmetic only: it stops the UI from
// *sending* a magic link to a stranger, but nothing stops someone technical
// from calling the Firebase Auth SDK/REST API directly and completing a
// sign-in with an arbitrary email anyway. These functions are what Firebase
// actually consults before minting a session -- rejecting here means the
// non-approved user never gets a valid token at all, not just "gets denied
// by Firestore rules afterwards".
//
// Two triggers are needed, not one: email-link auth calls beforeUserCreated
// the first time a given email signs in (Firebase creates the user record as
// part of that first sign-in) and beforeUserSignedIn on every sign-in after
// that. Guarding only one leaves the other path open.
//
// isAllowed() mirrors portal/login.html's isRegistered() exactly -- same
// admin allow-list, same hash comparison against config/allowedEmailHashes,
// same legacy-plaintext fallback, same fail-closed default -- so nothing
// that can sign in through the UI today gets rejected here, and nothing
// that couldn't should be able to sign in at all.

const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { beforeUserCreated, beforeUserSignedIn, HttpsError } = require("firebase-functions/v2/identity");
const crypto = require("crypto");

initializeApp();
const db = getFirestore();

const ADMIN_EMAILS = ["andre.rocha@douropartners.pt", "antonio.carvalho@douropartners.pt"];

function sha256Hex(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

async function isAllowed(emailRaw) {
  const email = (emailRaw || "").trim().toLowerCase();
  if (!email) return false;
  if (ADMIN_EMAILS.includes(email)) return true;

  // Preferred: scrambled list (config/allowedEmailHashes), same as login.html.
  const hashSnap = await db.doc("config/allowedEmailHashes").get();
  if (hashSnap.exists) {
    const hashes = hashSnap.data().hashes || [];
    return hashes.includes(sha256Hex(email));
  }

  // Transitional fallback, matching login.html -- dead in practice since the
  // plaintext doc was deleted in the 2026-07-08 pass, kept only so this
  // function never silently diverges from what the client checks.
  const legacySnap = await db.doc("config/allowedEmails").get();
  if (!legacySnap.exists) return false; // fail closed
  const emails = (legacySnap.data().emails || []).map((e) => String(e).trim().toLowerCase());
  return emails.includes(email);
}

const REJECTION_MESSAGE = "This email isn't registered in the Douro Partners portal. Please contact us at andre.rocha@douropartners.pt or antonio.carvalho@douropartners.pt.";

// Team access (Phase 1): a team member signs in with their role and
// permissions as custom claims (read by the Firestore rules and callables).
// Someone whose team access ended or is suspended is refused — unless they're
// also a registered investor, who then signs in as an investor only. Investors
// and partners otherwise sign in exactly as before.
const { onTeamSignIn } = require("./access/team");
const NO_TEAM_CLAIMS = { role: null, perms: [], key: null };

async function decide(event) {
  const email = event.data?.email;
  // If the team lookup fails, fall back to today's behaviour (partners by
  // email, investors by the hash list) — a team-access problem must never
  // lock partners or investors out.
  let team = null;
  try { team = await onTeamSignIn(email, event.data?.uid); }
  catch (e) { console.error("team sign-in lookup failed", e?.message || e); team = null; }
  if (team?.allowed) return { customClaims: team.claims };
  if (!(await isAllowed(email))) throw new HttpsError("permission-denied", REJECTION_MESSAGE);
  // An investor (or a former team member who is also an investor): no team permissions.
  return team ? { customClaims: NO_TEAM_CLAIMS } : undefined;
}

exports.beforeSignIn = beforeUserSignedIn(decide);
exports.beforeCreate = beforeUserCreated(decide);

// Outreach module (Phase 1) — required after initializeApp() above, since its
// modules call getFirestore()/getStorage(). See functions/outreach/.
Object.assign(exports, require("./outreach"));

// Team access (Phase 1) — see "Portal - Team Access & Roles Plan.md".
exports.teamAccess = require("./access/team").teamAccess;
exports.teamExpiry = require("./access/team").teamExpiry;
