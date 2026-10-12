// Friday batch (12 Oct 2026), portal/outreach.html: fit / revenue / EBITDA on
// the approval row; companies open in a window on top; the campaign tag and
// window in the Inbox; the Auto-reply tag and filters; the classification
// dropdown; the Overview panels stacked. (The step dates: projection test.)
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const lift = (name) => { const a = page.indexOf(`function ${name}(`); if (a < 0) throw new Error(name); let d = 0, i = page.indexOf('{', page.indexOf(')', a)); for (; ; i++) { if (page[i] === '{') d++; else if (page[i] === '}' && --d === 0) break; } return page.slice(a, i + 1); };
const line = (start) => { const a = page.indexOf(start); return page.slice(a, page.indexOf('\n', a)); };
const ctx = { esc: (s) => String(s) };
vm.createContext(ctx);
vm.runInContext(`${line('const eurShort =')}\n${line('const finYearOf =')}\n${lift('coFiguresHtml')}\nglobalThis.F = { eurShort, coFiguresHtml };`, ctx);
const { F } = ctx;
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

ok('money: €5.3M / €131k / €12M / —', F.eurShort(5312582.87) === '€5.3M' && F.eurShort(131140.8) === '€131k' && F.eurShort(12345678) === '€12M' && F.eurShort(null) === '—');
const fig = F.coFiguresHtml({ fitScore: 49, computedRevenue: 5312582.87, computedEBITDA: 131140.8, orbisFinancials: { 2024: {}, 2025: {} } });
ok('approval row figures: Fit 49 · Rev €5.3M · EBITDA €131k (2025)', /Fit <b>49<\/b> · Rev <b>€5.3M<\/b> · EBITDA <b>€131k<\/b> \(2025\)/.test(fig));
ok('no figures → nothing shown', F.coFiguresHtml({}) === '' && F.coFiguresHtml(null) === '');
ok('approval row uses it', page.includes('${coFiguresHtml(coCache.get(d.companyId))}'));
ok('company links open a window on top (Ctrl / middle click still navigate)', page.includes('a[href^="/portal/search.html?company="]') && page.includes('e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0') && page.includes('openCompanyModal(id)'));
ok('Inbox: campaign tag in the list and a campaign window from the conversation', page.includes('title="From this campaign">📣') && page.includes("id=\"campInfoBtn\"") && page.includes('async function openCampaignInfo(t)'));
ok('Inbox: Auto-reply tag and state chip', page.includes("['auto', 'Auto-reply']") && page.includes("stateFilter === 'auto' && !(t.lastInboundAuto && t.lastDirection === 'in')"));
ok('Sent: Auto-reply tag and "Got an auto-reply" filter', page.includes('<option value="__auto">Got an auto-reply</option>') && page.includes("st === '__auto' ? autoThread(m)"));
ok('classification dropdown with "Not classified yet" and counts', page.includes('id="inboxCat"') && page.includes("['__none', 'Not classified yet', n('__none')]") && page.includes("(!t.responseCategory && t.repliedAt)"));
ok('Overview panels stacked full width', /\.ov-grid \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/.test(page));
if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
