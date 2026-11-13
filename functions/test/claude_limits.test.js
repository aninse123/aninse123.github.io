// Claude connector — limits: 100 rows a page with a cursor, 300 calls an hour and
// 3,000 a day, per-role and per-person overrides, the "resets at" answer, size cap.
const X = require("./claude_fixtures");
const T = require("../claude/tools");
const G = require("../claude/gate");
const U = require("../claude/util");
const C = require("../claude/tools/common");
const { store } = X.F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const usageDoc = (key, now = new Date()) => `claudeUsage/${U.lisbonDay(now)}_${key}`;

(async () => {
  X.seed();
  await X.buildIndex();

  // ── Rows and paging ──
  const p1 = await X.tool(X.ANDRE, "find_companies", { filters: { sector: ["Metals"] }, sort: { field: "revenue", dir: "desc" }, fields: ["name", "revenue"], pageSize: 500 });
  ok("at most 100 rows per answer even when more are asked", p1.result.rows.length === 100 && p1.result.total === 232);
  ok("a cursor to the next page", !!p1.result.nextCursor);
  const p2 = await X.tool(X.ANDRE, "find_companies", { filters: { sector: ["Metals"] }, sort: { field: "revenue", dir: "desc" }, fields: ["name", "revenue"], cursor: p1.result.nextCursor });
  const p3 = await X.tool(X.ANDRE, "find_companies", { filters: { sector: ["Metals"] }, sort: { field: "revenue", dir: "desc" }, fields: ["name", "revenue"], cursor: p2.result.nextCursor });
  const ids = [...p1.result.rows, ...p2.result.rows, ...p3.result.rows].map((r) => r.id);
  ok("three pages give all 232 companies once each (a 300-company list works)", ids.length === 232 && new Set(ids).size === 232 && p3.result.nextCursor === null);
  ok("pages keep the sort across the cursor", p1.result.rows[99].revenue >= p2.result.rows[0].revenue);
  ok("chosen fields only (name and revenue)", Object.keys(p2.result.rows[0]).sort().join() === "id,name,revenue");
  store.set("claudeSettings/main", { roles: { intern: { rows: 25 } } }); U._resetSettings();
  const pi = await X.tool(X.MARIA, "find_companies", { filters: { sector: ["Metals"] } });
  ok("rows per answer is a setting (25 for interns here)", pi.result.rows.length === 25);
  store.delete("claudeSettings/main"); U._resetSettings();

  // ── Size cap ──
  const big = { rows: Array.from({ length: 100 }, (_, i) => ({ id: i, text: "x".repeat(2000) })) };
  const fitted = C.fit(big);
  ok("an answer bigger than ~60,000 characters is cut to fit, and says so", JSON.stringify(fitted).length <= C.MAX_CHARS && fitted.rows.length < 100 && /fit in one answer/.test(fitted.cutShort));

  // ── Calls an hour / a day ──
  const now = new Date();
  const hour = U.lisbonHour(now);
  store.set(usageDoc("antonio", now), { calls: 299, hours: { [hour]: 299 } });
  const c300 = await X.tool(X.ANT, "whoami");
  ok("call 300 in the hour still works", !c300.isError);
  const c301 = await X.tool(X.ANT, "find_companies", { text: "metal" });
  ok("call 301 in the hour is refused", c301.isError && /^Hourly limit reached \(300 calls\)\. It resets at \d\d:00 Lisbon time\.$/.test(c301.result.error));
  ok("the reset time is the next Lisbon hour", c301.result.error.includes(U.nextHourLabel(now)));
  const audits = [...store.values()].filter((v) => v && v.outcome === "limit");
  ok("the Log marks the limit", audits.length >= 1 && audits.some((a) => a.reason === "hour"));
  ok("the person's day shows a limit hit", store.get(usageDoc("antonio", now)).limitHits >= 1);
  store.set("claudeSettings/main", { people: { antonio: { hour: 1000 } } }); U._resetSettings();
  ok("raising the person's limit works on the next call", !(await X.tool(X.ANT, "find_companies", { text: "metal" })).isError);
  store.set(usageDoc("antonio", now), { calls: 3000, hours: { [hour]: 5 } });
  const cDay = await X.tool(X.ANT, "whoami");
  ok("the 3,001st call of the day is refused, resets at midnight", cDay.isError && /^Daily limit reached \(3000 calls\)\. It resets at 00:00 Lisbon time\.$/.test(cDay.result.error));
  store.delete("claudeSettings/main"); U._resetSettings();

  // Defaults, role and person override order.
  const S = U.normalizeSettings({ defaults: { hour: 300, day: 3000, rows: 100 }, roles: { intern: { hour: 50 } }, people: { maria: { hour: 70 } } });
  ok("defaults: 300 an hour, 3,000 a day, 100 rows", JSON.stringify(U.limitsFor(U.normalizeSettings(null), { key: "x", roleId: "analyst" })) === '{"hour":300,"day":3000,"rows":100}');
  ok("a role's limit applies to its people", U.limitsFor(S, { key: "zoe", roleId: "intern" }).hour === 50);
  ok("a person's limit beats their role's", U.limitsFor(S, { key: "maria", roleId: "intern" }).hour === 70);
  ok("silly values fall back (rows above 100, negative hours)", U.normalizeSettings({ defaults: { rows: 5000, hour: -3 } }).defaults.rows === 100 && U.normalizeSettings({ defaults: { hour: -3 } }).defaults.hour === 300);
  ok("sign-in days kept between 1 and 365", U.normalizeSettings({ signInDays: 900 }).signInDays === 90 && U.normalizeSettings({ signInDays: 30 }).signInDays === 30);

  // Counting: tool calls count; refusals for missing permission don't use up the limit.
  X.seed(); await X.buildIndex();
  await X.tool(X.MARIA, "find_companies", { text: "metal" });
  await X.tool(X.MARIA, "budget_summary", {});
  const u = store.get(usageDoc("maria"));
  ok("a successful call counts (hour and day)", u.calls === 1 && u.hours[U.lisbonHour()] === 1 && u.byTool.find_companies === 1);
  ok("a refused call is counted as refused, not against the limit", u.denied === 1);
  ok("reads are counted for the person", u.reads > 0);
  const drc = [...store.entries()].find(([k]) => k.startsWith("dailyReadCounters/") && k !== "dailyReadCounters/2026-11-12");
  ok("connector reads count into the Usage tab (site claude, per person)", drc && drc[1].bySite.claude > 0 && drc[1].byUser.maria > 0);

  console.log(fail ? `\n${fail} FAILED` : "\nall Claude limits tests passed");
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
