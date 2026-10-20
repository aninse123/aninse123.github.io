// One inbox (owner-aware outreach, Stage 1, 19 Oct 2026): the page side —
// the switch exists on both lists, the "same address" reason is labelled with
// who else has it, the reply box offers "Stop the campaign for this company",
// the header shows every address used, To approve lists the companies that
// wait, and the hold activity never counts as a touch.
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const out = read('../../portal/outreach.html'), search = read('../../portal/search.html');
const feats = read('../../portal/features.js'), cat = read('../../functions/features/catalog.js');

let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

ok('switch "outreach.oneInbox" on both lists (page and server)', feats.includes("['outreach.oneInbox', 'Outreach', 'release', 'One inbox',") && cat.includes('key: "outreach.oneInbox", area: "Outreach", kind: "release", name: "One inbox"'));
ok('Outreach: same_inbox labelled, with who else has the address', out.includes("same_inbox: 'same email address as another company, emailed recently'") && out.includes('${inboxDetail(x)}'));
ok('Search CRM: same_inbox labelled, with who else has the address', search.includes("same_inbox: 'same email address as another company, emailed recently'") && search.includes('${campInboxDetail(x)}'));
ok('reply box: "Stop the campaign for this company", ticked, hidden until a running campaign is found', out.includes('<label class="checkline" id="replyStopWrap" hidden') && out.includes('<input type="checkbox" id="replyStop" checked> <span>Stop the campaign for this company'));
ok('…only with the switch on and a company, from its live enrolments', /async function showReplyStop\(t\) \{\n\s+if \(!isOn\('outreach\.oneInbox'\) \|\| !t\.companyId\) return;/.test(out) && out.includes("where('companyId', '==', t.companyId)") && out.includes('LIVE_ENROL.includes(e.status)'));
ok('…sent only when shown and ticked', out.includes("const stopCampaign = !!($('replyStopWrap') && !$('replyStopWrap').hidden && $('replyStop')?.checked);") && out.includes('...(stopCampaign ? { stopCampaign: true } : {})'));
ok('header: every address used, first one first (switch on)', out.includes('function addrTrail(t)') && out.includes("join(' → ')") && out.includes('${company}${addrTrail(t)}'));
ok('To approve: companies waiting because of the same address, read at most once a minute', out.includes("where('holdKind', '==', 'same_inbox')") && out.includes('Date.now() - inboxHeldAt < 60000') && out.includes('${inboxHeldCard()}'));
ok('Search CRM: the hold activity is labelled and never counts as a touch', search.includes("outreach_hold:    { label:'Held: same email address'") && /AUTO_TYPES = \[[^\]]*'outreach_hold'[^\]]*\]/.test(search));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
