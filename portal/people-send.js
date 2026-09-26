// Relationship emails — Investor CRM / Network "Send email" and the admin
// "notify investors" / "send update" (Outreach Phase 5c). Goes through the
// outreachPeopleSend Cloud Function (admin sign-in, suppression, test mode,
// usage bar) instead of the old Netlify notify function and its shared secret.
import { auth } from './firebase-config.js';
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-functions.js";

const call = httpsCallable(getFunctions(auth.app, 'us-central1'), 'outreachPeopleSend', { timeout: 120000 });

// Same payload as before: { recipients: [{ email, name }], subject, message, from, kind?, combined?, doc… }.
// Returns { sent, skipped: [{ email, reason }], isTest }; throws an Error with a readable message.
export async function sendPeopleEmail(payload) {
  try { return (await call(payload)).data; }
  catch (e) { throw new Error(e?.message || String(e)); }
}

const REASON = { unsubscribed: 'unsubscribed', hard_bounce: 'address bounced', complaint: 'marked as spam', provider_suppressed: 'blocked by the provider' };
// One line for the success message: who was left out, and whether it was a test.
export function sendNote(r) {
  const parts = [];
  if (r?.skipped?.length) parts.push(`Not sent to ${r.skipped.map(s => `${s.email} (${REASON[s.reason] || s.reason})`).join(', ')}.`);
  if (r?.isTest) parts.push('Test mode is on — it went to the test address.');
  return parts.join(' ');
}
