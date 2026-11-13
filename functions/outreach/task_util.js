// Outreach Phase 2b — manual campaign steps as tasks (spec §5.1, §8.2): the
// outcome buttons per channel and what each one writes on the company.

// activity: the searchActivities type the outcome logs (search.html ACT).
// reply:    the company answered — "stop the sequence" is ticked by default.
// reopen:   the task stays open with a new date (call back, reschedule).
const OUTCOMES = {
  linkedin: [
    { key: "viewed", label: "Viewed profile", activity: "linkedin" },
    { key: "request_sent", label: "Request sent", activity: "linkedin" },
    { key: "accepted", label: "Accepted", activity: "linkedin" },
    { key: "messaged", label: "Messaged", activity: "linkedin" },
    { key: "replied", label: "Replied", activity: "linkedin", reply: true },
    { key: "not_found", label: "Not found", activity: "linkedin" },
  ],
  call: [
    { key: "connected", label: "Connected", activity: "call_connected", reply: true },
    { key: "no_answer", label: "No answer", activity: "call_attempted" },
    { key: "voicemail", label: "Voicemail", activity: "call_attempted" },
    { key: "wrong_number", label: "Wrong number", activity: "call_attempted" },
    { key: "callback", label: "Call back on…", activity: "call_attempted", reopen: true },
    // 13 Nov (switch outreach.callResults): someone answered — the card then asks for the result and the sequence choice.
    { key: "answered", label: "Answered", activity: "call_connected", reply: true },
  ],
  whatsapp: [
    { key: "sent", label: "Sent", activity: "whatsapp" },
    { key: "replied", label: "Replied", activity: "whatsapp", reply: true },
    { key: "not_on_whatsapp", label: "Not on WhatsApp", activity: "whatsapp" },
  ],
  letter: [
    { key: "posted", label: "Printed & posted", activity: "letter" },
    { key: "returned", label: "Returned", activity: "letter" },
  ],
  visit: [
    { key: "met", label: "Met", activity: "in_person", reply: true },
    { key: "not_there", label: "Not there", activity: "in_person" },
    { key: "reschedule", label: "Reschedule…", activity: "in_person", reopen: true },
  ],
  other: [
    { key: "done", label: "Done", activity: "other" },
  ],
};
const SKIP = { key: "skipped", label: "Skipped", activity: null };

const CHANNEL_LABEL = { email: "Email", linkedin: "LinkedIn", call: "Call", whatsapp: "WhatsApp", letter: "Letter", visit: "Visit", other: "Task" };

function findOutcome(channel, key) {
  if (key === "skipped") return SKIP;
  return (OUTCOMES[channel] || []).find((o) => o.key === key) || null;
}

// 4 Nov: a task step of the "other" type can define its own results (e.g. "Funds arrived" / "Not yet"); the default is the single "Done".
function stepOutcome(channel, step, key) {
  if (key === "skipped") return SKIP;
  if (channel === "other" && Array.isArray(step?.outcomes) && step.outcomes.length) {
    const o = step.outcomes.find((x) => x.key === key);
    return o ? { key: o.key, label: o.label, activity: "other" } : null;
  }
  return findOutcome(channel, key);
}

// Task id per enrolment and step (like the step's message id): re-running a
// due step finds the same task instead of creating a second one.
const stepTaskId = (enrolmentId, stepId) => `${enrolmentId}_${stepId}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);

// ── Call results (13 Nov 2026, switch outreach.callResults; plan "Call Results Plan" v3) ──
// When the company answered (a call "Answered", WhatsApp / LinkedIn "Replied", a visit "Met"), the result is one of the
// Inbox categories (outreachThreads.responseCategory), so metrics, chips, campaign rows and the Monday report read one list.
// sequence: what happens to every live address of the company by default (the card shows it, and it can be changed).
// reminder: awaiting = a follow-up task in 3 working days, closed by itself when the company writes in;
//           later = a "Next follow-up" date on the company (3 / 6 / 12 months) with a task on that day;
//           referred = a task to call the person they pointed to (next working day).
// reopen:   the same task stays open for the date and time chosen (Call back at…).
const RESULTS = [
  { key: "interested", label: "Interested", sequence: "stop" },
  { key: "wait_for_response", label: "Awaiting reply", sequence: "pause", reminder: "awaiting" },
  { key: "callback_later", label: "Call back at…", sequence: "pause", reopen: true },
  { key: "not_now", label: "Not now", sequence: "stop", reminder: "later" },
  { key: "not_interested", label: "Not interested", sequence: "stop" },
  { key: "referred", label: "Referred", sequence: "pause", reminder: "referred" },
  { key: "wrong_contact", label: "Wrong contact", sequence: "continue" },
];
const SEQUENCE_MODES = ["continue", "pause", "stop"];
const AWAITING_DAYS = 3; // working days, with the campaign's sending days and holidays (else Outreach → Settings)
const PAUSE_DAYS = 3; // a pause chosen without a date
const findResult = (key) => RESULTS.find((r) => r.key === key) || null;
// The outcomes after which the card asks for a result: someone answered.
const isAnswered = (o) => !!o && !!o.reply;

// "Number used": a Portuguese number reduced to its 9 national digits (same rule as the CRM's phone search, phoneKey in
// search.html / outreach.html); any other number keeps its digits with an "x" in front, so it is still one key per number.
function phoneKey(v) {
  const raw = String(v == null ? "" : v).trim();
  let d = raw.replace(/\D/g, "");
  if (/^(\+|00)/.test(raw) || (d.length === 12 && d.startsWith("351"))) {
    if (/^00/.test(raw) && !raw.startsWith("+")) d = d.slice(2);
    if (d.startsWith("351") && d.length === 12) return d.slice(3);
    return null;
  }
  return d.length === 9 ? d : null;
}
const reachKey = (v) => { const k = phoneKey(v); if (k) return k; const d = String(v == null ? "" : v).replace(/\D/g, ""); return d.length >= 6 ? "x" + d.slice(0, 20) : null; };

// The line that says who answered, for the campaign row and the stop reason: "Answered by phone: Sofia Soares · +351 …".
const ANSWER_WORD = { call: "by phone", whatsapp: "on WhatsApp", linkedin: "on LinkedIn", visit: "in person", other: "" };
function answerLine(channel, who) {
  const bits = [who?.name, channel === "visit" ? "" : who?.number].map((x) => String(x || "").trim()).filter(Boolean);
  const word = ANSWER_WORD[channel] ?? "";
  return `Answered${word ? " " + word : ""}${bits.length ? ": " + bits.join(" · ") : ""}`;
}

module.exports = { OUTCOMES, SKIP, CHANNEL_LABEL, findOutcome, stepOutcome, stepTaskId, RESULTS, SEQUENCE_MODES, AWAITING_DAYS, PAUSE_DAYS, findResult, isAnswered, phoneKey, reachKey, answerLine };
