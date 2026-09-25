// Verifies the 2026-09-15 fix: every read/write/delete counter (local
// per-browser estimate AND the shared cross-browser Firestore docs
// dailyReadCounters/dailyWriteCounters) keys off todayDateStr() in
// firebase-config.js. It used to build the key from new Date()'s LOCAL
// calendar components -- but Firestore's free-tier quota actually resets
// once a day at Pacific-time midnight, not at each browser's own local
// midnight (confirmed against Firebase's own docs: "Quotas are applied
// daily and reset around midnight Pacific time"). For anyone outside
// Pacific time (Lisbon, ~7-9h ahead depending on DST), the displayed
// counter rolled over hours before or after the real quota did. Lifted
// verbatim from the real source (same lift-and-test pattern used
// throughout this session) rather than re-implemented, so this actually
// tests what ships.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const src = readFileSync(new URL('../../portal/firebase-config.js', import.meta.url), 'utf8');

function liftFn(name){
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(name + ' not found');
  let p = src.indexOf('(', start), pd = 0;
  do { if (src[p] === '(') pd++; else if (src[p] === ')') pd--; p++; } while (pd > 0);
  const braceStart = src.indexOf('{', p);
  let depth = 0, j = braceStart;
  do { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; } while (depth > 0);
  return src.slice(start, j);
}
function liftConst(name){
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*`));
  if (!m) throw new Error(name + ' not found');
  let depth = 0, j = m.index;
  do {
    if ('{[('.includes(src[j])) depth++;
    else if ('}])'.includes(src[j])) depth--;
    else if (src[j] === ';' && depth === 0) break;
    j++;
  } while (j < src.length);
  return src.slice(m.index, j + 1);
}

const lifted = [
  liftConst('PACIFIC_DATE_FORMATTER'),
  liftFn('todayDateStr'),
  'this.__x = { todayDateStr, PACIFIC_DATE_FORMATTER };',
].join('\n\n');
const ctx = { console, Date, Intl };
vm.createContext(ctx);
new vm.Script(lifted, { filename: 'lifted.js' }).runInContext(ctx);
const { todayDateStr } = ctx.__x;

let fail = 0;
const ok = (l, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${l}`); };

// Can't override the real Date inside the lifted vm context per-call without
// re-running the script, so drive todayDateStr() by temporarily replacing
// globalThis.Date's "now" via a subclass swapped into the vm context, one
// scenario at a time.
function todayDateStrAt(isoUtc){
  const FixedDate = class extends Date {
    constructor(...args){ super(...(args.length ? args : [isoUtc])); }
    static now(){ return new Date(isoUtc).getTime(); }
  };
  const scenarioCtx = { console, Date: FixedDate, Intl };
  vm.createContext(scenarioCtx);
  new vm.Script(lifted, { filename: 'lifted.js' }).runInContext(scenarioCtx);
  return scenarioCtx.__x.todayDateStr();
}

console.log('=== format shape: YYYY-MM-DD, matching the old function\'s output format ===');
ok('real "now" call returns a well-formed YYYY-MM-DD string', /^\d{4}-\d{2}-\d{2}$/.test(todayDateStr()));

console.log('\n=== rolls over at Pacific midnight, not UTC midnight and not Lisbon midnight ===');
{
  // 2026-09-15T00:30:00Z = 01:30 Lisbon (WEST, UTC+1) on Sep 15, but still
  // 17:30 on Sep 14 in Los Angeles (PDT, UTC-7) -- the OLD local-date logic
  // would have already rolled to "09-15" here (past Lisbon midnight); the
  // fix must still read "09-14" (Pacific hasn't hit its own midnight yet).
  ok('01:30 Lisbon / 17:30 prev-day Pacific -> still counts as the PREVIOUS Pacific day',
    todayDateStrAt('2026-09-15T00:30:00.000Z') === '2026-09-14');
  // Pacific midnight during PDT (UTC-7, Sep applies) lands at 07:00 UTC.
  ok('06:59 UTC (one minute before Pacific midnight, PDT) -> previous day',
    todayDateStrAt('2026-09-15T06:59:00.000Z') === '2026-09-14');
  ok('07:00 UTC (exactly Pacific midnight, PDT) -> rolled over to the new day',
    todayDateStrAt('2026-09-15T07:00:00.000Z') === '2026-09-15');
}

console.log('\n=== DST-aware: the Pacific UTC offset itself shifts across a DST boundary, handled automatically ===');
{
  // 2026-11-01 is after the US falls back to PST (UTC-8) but Lisbon has not
  // yet fallen back to WET (still WEST, UTC+1, until late Oct/depends on
  // year) -- exercised here as a plain sanity check that the IANA-tz-based
  // formatter (not a hardcoded UTC-7/-8 offset) tracks the actual Pacific
  // local midnight rather than a fixed offset that would drift wrong for
  // exactly this kind of case.
  ok('winter (PST, UTC-8): 07:59 UTC still previous Pacific day',
    todayDateStrAt('2026-11-02T07:59:00.000Z') === '2026-11-01');
  ok('winter (PST, UTC-8): 08:00 UTC rolled to the new Pacific day',
    todayDateStrAt('2026-11-02T08:00:00.000Z') === '2026-11-02');
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
