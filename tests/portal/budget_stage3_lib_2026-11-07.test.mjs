// Budget v2, Stage 3 (7 Nov 2026): split lines, cost per visit / company / person, plan against actual — portal/budget-lib.js.
import { itemLines, visitIdsOf, visitReport, companyReport, personReport, planVsActual, normalizeItem } from '../../portal/budget-lib.js';
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
const ex = (o) => normalizeItem({ kind: 'expense', amount: 0, date: '2026-11-03', categoryId: 'transport', purposeId: 'field-visit', ...o });
const V = [{ id: 'v1', companyId: 'c1', companyName: 'Frutas Mangas', date: '2026-11-03' }, { id: 'v2', companyId: 'c2', companyName: 'Setcereal', date: '2026-11-03' }, { id: 'v3', companyId: 'c1', companyName: 'Frutas Mangas', date: '2026-12-10' }, { id: 'v4', companyId: 'c3', companyName: 'Old', date: '2026-01-05', archived: true }];

// ── Lines ──
ok('an expense with no lines is one line made of its own fields (and its visit)', (() => { const l = itemLines(ex({ amount: 50, visitId: 'v1' })); return l.length === 1 && l[0].amount === 50 && l[0].categoryId === 'transport' && l[0].purposeId === 'field-visit' && l[0].visitId === 'v1'; })());
ok('a car rental split between two visits: equal by default, always adding up to the total', (() => { const l = itemLines(ex({ amount: 100.01, lines: [{ visitId: 'v1' }, { visitId: 'v2' }] })); return l.length === 2 && l[0].amount === 50.01 && l[1].amount === 50 && Math.round((l[0].amount + l[1].amount) * 100) === 10001; })());
ok('weights set the shares (2:1 by kilometres)', (() => { const l = itemLines(ex({ amount: 120, lines: [{ weight: 2, visitId: 'v1' }, { weight: 1, visitId: 'v2' }] })); return l[0].amount === 80 && l[1].amount === 40; })());
ok('a line can have its own category and purpose (hotel invoice with meals); missing ones fall back to the item\'s', (() => { const l = itemLines(ex({ amount: 100, categoryId: 'accommodation', lines: [{ weight: 3 }, { weight: 1, categoryId: 'meals', purposeId: 'overhead' }] })); return l[0].categoryId === 'accommodation' && l[0].purposeId === 'field-visit' && l[1].categoryId === 'meals' && l[1].purposeId === 'overhead'; })());
ok('zero or missing weights count as 1; money received and plan lines have no lines', itemLines(ex({ amount: 10, lines: [{ weight: 0 }, {}] })).map((x) => x.amount).join() === '5,5' && itemLines({ kind: 'income', amount: 5 }).length === 0 && itemLines({ kind: 'plan', amount: 5 }).length === 0);
ok('visitIdsOf lists each visit once, from the lines or the item', visitIdsOf(ex({ amount: 9, lines: [{ visitId: 'v1' }, { visitId: 'v1' }, { visitId: 'v2' }, {}] })).join() === 'v1,v2' && visitIdsOf(ex({ amount: 9, visitId: 'v3' })).join() === 'v3' && visitIdsOf(ex({ amount: 9 })).length === 0);

// ── Cost per visit ──
const items = [
  ex({ amount: 100, lines: [{ visitId: 'v1' }, { visitId: 'v2' }] }),                      // car rental: 50 + 50
  ex({ amount: 30, categoryId: 'meals', visitId: 'v1' }),
  ex({ amount: 20, categoryId: 'accommodation', visitId: 'v2', archived: true }),            // archived: ignored
  ex({ amount: 15, visitId: 'v4' }),                                                         // an archived visit: ignored
  ex({ amount: 8 }),                                                                         // no visit
  normalizeItem({ kind: 'income', incomeType: 'supplier_refund', amount: 9, visitId: 'v1' }), // refunds are not visit costs here
];
const r = visitReport(items, V);
ok('cost per visit: the shared car rental and the meal are charged to the right visits; archived items and visits are left out', r.rows.length === 3 && r.rows.find((x) => x.visit.id === 'v1').total === 80 && r.rows.find((x) => x.visit.id === 'v2').total === 50 && r.rows.find((x) => x.visit.id === 'v3').total === 0 && r.total === 130);
ok('cost per visit by category, and the number of expenses touching each visit', (() => { const a = r.rows.find((x) => x.visit.id === 'v1'); return a.byCategory.transport === 50 && a.byCategory.meals === 30 && a.count === 2 && r.byCategory.transport === 100 && r.byCategory.meals === 30; })());
ok('average cost per visit: over every visit, and over the visits that have costs', r.visits === 3 && r.costed === 2 && r.average === 43.33 && r.averageCosted === 65);
ok('visits are listed newest first; a date range keeps the visits inside it (by the visit\'s date)', r.rows.map((x) => x.visit.id).join() === 'v3,v1,v2' || r.rows.map((x) => x.visit.id).join() === 'v3,v2,v1');
ok('date range on visits', visitReport(items, V, { from: '2026-12-01' }).rows.length === 1 && visitReport(items, V, { to: '2026-11-30' }).total === 130 && visitReport(items, V, { from: '2027-01-01' }).average === 0);
ok('cost per company adds up its visits', (() => { const c = companyReport(r); return c.length === 2 && c[0].name === 'Frutas Mangas' && c[0].total === 80 && c[0].visits === 2 && c[1].name === 'Setcereal' && c[1].total === 50; })());

// ── Cost per person ──
const pi = [
  ex({ amount: 100, usedBy: [{ key: 'andre' }] }),
  ex({ amount: 100, usedBy: [{ key: 'andre', weight: 70 }, { key: 'antonio', weight: 30 }], categoryId: 'meals' }),
  ex({ amount: 40, usedBy: [{ key: 'antonio' }, { key: 'external' }], categoryId: 'software-data' }),
  ex({ amount: 60, categoryId: 'professional-services' }),                                  // used by nobody in particular: Company
  ex({ amount: 5, usedBy: [{ key: 'andre' }], archived: true }),
  ex({ amount: 7, usedBy: [{ key: 'andre' }], date: '2025-01-01' }),
];
const pr = personReport(pi, { from: '2026-01-01' });
const by = (k) => pr.people.find((p) => p.key === k);
ok('cost per person: direct use, shares (70/30) and several people; External is a person too', by('andre').total === 170 && by('antonio').total === 50 && by('external').total === 20);
ok('cost per person: the Company bucket holds what nobody used; the total adds up; archived and out-of-range items are left out', pr.company.total === 60 && pr.total === 300 && !pr.people.some((p) => p.total === 5));
ok('cost per person by category', by('andre').byCategory.transport === 100 && by('andre').byCategory.meals === 70 && by('antonio').byCategory.meals === 30 && pr.company.byCategory['professional-services'] === 60);
ok('lines are shared per category: a split item charges each person for each line', (() => { const x = personReport([ex({ amount: 100, usedBy: [{ key: 'andre' }, { key: 'antonio' }], lines: [{ weight: 3, categoryId: 'accommodation' }, { weight: 1, categoryId: 'meals' }] })]); const a = x.people.find((p) => p.key === 'andre'); return a.total === 50 && a.byCategory.accommodation === 37.5 && a.byCategory.meals === 12.5; })());

// ── Plan against actual ──
const pl = planVsActual([
  normalizeItem({ kind: 'plan', amount: 1000, categoryId: 'transport', purposeId: 'field-visit' }), normalizeItem({ kind: 'plan', amount: 500, categoryId: 'meals' }),
  ex({ amount: 400 }), ex({ amount: 150, categoryId: 'meals', purposeId: 'networking-events' }), ex({ amount: 90, categoryId: 'software-data' }),
  ex({ amount: 999, archived: true }), normalizeItem({ kind: 'plan', amount: 77, categoryId: 'meals', archived: true }),
]);
const pc = (id) => pl.categories.find((x) => x.id === id);
ok('plan against actual by category: planned, spent, percent used and what is left; categories with spending but no plan show no percent', pc('transport').planned === 1000 && pc('transport').actual === 400 && pc('transport').pct === 40 && pc('transport').left === 600 && pc('meals').pct === 30 && pc('software-data').planned === 0 && pc('software-data').pct === null);
ok('plan against actual by purpose; archived plan lines and items are ignored', (() => { const f = pl.purposes.find((x) => x.id === 'field-visit'); const n = pl.purposes.find((x) => x.id === 'networking-events'); return f.planned === 1000 && f.actual === 490 && n.actual === 150 && n.pct === null && pc('meals').planned === 500; })());
ok('plan against actual: a date range limits the spending, not the plan', (() => { const q = planVsActual([normalizeItem({ kind: 'plan', amount: 100, categoryId: 'transport' }), ex({ amount: 10, date: '2026-01-01' }), ex({ amount: 20, date: '2026-06-01' })], { from: '2026-05-01' }); const t = q.categories.find((x) => x.id === 'transport'); return t.planned === 100 && t.actual === 20; })());

console.log(fail ? `\n${fail} FAILED` : '\nall budget stage 3 lib tests passed'); process.exit(fail ? 1 : 0);
