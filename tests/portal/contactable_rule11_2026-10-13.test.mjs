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
const v = contactableVerdicts(list, ctConfig({}));
ok('Royal Canin (Mars family via Mars, Incorporated (HQ)) is cut, with the reason', has11(v, 'royal') && v.get('royal').fails.find((f) => f.id === 'r11').text === 'Rule 11: controlled by a foreign company (MARS, INCORPORATED (HQ))');
ok('a person through one foreign holding (Ferfor via Enerpal España SL) is kept', !has11(v, 'ferfor'));
ok('a "… FAMILY" at the top (Alpla, Lehner family) is cut', has11(v, 'alpla'));
ok('a foreign company at the top (Croma SAED SL) is cut', has11(v, 'mendes'));
ok('a Portuguese holding (… LDA) is not foreign', !has11(v, 'ptholding'));
ok('an estate ("em comum") is not a company', !has11(v, 'estate'));
ok('not a controlled subsidiary → rule 11 doesn\'t apply', !has11(v, 'indep'));
ok('more than 2 foreign holdings → cut even with a person at the top', has11(v, 'deep'));
const cut = contactableVerdicts(list, ctConfig({ rules: { r11: { missing: 'exclude' } } }));
ok('controlled subsidiary without a chain: "missing" policy applies', !has11(v, 'nochain') && has11(cut, 'nochain'));
const noEx = contactableVerdicts(list, ctConfig({ rules: { r11: { personMaxHoldings: 0 } } }));
ok('exception off (0) → the person-held case is cut too', has11(noEx, 'ferfor'));
const off = contactableVerdicts(list, ctConfig({ rules: { r11: { on: false } } }));
ok('rule switched off never cuts', !list.some((c) => has11(off, c.id)));
// Owner with more than 2 companies in the CRM → not a grey case.
const many = [1, 2, 3].map((i) => co('p' + i, { entityType: 'Controlled subs.', guoType: fam, guoName: 'MR W', guoBvdId: 'PW', cshNames: ['MR W', 'W HOLDING LTD'] }));
ok('a person owning 3 companies in the CRM through a foreign holding → cut', many.every((c) => has11(contactableVerdicts(many, ctConfig({})), c.id)));
ok('foreign names recognised: GmbH, B.V., Inc., S.L.U., S.à r.l., A/S, PTE. LTD.; Portuguese not', ['ALPLA HOLDING GMBH', 'MARS NEDERLAND B.V.', 'SINGLESTORE, INC.', 'LASEM 2011 SLU', 'ROOT JVCO S.À R.L.', 'COLOPLAST A/S', 'SOMA HOLDING PTE. LTD.'].every(ctForeignCo) && !['FERREIRAFRIO - SGPS, UNIPESSOAL, LDA', 'PERFICHAPA, S.A.', 'MR JOAO'].some(ctForeignCo));
if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
