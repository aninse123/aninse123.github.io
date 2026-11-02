// Contactable rule 11 (13 Oct 2026): "Not controlled by a foreign company" —
// Orbis "Controlled subs." with a foreign company in the control chain is cut,
// unless a person holds it through a few foreign holdings (the grey cases).
// Engine lifted verbatim from search.html; synthetic companies only.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8');
const start = page.indexOf('// ── Contactable rules (Tier & Contactable plan, Phase 2)'), end = page.indexOf('function contactableBadge(');
const ctx = { console }; vm.createContext(ctx);
new vm.Script(page.slice(start, end) + '\nthis.__x = { ctConfig, contactableVerdicts, ctForeignCo };').runInContext(ctx);
const { ctConfig, contactableVerdicts, ctForeignCo } = ctx.__x;
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
const fin = { '2025': { operatingRevenue: 8000, ebitda: 900, numberOfEmployees: 60 } };
const co = (id, om) => ({ id, name: id, status: 'Active', nationalLegalForm: 'Public limited company - SA', entityType: 'Corporate', orbisFinancials: fin, peopleCounts: { sh: 1 }, ownershipMeta: { shTypes: ['Corporate'], ...om } });
const fam = 'One or more named individuals or families';
const list = [
  co('royal', { entityType: 'Controlled subs.', guoType: fam, guoName: 'MARS FAMILY', guoBvdId: 'WWC2', cshNames: ['MARS FAMILY', 'MARS, INCORPORATED (HQ)', 'EFFEM HOLDINGS LIMITED', 'ROYAL CANIN SAS'] }),
  co('ferfor', { entityType: 'Controlled subs.', guoType: fam, guoName: 'MR FERNANDO CARVALHO', guoBvdId: 'P1', cshNames: ['MR FERNANDO CARVALHO', 'ENERPAL ESPANA SL'] }),
  co('alpla', { entityType: 'Controlled subs.', guoType: fam, guoName: 'LEHNER FAMILY', guoBvdId: 'P2', cshNames: ['LEHNER FAMILY', 'ALPLA HOLDING GMBH'] }),
  co('mendes', { entityType: 'Controlled subs.', guoType: 'Corporate', guoName: 'CROMA SAED SL.', guoBvdId: 'ES1', cshNames: ['CROMA SAED SL.'] }),
  co('ptholding', { entityType: 'Controlled subs.', guoType: fam, guoName: 'MRS CARLA CARDOSO', guoBvdId: 'P3', cshNames: ['MRS CARLA CARDOSO', 'MELOHOLDING - PARTICIPACOES IMOVEIS, LDA'] }),
  co('estate', { entityType: 'Controlled subs.', guoType: fam, guoName: 'X', guoBvdId: 'P4', cshNames: ['HORTENSE GONÇALVES, PEDRO GONÇALVES, EM COMUM E SE'] }),
  co('indep', { entityType: 'Independent co', guoType: 'Corporate', guoName: 'FOO GMBH', guoBvdId: 'P5', cshNames: [] }),
  co('nochain', { entityType: 'Controlled subs.', guoType: fam, guoName: 'MR Y', guoBvdId: 'P6' }),
  co('deep', { entityType: 'Controlled subs.', guoType: fam, guoName: 'MR Z', guoBvdId: 'P7', cshNames: ['MR Z', 'A LTD', 'B LTD', 'C LTD'] }),
];
const has11 = (v, id) => v.get(id).fails.some((f) => f.id === 'r11');
const v = contactableVerdicts(list, ctConfig({ rules: { r11: { personMaxHoldings: 2 } } })); // the exception as an option (default 0 since 13 Oct)
ok('Royal Canin (Mars family via Mars, Incorporated (HQ)) is cut, with the reason', has11(v, 'royal') && v.get('royal').fails.find((f) => f.id === 'r11').text === 'Rule 11: controlled by a foreign company (MARS, INCORPORATED (HQ)) — by name');
ok('a person through one foreign holding (Ferfor via Enerpal España SL) is kept', !has11(v, 'ferfor'));
ok('a "… FAMILY" at the top (Alpla, Lehner family) is cut', has11(v, 'alpla'));
ok('a foreign company at the top (Croma SAED SL) is cut', has11(v, 'mendes'));
ok('a Portuguese holding (… LDA) is not foreign', !has11(v, 'ptholding'));
ok('an estate ("em comum") is not a company', !has11(v, 'estate'));
ok('not a controlled subsidiary → rule 11 doesn\'t apply', !has11(v, 'indep'));
ok('more than 2 foreign holdings → cut even with a person at the top', has11(v, 'deep'));
const cut = contactableVerdicts(list, ctConfig({ rules: { r11: { missing: 'exclude', personMaxHoldings: 2 } } }));
ok('controlled subsidiary without a chain: "missing" policy applies', !has11(v, 'nochain') && has11(cut, 'nochain'));
const noEx = contactableVerdicts(list, ctConfig({}));
ok('default (13 Oct): no exception — the person-held case is cut too', has11(noEx, 'ferfor') && ctConfig({}).rules.r11.personMaxHoldings === 0);
const off = contactableVerdicts(list, ctConfig({ rules: { r11: { on: false } } }));
ok('rule switched off never cuts', !list.some((c) => has11(off, c.id)));
// Owner with more than 2 companies in the CRM → not a grey case.
const many = [1, 2, 3].map((i) => co('p' + i, { entityType: 'Controlled subs.', guoType: fam, guoName: 'MR W', guoBvdId: 'PW', cshNames: ['MR W', 'W HOLDING LTD'] }));
ok('a person owning 3 companies in the CRM through a foreign holding → cut', many.every((c) => has11(contactableVerdicts(many, ctConfig({ rules: { r11: { personMaxHoldings: 2 } } })), c.id)));
ok('foreign names recognised: GmbH, B.V., Inc., S.L.U., S.à r.l., A/S, PTE. LTD.; Portuguese not', ['ALPLA HOLDING GMBH', 'MARS NEDERLAND B.V.', 'SINGLESTORE, INC.', 'LASEM 2011 SLU', 'ROOT JVCO S.À R.L.', 'COLOPLAST A/S', 'SOMA HOLDING PTE. LTD.'].every(ctForeignCo) && !['FERREIRAFRIO - SGPS, UNIPESSOAL, LDA', 'PERFICHAPA, S.A.', 'MR JOAO'].some(ctForeignCo));
// 30 Oct 2026: option "ownerCountryForeign" — a corporate owner whose stored country isn't PT is foreign (RGP 316 / RAOUL GUYOT SA, CH).
const rgp = co('rgp', { entityType: 'Controlled subs.', guoType: 'Corporate', guoName: 'RAOUL GUYOT SA', guoBvdId: 'CHCHE1', guoCountry: 'CH', cshNames: ['RAOUL GUYOT SA'] });
const ptsa = co('ptsa', { entityType: 'Controlled subs.', guoType: 'Corporate', guoName: 'PERFICHAPA, S.A.', guoBvdId: 'PT1', guoCountry: 'PT', cshNames: ['PERFICHAPA, S.A.'] });
const nocountry = co('nocountry', { entityType: 'Controlled subs.', guoType: 'Corporate', guoName: 'FOO SA', guoBvdId: 'X9', guoCountry: null, cshNames: ['FOO SA'] });
const famCh = co('famch', { entityType: 'Controlled subs.', guoType: fam, guoName: 'MR HANS', guoBvdId: 'P8', guoCountry: 'CH', cshNames: ['MR HANS'] });
const indepCh = co('indepch', { entityType: 'Independent co', guoType: 'Corporate', guoName: 'BAR SA', guoBvdId: 'CH2', guoCountry: 'CH', cshNames: ['BAR SA'] });
const hgt = co('hgt', { entityType: 'Controlled subs.', guoType: 'Financial company', guoName: 'COMPAGNIE FINANCIERE RUPERT', guoBvdId: 'CH3', guoCountry: 'CH', cshNames: ['COMPAGNIE FINANCIERE RUPERT', 'COMPAGNIE FINANCIERE RICHEMONT SA'] });
const country = [rgp, ptsa, nocountry, famCh, indepCh, hgt];
ok('country option defaults to off', ctConfig({}).rules.r11.ownerCountryForeign === 0);
const defOff = contactableVerdicts(country, ctConfig({}));
ok("option off: a Swiss SA owner is not caught (today's behaviour unchanged)", country.every((c) => !has11(defOff, c.id)));
const onC = contactableVerdicts(country, ctConfig({ rules: { r11: { ownerCountryForeign: 1 } } }));
ok('option on: RAOUL GUYOT SA (CH) is cut, with the country in the reason', has11(onC, 'rgp') && onC.get('rgp').fails.find((f) => f.id === 'r11').text === 'Rule 11: controlled by a company in CH (RAOUL GUYOT SA)');
ok('option on: a Portuguese S.A. owner is kept', !has11(onC, 'ptsa'));
ok('option on: a financial-company owner abroad (HGT Portugal, Compagnie Financiere Rupert, CH) is cut too', has11(onC, 'hgt') && !has11(defOff, 'hgt'));
ok('option on: a missing country never cuts', !has11(onC, 'nocountry'));
ok('option on: a family owner is left to the existing rules', !has11(onC, 'famch'));
ok('option on: not a controlled subsidiary, not cut', !has11(onC, 'indepch'));
const nameFirst = contactableVerdicts([co('gm', { entityType: 'Controlled subs.', guoType: 'Corporate', guoName: 'X GMBH', guoBvdId: 'DE1', guoCountry: 'DE', cshNames: ['X GMBH'] })], ctConfig({ rules: { r11: { ownerCountryForeign: 1 } } }));
ok('option on: a foreign name is still reported by the name rule', nameFirst.get('gm').fails.find((f) => f.id === 'r11').text === 'Rule 11: controlled by a foreign company (X GMBH) — by name');
// 2 Nov 2026: the stored country of the shareholders (ownership summary: ownForeign* fields) comes first; rule 12 is off by default.
const withHold = (id, om, f) => ({ ...co(id, { entityType: 'Controlled subs.', ...om }), ...f });
const sip = withHold('sip', { guoType: fam, guoName: 'MR RAPHAEL SILVANT', guoBvdId: 'FR9', guoCountry: 'FR', cshNames: ['MR RAPHAEL SILVANT', 'HSI', 'ETABLISSEMENTS YVES SILVANT'] }, { ownForeignPct: 99, ownForeignTopPct: 99, ownForeignTopCountry: 'FR', ownForeignTopName: 'ETABLISSEMENTS YVES SILVANT', ownForeignList: 'FR 99% ETABLISSEMENTS YVES SILVANT' });
const ptHolder = withHold('ptholder', { guoType: fam, guoName: 'MR JASON WALTER', guoBvdId: 'GB9', guoCountry: 'GB', cshNames: ['MR JASON WALTER', 'WALTER NEXUS, LDA'] }, {});   // Portuguese holder: nothing foreign stored
const minority = withHold('minority', { guoType: fam, guoName: 'MR X', guoBvdId: 'FR8', guoCountry: 'FR', cshNames: ['MR X', 'Y'] }, { ownForeignPct: 30, ownForeignTopPct: 30, ownForeignTopCountry: 'ES', ownForeignTopName: 'Z SL', ownForeignList: 'ES 30% Z SL' });
const holdSet = [sip, ptHolder, minority];
const cOn = ctConfig({ rules: { r11: { ownerCountryForeign: 1 } } });
const hv = contactableVerdicts(holdSet, cOn);
ok('holder country: a majority corporate shareholder in FR (SIPOLUX) is cut, with the country, name and % in the reason', has11(hv, 'sip') && hv.get('sip').fails.find((f) => f.id === 'r11').text === 'Rule 11: controlled by a company in FR (ETABLISSEMENTS YVES SILVANT, 99%)');
ok('holder country: a Portuguese holder (nothing foreign stored) is kept; a 30% foreign minority is not control', !has11(hv, 'ptholder') && !has11(hv, 'minority'));
ok('holder country needs the option: off = today\'s behaviour (the unrecognised holding passes)', !has11(contactableVerdicts(holdSet, ctConfig({})), 'sip'));
const both = withHold('both', { guoType: 'Corporate', guoName: 'X GMBH', guoBvdId: 'DE5', guoCountry: 'DE', cshNames: ['X GMBH'] }, { ownForeignTopPct: 100, ownForeignTopCountry: 'DE', ownForeignTopName: 'X GMBH' });
ok('order: the stored country is the first evidence, the legal form the second', contactableVerdicts([both], cOn).get('both').fails.find((f) => f.id === 'r11').text.startsWith('Rule 11: controlled by a company in DE') && contactableVerdicts([both], ctConfig({})).get('both').fails.find((f) => f.id === 'r11').text.endsWith('— by name'));
const parent = withHold('parent', { guoType: 'Corporate', guoName: '1000270084 ONTARIO LTD', guoBvdId: 'CA1', cshNames: ['1000270084 ONTARIO LTD', 'AZEIBEJA, S.A.'] }, {});
ok('a foreign parent above a Portuguese holding is still caught by the name (indirect control)', has11(contactableVerdicts([parent], cOn), 'parent'));
ok('not a controlled subsidiary: the holder fields never cut by rule 11', !has11(contactableVerdicts([{ ...sip, id: 'indep2', ownershipMeta: { ...sip.ownershipMeta, entityType: 'Independent co' } }], cOn), 'indep2'));

// Rule 12
const jv = { ...co('jv', { entityType: 'Independent co', guoType: 'Corporate', guoName: 'A SL', guoBvdId: 'ES7', guoCountry: 'ES', cshNames: [] }), ownForeignPct: 100, ownForeignTopPct: 50, ownForeignTopCountry: 'ES', ownForeignTopName: 'CHIC SL', ownForeignList: 'ES 50% CHIC SL; ES 50% SALOMON SL' };
const split = { ...co('split', { entityType: 'Independent co', guoType: 'Corporate', guoName: 'B', guoBvdId: 'ES8', guoCountry: 'ES', cshNames: [] }), ownForeignPct: 40, ownForeignTopPct: 40, ownForeignTopCountry: 'US', ownForeignTopName: 'ESRI INTERNATIONAL', ownForeignList: 'US 40% ESRI INTERNATIONAL' };
const none = co('none', { entityType: 'Independent co', guoType: 'Corporate', guoName: 'C', guoBvdId: 'PT3', guoCountry: 'PT', cshNames: [] });
const has12 = (v, id) => v.get(id).fails.some((f) => f.id === 'r12');
ok('rule 12 is off by default (nothing is cut until you turn it on)', ctConfig({}).rules.r12.on === false && [jv, split, none].every((c) => !has12(contactableVerdicts([jv, split, none], ctConfig({})), c.id)));
const v12 = contactableVerdicts([jv, split, none], ctConfig({ rules: { r12: { on: true } } }));
ok('rule 12 on: two 50% Spanish holders (100% foreign together) are cut, with the list in the reason', has12(v12, 'jv') && v12.get('jv').fails.find((f) => f.id === 'r12').text === 'Rule 12: foreign companies together hold 100% (ES 50% CHIC SL; ES 50% SALOMON SL)');
ok('rule 12 on: a 40% foreign holder is not above the 50% threshold; no foreign holder is kept', !has12(v12, 'split') && !has12(v12, 'none'));
ok('rule 12: the threshold is a setting (30 cuts the 40% case)', has12(contactableVerdicts([split], ctConfig({ rules: { r12: { on: true, minForeignPct: 30 } } })), 'split'));

// The badge lists every reason
const pageBadge = page.slice(page.indexOf('function contactableBadge('), page.indexOf('// 14 Oct: the three'));
ok('badge: tooltip names the first rule failed and lists the others', pageBadge.includes('(first rule failed). Also:') && pageBadge.includes('c.contactableRules?.reasons'));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
