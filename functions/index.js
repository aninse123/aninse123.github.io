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

exports.beforeSignIn = beforeUserSignedIn(async (event) => {
  if (!(await isAllowed(event.data?.email))) {
    throw new HttpsError("permission-denied", REJECTION_MESSAGE);
  }
});

exports.beforeCreate = beforeUserCreated(async (event) => {
  if (!(await isAllowed(event.data?.email))) {
    throw new HttpsError("permission-denied", REJECTION_MESSAGE);
  }
});
