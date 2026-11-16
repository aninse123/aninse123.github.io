// Claude connector — the nightly company index (16 Nov): most nights re-read only
// the companies changed since the last build; a full build on Sundays, when the
// stored index is missing, old or from an older format, when the tier rules
// changed, and when the company count doesn't match (deleted companies).
const zlib = require("zlib");
const X = require("./claude_fixtures");
const IX = require("../claude/index_companies");
const { store, storageFiles, Timestamp } = X.F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const DAY = 86400000;
const weekday = (ms) => new Date(ms).toLocaleDateString("en-GB", { timeZone: "Europe/Lisbon", weekday: "short" });
const stored = () => JSON.parse(zlib.gunzipSync(storageFiles.get(IX.PATH).buf).toString("utf8"));
const rowOf = (id) => stored().rows.find((r) => r.id === id);

(async () => {
  X.seed();
  // A Monday at least a day from now, 06:00 UTC (the job's hour in Lisbon in winter).
  let mon = Date.now() + DAY;
  while (weekday(mon) !== "Mon") mon += DAY;
  mon = Math.floor(mon / DAY) * DAY + 6 * 3600000;
  const at = (days, hours = 0) => mon + days * DAY + hours * 3600000;
  const total = [...store.keys()].filter((k) => k.startsWith("searchCompanies/")).length;

  // 1. First run: nothing stored → full build.
  const b1 = await IX.build({ now: at(0) });
  ok("first run: full build (no stored index)", b1.mode === "full" && b1.reason === "no stored index" && b1.count === total);
  const c1Before = JSON.stringify(rowOf("c1"));
  ok("the stored index records its format, full build time and tier rules", stored().format === IX.FORMAT && stored().fullAt === at(0) && typeof stored().rulesKey === "string");

  // 2. Next night: only the changed companies are read.
  store.get("searchCompanies/c3").stage = "screened";
  store.get("searchCompanies/c3").updatedAt = Timestamp.fromMillis(at(0, 3));
  store.set("searchCompanies/new1", { name: "NOVA EMPRESA LDA", nif: "510000000", sector: "Metals", distrito: "Braga", stage: "universe", createdAt: Timestamp.fromMillis(at(0, 4)) });
  const b2 = await IX.build({ now: at(1) });
  ok("next night: changes only", b2.mode === "changes" && b2.changed === 2 && b2.count === total + 1);
  ok("changes only reads far fewer documents than a full build", b2.reads < 20 && b1.reads > total);
  ok("a changed company has its new stage", rowOf("c3").stage === "screened");
  ok("a new company is in the index", !!rowOf("new1"));
  ok("an unchanged company keeps its row", JSON.stringify(rowOf("c1")) === c1Before);
  ok("the full build time is kept from the last full build", stored().fullAt === at(0) && stored().builtAt === at(1));

  // 2b. Joining or leaving a campaign stamps campaignChangedAt only (Campaigns hub, 16 Nov).
  Object.assign(store.get("searchCompanies/c3"), { activeCampaignId: "k9", activeCampaignName: "Plastics test", campaignChangedAt: Timestamp.fromMillis(at(1, 3)) });
  const b2b = await IX.build({ now: at(1, 6) });
  ok("a company that joined a campaign (campaignChangedAt only) is re-read", b2b.mode === "changes" && b2b.changed === 1 && rowOf("c3").campaignName === "Plastics test");

  // 3. A night with no changes.
  const b3 = await IX.build({ now: at(2) });
  ok("no changes: changes only, nothing re-read", b3.mode === "changes" && b3.changed === 0 && b3.count === total + 1);

  // 4. A deleted company: the count doesn't match → full build.
  store.delete("searchCompanies/new1");
  const b4 = await IX.build({ now: at(3) });
  ok("a deleted company: full build (count doesn't match)", b4.mode === "full" && /count/.test(b4.reason) && b4.count === total && !rowOf("new1"));

  // 5. Back to changes only after the full build.
  store.set("searchCompanies/new2", { name: "OUTRA LDA", stage: "universe", createdAt: Timestamp.fromMillis(at(3, 2)) });
  const b5 = await IX.build({ now: at(4) });
  ok("back to changes only: a company added the night before is in the index", b5.mode === "changes" && !!rowOf("new2"));

  // 6. Tier rules changed → full build.
  store.set("searchConfig/targetTiers", { rules: [{ tier: "A", field: "sector", value: "Metals" }] });
  const b6 = await IX.build({ now: at(4, 1) });
  ok("tier rules changed: full build", b6.mode === "full" && b6.reason === "tier rules changed");
  ok("after the rules change, tiers follow the new rules", rowOf("c1").tier === "A" && rowOf("c3").tier === null);

  // 7. Sunday → full build.
  const b7 = await IX.build({ now: at(6) });
  ok("Sunday: full build", weekday(at(6)) === "Sun" && b7.mode === "full" && b7.reason === "weekly (Sunday)");

  // 8. Last full build a week old (Sunday missed) → full build.
  const s = stored(); s.fullAt = at(6) - 8 * DAY;
  storageFiles.set(IX.PATH, { buf: zlib.gzipSync(Buffer.from(JSON.stringify(s))) });
  const b8 = await IX.build({ now: at(7) });
  ok("last full build a week old: full build", b8.mode === "full" && b8.reason === "last full build a week ago");

  // 9. An index from before 16 Nov (no format) → full build.
  storageFiles.set(IX.PATH, { buf: zlib.gzipSync(Buffer.from(JSON.stringify({ builtAt: at(7), rows: s.rows }))) });
  const b9 = await IX.build({ now: at(8) });
  ok("an older index format: full build", b9.mode === "full" && b9.reason === "older index format");

  // 10. Asked for a full build.
  const b10 = await IX.build({ now: at(8, 1), full: true });
  ok("full: true forces a full build", b10.mode === "full" && b10.reason === "asked for");

  // 11. Answers still see a change made after the build (the call-time overlay).
  store.get("searchCompanies/c3").stage = "outreach";
  store.get("searchCompanies/c3").updatedAt = Timestamp.fromMillis(at(9));
  IX._reset();
  const r = await X.tool(X.ANDRE, "find_companies", { text: "plasticos" });
  ok("a change after the build still shows in answers", r.result.rows?.[0]?.stage === "outreach");

  console.log(fail ? `\n${fail} FAILED` : "\nall Claude index tests passed");
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
