// Tier & Contactable plan, Phase 2 (8 Oct 2026): the contactable rules engine,
// lifted verbatim from search.html (everything between the "Contactable rules"
// banner and contactableBadge). Synthetic companies only — one per rule.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8');
const start = page.indexOf('// ── Contactable rules (Tier & Contactable plan, Phase 2)');
const end = page.indexOf('function contactableBadge(');
if (start < 0 || end < 0) throw new Error('engine not found');
const ctx = { console };
vm.createContext(ctx);
new vm.Script(page.slice(start, end) + '\nthis.__x = { ctConfig, contactableVerdicts, contactablePlan };', { filename: 'engine.js' }).runInContext(ctx);
const { ctConfig, contactableVerdicts, contactablePlan } = ctx.__x;

let fail = 0;
const ok = (l, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${l}`); };

// A company that passes every rule; each case changes one thing.
const fin = (rev, ebitda, emp) => ({ '2025': { operatingRevenue: rev, ebitda, numberOfEmployees: emp } });
const base = (id, extra = {}) => ({
  id, name: id, status: 'Active', nationalLegalForm: 'Limited liability company - LDA', entityType: 'Corporate',
  orbisFinancials: fin(8000, 900, 60), peopleCounts: { sh: 2 },
  ownershipMeta: { guoType: 'One or more named individuals or families', guoName: 'MR JOAO EXEMPLO', guoBvdId: 'WW' + id, guoCountry: 'PT', shTypes: ['One or more named individuals or families'] },
  ...extra,
});
const om = (x) => ({ ...base('x').ownershipMeta, ...x });
const list = [
  base('ok'),
  base('r1', { status: 'Active\nIn liquidation' }),
  base('r2', { nationalLegalForm: 'Cooperative company' }),
  base('r3', { entityType: 'Foundation' }),
  base('r4', { orbisFinancials: fin(62100, 900, 60) }),
  base('r4missing', { orbisFinancials: { '2023': { operatingRevenue: 5000 } } }),
  base('r4from2024', { orbisFinancials: { '2024': { operatingRevenue: 51000, ebitda: 900, numberOfEmployees: 60 } } }),
  base('r5', { orbisFinancials: fin(8000, 12000, 60) }),
  base('r6', { orbisFinancials: fin(8000, 900, 400) }),
  base('r7hard', { ownershipMeta: om({ shTypes: ['Corporate', 'Private equity firm'], guoType: 'Corporate', guoName: 'HOLD SA', guoBvdId: 'PT1' }) }),
  base('r7softFamily', { ownershipMeta: om({ shTypes: ['Financial company'] }) }),
  base('r7softCorp', { ownershipMeta: om({ shTypes: ['Financial company'], guoType: 'Corporate', guoName: 'BIG SA', guoBvdId: 'PT2' }) }),
  base('r8listed', { ownershipMeta: om({ guoType: 'Corporate', guoName: 'LISTED SE', guoBvdId: 'FR9', guoTicker: 'LST' }) }),
  base('r8delisted', { ownershipMeta: om({ guoType: 'Corporate', guoName: 'OLD SA', guoBvdId: 'PT3', guoTicker: 'Delisted' }) }),
  base('r8fund', { ownershipMeta: om({ guoType: 'Corporate', guoName: 'CREST II - FUNDO DE CAPITAL DE RISCO', guoBvdId: 'PT4' }) }),
  base('r8assocLda', { ownershipMeta: om({ guoType: 'Corporate', guoName: 'ASSOCIACAO X, LDA', guoBvdId: 'PT5' }) }),
  base('r8titled', { ownershipMeta: om({ guoType: 'Bank', guoName: 'MR BANKER' }) }),
  base('r9ownerUsd', { ownershipMeta: om({ guoType: 'Corporate', guoName: 'MID SA', guoBvdId: 'PT6', guoRevenueMUsd: 240 }) }),   // 240 / 1.175 = €204M
  base('r9ownerUsdBelow', { ownershipMeta: om({ guoType: 'Corporate', guoName: 'MID2 SA', guoBvdId: 'PT7', guoRevenueMUsd: 230 }) }), // €196M
  ...Array.from({ length: 10 }, (_, i) => base('grp' + i, { ownershipMeta: om({ guoType: 'Corporate', guoName: 'GROUP SGPS', guoBvdId: 'PT8', guoEmployees: 50, guoRevenueMUsd: 10 }) })),
  ...Array.from({ length: 4 }, (_, i) => base('fam' + i, { ownershipMeta: om({ guoName: 'MR HANS BEISPIEL', guoBvdId: 'WWDE1', guoCountry: 'DE' }) })),
  ...Array.from({ length: 4 }, (_, i) => base('famD9' + i, { ownershipMeta: om({ guoName: 'MR NO COUNTRY', guoBvdId: 'WWX2', guoCountry: null, familyShCountries: ['ES'] }) })),
  base('r10', { peopleCounts: { sh: 11 } }),
  base('manual', { orbisFinancials: fin(90000, 900, 60), contactable: true, contactableSource: 'manual' }),
  base('wasRules', { contactable: false, contactableSource: 'rules', contactableNote: 'Rule 4: old', contactableRules: { failed: ['r4'], reasons: ['Rule 4: old'] } }),
];
const cfg = ctConfig(null);
const v = contactableVerdicts(list, cfg);
const ids = (id) => v.get(id).fails.map(f => f.id);
const text = (id) => v.get(id).fails.map(f => f.text).join(' / ');

console.log('=== One company per rule (defaults = v6 + D8) ===');
ok('a clean company passes', ids('ok').length === 0);
ok('1: the current (last) status line counts', ids('r1').join() === 'r1' && /In liquidation/.test(text('r1')));
ok('2: other legal forms are cut', ids('r2').join() === 'r2');
ok('3: entity type must be Corporate', ids('r3').join() === 'r3');
ok('4: revenue above €50M is cut, with the figure and year', ids('r4').join() === 'r4' && /€62\.1M in 2025/.test(text('r4')));
ok('4/5: missing 2025/2024 revenue + EBITDA → not contactable (D3: v6 missing-data policy)', ids('r4missing').join() === 'r4,r5');
ok('4: falls back to 2024', ids('r4from2024').join() === 'r4' && /in 2024/.test(text('r4from2024')));
ok('5: EBITDA outside -3M..10M is cut', ids('r5').join() === 'r5');
ok('6: more than 350 employees is cut', ids('r6').join() === 'r6');
ok('7: a private-equity shareholder is cut', ids('r7hard').includes('r7'));
ok('7: a financial-company shareholder is fine when the owner is a family', !ids('r7softFamily').includes('r7'));
ok('7: … and cut when the owner is a company', ids('r7softCorp').includes('r7'));
ok('8: a listed owner is cut', ids('r8listed').includes('r8') && /listed owner \(LST\)/.test(text('r8listed')));
ok('8: "Delisted" is not listed', !ids('r8delisted').includes('r8'));
ok('8: a fund-like owner name is cut', ids('r8fund').includes('r8'));
ok('8: a non-profit-looking name ending in LDA is fine', !ids('r8assocLda').includes('r8'));
ok('8: never when the owner name has a person title', !ids('r8titled').includes('r8'));
ok('9: owner revenue in USD converted at 1.175 — US$240M ≈ €204M is cut at €200M', ids('r9ownerUsd').includes('r9'));
ok('9: US$230M ≈ €196M passes', !ids('r9ownerUsdBelow').includes('r9'));
ok('9: an owner with 10 companies in the CRM is cut (D8: ≥ 10)', ids('grp0').includes('r9') && /10 companies in the CRM/.test(text('grp0')));
ok('9: a foreign family owner with 4 companies is cut', ids('fam0').includes('r9'));
ok('9: D9 — no owner country, family shareholders abroad → foreign', ids('famD90').includes('r9'));
ok('10: more than 10 shareholders is cut', ids('r10').join() === 'r10');

console.log('=== Settings ===');
{
  const off = ctConfig({ rules: { r4: { on: false } } });
  ok('a rule switched off never cuts', !contactableVerdicts([base('r4', { orbisFinancials: fin(62100, 900, 60) })], off).get('r4').fails.length);
  const keep = ctConfig({ rules: { r4: { missing: 'keep' }, r5: { missing: 'keep' } } });
  ok('missing-data policy "passes"', !contactableVerdicts([base('m', { orbisFinancials: {} })], keep).get('m').fails.length);
  ok('stored settings keep the defaults of rules not stored', ctConfig({ rules: { r6: { maxEmployees: 500 } } }).rules.r9.groupMaxCompanies === 10);
}

console.log('=== What Apply would change ===');
const plan = contactablePlan(list, v);
ok('a choice made by hand is left alone, even when the rules would cut it', plan.manual === 1 && ![...plan.cut, ...plan.update].some(x => x.c.id === 'manual'));
ok('a rules verdict that now passes goes back to contactable', plan.clear.length === 1 && plan.clear[0].c.id === 'wasRules');
ok('newly failing companies are cut', plan.cut.some(x => x.c.id === 'r4') && !plan.cut.some(x => x.c.id === 'ok'));
{
  const c = base('again', { orbisFinancials: fin(62100, 900, 60) });
  const v1 = contactableVerdicts([c], cfg); const p1 = contactablePlan([c], v1);
  Object.assign(c, { contactable: false, contactableSource: 'rules', contactableRules: { failed: p1.cut[0].failed, reasons: p1.cut[0].reasons } });
  const p2 = contactablePlan([c], contactableVerdicts([c], cfg));
  ok('running again with nothing changed writes nothing', p2.unchanged === 1 && !p2.cut.length && !p2.update.length && !p2.clear.length);
}
{
  const legacy = base('legacy', { contactable: false });   // marked before the rules existed (no source)
  ok('a company marked before the rules existed counts as decided by hand', contactablePlan([legacy], contactableVerdicts([legacy], cfg)).manual === 1);
}

if (fail){ console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nall contactable rules tests passed');
