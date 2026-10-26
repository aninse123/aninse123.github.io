// Inbox: search all conversations (26 Oct 2026, switch outreach.inboxSearchAll).
// The Inbox loads the 150 most recent conversations (Setcereal's, 16 Oct, was
// the 153rd and couldn't be found); a search with nothing among them looks the
// company up in the whole database and loads its conversations; "Load older
// conversations" pages back; a hint says when Mine hides matches.
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const out = read('../../portal/outreach.html'), feat = read('../../portal/features.js'), cat = read('../../functions/features/catalog.js');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

ok('switch outreach.inboxSearchAll in both catalogs', feat.includes("['outreach.inboxSearchAll', 'Outreach', 'release'") && cat.includes('key: "outreach.inboxSearchAll"'));
ok('nothing among the loaded conversations → search all of them (switch on, 3+ characters)', out.includes("if (isOn('outreach.inboxSearchAll') && q.length >= 3 && q !== allSearch.q && !filteredThreads('all').length) searchAllConversations(q);"));
ok('the wider search uses the company lookup Compose uses (name, NIF, email, @domain) and loads those companies\' conversations, plus an exact address', out.includes('const cos = await findCompanies(q, 10);') && out.includes("where('companyId', 'in', ids.slice(i, i + 10)), limit(100)") && out.includes("where('contactEmail', '==', q.toLowerCase())"));
ok('a company found that way matches even when its name differs from the text typed', out.includes('!(allSearch.ids && norm(allSearch.q) === q && allSearch.ids.has(t.companyId))'));
ok('conversations found or loaded stay in the list across live updates', out.includes('mergeOlder(); // 26 Oct (outreach.inboxSearchAll)') && out.includes('for (const [id, t] of olderThreads) if (!have.has(id)) threads.push(t);'));
ok('"Load older conversations" pages back 150 at a time from the last one shown', out.includes("orderBy('lastMessageAt', 'desc'), startAfter(cur), limit(150)") && out.includes('id="threadLoadOlder">Load older conversations</button>'));
ok('the list says it is searching / how many were found, and when Mine hides matches', out.includes('Not in the latest 150 — searching all conversations…') && out.includes('Searched all conversations: ${num(allSearch.found)} found') && out.includes('more match under All.'));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
