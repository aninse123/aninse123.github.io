// Manual link between two companies (10 Nov 2026, switch search.manualLinks): the link typed on both companies counts as
// related (functions/outreach/related.js) and shows in the Monday report. Synthetic data only.
const F = require("./fake_firebase.js");
const R = require("../outreach/related.js");
const Report = require("../outreach/report.js");
const { store, Timestamp } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

(async () => {
  store.clear();
  // nothing in Orbis relates them: no shared person, no holder, no group
  const co = (id, data) => store.set(`searchCompanies/${id}`, { name: id.toUpperCase() + ", LDA", companyEmail: `geral@${id}.pt`, ownGraphAt: Timestamp.now(), ownGroupSize: 1, ownSubs: 0, ownParents: 0, ownOwnerOther: 0, ...data });
  co("x", { manualLinks: [{ companyId: "y", note: "mesma família, via Somobilis", by: "andre@x.pt", at: "2026-11-10T10:00:00Z" }] });
  co("y", { manualLinks: [{ companyId: "x", note: "mesma família, via Somobilis", by: "andre@x.pt", at: "2026-11-10T10:00:00Z" }], doNotContact: { on: false } });
  co("z", {});
  co("w", { manualLinks: [{ companyId: "z" }] }); // a link with no note (older or typed by another tool)
  co("long", { manualLinks: [{ companyId: "z", note: "n".repeat(500) }] });

  const m = await R.relatedFor(["x", "y", "z", "w", "long"]);
  ok("X is related to Y by the manual link, with nothing in Orbis", m.get("x").related.map((r) => r.companyId).join() === "y");
  ok("…and the reason is the note, after «manual link»", m.get("x").related[0].why[0] === "manual link: mesma família, via Somobilis");
  ok("…the link is on both companies, so Y sees X too", m.get("y").related.map((r) => r.companyId).join() === "x");
  ok("a company with no link and nothing in Orbis has nothing related", m.get("z").related.length === 0 && m.get("z").lead === null);
  ok("a link with no note says only «manual link»", m.get("w").related[0].why[0] === "manual link");
  ok("a very long note is cut at 200 characters", m.get("long").related[0].why[0] === "manual link: " + "n".repeat(200));
  ok("the other company's data comes with it (stage, campaign, email) like any related company", m.get("x").related[0].email === "geral@y.pt" && "stage" in m.get("x").related[0] && "campaignName" in m.get("x").related[0]);

  // the lookup that sorts and flags still works with a manual link
  const flags = R.flagsFor(m.get("x"), { campaignId: "k1", windowDays: 30, now: Date.parse("2026-11-10T12:00:00Z"), batch: new Set(["x", "y"]), selfId: "x" });
  ok("flags: Y in the same batch is flagged like any related company", flags.some((f) => f.kind === "same_batch"));

  // the Monday report text
  const week = { sent: 0, replies: 0, unsubscribes: 0, meetings: 0, meetingsHeld: 0, tasksDone: 0, started: 0, held: 0, byCampaign: {}, bySender: {}, byCategory: {}, tasksByChannel: {} };
  const owners = { multiCampaign: [], sameOwner: [], emailLinks: [], manualLinks: [["X, LDA", "Y, LDA", "mesma família, via Somobilis"]], openFlags: [], heldNow: [] };
  const text = Report.reportText({ week, owners }, { weekKey: "2026-11-09", toKey: "2026-11-15" });
  ok("the report lists the manual link with its note", /Ligadas à mão \(ligação manual\): 1/.test(text) && text.includes("  · X, LDA ↔ Y, LDA — mesma família, via Somobilis"));
  const none = Report.reportText({ week, owners: { ...owners, manualLinks: [] } }, { weekKey: "2026-11-09", toKey: "2026-11-15" });
  ok("no manual link, no line", !/Ligadas à mão/.test(none));
  const old = Report.reportText({ week, owners: { multiCampaign: [], sameOwner: [], emailLinks: [], openFlags: [], heldNow: [] } }, { weekKey: "2026-11-09", toKey: "2026-11-15" });
  ok("a report saved before this change (no manualLinks) still prints", !/Ligadas à mão/.test(old));

  console.log(fail ? `${fail} manual-link test(s) FAILED` : "all manual-link tests passed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
