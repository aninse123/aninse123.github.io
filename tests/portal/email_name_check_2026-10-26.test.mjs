// Email name check on the pages (26 Oct 2026, switch search.emailNameCheck):
// the page twin (portal/email-name-check.js, generated) gives the server's answer;
// the Overview note, the Search CRM filter, the Add companies section (Search CRM
// and Outreach) and the line on drafts to approve are wired; the panel module works.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const search = read('../../portal/search.html'), out = read('../../portal/outreach.html'), feat = read('../../portal/features.js'), cat = read('../../functions/features/catalog.js');
const P = await import(new URL('../../portal/email-name-check.js', import.meta.url));
const UI = await import(new URL('../../portal/name-check-ui.js', import.meta.url));
const require = createRequire(import.meta.url);
const S = require('../../functions/outreach/email_name_check.js');
const ACC = JSON.parse(read('../../functions/outreach/accents_pt.json'));
const pageSrc = read('../../portal/email-name-check.js'), renderSrc = read('../../functions/outreach/render.js');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

// Page twin = server
const cases = [
  { name: 'PAIVA & SILVA, LDA', akaName: 'CAFE TONY', caeCode: '47300' }, { name: 'PORTUGAL CAPITAL VENTURES - SOCIEDADE DE CAPITAL DE RISCO, S.A.', emailName: 'Pv' },
  { name: 'TN - TRANSPORTES, S.A.', emailName: 'TN' }, { name: 'ENDUTEX SOCIEDADE GESTORA DE PARTICIPACOES SOCIAIS (SGPS),S.A', emailName: 'Endutex SGPS' },
  { name: 'SONIA SILVA & SOUSA, LDA' }, { name: 'CONSTRUCOES DURAO, S.A.', akaName: 'HOTEL DURAO', caeCode: '41200' }, { name: 'O SINO, S.A.', emailName: 'Restaurante o Sino', caeCode: '56101' },
  { name: 'X, LDA', emailName: 'CASA NOVA SILVA' }, { name: 'X, LDA', emailName: 'Casa  Nova' }, { name: 'X, LDA', emailName: 'Santa Casa da Misericórdia de Figueiró dos Vinhos e Arredores' },
  { name: 'S.A.C.L. SERVICOS DE AR CONDICIONADO, LDA', emailName: 'S.A.C.L.' }, { name: 'TEATRO NACIONAL DE SAO JOAO, E.P.E.', emailName: 'TNSJ, E.P.E' },
  { name: 'MARIANO VIDAL - ALIMENTOS PARA ANIMAIS, LDA', akaName: 'RESTAURANTE O BELEZA', caeCode: '46211' }, { name: 'PV CAPITAL, LDA', emailName: 'Pv', emailNameChecked: { name: 'Pv' } },
];
ok(`the page and the server give the same issues, suggestion and name for ${cases.length} sample companies`, cases.every((c) => JSON.stringify(P.nameIssues(c)) === JSON.stringify(S.nameIssues(c)) && P.suggestedName(c) === S.suggestedName(c) && P.emailNameOf(c) === S.emailNameOf(c) && JSON.stringify(P.nameCheckOf(c, 'x')) === JSON.stringify(S.nameCheckOf(c, 'x'))));
ok('the page module is up to date: the same accent list and the same legal-suffix rule as the server', pageSrc.includes(`const ACCENTS = ${JSON.stringify(ACC)};`) && pageSrc.includes(renderSrc.match(/const LEGAL_SUFFIX_RE = .*;/)[0]));
ok('switch search.emailNameCheck in both catalogs', feat.includes("['search.emailNameCheck', 'Search CRM', 'release'") && cat.includes('key: "search.emailNameCheck"'));

// The panel module
const nc = { companyId: 'c1', companyName: 'PAIVA & SILVA, LDA', emailName: 'Café Tony', source: 'trade', issues: ['names a café — the company\'s CAE is 47300'], suggestion: 'Paiva & Silva' };
const panel = UI.nameCheckPanelHtml([nc]);
ok('Add companies section: name, where it comes from, why, the suggestion in an editable box, Use this name / Keep', /Check the email name \(1\)/.test(panel) && /In emails: “Café Tony” <span[^>]*>\(from the Orbis trade name\)<\/span> — names a café/.test(panel) && /data-ncname value="Paiva &amp; Silva"/.test(panel) && /data-ncop="save"/.test(panel) && /data-ncop="keep"/.test(panel));
ok('…without company edit rights: the warning only, no buttons', !/data-ncop/.test(UI.nameCheckPanelHtml([nc], false)) && UI.nameCheckPanelHtml([]) === '' && UI.nameCheckPanelHtml(null) === '');
ok('draft line: "Email name may be wrong", says the draft already uses it (edit or Skip)', /Email name may be wrong:<\/b> “Café Tony”/.test(UI.nameCheckLine(nc, 'c1')) && /edit the text, or Skip/.test(UI.nameCheckLine(nc, 'c1')) && UI.nameCheckLine(null, 'c1') === '');
ok('Overview note: amber with buttons for a warning, grey without buttons for a long name', /⚠ names a café/.test(UI.nameCheckNote([{ kind: 'activity', level: 'warn', text: 'names a café' }], nc, 'c1')) && !/data-ncop/.test(UI.nameCheckNote([{ kind: 'long', level: 'info', text: 'long (50 characters)' }], null, 'c1')) && UI.nameCheckNote([], nc, 'c1') === '');

// Wiring
ok('Search CRM: Overview note next to the email name, behind the switch', search.includes("${isOn('search.emailNameCheck') ? nameCheckNote(nameIssues(c), nameCheckOf(c, c.id), c.id,"));
ok('Search CRM: filter "Email name: to check / long"', search.includes('<select class="filter-sel" id="emailNameFilter" data-feature="search.emailNameCheck"') && search.includes("if (enF && !nameIssues(c).some(i => enF === 'warn' ? i.level === 'warn' : i.kind === 'long')) return false;") && search.includes("'sameEmailFilter','emailNameFilter'];"));
ok('Search CRM: Add companies section after the preview; one handler fixes the loaded copy too', search.includes("if (preview.nameCheck?.length) body.insertAdjacentHTML('beforeend', nameCheckPanelHtml(preview.nameCheck,") && search.includes("wireNameCheck(document.body, (payload) => callOutreachCampaign(payload), (id, r) => {"));
ok('Outreach: Add companies section and the line on drafts to approve', out.includes("${isOn('search.emailNameCheck') ? nameCheckPanelHtml(p.nameCheck, canEditCompanies()) : ''}") && out.includes("const ncHtml = isOn('search.emailNameCheck') && d.nameCheck ? nameCheckLine(d.nameCheck, d.companyId, canEditCompanies()) : '';") && out.includes('return ncHtml + genderHtml + mentionHtml + opHtml +'));
ok('the page short-name copy has the "SOUSA" fix too', search.includes("let s = n.replace(/(?:[\\s,]+(?:(?:sociedade\\s+)?unipessoal[\\s,]+)?"));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
