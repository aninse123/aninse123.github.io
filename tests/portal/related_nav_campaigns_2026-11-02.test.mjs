// 2 Nov 2026 build: related companies (aware-only mention, rename), campaign search / creator / filters, and the Search CRM
// navigation history (← Back and the browser's Back go one level at a time).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').split('\r\n').join('\n');
const search = read('../../portal/search.html'), out = read('../../portal/outreach.html'), panel = read('../../portal/owner-panel.js');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

// ── Related companies: the panel and the two pages
ok('panel: each related company can be "Also writing" or "Aware only"; the two are exclusive', panel.includes('data-opknown') && panel.includes('Aware only') && panel.includes('a company is either written about or only known of'));
ok('panel: a company with no flag is listed with "No flag" and its related companies open', panel.includes('No flag: nothing is happening with its related companies.') && panel.includes("f.flags.length ? '' : ' open'"));
ok('panel: "mention" with nothing ticked (either kind) is Proceed; readOwnerKnown exported', panel.includes("[data-opmention]:checked, [data-opknown]:checked") && panel.includes('export function readOwnerKnown'));
ok('both pages send ownerKnown with the enrolment', search.includes('ownerKnown: readOwnerKnown(body)') && out.includes("ownerKnown: readOwnerKnown($('modalBody'))"));
ok('activity label renamed: "Related company contacted"', search.includes("label:'Related company contacted'") && !search.includes("label:'Group contacted'"));

// ── Add to campaign (Search CRM): search as you type
ok('Add to campaign: a search box filters the campaigns by name, status or creator as you type', search.includes('id="addCampFind"') && search.includes("find.addEventListener('input', fillCampSel)") && search.includes('No campaign matches'));

// ── Outreach > Campaigns table
ok('Campaigns table: Created by column (from createdBy), search, status, creator, type and "Needs attention"', out.includes('<th>Created by</th>') && out.includes('id="campFind"') && out.includes('id="campStatusF"') && out.includes('id="campCreatorF"') && out.includes('id="campTypeF"') && out.includes('id="campAttn"') && out.includes('const creatorOf = (c) =>'));
ok('Campaigns table: filters as you type; empty message tells a filter from "no campaigns"', out.includes("$('campFind').addEventListener('input', renderCampList)") && out.includes('No campaign matches the search and filters.'));

// ── Navigation history, run against a fake history
const start = search.indexOf('// 2 Nov: navigation history.'), end = search.indexOf('\n// ', search.indexOf("window.addEventListener('popstate'", start));
const code = search.slice(start, end > 0 ? end : undefined);
const log = []; let stack, idx; const listeners = [];
const reset = () => { stack = [{ v: 'l', d: 0 }]; idx = 0; log.length = 0; };
const fire = () => listeners.forEach((f) => f({ state: stack[idx] }));
const ctx = {
  history: {
    get state() { return stack[idx]; },
    replaceState: (s) => { stack[idx] = s; }, pushState: (s) => { stack = stack.slice(0, idx + 1); stack.push(s); idx++; },
    back: () => { if (idx > 0) { idx--; fire(); } },
  },
  window: { addEventListener: (t, f) => { if (t === 'popstate') listeners.push(f); } },
  document: { getElementById: () => ({ textContent: '' }) },
  openDetail: (id, tab) => log.push(`company ${id}${tab ? ' ' + tab : ''}`), openPerson: (id) => log.push(`person ${id}`), showListView: () => log.push('list'),
  console,
};
vm.createContext(ctx);
new vm.Script(code + '\nthis.__n = { navPush, navTab, navBack, get depth(){ return navDepth; } };').runInContext(ctx);
const n = ctx.__n;
reset(); ctx.history.replaceState({ v: 'l', d: 0 });
n.navPush('c', 'polipaul');                   // list → Polipaul
n.navTab('ownership');                        // → its Ownership tab
n.navPush('c', 'rgp316');                     // → RGP 316 (a shareholder / related company)
ok('opening companies adds history entries (depth 2)', n.depth === 2 && stack.length === 3);
n.navBack(() => log.push('fallback-list'));
ok('Back from RGP 316 returns to Polipaul on its Ownership tab, not the list', log.join('|') === 'company polipaul ownership' && n.depth === 1);
n.navBack(() => log.push('fallback-list'));
ok('Back again returns to the list', log[log.length - 1] === 'list' && n.depth === 0);
n.navBack(() => log.push('fallback-list'));
ok('with no history left, the in-page Back falls back to the list', log[log.length - 1] === 'fallback-list');
// a person in between: company → person → back → company
reset(); ctx.history.replaceState({ v: 'l', d: 0 }); n.navPush('c', 'a'); n.navPush('p', 'ana'); n.navBack(() => {});
ok('Back from a person returns to the company', log[log.length - 1] === 'company a overview');
// the same company again (a refresh) does not add an entry
reset(); ctx.history.replaceState({ v: 'l', d: 0 }); n.navPush('c', 'a'); const before = stack.length; n.navPush('c', 'a', 'people');
ok('opening the same company again (refresh) adds no entry and keeps the new tab', stack.length === before && stack[idx].tab === 'people');

ok('page wiring: openDetail / openPerson / setActiveTab record history; both Back buttons go one level; backToList starts the history over', search.includes("navPush('c', id, tab);") && search.includes("navPush('p', personId);") && search.includes('function setActiveTab(name){\n  navTab(name);') && search.includes("addEventListener('click', () => navBack(backToList))") && search.includes("addEventListener('click', () => navBack(backFromPerson))") && search.includes('function showListView()'));

// Layout (2 Nov): the campaigns toolbar has two rows — New campaign sits on the title row, before the search and filters
ok("Campaigns toolbar: New campaign on the title row; search, filters and Show archived on their own row", out.indexOf("id=\"campNew\"") < out.indexOf("id=\"campFind\"") && out.indexOf("id=\"campAttn\"") < out.indexOf("id=\"campShowArchived\""));
ok('Add to campaign: rows with the whole name and a status · creator · companies line, active first, arrows and Enter work', search.includes('id="addCampList"') && search.includes("const ORDER = { active: 0") || search.includes('ORDER = { active: 0, draft: 1, paused: 2 }') && search.includes("ev.key === 'ArrowDown'") && search.includes("ev.key === 'Enter'") && search.includes('companies</div></div>'));

// Addresses per company (2 Nov): campaign settings, shown with the switch on, company campaigns only, saved with the campaign
ok('campaign settings: addresses per company, the maximum and the two start delays; saved with the campaign', out.includes('id="csAddrMode"') && out.includes('id="csAddrMax"') && out.includes('id="csDelayPerson"') && out.includes('id="csDelayCompany"') && out.includes("isOn('outreach.multiRecipient') && c.audienceType !== 'people'") && out.includes("addressMode: $('csAddrMode').value") && out.includes("startDelayCompany: Number($('csDelayCompany').value)"));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
