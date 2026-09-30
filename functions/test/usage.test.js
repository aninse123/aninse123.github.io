// Usage (Team & access → Usage): counters where things happen, exact figures
// from Google Cloud Monitoring (fallback when refused), the "right now"
// snapshot, sender-cap alerts, the 90-day rollup and the partner-only callable.
const F = require("./fake_firebase.js");
const { store, Timestamp } = F;
const U = require("../usage");
const T = require("../access/team.js");
const fns = require("../index.js");

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const day = () => store.get(`usageDaily/${U.lisbonDay()}`) || {};

(async () => {
  // Days and keys
  ok("Pacific midnight in summer = 07:00 UTC; Lisbon midnight in summer = 23:00 UTC the day before", U.zonedMidnight("2026-09-30", "America/Los_Angeles").toISOString() === "2026-09-30T07:00:00.000Z" && U.zonedMidnight("2026-09-30", "Europe/Lisbon").toISOString() === "2026-09-29T23:00:00.000Z");
  ok("winter time too (Pacific 08:00 UTC)", U.zonedMidnight("2026-12-01", "America/Los_Angeles").toISOString() === "2026-12-01T08:00:00.000Z");
  ok("map keys are made safe (no dots or @)", U.safeKey("an.rocha@mail.douropartners-team.pt") === "an_rocha_mail_douropartners-team_pt");
  const n = U.nest({ "email.sentBy.x@y": 2 });
  ok("dotted paths nest (field names keep their case); odd characters in a key are replaced", n.email?.sentBy?.x_y?.__op === "increment" || n.email?.sentBy?.x_y != null);

  // People
  store.set("team/maria@douropartners.pt", { key: "maria", status: "active" });
  ok("person key: partners by email, team members by short name, others by the email's start", (await U.personKey("andre.rocha@douropartners.pt")) === "andre" && (await U.personKey("Maria@DouroPartners.pt")) === "maria" && (await U.personKey("x.y@gmail.com")) === "x_y");

  // Emails
  await U.countEmail({ kind: "campaign", isTest: false, senderId: "an.rocha@mail.douropartners-team.pt" });
  await U.countEmail({ kind: "manual", isTest: false, senderId: "andre.rocha@douropartners.pt", by: "andre.rocha@douropartners.pt" });
  await U.countEmail({ kind: "manual", isTest: true, senderId: "andre.rocha@douropartners.pt", by: "maria@douropartners.pt" });
  await U.countEmail({ kind: "relationship", isTest: false, by: "maria@douropartners.pt", n: 3 });
  await U.countEmail({ kind: "campaign", isTest: false, failed: true });
  const e = day().email;
  ok("emails by kind, real vs test", e.real.campaign === 1 && e.real.manual === 1 && e.real.relationship === 3 && e.test.manual === 1);
  ok("campaign emails count as automatic; manual ones for whoever sent them", e.sentBy.automatic === 1 && e.sentBy.andre === 1 && e.sentBy.maria === 4);
  ok("per sending address, real vs test", e.bySender["an_rocha_mail_douropartners-team_pt"].real === 1 && e.bySender.andre_rocha_douropartners_pt.real === 1 && e.bySender.andre_rocha_douropartners_pt.test === 1);
  ok("failed sends counted apart (not as sent)", e.failed.real === 1 && e.real.campaign === 1);
  await U.countPerson("email.written", "maria@douropartners.pt");
  await U.countPerson("email.approved", "andre.rocha@douropartners.pt", 2);
  ok("written for approval / approved, per person", day().email.written.maria === 1 && day().email.approved.andre === 2);

  // Sign-ins are counted by the sign-in check
  store.set("team/rui@douropartners.pt", { key: "rui", status: "active", roleId: null, ndaSigned: true });
  await T.onTeamSignIn("rui@douropartners.pt", "uid-rui");
  ok("a team sign-in is counted for the person", day().activity?.signIns?.rui === 1);

  // Exact figures from Google
  let calls = [];
  const fakeFetch = async (url) => { calls.push(url); const m = String(url).includes("read_count") ? 1200 : String(url).includes("write_count") ? 300 : 7; return { ok: true, status: 200, json: async () => ({ timeSeries: [{ points: [{ value: { int64Value: String(m - 200) } }, { value: { int64Value: "200" } }] }] }) }; };
  const t = await U.monitoringTotals(new Date("2026-09-29T07:00:00Z"), new Date("2026-09-30T07:00:00Z"), { fetchImpl: fakeFetch, token: "t" });
  ok("exact totals: reads / writes / deletes summed over the day", t.reads === 1200 && t.writes === 300 && t.deletes === 7 && calls.length === 3 && calls.every((u) => u.includes("aggregation.crossSeriesReducer=REDUCE_SUM")));
  const r1 = await U.refreshUsage({ now: new Date(), days: 2, monitoring: { fetchImpl: fakeFetch, token: "t" } });
  const pToday = U.pacificDay();
  ok("refresh stores today (so far) and past days; a past day is marked complete", store.get(`usageFirestore/${pToday}`).reads === 1200 && store.get(`usageFirestore/${pToday}`).complete === false && store.get(`usageFirestore/${U.addDays(pToday, -1)}`).complete === true);
  calls = [];
  await U.refreshUsage({ now: new Date(), days: 2, monitoring: { fetchImpl: fakeFetch, token: "t" } });
  ok("finished days aren't asked again (only today)", calls.length === 3);
  const denied = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "Permission monitoring.timeSeries.list denied" } }) });
  store.delete?.(`usageFirestore/${pToday}`);
  const r2 = await U.refreshUsage({ now: new Date(), days: 3, monitoring: { fetchImpl: denied, token: "t" } });
  ok("no permission yet: recorded as no_permission (the page falls back to estimates) and not retried for older days", r2.exact[pToday]?.error === "no_permission" && Object.keys(r2.exact).length === 1);

  // Backfill: as far back as Google keeps figures; days it has nothing for are marked, not stored as zero
  const oldCut = U.addDays(pToday, -20);
  const partial = async (url) => { const d = decodeURIComponent(String(url)).match(/interval\.startTime=(\d{4}-\d{2}-\d{2})/)?.[1]; return { ok: true, status: 200, json: async () => (d && d < oldCut ? {} : { timeSeries: [{ points: [{ value: { int64Value: "10" } }] }] }) }; };
  calls = [];
  const bf = await U.refreshUsage({ now: new Date(), days: U.BACKFILL_DAYS, monitoring: { fetchImpl: async (u) => { calls.push(u); return partial(u); }, token: "t" } });
  const old = store.get(`usageFirestore/${U.addDays(pToday, -30)}`), recent = store.get(`usageFirestore/${U.addDays(pToday, -10)}`);
  ok("backfill covers about 6 weeks (42 days)", U.BACKFILL_DAYS === 42 && Object.keys(bf.exact).length >= 40);
  ok("a day Google has no data for is marked noData (no zeros); a day it has is stored", old.noData === true && old.reads == null && recent.reads === 10 && recent.noData === false);
  calls = [];
  await U.refreshUsage({ now: new Date(), days: U.BACKFILL_DAYS, monitoring: { fetchImpl: async (u) => { calls.push(u); return partial(u); }, token: "t" } });
  ok("backfill again: finished days (and no-data days) aren't asked again — only today", calls.length === 3);

  // Snapshot: drafts waiting, held, exports per person
  store.set("outreachMessages/d1", { status: "draft", createdAt: Timestamp.fromMillis(Date.now() - 5 * 3600000) });
  store.set("outreachMessages/d2", { status: "draft", createdAt: Timestamp.fromMillis(Date.now() - 3600000) });
  store.set("outreachMessages/s1", { status: "sent" });
  store.set("outreachEnrolments/e1", { status: "active", lastError: "Held: automatic sending is switched off (Team & access → Features)." });
  store.set("outreachEnrolments/e2", { status: "active", lastError: "Resend refused" });
  store.set("activityLog/x1", { type: "data_export", email: "maria@douropartners.pt", rows: 120, timestamp: Timestamp.now() });
  store.set("activityLog/x2", { type: "data_export", email: "maria@douropartners.pt", rows: 30, timestamp: Timestamp.now() });
  store.set("activityLog/x3", { type: "login", email: "maria@douropartners.pt", timestamp: Timestamp.now() });
  const r3 = await U.refreshUsage({ now: new Date(), days: 0, monitoring: { fetchImpl: fakeFetch, token: "t" } });
  ok("snapshot: 2 drafts waiting (oldest ~5 h), 1 held", r3.snapshot.draftsWaiting === 2 && r3.snapshot.held === 1 && Math.round((Date.now() - r3.snapshot.oldestDraftAt.toMillis()) / 3600000) === 5);
  ok("CSV exports per person with rows", day().activity.exports.maria === 2 && day().activity.exportRows.maria === 150);

  // Sender alerts (scheduler)
  await U.senderAlerts([{ id: "a@x.pt", sent: 21, cap: 25 }, { id: "b@x.pt", sent: 5, cap: 25 }]);
  ok("senders at 80%+ of their cap are listed", JSON.stringify(store.get("usageAlerts/current").senders) === JSON.stringify([{ id: "a@x.pt", sent: 21, cap: 25 }]));
  const stamp = JSON.stringify(store.get("usageAlerts/current").updatedAt);
  await U.senderAlerts([{ id: "a@x.pt", sent: 21, cap: 25 }]);
  ok("unchanged: not written again", JSON.stringify(store.get("usageAlerts/current").updatedAt) === stamp);
  await U.senderAlerts([{ id: "a@x.pt", sent: 3, cap: 25 }]);
  ok("back under: cleared", store.get("usageAlerts/current").senders.length === 0);

  // Rollup: older than 90 days → monthly totals
  store.set("usageDaily/2026-01-10", { email: { real: { campaign: 4 } }, snapshot: { held: 2 } });
  store.set("usageDaily/2026-01-11", { email: { real: { campaign: 6 } } });
  store.set("dailyReadCounters/2026-01-10", { count: 1000, byUser: { andre: 700, maria: 300 } });
  store.set("dailyWriteCounters/2026-01-10", { writes: 50, deletes: 2 });
  store.set("usageFirestore/2026-01-10", { reads: 1500, writes: 60, deletes: 2, complete: true });
  const k = await U.rollup({ now: new Date("2026-09-30T12:00:00Z") });
  const m = store.get("usageMonthly/2026-01");
  ok("old days rolled into the month and removed", k.moved === 5 && m.usage.email.real.campaign === 10 && m.reads.count === 1000 && m.reads.byUser.maria === 300 && m.firestore.reads === 1500 && !store.get("usageDaily/2026-01-10") && !store.get("dailyReadCounters/2026-01-10"));
  ok("snapshots aren't summed into months", !m.usage.snapshot && m.days.usage === 2);
  ok("recent days stay", !!store.get(`usageDaily/${U.lisbonDay()}`));

  // Callable: partners only
  const call = async (req) => { try { return await fns.usageAdmin({ ...req, data: { action: "refresh" } }); } catch (err) { return { err }; } };
  ok("an intern can't open Usage", (await call({ auth: { token: { email: "maria@douropartners.pt", perms: ["search.view"] } } })).err?.details?.reason === "no_permission");

  console.log(fail ? `\n${fail} FAILED` : "\nall usage tests passed");
  process.exit(fail ? 1 : 0);
})();
