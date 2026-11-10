// Related companies: activity (10 Nov 2026, switch outreach.relatedActivity): wiring of the three suggestions in the pages —
// Log Activity (Search CRM) and Task or activity (Outreach) list the related companies unticked; a call task can mention them;
// the related company's "in conversation" line gets a Pause button that asks first. The rules are tested in functions/test/related_activity.test.js.
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const search = read('../../portal/search.html'), outreach = read('../../portal/outreach.html'), feats = read('../../portal/features.js'), catalog = read('../../functions/features/catalog.js');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

ok('release switch in both catalogs, area Outreach', feats.includes("['outreach.relatedActivity', 'Outreach', 'release'") && catalog.includes('key: "outreach.relatedActivity"'));

// 1. Log Activity (Search CRM)
ok('Log Activity: a box for the related companies, filled after the form, hidden for an email', search.includes('id="actAlso"') && search.includes('fillActAlso();') && search.includes("activityType === 'email'"));
ok('…only with both switches on; the list is the server\'s related lookup, at most 6 shown', search.includes("!isOn('outreach.relatedActivity') || !isOn('outreach.ownerAware')") && search.includes("callOutreachCampaign({ action: 'related', companyId: c.id })") && search.includes('(r?.related || []).slice(0, 6)'));
ok('…none ticked for you, at most 3 can be ticked', /class="actAlsoCk" value="\$\{esc\(x\.companyId\)\}">/.test(search) && !/class="actAlsoCk"[^>]*checked/.test(search) && search.includes("querySelectorAll('.actAlsoCk:checked').length > 3) ck.checked = false"));
ok('…saved first here; then logRelated with the new activity id; a failure says so without losing the activity', search.includes("const alsoIds = [...document.querySelectorAll('#actAlso .actAlsoCk:checked')]") && search.includes("callOutreachCampaign({ action: 'logRelated', activityId: ref.id, companyIds: alsoIds })") && search.includes('Saved here, but it could not be logged on the related companies'));

// 2 + 1b. Task or activity (Outreach)
ok('Outreach modal: a box for the related companies, only with both switches, for a call task or a recorded activity', outreach.includes('id="ntRel"') && outreach.includes("isOn('outreach.relatedActivity') && isOn('outreach.ownerAware') && co && ((mode === 'task' && ch === 'call') || (mode === 'done' && ch !== 'other'))"));
ok('…none ticked for you, at most 3; the label says what ticking does in each mode', !/class="ntRelCk"[^>]*checked\b[^$]/.test(outreach.replace("${was.has(r.companyId) ? ' checked' : ''}", '')) && outreach.includes('Mention also in the call (optional)') && outreach.includes('Also log on a related company (optional)') && outreach.includes("querySelectorAll('.ntRelCk:checked').length > 3"));
ok('planning a call: the ticked companies go into the instructions as "Mention also: …"', outreach.includes("const alsoTask = ch === 'call' ? ntRelPicked() : [];") && outreach.includes('`Mention also: ${alsoTask.map(x => x.name).join(\', \')}.`') && outreach.includes("instructions: [$('ntIns').value.trim(), mention].filter(Boolean).join('\\n')"));
ok('recording what happened: logActivity first, then logRelated with its activityId', outreach.includes("const made = (await callCampaign({ action: 'logActivity'") && outreach.includes("action: 'logRelated', activityId: made.activityId"));
ok('the box refreshes when the company is chosen or the kind changes', outreach.includes("$('ntCoPicked').textContent = `Chosen: ${c.name}`;\n              ntRelated();") && outreach.includes("const ch = $('ntCh').value;\n        ntRelated();"));

// 3. In conversation + Pause
ok('Ownership tab: "in conversation" follows the server flags (activity included); the Pause button only for activity flags, with the switch', search.includes("convFlags = (r.flags || []).filter(f => f.kind === 'in_conversation')") && search.includes("isOn('outreach.relatedActivity') ? convFlags.filter(f => f.activity) : []") && search.includes('id="relPauseBtn"'));
ok('…it asks first, says nothing is deleted, calls pauseSequence, and tells when there is no sequence', search.includes("if (!confirm(`Pause the email sequence of ${c.name}?") && search.includes("action: 'pauseSequence', companyId: c.id") && search.includes('This company has no running email sequence to pause.'));
ok('Outreach conversation header: the same Pause button next to the related companies, asking first', outreach.includes('id="relPause"') && outreach.includes("(d.flags || []).some(f => f.activity)") && outreach.includes("if (!confirm(`Pause the email sequence of ${t.companyName || 'this company'}?") && outreach.includes("action: 'pauseSequence', companyId: t.companyId"));
ok('nothing is automatic: no pauseSequence / logRelated call outside a click or the Save button', (search.match(/action: 'pauseSequence'/g) || []).length === 1 && (outreach.match(/action: 'pauseSequence'/g) || []).length === 1 && (search.match(/action: 'logRelated'/g) || []).length === 1 && (outreach.match(/action: 'logRelated'/g) || []).length === 1);
if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); } else console.log('\nAll passed');
