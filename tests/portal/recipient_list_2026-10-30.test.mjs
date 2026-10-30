// Recipient list per company (30 Oct 2026, switch contacts.trustLabels): the Companies tab has "Choose…", the server
// has two gated actions, and the first chosen address is the one the scheduler already honours (enrolment.recipient).
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const outreach = read('../../portal/outreach.html'), campaigns = read('../../functions/outreach/campaigns.js'), sched = read('../../functions/outreach/scheduler.js');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

ok('the button shows only with the switch on, for a live first-track company (after email 1 only with outreach.multiRecipient)', /function canChooseRecipients\(e\) \{ return isOn\('contacts\.trustLabels'\) && e\.companyId && !e\.personEmail && !e\.trackOf && LIVE_ENROL\.includes\(e\.status\) && \(\(!e\.threadId && !\(e\.currentStep > 0\)\) \|\| isOn\('outreach\.multiRecipient'\)\)/.test(outreach) && /canChooseRecipients\(e\) \? ` <button[^`]*data-eop="recipients"/.test(outreach));
ok('the modal reads the list and saves the chosen order', /action: 'recipientsFor'/.test(outreach) && /action: 'setRecipients', enrolmentId: e\.id, emails/.test(outreach));
ok('the domain flag is advice only (text says so)', /advice only; it never blocks/.test(outreach));
ok('the choice actions need the switch and out.campaigns, and a started campaign needs approve', campaigns.includes('["recipientsFor", "setRecipients", "previewRecipient"].includes(data.action)) await Feat.requireFeature(request, "contacts.trustLabels")') && /recipientsFor: "out\.campaigns", setRecipients: "out\.campaigns"/.test(campaigns) && campaigns.includes('["setRecipients", "restartCompany"].includes(data.action)'));
ok('the scheduler keeps using enrolment.recipient (chosen once, first email)', /let recipient = e\.recipient \|\| null;/.test(sched));
const tracks = read('../../functions/outreach/tracks.js'), webhook = read('../../functions/outreach/webhook.js'), inbound = read('../../functions/outreach/inbound.js');
ok('the modal offers "write to every ticked address", a preview per address, and says how many emails go', /id="rcAll"/.test(outreach) && /data-rcprev/.test(outreach) && /emails will be sent, one to each address/.test(outreach) && /action: 'previewRecipient'/.test(outreach));
ok('an automatic campaign shows a warning before several emails', /This campaign sends without approval\. Use Preview on each address/.test(outreach));
ok('Restart company is on a company stopped by a reply, and asks about the conversation that got the reply', /data-eop="restart"/.test(outreach) && /Restart that one too\?/.test(outreach) && /action: 'restartCompany'/.test(outreach));
ok('server: tracks and restart are gated by outreach.multiRecipient', campaigns.includes('["tracksFor", "restartCompany"].includes(data.action)') && campaigns.includes('"outreach.multiRecipient"') && /case "restartCompany"/.test(campaigns) && /case "tracksFor"/.test(campaigns));
ok('scheduler: starts tracks behind the switch; a late address always waits for approval', /Tracks\.startTracks/.test(sched) && /e\.forceApproval/.test(sched));
ok('webhook: a bounce moves on to another address and skips stopping the company when one exists', /Tracks\.onHardBounce/.test(webhook) && /carry === "none"/.test(webhook));
ok('inbound: the reply says who replied when the company has several conversations', /Tracks\.hasTracks/.test(inbound) && /replied`/.test(inbound));
ok('ending an enrolment remembers the step, for Restart', /resumeStep: e\.data\(\)\.currentStep/.test(campaigns));
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exit(fail ? 1 : 0);
