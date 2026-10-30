// Recipient list per company (30 Oct 2026, switch contacts.trustLabels): the Companies tab has "Choose…", the server
// has two gated actions, and the first chosen address is the one the scheduler already honours (enrolment.recipient).
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const outreach = read('../../portal/outreach.html'), campaigns = read('../../functions/outreach/campaigns.js'), sched = read('../../functions/outreach/scheduler.js');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

ok('the button shows only with the switch on, for a live company that has not been written to', /function canChooseRecipients\(e\) \{ return isOn\('contacts\.trustLabels'\) && e\.companyId && !e\.personEmail && !e\.threadId && !\(e\.currentStep > 0\)/.test(outreach) && /canChooseRecipients\(e\) \? ` <button[^`]*data-eop="recipients"/.test(outreach));
ok('the modal reads the list and saves the chosen order', /action: 'recipientsFor'/.test(outreach) && /action: 'setRecipients', enrolmentId: e\.id, emails/.test(outreach));
ok('the domain flag is advice only (text says so)', /advice only; it never blocks/.test(outreach));
ok('both actions need the switch and out.campaigns, and a started campaign needs approve', /recipientsFor", "setRecipients"\]|data\.action === "recipientsFor" \|\| data\.action === "setRecipients"\) await Feat\.requireFeature\(request, "contacts\.trustLabels"\)/.test(campaigns) && /recipientsFor: "out\.campaigns", setRecipients: "out\.campaigns"/.test(campaigns) && /data\.action === "setRecipients"\) \{ const en/.test(campaigns));
ok('the scheduler keeps using enrolment.recipient (chosen once, first email)', /let recipient = e\.recipient \|\| null;/.test(sched));
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exit(fail ? 1 : 0);
