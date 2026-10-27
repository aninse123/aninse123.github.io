// One inbox (owner-aware outreach, Stage 1, 19 Oct 2026; switch
// "outreach.oneInbox"): the same email address never gets two cold emails
// within the campaign's "contacted in the last N days" window, whichever
// company it belongs to, and never two first drafts on the same day. It's a
// sending rule about addresses, not ownership: whoever reads that inbox would
// get both.
//
// Conversations remember every address used in them (thread.addresses, from
// 19 Oct); older ones are found by their main address (contactEmail). Test
// conversations store the intended address in `addresses` (their contactEmail
// is the approved test address), so a test campaign checks test conversations
// and a real campaign real ones.

const store = require("./store");
const { normEmail } = require("./util");
const { db, Timestamp, FieldValue } = store;

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
function ms(t) {
  if (!t) return 0;
  if (typeof t.toMillis === "function") return t.toMillis();
  if (typeof t._seconds === "number") return t._seconds * 1000;
  const n = typeof t === "number" ? t : Date.parse(t);
  return isNaN(n) ? 0 : n;
}
const DAY = 86400000;

// emails → Map(email → [{ companyId, companyName, at, campaignId, threadId, direction }]),
// newest first: conversations with a message since `sinceMs`.
async function recentByAddress(emails, { sinceMs, isTest }) {
  const list = [...new Set((emails || []).map(normEmail).filter(Boolean))];
  const want = new Set(list);
  const out = new Map();
  const seen = new Set();
  const take = (d) => {
    if (seen.has(d.id)) return;
    seen.add(d.id);
    const t = d.data();
    if (!!t.isTest !== !!isTest) return;
    if (t.status === "failed") return; // 27 Oct: its email never went out — not a contact
    const at = ms(t.lastMessageAt || t.createdAt);
    if (at < sinceMs) return;
    const addrs = new Set([...(t.addresses || []), ...(t.isTest ? [] : [normEmail(t.contactEmail)])].filter(Boolean));
    for (const e of addrs) {
      if (!want.has(e)) continue;
      const arr = out.get(e) || [];
      arr.push({ companyId: t.companyId || null, companyName: t.companyName || "", at, campaignId: t.campaignId || null, threadId: d.id, direction: t.lastDirection || "out" });
      out.set(e, arr);
    }
  };
  for (const group of chunks(list, 30)) {
    const [byMain, byAny] = await Promise.all([
      db().collection("outreachThreads").where("contactEmail", "in", group).get(),
      db().collection("outreachThreads").where("addresses", "array-contains-any", group).get(),
    ]);
    byMain.docs.forEach(take);
    byAny.docs.forEach(take);
  }
  for (const arr of out.values()) arr.sort((a, b) => b.at - a.at);
  return out;
}

// The newest conversation with this address that belongs to another company.
function otherCompanyHit(map, email, companyId) {
  const arr = map?.get(normEmail(email)) || [];
  return arr.find((h) => h.companyId && h.companyId !== companyId) || null;
}

// First drafts (waiting or approved) to this address for another company.
async function openDraftsTo(email, { isTest, companyId }) {
  const e = normEmail(email);
  if (!e) return [];
  const snap = await db().collection("outreachMessages").where("recipient.email", "==", e).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((m) => ["draft", "approved", "approving"].includes(m.status) && !m.isReply && !!m.isTest === !!isTest && m.companyId && m.companyId !== companyId)
    .map((m) => ({ companyId: m.companyId, companyName: m.companyName || "", at: ms(m.createdAt), campaignId: m.campaignId || null, messageId: m.id }));
}

const fmtDay = (t) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Lisbon" });

// Scheduler check before a company's first email. Returns null, or
// { kind: "recent" | "draft" | "run", companyId, companyName, at, untilMs? }.
//   recent: another company's conversation with this address inside the window → wait until it ends
//   draft:  another company's first draft to this address is waiting / approved → next sending day
//   run:    another company got a draft or email to this address earlier in this run → next sending day
async function clash({ email, companyId, isTest, windowDays, now, thisRun }) {
  const e = normEmail(email);
  if (!e || !(windowDays > 0)) return null;
  const nowMs = now.getTime();
  const sameRun = thisRun?.get(e);
  if (sameRun && sameRun.companyId !== companyId) return { kind: "run", ...sameRun };
  const recent = otherCompanyHit(await recentByAddress([e], { sinceMs: nowMs - windowDays * DAY, isTest }), e, companyId);
  if (recent) return { kind: "recent", companyId: recent.companyId, companyName: recent.companyName, at: recent.at, campaignId: recent.campaignId, untilMs: recent.at + windowDays * DAY };
  const drafts = await openDraftsTo(e, { isTest, companyId });
  if (drafts.length) return { kind: "draft", ...drafts.sort((a, b) => a.at - b.at)[0] };
  return null;
}

// "Waiting: same address as Fillwork (last email 12 Oct) until 11 Nov."
function holdText(c, untilMs, email) {
  const who = c.companyName || "another company";
  const what = c.kind === "recent" ? `last email ${fmtDay(c.at)}` : c.kind === "draft" ? "its first email is waiting for approval" : "emailed in this same run";
  return `Waiting: ${email} is also the address of ${who} (${what}). Tries again ${fmtDay(untilMs)}.`;
}

// One activity on the held company per hold (not every run).
async function logHold({ companyId, text, isTest, campaignId, enrolmentId }) {
  if (!companyId) return;
  await db().collection("searchActivities").add({
    companyId, type: "outreach_hold", date: Timestamp.now(),
    title: (isTest ? "[TEST] " : "") + "Held: same email address", content: text,
    status: null, isTest: !!isTest, campaignId: campaignId || null, enrolmentId: enrolmentId || null,
    createdAt: FieldValue.serverTimestamp(), createdBy: "scheduler",
  });
}

module.exports = { recentByAddress, otherCompanyHit, openDraftsTo, clash, holdText, logHold, fmtDay, DAY };
