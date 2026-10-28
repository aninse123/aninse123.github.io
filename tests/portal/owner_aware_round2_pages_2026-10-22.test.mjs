// Owner-aware outreach, round 2 on the pages (22 Oct 2026, André's answers):
// D3 the same people rule on page and server (the page's "Possible link" no
// longer hides a pair that only shares an auditor), the lead wording; D5 the
// mention ticks; D6 the approval box and the confirmations; D1 the "Same email"
// filter; F2 the skip reasons; F4 the "Test campaign" tick (outreach.testCampaigns).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const search = read('../../portal/search.html'), out = read('../../portal/outreach.html'), feat = read('../../portal/features.js'), cat = read('../../functions/features/catalog.js');
const P = await import(new URL('../../portal/owner-panel.js', import.meta.url));
const require = createRequire(import.meta.url);
const R = require('../../functions/outreach/related.js');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

// D3: page and server agree, person by person
const people = [
  { mgmtCurrent: true, mgmtRoles: ['Ultimate owner'] }, { shCurrent: true, shDirectPct: 70, mgmtCurrent: true, mgmtRoles: ['Gerente'] },
  { shCurrent: true, shDirectPct: 55 }, { shCurrent: true, shDirectPct: 12, mgmtCurrent: true, mgmtRoles: ['Sócio-Gerente'] }, { shCurrent: true, shDirectPct: 2 }, { shCurrent: true },
  { mgmtCurrent: true, mgmtRoles: ['Administrador Único'] }, { mgmtCurrent: true, mgmtRoles: ['Financial Director/Director Financeiro'] }, { mgmtCurrent: true, mgmtRoles: ['Voter of the Board of Directors'] },
  { mgmtCurrent: true, mgmtRoles: ['Accountant'] }, { mgmtCurrent: true, mgmtRoles: ['Substitute Sole Fiscal/Fiscal Unico - Sup./Official Accounting Revisor/Revisor Official de Contas/No specific function'] },
  { mgmtCurrent: true, mgmtRoles: ['Secretary of the Board'] }, { mgmtCurrent: false, mgmtRoles: ['Gerente'] }, { shCurrent: false, shDirectPct: 40 },
].map((l) => ({ personEntityType: 'person', ...l }));
ok('the ladder: the page (owner-panel.js relatedRank) gives the server\'s level for every sample person', people.every((l) => Math.abs(P.relatedRank(l) - R.deciderRank(l)) < 1e-9));
ok('…an auditor (STOP TRANS II/III\'s ROC) doesn\'t relate two companies; a board member does', !P.isRelatedDecider(people[10]) && P.isRelatedDecider(people[8]) && !P.isRelatedDecider({ personEntityType: 'entity', shCurrent: true, shDirectPct: 100 }));
ok('the page\'s "Possible link" uses that rule (not any current person)', search.includes("const deciders = (ls) => new Set(ls.filter(isRelatedDecider).map(l => l.personId));") && !search.includes("ls.filter(l => linkIsCurrent(l) && l.personEntityType !== 'entity')"));
ok('lead wording: the parent / the person and level / the largest', /\(the parent\)/.test(P.leadText({ name: 'P', why: 'parent' })) && /Alfredo Cunha: majority owner, manages/.test(P.leadText({ name: 'X2', why: 'owner', person: 'Alfredo Cunha', level: 'majority owner, manages' })) && search.includes('Suggested lead company for the group: <b>${leadText(r.lead)}</b>.'));

// D5: the ticks
const owner = { count: 1, flagged: [{ companyId: 'x1', companyName: 'X1', flags: [{ kind: 'group_contacted', text: 'group contacted via X2' }], related: [{ companyId: 'x2', name: 'X2', why: ['same owner'] }, { companyId: 'x3', name: 'X3', why: ['same group'] }, { companyId: 'x4', name: 'X4', why: ['same group'] }, { companyId: 'x5', name: 'X5', why: ['same group'] }], mention: [{ companyId: 'x2', name: 'X2' }], choice: 'proceed', lead: null }] };
const html = P.ownerPanelHtml(owner);
ok('panel: one tick per related company, hidden until "Proceed and mention…", none ticked, the suggestion marked', (html.match(/data-opmention="/g) || []).length === 4 && /class="op-mention"[^>]* hidden/.test(html) && !/data-opmention="[^"]*" checked/.test(html) && /X2 <span[^>]*>\(same owner\)<\/span> <span[^>]*>suggested<\/span>/.test(html));
// a tiny DOM stand-in for readOwnerChoices / readOwnerMentions
const fakeRow = (choice, ticked) => ({ dataset: { opid: 'x1' }, querySelector: (sel) => sel.includes(':checked') && sel.includes('radio') ? { value: choice } : sel.includes('[data-opmention]:checked') ? (ticked.length ? {} : null) : null, querySelectorAll: () => ticked.map((id) => ({ dataset: { opmention: id } })) });
const root = (row) => ({ querySelectorAll: () => [row] });
ok('read: "mention" with ticks → mention + the ticked ids (at most 3)', P.readOwnerChoices(root(fakeRow('mention', ['x2', 'x3', 'x4', 'x5']))).x1 === 'mention' && JSON.stringify(P.readOwnerMentions(root(fakeRow('mention', ['x2', 'x3', 'x4', 'x5']))).x1) === '["x2","x3","x4"]');
ok('read: "mention" with nothing ticked is sent as "proceed", no mentions', P.readOwnerChoices(root(fakeRow('mention', []))).x1 === 'proceed' && !P.readOwnerMentions(root(fakeRow('mention', []))).x1);

// D6: the approval box
ok('approval: its own box, red when a related company said no, amber when in conversation, open then', out.includes("const risk = ownerRisk(d);") && out.includes("<div class=\"owner-box${risk ? ' owner-box--' + risk : ''}\">") && out.includes(".owner-box--red {") && out.includes(".owner-box--amber {") && out.includes("<details${risk ? ' open' : ''}"));
ok('…"This email mentions: X"; per related company Fit · Rev · EBITDA and "open company ↗" (28 Oct, instead of Copy address; no automatic Cc)', out.includes('This email mentions: <b>${mentioned.map(esc).join(\' and \')}</b>') && out.includes('${relatedLine(r)}${coFiguresHtml(coCache.get(r.companyId))}') && out.includes('...(d.ownerPanel?.related || []).map(r => r.companyId)'));
ok('…approving or sending a red / amber draft asks first; "Approve all" counts them', out.includes("if ((act === 'approve' || act === 'send') && ownerRisk(d) && !confirm(") && out.includes("const risky = list.filter(d => ids.includes(d.id) && ownerRisk(d)).length;"));

// D1: the filter
ok('Search CRM filter "Same email" (Possible / Confirmed) behind search.sameEmail, by the full address', search.includes('<select class="filter-sel" id="sameEmailFilter" data-feature="search.sameEmail"') && search.includes("if (seF === 'possible' && !hasPossibleSameEmail(c, seMap)) return false;") && search.includes("const sameEmailKey = (x) => String(x.companyEmail || '').trim().toLowerCase();"));

// F2: skip reasons
ok('the add result names why companies were skipped (Search CRM and Outreach)', search.includes("skipped: ${Object.entries(r.skipped || {}).map(([k, x]) => `${fmt(x)} ${esc(CAMP_EXCL_LABELS[k] || k)}`).join(', ')}") && out.includes("skipped: ${Object.entries(r.skipped || {}).map(([k, x]) => `${num(x)} ${EXCL_LABELS[k] || k}`).join(', ')}"));

// F4: test campaigns
ok('switch outreach.testCampaigns in both catalogs', feat.includes("['outreach.testCampaigns', 'Outreach', 'release'") && cat.includes('key: "outreach.testCampaigns"'));
ok('New campaign: "Test campaign" tick (only when live, behind the switch), sent as isTest; Run now on a test campaign', out.includes('data-feature="outreach.testCampaigns"><label class="checkline"><input type="checkbox" id="ncTest">') && out.includes("const isTest = !!$('ncTest')?.checked && isOn('outreach.testCampaigns');") && out.includes("settings.testMode !== false || c.isTest)) acts.unshift(['runnow'"));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
