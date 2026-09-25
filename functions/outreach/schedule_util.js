// Outreach Phase 2 — calendar and choice rules for the campaign scheduler
// (Phase 2 spec §5.2, §5.5, §6). Pure functions; no Firestore.

const TZ = "Europe/Lisbon";
const DAY_MS = 86400000;

// Lisbon wall-clock parts of an instant.
function lisbonParts(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return {
    y: Number(p.year), m: Number(p.month), d: Number(p.day),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday),
    hhmm: `${p.hour}:${p.minute}`,
    dayKey: `${p.year}-${p.month}-${p.day}`,
  };
}

// Easter Sunday (Gregorian, anonymous algorithm) as "MM-DD".
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(y, month - 1, day);
}
const mmdd = (ms) => new Date(ms).toISOString().slice(5, 10);

// Portuguese national public holidays (C7: national only — no municipal
// holidays, no Carnival, which isn't mandatory).
const holidayCache = new Map();
function nationalHolidays(y) {
  if (holidayCache.has(y)) return holidayCache.get(y);
  const e = easter(y);
  const set = new Set([
    "01-01", "04-25", "05-01", "06-10", "08-15", "10-05", "11-01", "12-01", "12-08", "12-25",
    mmdd(e - 2 * DAY_MS),  // Sexta-feira Santa
    mmdd(e),               // Páscoa
    mmdd(e + 60 * DAY_MS), // Corpo de Deus
  ]);
  holidayCache.set(y, set);
  return set;
}

function isHoliday(parts) {
  return nationalHolidays(parts.y).has(`${String(parts.m).padStart(2, "0")}-${String(parts.d).padStart(2, "0")}`);
}

function isWorkingDay(parts) {
  return parts.weekday >= 1 && parts.weekday <= 5 && !isHoliday(parts);
}

// Emails go out on the window's days, between its times, never on a national
// holiday. `window` = { days: [0-6], from: "HH:MM", to: "HH:MM" } in Lisbon time.
function isWindowOpen(date, window) {
  const p = lisbonParts(date);
  if (!window?.days?.includes(p.weekday) || isHoliday(p)) return false;
  return p.hhmm >= window.from && p.hhmm < window.to;
}

// When a step becomes due: `wait.days` working days (Mon–Fri, no national
// holidays) or calendar days after `from`, same time of day. 0 = now.
function addWait(from, wait) {
  const days = Math.max(0, Number(wait?.days) || 0);
  if (!days) return new Date(from.getTime());
  if (wait.unit === "calendar") return new Date(from.getTime() + days * DAY_MS);
  let t = from.getTime(), counted = 0;
  while (counted < days) {
    t += DAY_MS;
    if (isWorkingDay(lisbonParts(new Date(t)))) counted++;
  }
  return new Date(t);
}

// A/B (§5.5): the step's variants with their weights, or — when the step
// lists none — every variant of the template, equal weights. `rand` in [0,1).
function pickVariant(stepVariants, templateVariants, rand = Math.random()) {
  const available = new Set((templateVariants || []).map((v) => v.key));
  let pool = (stepVariants || []).filter((v) => v.weight > 0 && available.has(v.key));
  if (!pool.length) pool = (templateVariants || []).map((v) => ({ key: v.key, weight: 1 }));
  if (!pool.length) return null;
  const total = pool.reduce((a, v) => a + v.weight, 0);
  let x = rand * total;
  for (const v of pool) { x -= v.weight; if (x < 0) return v.key; }
  return pool[pool.length - 1].key;
}

// Sender for a company's first email (§6): the campaign's fixed addresses, or
// the company owner's active addresses (all active ones when the company has
// no owner). Among those, the least used today that is under its cap and not
// already used in this run — which spaces each address's emails a run apart.
function pickSender({ policy, owner, senders, sentToday, usedThisRun, defaultCap }) {
  const active = senders.filter((s) => s.status === "active");
  let pool = policy?.mode === "fixed"
    ? active.filter((s) => (policy.senderIds || []).includes(s.id))
    : active.filter((s) => !owner || s.owner === owner);
  pool = pool.filter((s) => !usedThisRun.has(s.id) && (sentToday[s.id] || 0) < (s.dailyCap || defaultCap));
  pool.sort((a, b) => (sentToday[a.id] || 0) - (sentToday[b.id] || 0) || a.id.localeCompare(b.id));
  return pool[0] || null;
}

module.exports = { TZ, lisbonParts, easter, nationalHolidays, isHoliday, isWorkingDay, isWindowOpen, addWait, pickVariant, pickSender };
