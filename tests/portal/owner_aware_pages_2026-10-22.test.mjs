// Owner-aware outreach, Stages 2–5 on the pages (22 Oct 2026; switches
// search.sameEmail and outreach.ownerAware): the shared owner panel module, the
// Search CRM (add panel, Overview "also the email of", Ownership "Same email" and
// "Related companies in outreach", the two new history types), Outreach (add
// panel, approval card, Metrics by owner, the report setting). Wiring checks plus
// the panel module run directly.
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const search = read('../../portal/search.html'), out = read('../../portal/outreach.html'), feat = read('../../portal/features.js'), cat = read('../../functions/features/catalog.js'), rules = read('../../firestore.rules');
const P = await import(new URL('../../portal/owner-panel.js', import.meta.url));
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

// The panel module
const owner = { count: 2, flagged: [
  { companyId: 'x1', companyName: 'Flexitrab', flags: [{ kind: 'group_contacted', text: 'group contacted via Fillwork (2026-10-12)' }], related: [{ companyId: 'f', name: 'Fillwork', why: ['same owner: José Silva'], campaignName: 'Serviços Q4', lastOutreachAt: Date.parse('2026-10-12') }], lead: { companyId: 'f', name: 'Fillwork', why: 'largest' }, choice: 'proceed', mention: [{ companyId: 'f', name: 'Fillwork' }] },
  { companyId: 'x3', companyName: 'Mafirol <b>', flags: [{ kind: 'said_no', text: 'Mafirol Ind.: said no' }], related: [], lead: null, choice: 'skip', mention: [] },
] };
const html = P.ownerPanelHtml(owner);
ok('panel: "Related companies (2)", Proceed with all / Skip all', /Related companies \(2\)/.test(html) && /data-opall="proceed"/.test(html) && /data-opall="skip"/.test(html));
ok('panel: each company starts on its suggested choice (Flexitrab Proceed, Mafirol Skip for now)', /name="op_x1" value="proceed" checked/.test(html) && /name="op_x3" value="skip" checked/.test(html));
ok('panel: "Proceed and mention…" only when there are related companies to tick (22 Oct, D5)', /name="op_x1" value="mention"/.test(html) && /data-opmention="f"/.test(html) && !/name="op_x3" value="mention"/.test(html));
ok('panel: flags, related companies, suggested lead; names escaped', /group contacted via Fillwork/.test(html) && /suggested lead: Fillwork/.test(html) && /Mafirol &lt;b&gt;/.test(html));
ok('panel: nothing flagged → nothing shown', P.ownerPanelHtml({ count: 0, flagged: [] }) === '' && P.ownerPanelHtml(null) === '');
ok('related line: name, why, last contact and campaign', /Fillwork <span[^>]*>\(same owner: José Silva\)<\/span> — contacted 12 Oct · campaign “Serviços Q4”/.test(P.relatedLine(owner.flagged[0].related[0])));

// Switches
ok('switches in both catalogs: search.sameEmail, outreach.ownerAware', feat.includes("['search.sameEmail', 'Search CRM', 'release'") && feat.includes("['outreach.ownerAware', 'Outreach', 'release'") && cat.includes('key: "search.sameEmail"') && cat.includes('key: "outreach.ownerAware"'));

// Search CRM
ok('add to campaign: the panel after the preview, the choices sent with the enrolment', search.includes("if (preview.owner?.count) { body.insertAdjacentHTML('beforeend', ownerPanelHtml(preview.owner)); wireOwnerPanel(body); }") && search.includes('ownerChoices: readOwnerChoices(body), ownerMentions: readOwnerMentions(body) })'));
ok('Overview: "also the email of X" / "same personal email as" next to the email (switch search.sameEmail)', search.includes('<span id="ovSameEmail" data-feature="search.sameEmail"></span>') && search.includes("if (isOn('search.sameEmail')) fillOverviewSameEmail(c);") && search.includes("${personal ? 'same personal email as' : 'also the email of'}"));
ok('Ownership: "Possible link: same email" only when Orbis doesn\'t already relate them; Confirm on both companies, Dismiss on this one, Undo', search.includes('if (!(await relatedByOrbis(c, links, o))) possible.push(o);') && search.includes("sameEmailLinks: arrayUnion({ companyId: oid, by: currentUser, at })") && search.includes("sameEmailLinks: arrayUnion({ companyId: c.id, by: currentUser, at })") && search.includes('sameEmailDismissed: arrayUnion(oid)') && search.includes('data-seundo='));
ok('Ownership: "Related companies in outreach" with "In conversation via X" from the server lookup (switch outreach.ownerAware)', search.includes("callOutreachCampaign({ action: 'related', companyId: c.id })") && search.includes('In conversation via ${conv.map(x => esc(x.name)).join'));
ok('history: "Owner-aware choice" and "Group contacted" are automatic, never a touch', search.includes("outreach_owner:   { label:'Owner-aware choice'") && search.includes("outreach_group:   { label:'Group contacted'") && search.includes("'outreach_owner','outreach_group']; // 22 Oct"));
ok('"skipped for now (related companies)" in the add result', search.includes("owner_skip: 'skipped for now (related companies)'") && out.includes("owner_skip: 'skipped for now (related companies)'"));

// Outreach
ok('Outreach add screen: same panel and choices', out.includes("${ownerPanelHtml(p.owner)}") && out.includes("if (stage !== 'pick') wireOwnerPanel($('modalBody'));") && out.includes("ownerChoices: readOwnerChoices($('modalBody')), ownerMentions: readOwnerMentions($('modalBody')) })"));
ok('approval card: related companies with why, status and the address to copy (no automatic Cc); "Check the mention"', out.includes("const op = isOn('outreach.ownerAware') ? d.ownerPanel : null;") && out.includes('data-copyemail=') && out.includes('Check the mention of the related companies') && out.includes('mentionHtml + opHtml +'));
ok('Metrics: replied by company and by owner, and the latest Monday report', out.includes('<div id="mOwner" data-feature="outreach.ownerAware"></div>') && out.includes("orderBy('weekFrom', 'desc'), limit(1)") && out.includes('of ${num(started.size)} owners'));
ok('Settings: "Email the Monday report to the partners" (on unless unticked)', out.includes('id="gWeeklyReport"') && out.includes("$('gWeeklyReport').checked = s.weeklyReportEmail !== false;") && out.includes("weeklyReportEmail: $('gWeeklyReport').checked,"));

// Rules
ok('rules: the same-email link by anyone who edits companies; reports read with Outreach view', rules.includes("|| (canAny(['search.edit', 'search.editall']) && onlyFields(['sameEmailLinks', 'sameEmailDismissed'].concat(stampFields())))") && rules.includes("match /outreachReports/{id} {\n      allow read: if can('out.view');"));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
