// Mobile app (portal/m/app.js): search rows, the company page (overview, key
// financials, shareholders with the controlling owner, contacts, management,
// activities) and the person page (contact, positions, "Open company"),
// rendered from sample records with the app's own code.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const strip = (src) => src.replace(/\r\n/g, '\n').replace(/^import .*$/gm, '').replace(/^export \{[^}]*\};?$/gm, '').replace(/^export /gm, '');
const helpersSrc = strip(readFileSync(new URL('../../portal/m/crm-helpers.js', import.meta.url), 'utf8'));
let appSrc = strip(readFileSync(new URL('../../portal/m/app.js', import.meta.url), 'utf8'));
appSrc = appSrc.slice(0, appSrc.indexOf("if (typeof window !== 'undefined'"));   // no sign-in bootstrap

const ctx = { console, Intl, URLSearchParams, localStorage: { getItem: () => null, setItem() {} }, document: { getElementById: () => null } };
vm.createContext(ctx);
vm.runInContext(helpersSrc + '\nglobalThis.H = { deburr, onlyDigits, personNameKey, nifFromAny, foundedYear, legalFormOf, personAge, controlTier, linkIsCurrent, linkIsShareholder, linkIsManager, fmtPctOwn, resolveOwnership, orbisValues, STAGES, FINANCIALS_YEARS, tierOf, setTierRules };', ctx);
vm.runInContext('const auth = { app: {} }; const getFunctions = () => ({}); const httpsCallable = () => async () => ({ data: {} });\n'
  + appSrc + '\nglobalThis.A = { money, keyFinancials, companyRowHtml, personRowHtml, companyHtml, personHtml, setDir: (d) => { dir = d; } };', ctx);
const { A, H } = ctx;

let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
ok('money: M€ / k€ / —', A.money(12345678) === '12.3 M€' && A.money(850000) === '850 k€' && A.money(null) === '—' && A.money(2000000) === '2 M€');

H.setTierRules([{ field: 'caeCode', value: '2511', tier: 'A' }]);
const row = A.companyRowHtml({ id: 'c1', name: 'METAL <NORTE>', nif: '508123456', town: 'Braga', sector: 'Metals', stage: 'screened', caeCode: '25110', contactable: false });
ok('company row: link, NIF, town, stage, tier from the rules, flags, escaped name', /href="#c\/c1"/.test(row) && /NIF 508123456 · Braga · Metals/.test(row) && /Screened/.test(row) && /Tier A/.test(row) && /Not contactable/.test(row) && /METAL &lt;NORTE&gt;/.test(row));
const prow = A.personRowHtml({ id: 'e1', name: 'HOLDING X', entityType: 'entity', linkCount: 3, currentLinkCount: 1 });
ok('person row: corporate shareholder, positions', /href="#p\/e1"/.test(prow) && /Company \(shareholder\)/.test(prow) && /1 current · 3 positions/.test(prow));

const company = {
  id: 'c1', name: 'METALURGICA DO NORTE, LDA', nif: '508123456', concelho: 'Braga', stage: 'engaged', owner: 'andre', caeCode: '25110', caeDescription: 'Estruturas metálicas',
  sector: 'Metals', subSector: 'Structures', nationalLegalForm: 'Sociedade por quotas', dateOfIncorporation: '1990-05-01', hqAddress: 'Rua A, 1', postcode: '4700-000',
  website: 'metalnorte.pt', companyPhone: '+351 253 000 000', doNotContact: { on: true },
  orbisFinancials: { 2023: { operatingRevenue: 10000000, ebitda: 1500000, profitForPeriodNetIncome: 800000, numberOfEmployees: 70 }, 2024: { operatingRevenue: 12000000, ebitda: 2400000, numberOfEmployees: 80 } },
  contacts: [{ name: 'Rui Gerente', role: 'CEO', phone: '+351 910 000 000', email: 'rui@metalnorte.pt', isPrimary: true }],
  ownershipMeta: { guoName: 'HOLDING X SGPS', guoNif: '509999999', guoType: 'Corporate' },
};
const links = [
  { id: 'l1', personId: 'e1', personName: 'HOLDING X SGPS', personEntityType: 'entity', shDirectPct: 70, shCurrent: true },
  { id: 'l2', personId: 'p1', personName: 'Ana Silva', shDirectPct: 30, shCurrent: true, mgmtRoles: ['Gerente'], mgmtCurrent: true, mgmtLevel: 'Highest level' },
  { id: 'l3', personId: 'p2', personName: 'Old Partner', shDirectPct: 10, shCurrent: false },
  { id: 'l4', personId: 'p3', personName: 'Ex Director', mgmtRoles: ['Director'], mgmtCurrent: false },
];
const acts = [{ id: 'a1', type: 'call_connected', title: 'Falámos com o gerente', date: { toMillis: () => Date.UTC(2026, 8, 20) }, createdBy: 'andre.rocha@douropartners.pt' }];
const html = A.companyHtml(company, links, acts, { id: 'g1', name: 'HOLDING X SGPS' });
const order = ['Overview', 'Key financials', 'Shareholders', 'Contacts', 'Management', 'Activities'].map((s) => html.indexOf('<summary>' + s));
ok('company sections in André\'s order: Overview → Key financials → Shareholders → Contacts → Management → Activities', order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])));
ok('header: NIF, town, stage, do not contact', /NIF 508123456 · Braga/.test(html) && /Engaged/.test(html) && /Do not contact/.test(html));
ok('overview: sector, CAE, founded 1990, tap-to-call, Maps, website', /Metals › Structures/.test(html) && /25110 — Estruturas metálicas/.test(html) && /1990/.test(html) && /href="tel:\+351253000000"/.test(html) && /maps\.apple\.com/.test(html) && /https:\/\/metalnorte\.pt/.test(html));
ok('key financials: newest year first, revenue, EBITDA margin 20%, employees', html.indexOf('>2024<') < html.indexOf('>2023<') && /12 M€/.test(html) && /20%/.test(html) && />80</.test(html));
ok('shareholders: 70% holder first, links to the person, control tier; previous collapsed', html.indexOf('HOLDING X SGPS') < html.indexOf('Ana Silva') && /href="#p\/e1"/.test(html) && /Control/.test(html) && /Previous shareholders \(1\)/.test(html));
ok('ultimate owner links to its company in the pipeline', /Ultimate owner: <a href="#c\/g1">HOLDING X SGPS<\/a>/.test(html));
ok('contacts: tap to call / email', /href="tel:\+351910000000"/.test(html) && /mailto:rui@metalnorte\.pt/.test(html));
ok('management: current Gerente with top exec, previous director collapsed', /Gerente/.test(html) && /Top exec/.test(html) && /Previous \(1\)/.test(html));
ok('activities: last activity with date and who', /Falámos com o gerente/.test(html) && /20 Sept 2026|20 Sep 2026/.test(html) && /andre\.rocha/.test(html));
ok('link to the full Search CRM', /\/portal\/search\.html\?company=c1/.test(html));

const person = { id: 'e1', name: 'HOLDING X SGPS', entityType: 'entity', matchedCompanyId: 'g1', country: 'PT', nif: '509999999', phone: '+351 222 000 000', orbisEmails: ['geral@holdingx.pt'] };
const plinks = [
  { id: 'l1', companyId: 'c1', companyName: 'METALURGICA DO NORTE, LDA', shDirectPct: 70, shCurrent: true },
  { id: 'l9', companyId: 'c7', companyName: 'OUTRA, LDA', mgmtRoles: ['Administrador'], mgmtCurrent: false },
];
const ph = A.personHtml(person, plinks);
ok('person: corporate shareholder with Open company', /Company \(shareholder\)/.test(ph) && /href="#c\/g1">Open company/.test(ph));
ok('person: phone to tap and Orbis email', /href="tel:\+351222000000"/.test(ph) && /mailto:geral@holdingx\.pt/.test(ph));
ok('person: current position links to the company with % and tier; previous listed', /href="#c\/c1"/.test(ph) && /Shareholder 70%/.test(ph) && /Control/.test(ph) && /Previous positions/.test(ph) && /Administrador/.test(ph));
console.log(fail ? `\n${fail} FAILED` : '\nall mobile render tests passed'); process.exit(fail ? 1 : 0);
