// 21 Oct 2026 (André): adding, editing or removing a person on a company is not
// a "touch" — it doesn't move the company's last touch (lastTouchAt), which the
// list, filters and the Outreach "last outreach activity" warning read.
// Runs the page's own rule on synthetic activities.
import { readFileSync } from 'node:fs';
const page = readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const i = page.indexOf('const AUTO_TYPES = ['), j = page.indexOf('];', i);
const AUTO = new Function(`return ${page.slice(i + 'const AUTO_TYPES = '.length, j + 1)}`)();
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
ok('person linked / updated / unlinked are not touches', ['person_linked', 'person_updated', 'person_unlinked'].every((t) => AUTO.includes(t)));
ok('the earlier automatic types stay automatic (contact details, notes, merges, company edits)', ['person_contact_edited', 'person_note', 'person_merged', 'company_edited', 'email_test'].every((t) => AUTO.includes(t)));
ok('real activities still count (calls, emails, meetings, notes)', !['call_connected', 'call_attempted', 'email', 'meeting_done', 'note', 'letter', 'linkedin'].some((t) => AUTO.includes(t)));
const acts = [{ type: 'call_connected', date: '2026-10-10' }, { type: 'person_linked', date: '2026-10-21' }, { type: 'person_updated', date: '2026-10-21' }];
const last = acts.filter((a) => !AUTO.includes(a.type)).sort((a, b) => b.date.localeCompare(a.date))[0].date;
ok('a call on 10 Oct then a person added on 21 Oct → last touch stays 10 Oct', last === '2026-10-10');
if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
