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

// Task id per enrolment and step (like the step's message id): re-running a
// due step finds the same task instead of creating a second one.
const stepTaskId = (enrolmentId, stepId) => `${enrolmentId}_${stepId}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);

module.exports = { OUTCOMES, SKIP, CHANNEL_LABEL, findOutcome, stepTaskId };
