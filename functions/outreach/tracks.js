// Several recipients per company (30 Oct 2026, plan step 4, switch outreach.multiRecipient).
// A company in a campaign has one enrolment (its first track, to the first ticked address). Each further ticked address
// is a "track": a sibling enrolment (trackOf = the first one's id) with its own conversation, started once email 1 of
// the first track has gone out, one working day apart. Everything else (steps, drafts, waits) is the ordinary enrolment
// machinery. A hard bounce moves on to the next address (fallback); a reply from anyone stops them all, with the reason
// written down, and can be undone with restartCompany.

const store = require("./store");
const { addWait, sendingDaysOf } = require("./schedule_util");
const { normEmail } = require("./util");
const { LIVE_ENROLMENT } = require("./campaign_util");
const { companyRecipients, pickAddresses } = require("./recipients");

const { db, FieldValue, Timestamp } = store;
const MAX_TRACKS = 3;
const trackId = (rootId, n) => `${rootId}__t${n}`;
const rootOf = (id, e) => (e && e.trackOf) || id;
const campaigns = () => require("./campaigns"); // lazy: campaigns requires this module's callers
const ts = (d) => Timestamp.fromDate(d);

// One extra address of a company: a sibling enrolment of the first one, waiting to start once email 1 of the first has gone out.
// isExtra: an extra address of the same company (not a replacement after a bounce, which takes the first one's place).
function trackDoc(root, rootId, n, r, caller, { late = false, fallbackFrom = null } = {}) {
  const email = normEmail(r.email);
  return {
    campaignId: root.campaignId, campaignName: root.campaignName || "", companyId: root.companyId, companyName: root.companyName || "",
    owner: root.owner || null, contactEmail: email, source: root.source || null, sourceLabel: root.sourceLabel || null,
    status: "pending", stopReason: null, currentStep: 0, nextActionAt: null, senderId: root.senderId || null, threadId: null,
    variants: {}, history: [], isTest: !!root.isTest, createdAt: FieldValue.serverTimestamp(), enrolledBy: caller, endedAt: null,
    isTrack: true, isExtra: true, trackOf: rootId, trackIndex: n,
    recipient: { email, name: r.name || "", kind: r.kind || "company", ...(r.personId ? { personId: r.personId } : {}) }, recipientList: [email],
    ...(late ? { forceApproval: true } : {}), ...(fallbackFrom ? { fallbackFrom } : {}),
    // 2 Nov: the related companies chosen to be mentioned are a company-level choice: every address carries them
    ...(root.mention?.length ? { mention: root.mention } : {}), ...(root.known?.length ? { known: root.known } : {}),
  };
}

async function siblingsOf(rootId) {
  const snap = await db().collection("outreachEnrolments").where("trackOf", "==", rootId).get();
  return snap.docs;
}

// The tracks of one first-track enrolment wanted after a choice: `list` = [{ email, name, kind }] for the 2nd address on.
// Live tracks whose address is no longer wanted end ("removed"); new addresses get a track. `late`: the first email
// has already gone out, so these start as drafts to approve even in an automatic campaign.
async function syncTracks(rootId, list, caller, { late = false, maxExtras = MAX_TRACKS - 1 } = {}) {
  const rootRef = db().doc(`outreachEnrolments/${rootId}`);
  const root = (await rootRef.get()).data();
  if (!root) return { added: 0, removed: 0 };
  const sibs = await siblingsOf(rootId);
  const want = new Map(list.slice(0, maxExtras).map((r) => [normEmail(r.email), r]));
  let removed = 0, added = 0;
  for (const d of sibs) {
    const s = d.data(), em = normEmail(s.recipient?.email);
    if (!LIVE_ENROLMENT.includes(s.status)) continue;
    if (want.has(em)) { want.delete(em); continue; }
    if (await campaigns().endEnrolment(d.ref, "removed", `Removed by ${caller}`)) removed++;
  }
  let n = sibs.reduce((m, d) => Math.max(m, d.data().trackIndex || 0), 0);
  for (const [email, r] of want) {
    n++;
    await db().doc(`outreachEnrolments/${trackId(rootId, n)}`).set(trackDoc(root, rootId, n, { email, ...r }, caller, { late }));
    added++;
  }
  await rootRef.update({ multiRecipient: true, tracksBy: caller, tracksAt: FieldValue.serverTimestamp() });
  return { added, removed };
}

// Scheduler, each run: pending tracks start once their first track's email 1 has gone out.
async function startTracks(campaign, now, report = {}) {
  const snap = await db().collection("outreachEnrolments").where("campaignId", "==", campaign.id).where("isTrack", "==", true).where("status", "==", "pending").limit(200).get();
  for (const d of snap.docs) {
    const t = d.data();
    const rootSnap = await db().doc(`outreachEnrolments/${t.trackOf}`).get();
    const root = rootSnap.exists ? rootSnap.data() : null;
    if (!root || ["replied", "removed", "moved"].includes(root.status) || (root.status === "stopped" && !/bounce/i.test(root.stopReason || ""))) {
      await campaigns().endEnrolment(d.ref, "removed", "The company's first email will not go out"); continue;
    }
    if (!root.threadId && !((root.currentStep || 0) > 0)) continue; // email 1 to the first address has not gone out yet
    // 2 Nov: another person can be written to the same day; a general address next to a person waits (it may reach the same person).
    // Campaign settings startDelayPerson (default 0) / startDelayCompany (default 1), in working days after email 1 of the first address.
    const days = t.recipient?.kind === "company" ? (campaign.startDelayCompany ?? 1) : (campaign.startDelayPerson ?? 0);
    const due = days > 0 ? addWait(now, { days, unit: "working" }, campaign._sendingDays, campaign._skipHolidays !== false, campaign._waitStart) : now;
    await d.ref.update({ status: "active", currentStep: 0, nextActionAt: ts(due), startedAt: ts(now), senderId: root.senderId || t.senderId || null,
      ...(root.mention?.length && !t.mention?.length ? { mention: root.mention } : {}), ...(root.known?.length && !t.known?.length ? { known: root.known } : {}),
      ...(root.pathId ? { pathId: root.pathId, pathName: root.pathName || null, plannedPathId: root.plannedPathId || null } : {}) });
    report.tracksStarted = (report.tracksStarted || 0) + 1;
  }
}

// 3 Nov: an address stopped by an error (bounced, or its domain has no mail servers). If the same person (a general address: the
// company's other general addresses) has another usable address that this company has not been written to yet, it becomes a new
// track of the company, waiting in To approve (forceApproval) — even while other addresses of the company are running. Returns the
// address added, or null. Only once email 1 has gone out to the company's first address (the track starts after it).
async function addAlternateAddress(enrolmentId, deadEmail, caller = "system") {
  const ref = db().doc(`outreachEnrolments/${enrolmentId}`);
  const e = (await ref.get()).data();
  if (!e || !e.companyId || e.isTest) return null;
  const rootId = rootOf(enrolmentId, e);
  const rootSnap = rootId === enrolmentId ? null : await db().doc(`outreachEnrolments/${rootId}`).get();
  const root = rootSnap ? (rootSnap.exists ? rootSnap.data() : null) : e;
  if (!root || ["replied", "removed", "moved"].includes(root.status) || (!root.threadId && !((root.currentStep || 0) > 0))) return null;
  const [cs, camp, sibs] = await Promise.all([
    db().doc(`searchCompanies/${e.companyId}`).get(), db().doc(`outreachCampaigns/${e.campaignId}`).get(),
    db().collection("outreachEnrolments").where("companyId", "==", e.companyId).where("campaignId", "==", e.campaignId).get(),
  ]);
  if (!cs.exists) return null;
  const campaign = camp.exists ? camp.data() : {};
  const all = sibs.docs.map((d) => ({ id: d.id, ...d.data() }));
  const max = Math.min(MAX_TRACKS, Number(campaign.addressMax) || MAX_TRACKS);
  if (all.filter((x) => x.id !== enrolmentId && LIVE_ENROLMENT.includes(x.status)).length >= max) return null; // the cap counts live addresses (not the one that failed)
  const used = new Set(all.flatMap((x) => [x.recipient?.email, ...(x.recipientTried || [])]).map(normEmail).filter(Boolean));
  const dead = normEmail(deadEmail || e.recipient?.email);
  used.add(dead);
  const cands = await companyRecipients(e.companyId, cs.data(), { usePeople: true, trust: { on: true, includeUnverified: !!campaign.useUnverified } });
  const personId = e.recipient?.personId || null, kind = e.recipient?.kind || "company";
  const pick = [];
  for (const r of cands) {
    const em = normEmail(r.email);
    if (r.blocked || r.trust === "bounced" || used.has(em)) continue;
    if (personId ? r.personId !== personId : (kind !== "company" || r.kind !== "company")) continue; // the same person, or another general address
    if (await store.findSuppression(em)) continue;
    pick.push({ ...r, email: em }); break;
  }
  if (!pick.length) return null;
  const n = all.reduce((m, x) => Math.max(m, x.trackIndex || 0), 0) + 1;
  await db().doc(`outreachEnrolments/${trackId(rootId, n)}`).set(trackDoc(root, rootId, n, pick[0], caller, { late: true, fallbackFrom: dead }));
  await db().doc(`outreachEnrolments/${rootId}`).update({ multiRecipient: true, tracksBy: caller, tracksAt: FieldValue.serverTimestamp() });
  return pick[0].email;
}

// A hard bounce on a conversation. "fallback": the next address in the company's list takes over; "track": this track
// ended and others carry on; "none": nothing else to try, the caller stops the company as before.
async function onHardBounce(enrolmentId, bouncedEmail, now = new Date()) {
  if (!enrolmentId) return "none";
  const ref = db().doc(`outreachEnrolments/${enrolmentId}`);
  const e = (await ref.get()).data();
  if (!e || !e.companyId || !LIVE_ENROLMENT.includes(e.status)) return "none";
  const root = rootOf(enrolmentId, e);
  const mates = (await siblingsOf(root)).filter((d) => d.id !== enrolmentId && LIVE_ENROLMENT.includes(d.data().status));
  const rootSnap = root === enrolmentId ? null : await db().doc(`outreachEnrolments/${root}`).get();
  const rootLive = root === enrolmentId ? false : rootSnap.exists && LIVE_ENROLMENT.includes(rootSnap.data().status);
  if (mates.length || rootLive) {
    await campaigns().endEnrolment(ref, "stopped", "Email bounced"); // the other addresses carry on
    const alt = await addAlternateAddress(enrolmentId, bouncedEmail, "system").catch(() => null); // 3 Nov: the same person's next address, to approve
    if (alt) await ref.update({ stopReason: `Email bounced; ${alt} (same person) waits in To approve` }).catch(() => {});
    return "track";
  }
  // Nobody else is running: try the next address of the saved list that has not been tried
  const bounced = normEmail(bouncedEmail || e.recipient?.email);
  const everyone = [...(await siblingsOf(root)), ...(root === enrolmentId ? [] : [rootSnap])].filter((d) => d && d.exists !== false);
  const used = everyone.map((d) => normEmail(d.data().recipient?.email)).filter(Boolean); // an address another conversation already writes to is tried
  const tried = new Set([...(e.recipientTried || []), bounced, ...used].map(normEmail));
  const list = (e.recipientList || []).map(normEmail);
  const next = list.find((x) => !tried.has(x) && x !== bounced);
  if (!next) {
    const alt = await addAlternateAddress(enrolmentId, bouncedEmail, "system").catch(() => null); // 3 Nov: the same person's other address, to approve
    if (!alt) return "none";
    await campaigns().endEnrolment(ref, "stopped", `Email bounced; ${alt} (same person) waits in To approve`);
    return "track";
  }
  const sup = await store.findSuppression(next);
  const remaining = list.find((x) => !tried.has(x) && x !== bounced && x !== next);
  if (sup && !remaining) return "none";
  const pick = sup ? remaining : next;
  const camp = (await db().doc(`outreachCampaigns/${e.campaignId}`).get()).data() || {};
  const settings = await store.getSettings();
  const n = (await siblingsOf(root)).reduce((m, d) => Math.max(m, d.data().trackIndex || 0), 0) + 1;
  await db().doc(`outreachEnrolments/${trackId(root, n)}`).set({
    campaignId: e.campaignId, campaignName: e.campaignName || "", companyId: e.companyId, companyName: e.companyName || "",
    owner: e.owner || null, contactEmail: pick, source: e.source || null, sourceLabel: e.sourceLabel || null,
    status: "active", stopReason: null, currentStep: 0, senderId: e.senderId || null, threadId: null, variants: {}, history: [], isTest: !!e.isTest,
    createdAt: FieldValue.serverTimestamp(), startedAt: FieldValue.serverTimestamp(), endedAt: null, isTrack: true, trackOf: root, trackIndex: n, fallbackFrom: bounced,
    nextActionAt: ts(addWait(now, { days: 1, unit: "working" }, sendingDaysOf(camp, settings), true, null)),
    recipient: { email: pick, name: "", kind: "company" }, recipientList: list, recipientTried: [...tried, pick].filter((x) => x !== pick),
    ...(e.pathId ? { pathId: e.pathId, pathName: e.pathName || null } : {}),
  });
  await campaigns().endEnrolment(ref, "stopped", `Email bounced (${bounced}); trying ${pick}`);
  if (!camp.isTest) await db().doc(`searchCompanies/${e.companyId}`).update({ activeCampaignId: e.campaignId, activeCampaignName: camp.name || "", activeEnrolmentId: trackId(root, n) });
  return "fallback";
}

// 2 Nov (campaign setting "addresses per company"): when a company starts, choose its addresses by the campaign's mode and
// make the extra ones tracks. A company whose addresses were chosen by hand (Choose…, recipientList) is left as chosen.
async function applyAddressMode(campaign, ref) {
  const mode = campaign.addressMode || "one";
  if (mode === "one") return { skipped: "mode_one" };
  const e = (await ref.get()).data();
  if (!e || !e.companyId || e.trackOf) return { skipped: "not_a_company_first_track" };
  if (Array.isArray(e.recipientList) && e.recipientList.length) return { skipped: "chosen_by_hand" };
  const co = await db().doc(`searchCompanies/${e.companyId}`).get();
  if (!co.exists) return { skipped: "no_company" };
  const all = await companyRecipients(e.companyId, co.data(), { usePeople: true, trust: { on: true, includeUnverified: !!campaign.useUnverified } });
  const picked = pickAddresses(all, { mode, max: campaign.addressMax, policy: campaign.recipientPolicy || "company" });
  if (!picked.length) return { skipped: "no_address" };
  const rec = (r) => ({ email: r.email, name: r.name || "", kind: r.kind, ...(r.personId ? { personId: r.personId } : {}), ...(r.gender ? { gender: r.gender, genderSource: r.genderSource || "" } : {}) });
  await ref.update({ recipient: rec(picked[0]), recipientList: picked.map((r) => r.email), recipientListBy: "campaign setting", recipientListAt: FieldValue.serverTimestamp() });
  let r = { added: 0 };
  if (picked.length > 1) r = await syncTracks(ref.id, picked.slice(1).map((x) => ({ email: x.email, name: x.name, kind: x.kind, personId: x.personId || null })), "campaign setting");
  return { ok: true, addresses: picked.length, ...r };
}

// Why a reply stopped the company, when several tracks ran.
async function hasTracks(companyId) {
  if (!companyId) return false;
  const s = await db().collection("outreachEnrolments").where("companyId", "==", companyId).where("isTrack", "==", true).limit(1).get();
  return !s.empty;
}

// Restart what a reply stopped (by mistake, say an auto-reply): every enrolment of the company in this campaign that ended
// "replied", back at the step it was on, from the next working day. The track whose own conversation got the reply
// stays stopped unless includeReplier.
async function restartCompany({ enrolmentId, includeReplier = false }, caller, now = new Date()) {
  const e0 = (await db().doc(`outreachEnrolments/${enrolmentId}`).get()).data();
  if (!e0 || !e0.companyId) return { restarted: [], skipped: [{ reason: "not_found" }] };
  const co = (await db().doc(`searchCompanies/${e0.companyId}`).get()).data() || {};
  if (co.doNotContact?.on) return { restarted: [], skipped: [{ reason: "do_not_contact" }] };
  if (co.outreachStatus === "unsubscribed") return { restarted: [], skipped: [{ reason: "unsubscribed" }] };
  const camp = (await db().doc(`outreachCampaigns/${e0.campaignId}`).get()).data() || {};
  const settings = await store.getSettings();
  const all = (await db().collection("outreachEnrolments").where("campaignId", "==", e0.campaignId).where("companyId", "==", e0.companyId).get()).docs;
  const restarted = [], skipped = [];
  for (const d of all) {
    const s = d.data();
    if (s.status !== "replied") continue;
    const th = s.threadId ? (await db().doc(`outreachThreads/${s.threadId}`).get()).data() : null;
    const replier = !!th && th.status === "replied" && th.lastDirection === "in" && !th.lastInboundAuto;
    if (replier && !includeReplier) { skipped.push({ id: d.id, reason: "replier" }); continue; }
    if (s.recipient?.email && await store.findSuppression(s.recipient.email)) { skipped.push({ id: d.id, reason: "suppressed" }); continue; }
    const due = addWait(now, { days: 1, unit: "working" }, sendingDaysOf(camp, settings), true, null);
    // a reply from before this feature has no resumeStep: the step it was on is still there
    await d.ref.update({ status: "active", currentStep: s.resumeStep ?? s.currentStep ?? 0, nextActionAt: ts(due), stopReason: null, endedAt: null, lockUntil: null,
      restartedAt: FieldValue.serverTimestamp(), restartedBy: caller, resumeStep: FieldValue.delete(), resumeStatus: FieldValue.delete() });
    if (!(camp.isTest)) await db().doc(`searchCompanies/${e0.companyId}`).update({ activeCampaignId: e0.campaignId, activeCampaignName: camp.name || "", activeEnrolmentId: rootOf(d.id, s) });
    restarted.push(d.id);
  }
  return { restarted, skipped };
}

// For the company's page: the tracks of one enrolment and where each is.
async function tracksFor(enrolmentId) {
  const e = (await db().doc(`outreachEnrolments/${enrolmentId}`).get()).data();
  if (!e) return { tracks: [] };
  const root = rootOf(enrolmentId, e);
  const rootSnap = await db().doc(`outreachEnrolments/${root}`).get();
  const docs = [rootSnap, ...(await siblingsOf(root))].filter((d) => d.exists);
  return {
    root,
    tracks: docs.map((d) => { const s = d.data(); return { id: d.id, email: s.recipient?.email || s.contactEmail || "", name: s.recipient?.name || "", status: s.status, step: s.currentStep || 0, stopReason: s.stopReason || "", fallbackFrom: s.fallbackFrom || "", late: !!s.forceApproval, canRestart: s.status === "replied" }; }),
  };
}

module.exports = { syncTracks, startTracks, applyAddressMode, onHardBounce, addAlternateAddress, hasTracks, restartCompany, tracksFor, rootOf, MAX_TRACKS };
