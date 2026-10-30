// Several recipients per company (30 Oct 2026, switch outreach.multiRecipient): each ticked address its own email and
// conversation (a "track"), the next address after a bounce, who replied, and restarting by mistake. Synthetic data only.
const F = require("./fake_firebase.js");
const RL = require("../outreach/recipient_list.js");
const Tracks = require("../outreach/tracks.js");
const { stopCompanyEnrolments } = require("../outreach/campaigns.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const err = (code) => Object.assign(new Error(code), { code });
const dns = { resolveMx: async () => [{ exchange: "mx", priority: 1 }], resolve4: async () => [], resolve6: async () => { throw err("ENODATA"); } };
const en = (id) => store.get(`outreachEnrolments/${id}`);
const reason = async (p) => { try { await p; return null; } catch (e) { return e.details?.reason || e.message; } };
const live = (id) => ["pending", "active", "awaiting_approval", "awaiting_task", "paused"].includes(en(id)?.status);

function seed() {
  store.clear();
  store.set("searchCompanies/co1", { name: "EMPRESA, LDA", companyEmail: "geral@empresa.pt", reach: [{ id: "x1", type: "email", value: "contas@empresa.pt", status: "ok", origin: "team" }], contacts: [], activeCampaignId: "cmp1", activeEnrolmentId: "en1" });
  store.set("searchPeople/u_1", { name: "João Silva", reach: [{ id: "r1", type: "email", value: "joao@empresa.pt", status: "ok", primary: true, origin: "team" }] });
  store.set("searchPersonLinks/u_1__co1", { personId: "u_1", companyId: "co1", personName: "João Silva", personEntityType: "person", shCurrent: true, shDirectPct: 60, mgmtCurrent: true, mgmtRoles: ["Administrador"] });
  store.set("outreachCampaigns/cmp1", { name: "C", recipientPolicy: "best_person", status: "active", steps: [{ id: "s1", channel: "email", templateId: "t1", wait: { days: 0, unit: "working" } }, { id: "s2", channel: "email", templateId: "t1", wait: { days: 3, unit: "working" } }] });
  store.set("outreachEnrolments/en1", { campaignId: "cmp1", campaignName: "C", companyId: "co1", companyName: "EMPRESA, LDA", status: "active", currentStep: 0, senderId: "a@douropartners.pt" });
}

(async () => {
  seed();
  ok("several addresses need the switch", (await reason(RL.setRecipients({ enrolmentId: "en1", emails: ["joao@empresa.pt", "geral@empresa.pt"], all: true }, "andre", { deps: dns }))) === "multi_off");
  ok("more than three is refused", (await reason(RL.setRecipients({ enrolmentId: "en1", emails: ["joao@empresa.pt", "geral@empresa.pt", "contas@empresa.pt", "x@empresa.pt"], all: true }, "andre", { deps: dns, multi: true }))) === "too_many_tracks");

  // ── Ticking two: a track for the second ──
  const r = await RL.setRecipients({ enrolmentId: "en1", emails: ["joao@empresa.pt", "geral@empresa.pt"], all: true }, "andre", { deps: dns, multi: true });
  const t1 = en("en1__t1");
  ok("the first address stays on the company's enrolment; the second gets a track of its own", r.added === 1 && en("en1").recipient.email === "joao@empresa.pt" && t1 && t1.trackOf === "en1" && t1.isTrack === true && t1.recipient.email === "geral@empresa.pt" && t1.status === "pending" && !t1.forceApproval);
  ok("a track has no enrolledAt, so the daily pacing of new companies never counts it", t1.enrolledAt === undefined);

  // ── Starting tracks ──
  const camp = { id: "cmp1", _sendingDays: [1, 2, 3, 4, 5, 6, 7], _skipHolidays: false };
  const now = new Date("2026-11-03T10:00:00Z");
  await Tracks.startTracks(camp, now, {});
  ok("the track waits while email 1 of the first address has not gone out", en("en1__t1").status === "pending");
  store.set("outreachEnrolments/en1", { ...en("en1"), threadId: "th1", currentStep: 1 });
  const rep = {};
  await Tracks.startTracks(camp, now, rep);
  const a = en("en1__t1");
  ok("once email 1 has gone out the track starts, from step 1, a working day later, same sender", a.status === "active" && a.currentStep === 0 && a.senderId === "a@douropartners.pt" && rep.tracksStarted === 1 && a.nextActionAt.toMillis() > now.getTime());

  // ── Ticking another after email 1 (late) and unticking ──
  const late = await RL.setRecipients({ enrolmentId: "en1", emails: ["joao@empresa.pt", "geral@empresa.pt", "contas@empresa.pt"], all: true }, "andre", { deps: dns, multi: true });
  ok("a late address becomes a track that must wait in To approve", late.added === 1 && en("en1__t2").recipient.email === "contas@empresa.pt" && en("en1__t2").forceApproval === true);
  const late2 = await RL.setRecipients({ enrolmentId: "en1", emails: ["joao@empresa.pt", "geral@empresa.pt"], all: true }, "andre", { deps: dns, multi: true });
  ok("unticking ends that track and leaves the sent one alone", late2.removed === 1 && en("en1__t2").status === "removed" && live("en1__t1"));
  ok("after email 1 the first address cannot change", (await reason(RL.setRecipients({ enrolmentId: "en1", emails: ["geral@empresa.pt"], all: true }, "andre", { deps: dns, multi: true }))) === "already_started");

  // ── A bounce ──
  ok("a bounce with other conversations running: only that one stops", (await Tracks.onHardBounce("en1__t1", "geral@empresa.pt")) === "track" && en("en1__t1").status === "stopped" && live("en1"));
  ok("a bounce with nobody else and no other address: stop the company as before", (await Tracks.onHardBounce("en1", "joao@empresa.pt")) === "none" && en("en1").status === "active");

  seed();
  store.set("outreachEnrolments/en1", { ...en("en1"), threadId: "th1", currentStep: 1, recipient: { email: "joao@empresa.pt", kind: "person" }, recipientList: ["joao@empresa.pt", "geral@empresa.pt"] });
  const fb = await Tracks.onHardBounce("en1", "joao@empresa.pt");
  const fbT = en("en1__t1");
  ok("one address with a saved list: the next address takes over, from the start, in a conversation of its own", fb === "fallback" && fbT.recipient.email === "geral@empresa.pt" && fbT.status === "active" && fbT.currentStep === 0 && fbT.fallbackFrom === "joao@empresa.pt" && en("en1").status === "stopped");
  ok("the company keeps its campaign slot (now on the fallback)", store.get("searchCompanies/co1").activeEnrolmentId === "en1__t1");
  ok("and when that one bounces too, nothing is left", (await Tracks.onHardBounce("en1__t1", "geral@empresa.pt")) === "none");

  // ── A reply from anyone stops them all; restart ──
  seed();
  await RL.setRecipients({ enrolmentId: "en1", emails: ["joao@empresa.pt", "geral@empresa.pt"], all: true }, "andre", { deps: dns, multi: true });
  store.set("outreachEnrolments/en1", { ...en("en1"), threadId: "th1", currentStep: 2 });
  store.set("outreachEnrolments/en1__t1", { ...en("en1__t1"), status: "active", currentStep: 1, threadId: "th2" });
  store.set("outreachThreads/th1", { status: "replied", lastDirection: "in", lastInboundAuto: false, companyId: "co1" });
  store.set("outreachThreads/th2", { status: "waiting", lastDirection: "out", companyId: "co1" });
  ok("a company with tracks is known", (await Tracks.hasTracks("co1")) === true);
  const n = await stopCompanyEnrolments("co1", "Stopped: João (joao@empresa.pt) replied", "replied");
  ok("a reply stops every conversation of the company, with the reason, remembering the step", n === 2 && en("en1").status === "replied" && en("en1").stopReason.includes("joao@empresa.pt") && en("en1").resumeStep === 2 && en("en1__t1").status === "replied" && en("en1__t1").resumeStep === 1);
  const rs = await Tracks.restartCompany({ enrolmentId: "en1" }, "andre", new Date("2026-11-03T10:00:00Z"));
  ok("restart: the others come back at their step, from tomorrow; the one that replied stays stopped", rs.restarted.join() === "en1__t1" && rs.skipped[0].reason === "replier" && en("en1__t1").status === "active" && en("en1__t1").currentStep === 1 && en("en1__t1").nextActionAt.toMillis() > Date.parse("2026-11-03T10:00:00Z") && en("en1").status === "replied");
  const rs2 = await Tracks.restartCompany({ enrolmentId: "en1", includeReplier: true }, "andre", new Date("2026-11-03T10:00:00Z"));
  ok("restart with the replier too: back at step 3's place", rs2.restarted.join() === "en1" && en("en1").status === "active" && en("en1").currentStep === 2 && en("en1").restartedBy === "andre");
  store.set("outreachEnrolments/en1", { ...en("en1"), status: "replied" });
  store.set("searchCompanies/co1", { ...store.get("searchCompanies/co1"), doNotContact: { on: true } });
  ok("a company marked do not contact cannot be restarted", (await Tracks.restartCompany({ enrolmentId: "en1", includeReplier: true }, "andre")).skipped[0].reason === "do_not_contact");

  // A company that replied before this feature (no resumeStep) comes back at the step it was on, not at email 1
  store.set("outreachEnrolments/en1", { ...en("en1"), status: "replied", currentStep: 1 });
  store.set("searchCompanies/co1", { ...store.get("searchCompanies/co1"), doNotContact: null });
  const old = store.get("outreachEnrolments/en1"); delete old.resumeStep; store.set("outreachEnrolments/en1", old);
  await Tracks.restartCompany({ enrolmentId: "en1", includeReplier: true }, "andre", new Date("2026-11-03T10:00:00Z"));
  ok("an older reply with no remembered step restarts at the step it was on", en("en1").status === "active" && en("en1").currentStep === 1);
  store.set("outreachEnrolments/en1", { ...en("en1"), status: "replied" });

  // ── The tracks list for the company page ──
  const tl = await Tracks.tracksFor("en1__t1");
  ok("the list shows each conversation with its status", tl.root === "en1" && tl.tracks.length === 2 && tl.tracks.find((x) => x.id === "en1").status === "replied" && tl.tracks.find((x) => x.id === "en1").canRestart === true);

  // ── Preview of what one address would get ──
  seed();
  store.set("outreachSenders/a@douropartners.pt", { status: "active" });
  const pv = await RL.previewRecipient({ enrolmentId: "en1", email: "joao@empresa.pt" }, { prepare: async (o) => ({ subject: "Olá " + o.recipient.email, bodyText: "corpo", senderId: o.senderId }) });
  ok("preview returns subject and body for that address and writes nothing", pv.ok && pv.subject === "Olá joao@empresa.pt" && pv.text === "corpo" && !store.has("outreachMessages/undefined"));
  const pv2 = await RL.previewRecipient({ enrolmentId: "en1", email: "x@empresa.pt" }, { prepare: async () => { throw new Error("suppressed"); } });
  ok("a refusal comes back as text, not a crash", pv2.ok === false && pv2.error === "suppressed");

  console.log(fail ? `\n${fail} FAILED` : "\nAll passed");
  process.exit(fail ? 1 : 0);
})();
