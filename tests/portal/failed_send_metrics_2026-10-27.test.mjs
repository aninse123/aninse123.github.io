// A conversation whose email Resend refused (27 Oct 2026) isn't a first email in Metrics.
import { readFileSync } from 'node:fs';
const out = readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
ok('Metrics leaves out conversations whose email failed (first emails, reply rate, by owner, breakdown)', out.includes("const threads = metricsData.threads.filter(t => t.firstTouchAt && t.status !== 'failed' && tsMs(t.firstTouchAt) >= since"));
if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
