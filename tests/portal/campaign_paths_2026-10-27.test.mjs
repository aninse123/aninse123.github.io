// Campaign paths on the pages (27 Oct 2026, switch outreach.paths): the shared
// module (same path rules as the server, condition text, amounts, the tree) and
// the wiring in Outreach (editor with list / tree / side by side, conditions,
// "Check who goes where", saving, each company's own path in the Outbox,
// labels and drafts) and the Search CRM campaign card.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const out = read('../../portal/outreach.html'), search = read('../../portal/search.html'), feat = read('../../portal/features.js'), cat = read('../../functions/features/catalog.js');
const P = await import(new URL('../../portal/campaign-paths.js', import.meta.url));
const require = createRequire(import.meta.url);
const U = require('../../functions/outreach/campaign_util.js');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

// Same rules as the server
const camp = { paths: [{ id: 'hi', name: 'High fit', filters: [{ field: 'fitScore', op: 'gte', value: 75 }] }, { id: 'main', name: 'Everyone else', filters: null }],
  steps: [{ id: 'a', pathId: 'hi' }, { id: 'b', pathId: 'hi' }, { id: 'c' }, { id: 'd', pathId: 'main' }] };
ok('path steps: the page and the server agree (a step with no path is on "main")', ['hi', 'main', undefined].every((p) => JSON.stringify(P.stepsOfPath(camp, p).map((s) => s.id)) === JSON.stringify(U.pathSteps(camp, p).map((s) => s.id))) && P.stepsFor(camp, { pathId: 'hi' }).length === 2 && P.stepsFor(camp, {}).length === 2);
ok('a campaign without paths is one path, "main"', P.pathsOf({}).length === 1 && P.pathsOf({})[0].id === 'main' && !P.hasPaths({}) && P.hasPaths(camp) && U.pathsOf({})[0].id === 'main');
ok('the fields and operators match the server\'s list', P.PATH_FIELDS.every((f) => U.PATH_FIELDS[f.key] === f.type) && Object.keys(U.PATH_FIELDS).length === P.PATH_FIELDS.length && Object.entries(P.OPS).every(([t, ops]) => JSON.stringify(ops.map((o) => o[0])) === JSON.stringify(U.PATH_OPS[t])));
ok('every default condition is valid for the server', P.PATH_FIELDS.every((f) => { const d = P.defaultFilter(f.key); if (d.op === 'prefix' || d.op === 'eq') d.value = 'x'; if (d.op === 'in' && !d.value.length) d.value = ['x']; if (d.value === null) d.value = 1; try { U.normalizeCampaign({ name: 'T', exclusions: { allowedStages: ['universe'] }, paths: [{ id: 'x', filters: [d] }, { id: 'main' }], steps: [] }); return true; } catch (e) { return false; } }));

// Text and amounts
ok('condition text: "Fit score at least 75", "Revenue from €2M to under €10M", "Tier is A or B", "Not contactable", "Last touch in the last 90 days"',
  P.condText({ field: 'fitScore', op: 'gte', value: 75 }) === 'Fit score at least 75' && P.condText({ field: 'computedRevenue', op: 'range', value: [2e6, 1e7] }) === 'Revenue from €2M to under €10M'
  && P.condText({ field: 'targetTier', op: 'in', value: ['A', 'B'] }) === 'Tier is A or B' && P.condText({ field: 'contactable', op: 'bool', value: false }) === 'Not contactable' && P.condText({ field: 'lastTouchAt', op: 'within_days', value: 90 }) === 'Last touch in the last 90 days');
ok('amounts: "2M" → 2,000,000, "500k", "1,5M"; shown back as 2M / 500k', P.parseAmount('2M') === 2e6 && P.parseAmount('500k') === 5e5 && P.parseAmount('1,5M') === 1.5e6 && Number.isNaN(P.parseAmount('abc')) && P.amountText(2e6, '€') === '2M' && P.amountText(5e5, '€') === '500k');
ok('"Everyone else" reads as the rest', P.pathCondText({ id: 'main' }) === 'Any company the paths above don’t take');

// Round 1 iteration (27 Oct, André's checklist): one way to write values, lists to pick from, counts in three groups
ok('text fields: "is any of" from a list — "Region (NUTS II) is PT11 - Norte or PT16 - Centro"; the default is an empty pick', /is PT11 - Norte or PT16 - Centro$/.test(P.condText({ field: 'nuts2', op: 'in', value: ['PT11 - Norte', 'PT16 - Centro'] })) && JSON.stringify(P.defaultFilter('sector')) === JSON.stringify({ field: 'sector', op: 'in', value: [] }));
ok('a new Revenue condition starts empty (so the example shows) and the server refuses it until a number is typed', P.defaultFilter('computedRevenue').value === null && P.condText(P.defaultFilter('computedRevenue')) === 'Revenue at least …' && (() => { try { U.normalizeCampaign({ name: 'T', exclusions: { allowedStages: ['universe'] }, paths: [{ id: 'x', name: 'Big', filters: [P.defaultFilter('computedRevenue')] }, { id: 'main' }], steps: [] }); return false; } catch (e) { return /Revenue needs a number/.test(e.message); } })());
ok('every number box shows an example inside (2M, 500k, 75, 4621, 90) and money is read back "= €2,000,000"', P.placeholderOf('computedRevenue') === 'e.g. 2M' && P.placeholderOf('fitScore') === 'e.g. 75' && P.placeholderOf('caeCode') === 'e.g. 4621' && P.placeholderOf('lastTouchAt') === 'e.g. 90' && P.amountReadback(P.parseAmount('2000k')) === '= €2,000,000' && P.amountReadback(NaN) === '');
ok('counts: "3 companies: 1 to start · 1 in progress · 1 closed (all left out)"; Everyone else after the run "2 companies: 2 closed (all left out)"', P.pathCountText({ waiting: 1, active: 1, closed: 1, leftOut: 1 }) === '3 companies: 1 to start · 1 in progress · 1 closed (all left out)' && P.pathCountText({ waiting: 0, active: 0, closed: 2, leftOut: 2 }) === '2 companies: 2 closed (all left out)' && P.pathCountText({ waiting: 0, active: 0, closed: 3, leftOut: 1 }) === '3 companies: 3 closed (1 left out)' && P.pathTotal({ waiting: 4, active: 2, closed: 1 }) === 7);
ok('editor: lists to tick (searchConfig/pathOptions, with a search box when long), typed list as fallback, the "how to write" hint, the read-back updates as you type', out.includes("getDoc(doc(db, 'searchConfig', 'pathOptions'))") && out.includes('<details class="msel">') && out.includes('data-cf="msel"') && out.includes('data-mselq') && out.includes('data-cf="vlist"') && out.includes('Amounts: 2000000, 2000k and 2M are the same. Several values in one condition = any of them; separate conditions (+ and…) = all of them.') && out.includes('data-readback=') && out.includes('pathCountText(n)'));

// The tree
const tree = P.pathsTreeHtml({ paths: camp.paths, steps: [{ id: 'a', pathId: 'hi', channel: 'email', name: 'Email 1', wait: { days: 0 } }, { id: 'b', pathId: 'hi', channel: 'call', name: 'Call', wait: { days: 3 }, branches: [{ outcome: 'no_answer', action: 'end' }] }], counts: { hi: { waiting: 20, active: 2, closed: 1 } } });
ok('tree: a column per path with its condition and count, the steps with waits and rules, "leave out" for an empty Everyone else', /High fit<small>Fit score at least 75 · 23<\/small>/.test(tree) && /data-tree-step="1"[^>]*>📞 2\. Call/.test(tree) && /3 sending days/.test(tree) && /no_answer → end/.test(tree) && /leave out — not contacted/.test(tree) && /data-tree-path="hi"/.test(tree));

// Wiring
ok('switch outreach.paths in both catalogs', feat.includes("['outreach.paths', 'Outreach', 'release'") && cat.includes('key: "outreach.paths"'));
ok('editor: List / Tree / Side by side, Add path, Check who goes where (behind the switch)', out.includes("[['list', 'List'], ['tree', 'Tree'], ['side', 'Side by side']]") && out.includes('id="pathAdd"') && out.includes('id="pathCheck">Check who goes where</button>') && out.includes("const pathsOn = isOn('outreach.paths');"));
ok('editor: a card per path (name, ↑↓, delete unless its steps ran, conditions with "and"), "Everyone else" last saying it leaves companies out when empty', out.includes('const pathCard = (p, pi) =>') && out.includes('data-pdel=') && out.includes("Steps of this path already ran") && out.includes("<b>No steps: these companies are left out — not contacted.</b>") && out.includes('+ and…'));
ok('steps number, move and "go to" within their own path; new steps go to their path', out.includes('const pi = ps.findIndex(([, xi]) => xi === i), lockedInPath') && out.includes("go to step ${k + 1}") && out.includes('const addStep = (pid, ch) =>'));
ok('saving sends the paths (only with the switch on); the counts come from the server action', out.includes("if (isOn('outreach.paths')) payload.paths = pathsDraft.length > 1 ? pathsDraft : null;") && out.includes("action: 'pathsPreview', campaignId: c.id, paths: pathsDraft, steps: seqDraft"));
ok('the tree\'s boxes open the step / path in the list', out.includes("root.querySelectorAll('[data-tree-step],[data-tree-path]')"));
ok('each company runs its path\'s steps in the Outbox, its labels, the waiting reason, the conversation window and the drafts', out.includes('steps: stepsFor(camps.get(e.campaignId), e)') && out.includes('const steps = stepsFor(c, e); // 27 Oct: its path\'s steps') && out.includes('const steps = stepsFor(c, e), st = steps[e.currentStep];') && out.includes('const steps = en ? stepsFor(c, en) : (c.steps || []);') && out.includes('const ps = st ? stepsOfPath(c, st.pathId) : [];'));
ok('Search CRM campaign card: the company\'s path', search.includes('const steps = stepsFor(camp, e); // 27 Oct'));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
