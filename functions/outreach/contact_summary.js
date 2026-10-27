// Contacted column (27 Oct 2026, switch search.contactColumns): each company keeps
// a short summary of how it was contacted, per channel, in `touches`:
//   touches.<channel> = { n, at, by, outcome, inAt }
// n = outgoing contacts on that channel, at / by / outcome = the latest one, inAt =
// the latest answer (an email received, a call that connected, a meeting held, a
// LinkedIn / WhatsApp reply). The Search CRM list shows one icon per channel from
// it — no extra reads. Rebuilt in full from the company's activities by the page
// (recomputeActivityFields) and the backfill tool (Tools/contact-summary); kept up
// to date here, one contact at a time, by store.touchCompany. Twin of
// portal/contact-summary.js (same rules — a test checks they agree).
// Test traffic, automatic notes and future-dated entries never count.

const CHANNELS = ["email", "call", "letter", "linkedin", "whatsapp", "visit", "meeting", "intro"];
// Activity type → channel.
const TYPE_CHANNEL = {
  email: "email", email_received: "email", letter: "letter", call_attempted: "call", call_connected: "call",
  whatsapp: "whatsapp", linkedin: "linkedin", in_person: "visit", meeting_scheduled: "meeting", meeting_done: "meeting", warm_intro: "intro",
};
// A task's channel (Outreach) → channel.
const TASK_CHANNEL = { email: "email", call: "call", letter: "letter", linkedin: "linkedin", whatsapp: "whatsapp", visit: "visit" };
// Entries that are an answer, not an outgoing contact.
const ANSWER_TYPES = ["email_received"];
// …and outgoing contacts that also got an answer.
const ANSWERED_TYPES = ["call_connected", "meeting_done"];
const ANSWER_OUTCOMES = ["replied", "accepted", "connected", "met"];

const ms = (t) => (t?.toMillis ? t.toMillis() : t?.seconds != null ? t.seconds * 1000 : t?._seconds != null ? t._seconds * 1000 : t ? new Date(t).getTime() : 0);

// The whole summary from a company's activities (the page and the backfill).
function summaryOf(activities, now = Date.now()) {
  const out = {};
  for (const a of activities || []) {
    if (!a || a.isTest || a.recordDeleted) continue;
    const ch = TYPE_CHANNEL[a.type];
    if (!ch) continue;
    const t = ms(a.date || a.createdAt);
    if (!t || t > now) continue;
    const s = out[ch] || (out[ch] = { n: 0, at: null, by: null, outcome: null, inAt: null });
    const answered = ANSWER_TYPES.includes(a.type) || ANSWERED_TYPES.includes(a.type) || ANSWER_OUTCOMES.includes(a.outcome);
    if (answered && t > ms(s.inAt)) s.inAt = a.date || a.createdAt;
    if (ANSWER_TYPES.includes(a.type)) continue;
    s.n++;
    if (t >= ms(s.at)) { s.at = a.date || a.createdAt; s.by = a.createdBy || null; s.outcome = a.outcome || (a.type === "call_attempted" ? "no_answer" : a.type === "call_connected" ? "connected" : null); }
  }
  return out;
}

// One contact as dotted update paths for touchCompany (the increment and the time
// come from the caller: FieldValue.increment(1) and the server time).
function patchFor({ channel, direction, by = null, outcome = null, answered = false }, { now, inc }) {
  const ch = TASK_CHANNEL[channel] || (CHANNELS.includes(channel) ? channel : null);
  if (!ch) return {};
  if (direction === "in") return { [`touches.${ch}.inAt`]: now };
  return {
    [`touches.${ch}.n`]: inc, [`touches.${ch}.at`]: now, [`touches.${ch}.by`]: by || null, [`touches.${ch}.outcome`]: outcome || null,
    ...(answered || ANSWER_OUTCOMES.includes(outcome) ? { [`touches.${ch}.inAt`]: now } : {}),
  };
}

module.exports = { CHANNELS, TYPE_CHANNEL, TASK_CHANNEL, ANSWER_OUTCOMES, summaryOf, patchFor };
