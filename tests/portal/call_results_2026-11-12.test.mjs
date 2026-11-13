// Call results (12–13 Nov 2026, switch outreach.callResults; plan "Call Results Plan" v3): the task card asks whether someone answered,
// then the result (the Inbox categories), the sequence choice for every address of the company and the reminder; Number used and Who
// answered are two fields; the Search CRM gets a Next follow-up column, filter and badge. The rules are tested in
// functions/test/call_results.test.js; this suite checks the pages' wiring and lifts the pure helpers.
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const outreach = read('../../portal/outreach.html'), search = read('../../portal/search.html'), feats = read('../../portal/features.js'), catalog = read('../../functions/features/catalog.js');
const owner = read('../../portal/owner-panel.js'), paths = read('../../portal/campaign-paths.js');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
function liftFn(page, name) {
  const start = page.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(name + ' not found');
  let p = page.indexOf('(', start), pd = 0;
  do { if (page[p] === '(') pd++; else if (page[p] === ')') pd--; p++; } while (pd > 0);
  let depth = 0, j = page.indexOf('{', p);
  do { if (page[j] === '{') depth++; else if (page[j] === '}') depth--; j++; } while (depth > 0);
  return page.slice(start, j);
}

ok('release switch in both catalogs, area Outreach', feats.includes("['outreach.callResults', 'Outreach', 'release', 'Call results'") && catalog.includes('key: "outreach.callResults"'));

// The card
ok('a call has two levels with the switch: No answer · Voicemail · Wrong number · Answered', outreach.includes("const CALL_OUTCOMES_V2 = [['no_answer', 'No answer'], ['voicemail', 'Voicemail'], ['wrong_number', 'Wrong number'], ['answered', 'Answered', 'reply']];"));
ok('the results are the Inbox categories, with their default sequence (the plan\'s table)', ["['interested', 'Interested', 'stop']", "['wait_for_response', 'Awaiting reply', 'pause']", "['callback_later', 'Call back at…', 'pause']", "['not_now', 'Not now', 'stop']", "['not_interested', 'Not interested', 'stop']", "['referred', 'Referred', 'pause']", "['wrong_contact', 'Wrong contact', 'continue']"].every((x) => outreach.includes(x)));
ok('only for company tasks of call / WhatsApp / LinkedIn / visit, and only with the switch', outreach.includes("const callResultsOn = (t) => isOn('outreach.callResults') && !!t.companyId && ['call', 'whatsapp', 'linkedin', 'visit'].includes(t.channel);"));
ok('the old card stays when the switch is Off (stop checkbox, old who field)', outreach.includes("${!CR && t.campaignId && outs.some(o => o[2] === 'reply') ? `<label class=\"checkline\" style=\"margin-bottom:8px;\"><input type=\"checkbox\" data-tstop checked>") && outreach.includes("${!(CR && t.channel !== 'linkedin') && isOn('outreach.taskContact')"));
ok('the result block shows only once the outcome is an answer', outreach.includes('ans.show(callResultsOn(t) && isReplyPick());'));
ok('Call back at…: date AND time, with the four shortcuts', outreach.includes('type="datetime-local"') && ["'in 10 min'", "'in 1 h'", "'this afternoon'", "'tomorrow morning'"].every((x) => outreach.includes(x)));
ok('Not now: 3 / 6 / 12 months', outreach.includes("[[3, '3 months'], [6, '6 months'], [12, '12 months']]"));
ok('sequence: Continue · Pause until <date> · Stop, for every address', outreach.includes('Sequence — every address of the company') && outreach.includes('value="continue"') && outreach.includes('value="pause"') && outreach.includes('value="stop"') && outreach.includes('data-auntil'));
ok('Save sends the result, the sequence, the call back and the reminder (with the notes)', outreach.includes('const ar = ans.read();') && outreach.includes("payload.reminder = { ...ar.reminder, note: payload.notes.trim().slice(0, 500) }"));
ok('Number used and Who answered are two fields; Someone else… opens the Inbox Add to company window', outreach.includes('<label>Number used</label>') && outreach.includes('<label>Who answered</label>') && outreach.includes('<option value="new">Someone else…</option>') && outreach.includes("if (nwv?.person?.isNew && t.companyId) addCrm = {"));
ok('Who answered lists every person (with or without email) and marks the decision-makers', outreach.includes("decider: !p.isContact && p.rank >= 60") && outreach.includes("${p.decider ? ' · Decision-maker' : ''}"));
ok('the number is saved on the person only when new for them; unticked when it is the company\'s or someone else\'s', outreach.includes('const show = !!(p && p.personId && num && k && !hasIt);') && outreach.includes("el.querySelector('[data-tsavenum]').checked = !ownedElse;") && outreach.includes('async function savePhoneOnPerson('));
ok('Pause company on the card pauses every address (B1)', outreach.includes("op: 'pause', wholeCompany: true"));
ok('a reminder task says Awaiting reply since <date>', outreach.includes('`Awaiting reply since ${since}`') && outreach.includes('${reminderTag(t)}Own task'));
ok('Task or activity: the same answer block for an answer, two-level call', outreach.includes('<div id="ntAns">${answerBlockHtml(true)}</div>') && outreach.includes("(ch === 'call' && ntAns ? CALL_OUTCOMES_V2 : (TASK_OUTCOMES[ch] || []))"));
ok('Inbox: Awaiting reply is a category', outreach.includes("['wait_for_response', 'Awaiting reply']"));
ok('To approve: an email after an answer carries the note', outreach.includes('d.answerNote ?') && outreach.includes('adapt this email or skip it'));
ok('campaign rows: the result chip and the pause date; Overview counts an answer by phone (also positive)', outreach.includes("${r.answer ? ` <span class=\"pill pill--info\"") && outreach.includes("POSITIVE.includes(e.answer?.category)") && paths.includes('for (const e of enrols) if (e.answer) add(e.companyId'));
ok('related companies: a Next follow-up is amber, with ⏰', outreach.includes("f.kind === 'in_conversation' || f.kind === 'follow_up'") && owner.includes("follow_up: '⏰'") && owner.includes('next follow-up ${day(r.nextFollowUpAt)}'));

// Search CRM
ok('Search CRM: Next follow-up column, filter and badge, behind the switch', search.includes('<th data-col="nextFollowUpAt" data-feature="outreach.callResults"') && search.includes('id="followUpFilter" data-feature="outreach.callResults"') && search.includes("'followUpFilter'];") && search.includes('⏰ Next follow-up'));
ok('Search CRM: wait_for_response is called Awaiting reply', search.includes("wait_for_response:'Awaiting reply'"));
ok('the company page shows the related companies\' Next follow-up', search.includes(".filter(f => f.kind === 'follow_up')"));
const followUpMs = new Function(`${liftFn(search, 'followUpMs')}; return followUpMs;`)();
ok('followUpMs: a Timestamp, a cached { seconds }, a date string, nothing', followUpMs({ nextFollowUp: { at: { toMillis: () => 5 } } }) === 5 && followUpMs({ nextFollowUp: { at: { seconds: 2, nanoseconds: 0 } } }) === 2000 && followUpMs({ nextFollowUp: { at: '2027-05-12T09:00:00Z' } }) === Date.parse('2027-05-12T09:00:00Z') && followUpMs({}) === 0);
const workingDaysOn = new Function(`${liftFn(outreach, 'workingDaysOn')}; return workingDaysOn;`)();
const d = workingDaysOn(3, new Date(2026, 9, 2, 11)); // Fri 2 Oct → Wed 7 Oct (Mon–Fri on the page; the server adds holidays)
ok('workingDaysOn: Friday + 3 working days = Wednesday', d.getDay() === 3 && d.getDate() === 7);
if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); } else console.log('\nAll passed');
