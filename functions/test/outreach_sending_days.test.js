// 9 Oct 2026: a wait in "sending days" counts the campaign's own sending days
// (its window's weekdays, else Settings, else Mon–Fri), skipping national holidays.
const S = require("../outreach/schedule_util.js");
let fail = 0;
const ok = (l, c) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"}  ${l}`); };
const at = (s) => new Date(s + "T10:00:00+01:00"); // Lisbon (WEST until 25 Oct)
const day = (d) => S.lisbonParts(d).y + "-" + String(S.lisbonParts(d).m).padStart(2, "0") + "-" + String(S.lisbonParts(d).d).padStart(2, "0");
const w4 = { days: 4, unit: "working" };
const thu = at("2026-10-15"); // Thursday
ok("no window given = Mon–Fri as before: Thu + 4 → Wed 21 Oct", day(S.addWait(thu, w4)) === "2026-10-21");
ok("Mon–Fri window: same result", day(S.addWait(thu, w4, [1, 2, 3, 4, 5])) === "2026-10-21");
ok("Mon–Sat: Thu + 4 → Fri, Sat, Mon, Tue 20 Oct", day(S.addWait(thu, w4, [1, 2, 3, 4, 5, 6])) === "2026-10-20");
ok("Thu–Sat: Thu + 4 → Fri, Sat, Thu, Fri 23 Oct (no pile-up for Thursday)", day(S.addWait(thu, w4, [4, 5, 6])) === "2026-10-23");
ok("holidays never count: Fri 30 Oct + 2 → Mon 2 Nov, Tue 3 Nov (1 Nov is a Sunday)", day(S.addWait(at("2026-10-30"), { days: 2, unit: "working" }, [1, 2, 3, 4, 5])) === "2026-11-03");
ok("a holiday on a sending day is skipped: Mon 30 Nov + 1 → Wed 2 Dec (1 Dec)", day(S.addWait(at("2026-11-30"), { days: 1, unit: "working" }, [1, 2, 3, 4, 5])) === "2026-12-02");
ok("calendar days unchanged: Thu + 7 → Thu 22 Oct", day(S.addWait(thu, { days: 7, unit: "calendar" }, [4, 5, 6])) === "2026-10-22");
ok("wait 0 = now", S.addWait(thu, { days: 0, unit: "working" }, [4]).getTime() === thu.getTime());
ok("sendingDaysOf: own window, else Settings, else Mon–Fri", JSON.stringify(S.sendingDaysOf({ sendWindow: { days: [4, 5, 6] } }, { sendWindow: { days: [1, 2] } })) === "[4,5,6]"
  && JSON.stringify(S.sendingDaysOf({ sendWindow: null }, { sendWindow: { days: [1, 2, 3, 4, 5, 6] } })) === "[1,2,3,4,5,6]" && JSON.stringify(S.sendingDaysOf({}, {})) === "[1,2,3,4,5]");
ok("national holidays 2026 (13, Easter-based included)", [...S.nationalHolidays(2026)].sort().join(",") === "01-01,04-03,04-05,04-25,05-01,06-04,06-10,08-15,10-05,11-01,12-01,12-08,12-25");
if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log("\nALL PASSED");
