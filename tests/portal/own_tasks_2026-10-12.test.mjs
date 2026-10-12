// Own tasks and activities (12 Oct 2026): the page's entry points — "＋ Task
// or activity" in Tasks and in a conversation, the modal's two modes, and own
// tasks on the To do list (no campaign line, "Cancel task", "Own tasks" filter).
import { readFileSync } from 'node:fs';
const page = readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
ok('Tasks has "＋ Task or activity" (Do tasks)', /id="newTaskBtn" data-perm="out.tasks"/.test(page) && page.includes("$('newTaskBtn').addEventListener('click', () => openTaskModal());"));
ok('a conversation has "＋ Task or activity" with its company and thread', /id="taskBtn" data-perm="out.tasks"/.test(page) && page.includes('openTaskModal({ companyId: t.companyId, companyName: t.companyName, threadId: t.id'));
ok('modal: plan a task or record it as done', page.includes('data-ntmode="task"') && page.includes('data-ntmode="done"') && page.includes("action: 'createTask'") && page.includes("action: 'logActivity'"));
ok('record mode offers no call-back / reschedule outcomes', page.includes("(TASK_OUTCOMES[ch] || []).filter(o => o[2] !== 'reopen')"));
ok('own task card: no campaign line, Cancel task, link to the conversation', page.includes("Own task · added by") && page.includes("'Cancel task'") && page.includes('data-topenthread'));
ok('To do filter has "Own tasks"', page.includes("todoCampaign === 'own' ? !t.campaignId"));
if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
