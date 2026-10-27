// Campaign paths, round 2 on the pages (27 Oct 2026, switch outreach.paths):
// results by path. The shared helpers (planned path, who starts first — same
// shares as the server —, results per path) and the wiring: Overview "By path"
// and "By step" per path, the forecast per path, the Companies path filter and
// "planned", Metrics "Campaign · path", the path in Inbox / tasks / Outbox, the
// folding step cards and Settings "Who starts first".
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const out = read('../../portal/outreach.html');
const P = await import(new URL('../../portal/campaign-paths.js', import.meta.url));
const require = createRequire(import.meta.url);
const U = require('../../functions/outreach/campaign_util.js');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

const paths = [{ id: 'hi', name: 'High fit', filters: [{ field: 'fitScore', op: 'gte', value: 75 }] }, { id: 'md', name: 'Middle', filters: [{ field: 'fitScore', op: 'lt', value: 75 }] }, { id: 'main', name: 'Everyone else', filters: null }];
const steps = [{ id: 'h1', pathId: 'hi' }, { id: 'm1', pathId: 'md' }, { id: 'e1', pathId: 'main' }];
const camp = (startOrder) => ({ paths, steps, startOrder });

// Planned path
ok('a waiting company runs its planned path\'s steps; once started, its own path', P.stepsFor({ paths, steps }, { status: 'pending', plannedPathId: 'hi' })[0].id === 'h1' && P.stepsFor({ paths, steps }, { status: 'active', pathId: 'md', plannedPathId: 'hi' })[0].id === 'm1' && P.pathIdOf({ status: 'pending' }) === null);

// Who starts first: the same shares as the server
ok('split shares: the page and the server agree (equal and own numbers, 1–25 a day)', [1, 2, 3, 7, 20, 25].every((n) => ['equal', 'own'].every((k) => { const so = k === 'equal' ? { mode: 'split', equal: true } : { mode: 'split', equal: false, perPath: { hi: 3, md: 0, main: 2 } }; return JSON.stringify(P.splitShares(camp(so), n)) === JSON.stringify(U.splitShares(camp(so), n)); })));
const at = (s) => ({ seconds: s });
const pend = [['a', 'md', 1], ['b', 'main', 2], ['c', 'hi', 3], ['d', 'md', 4], ['e', 'hi', 5], ['f', 'main', 6]].map(([id, p, s]) => ({ id, status: 'pending', plannedPathId: p, enrolledAt: at(s) }));
const q = (so, n) => P.startQueue(camp(so), pend, n).map((e) => e.id).join('');
ok('start queue — as added: oldest first (abcdef)', q(null, 2) === 'abcdef');
ok('start queue — path order: High fit, then Middle, then Everyone else (ceadbf)', q({ mode: 'order' }, 2) === 'ceadbf');
ok('start queue — split equally, 3 a day: one of each path per day (cab · edf)', q({ mode: 'split', equal: true }, 3) === 'cabedf');
ok('start queue — own numbers (High fit 2, Middle 1, Everyone else 0): c, e, a on day 1, then the unused room goes on in path order', q({ mode: 'split', equal: false, perPath: { hi: 2, md: 1, main: 0 } }, 3) === 'ceadbf');

// Results per path
const enrols = [
  { id: 'x_1', status: 'replied', pathId: 'hi', history: [{}] }, { id: 'x_2', status: 'active', pathId: 'hi', history: [{}] },
  { id: 'x_3', status: 'pending', plannedPathId: 'md' }, { id: 'x_4', status: 'completed', pathId: 'main', stopReason: 'Left out by the campaign\'s paths ("Everyone else")' },
  { id: 'x_5', status: 'pending' }, { id: 'x_6', status: 'removed', pathId: 'hi' },
];
const pr = P.pathResults({ paths, steps }, enrols, [{ enrolmentId: 'x_1', responseCategory: 'interested' }], ['interested']);
const row = (id) => pr.rows.find((r) => r.id === id);
ok('by path: High fit 2 companies, 2 contacted, 1 replied, 1 positive, 1 in sequence; Middle 1 waiting (planned); Everyone else 1 left out; 1 not planned yet; removed not counted', row('hi').total === 2 && row('hi').contacted === 2 && row('hi').replied === 1 && row('hi').positive === 1 && row('hi').inSeq === 1 && row('md').waiting === 1 && row('main').leftOut === 1 && pr.unplanned === 1);

// Wiring
ok('Overview: "By path" table and "By step" grouped by path (behind the switch)', out.includes('const pr = pathsView ? pathResults(c, curEnrols, curThreads, POSITIVE) : null;') && out.includes('<h3>By path</h3>') && out.includes('<tr class="path-row">') && out.includes("const pathsView = hasPaths(c) && isOn('outreach.paths');"));
ok('forecast: one per path, waiting companies on their planned path, in the campaign\'s start order', out.includes('function projectionByPath(c)') && out.includes('const queue = startQueue(c, live.filter(e => e.status === \'pending\'), perDay);') && out.includes('projectionHtml(c, { steps, live: mine, queueIdx'));
ok('Companies: path filter (each path, Left out, Not planned yet) and "Not started · planned: High fit"', out.includes('<select id="audPath" aria-label="Path">') && out.includes('<option value="left">Left out') && out.includes('planned: ${esc(e.plannedPathName)}'));
ok('Metrics: "Campaign · path" (from the path stored on the conversation)', out.includes('<option value="campaignPath" data-feature="outreach.paths">Campaign · path</option>') && out.includes("by === 'campaignPath'"));
ok('the path in the Inbox (list and header), tasks and the Outbox', (out.match(/\$\{t\.pathName \? ' · ' \+ esc\(t\.pathName\) : ''\}/g) || []).length === 2 && (out.match(/\$\{t\.pathName \? esc\(t\.pathName\) \+ ' · ' : ''\}/g) || []).length === 2 && out.includes("${r.pathName ? esc(r.pathName) + ' · ' : ''}") && out.includes('pathName: hasPaths(it.c) ? (it.e.pathName || it.e.plannedPathName || \'\') : \'\''));
ok('Outbox: waiting companies start in the campaign\'s order', out.includes('const pos = new Map(startQueue(cc, list.map(it => it.e), cc.pacing?.newPerDay || 20)'));
ok('step cards fold to one line inside paths (Open ›, Fold ‹, Open all steps); a new step and a tree click open it', out.includes('const foldLine = (s, i, k) =>') && out.includes('data-sfold=') && out.includes("id=\"foldAll\">${foldSteps ? 'Open all steps' : 'Fold steps'}") && out.includes('stepOpen.add(nid);') && out.includes('if (ts && foldSteps && !stepOpen.has(ts.id))'));
ok('Settings: "Who starts first" (as added / path order / split by path with "Share equally"), sent with the settings', out.includes('<select id="csStart"') && out.includes('id="csEqual"') && out.includes('const splitRows = () => {') && out.includes("startOrder: { mode: $('csStart').value, equal: $('csEqual').checked"));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
