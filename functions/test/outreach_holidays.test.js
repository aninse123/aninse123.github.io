// National holidays as a choice (13 Oct 2026): Settings → General
// "Skip national holidays" (default on) and a per-campaign override. Pure
// functions of schedule_util; synthetic dates only.
const S = require("../outreach/schedule_util.js");
let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const WIN = { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00" };
const day = (iso) => new Date(iso);

const list = S.holidayList(2026);
ok("2026: 13 national holidays with names (Good Friday 3 Apr, Corpus Christi 4 Jun)", list.length === 13 && list.every((h) => h.name) && list.some((h) => h.date === "2026-04-03" && h.name === "Sexta-feira Santa") && list.some((h) => h.date === "2026-06-04" && h.name === "Corpo de Deus"));
ok("8 Dec 2026 (Tue, Imaculada Conceição) is a holiday", S.isHoliday(S.lisbonParts(day("2026-12-08T10:00:00Z"))));

// Window: closed on a holiday when skipping, open when not.
ok("window closed on 8 Dec when skipping (default)", S.isWindowOpen(day("2026-12-08T10:00:00Z"), WIN) === false && S.isWindowOpen(day("2026-12-08T10:00:00Z"), WIN, true) === false);
ok("window open on 8 Dec when the campaign sends on holidays", S.isWindowOpen(day("2026-12-08T10:00:00Z"), WIN, false) === true);
ok("a normal Wednesday is open either way", S.isWindowOpen(day("2026-12-09T10:00:00Z"), WIN, true) && S.isWindowOpen(day("2026-12-09T10:00:00Z"), WIN, false));

// Waits: Mon 7 Dec + 2 sending days → Thu 10 Dec skipping the 8th, Wed 9 Dec not skipping.
const from = day("2026-12-07T10:00:00Z");
ok("wait 2 sending days skips 8 Dec → Thu 10 Dec", S.addWait(from, { days: 2 }, [1, 2, 3, 4, 5]).toISOString().slice(0, 10) === "2026-12-10");
ok("…and counts it when holidays aren't skipped → Wed 9 Dec", S.addWait(from, { days: 2 }, [1, 2, 3, 4, 5], false).toISOString().slice(0, 10) === "2026-12-09");
ok("without a day list: Mon–Fri, same rule", S.addWait(from, { days: 2 }).toISOString().slice(0, 10) === "2026-12-10" && S.addWait(from, { days: 2 }, null, false).toISOString().slice(0, 10) === "2026-12-09");

// Precedence: campaign true / false wins, else Settings, else skip.
ok("campaign choice wins over Settings", S.skipHolidaysOf({ skipHolidays: false }, { skipNationalHolidays: true }) === false && S.skipHolidaysOf({ skipHolidays: true }, { skipNationalHolidays: false }) === true);
ok("no campaign choice → Settings; nothing set → skip", S.skipHolidaysOf({ skipHolidays: null }, { skipNationalHolidays: false }) === false && S.skipHolidaysOf({}, {}) === true);

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log("\nALL PASSED");
