// Budget v2, Stage 3 (7 Nov 2026; visits became companies 11 Nov 2026): split lines, cost per company / person, plan against actual — portal/budget-lib.js.
import { itemLines, companyIdsOf, companyReport, personReport, planVsActual, normalizeItem } from '../../portal/budget-lib.js';
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
const ex = (o) => normalizeItem({ kind: 'expense', amount: 0, date: '2026-11-03', categoryId: 'transport', purposeId: 'field-visit', ...o });
const FM = { companyId: 'c1', companyName: 'Frutas Mangas' }, SC = { companyId: 'c2', companyName: 'Setcereal' };

// ── Lines ──
ok('an expense with no lines is one line made of its own fields (and its company)', (() => { const l = itemLines(ex({ amount: 50, ...FM })); return l.length === 1 && l[0].amount === 50 && l[0].categoryId === 'transport' && l[0].purposeId === 'field-visit' && l[0].companyId === 'c1' && l[0].companyName === 'Frutas Mangas'; })());
ok('a car rental split between two companies: equal by default, always adding up to the total', (() => { const l = itemLines(ex({ amount: 100.01, lines: [FM, SC] })); return l.length === 2 && l[0].amount === 50.01 && l[1].amount === 50 && Math.round((l[0].amount + l[1].amount) * 100) === 10001; })());
ok('weights set the shares (2:1 by kilometres)', (() => { const l = itemLines(ex({ amount: 120, lines: [{ weight: 2, ...FM }, { weight: 1, ...SC }] })); return l[0].amount === 80 && l[1].amount === 40; })());
ok('a line can have its own category and purpose (hotel invoice with meals); missing ones fall back to those of the item', (() => { const l = itemLines(ex({ amount: 100, categoryId: 'accommodation', lines: [{ weight: 3 }, { weight: 1, categoryId: 'meals', purposeId: 'overhead' }] })); return l[0].categoryId === 'accommodation' && l[0].purposeId === 'field-visit' && l[1].categoryId === 'meals' && l[1].purposeId === 'overhead'; })());
ok('zero or missing weights count as 1; money received and plan lines have no lines', itemLines(ex({ amount: 10, lines: [{ weight: 0 }, {}] })).map((x) => x.amount).join() === '5,5' && itemLines({ kind: 'income', amount: 5 }).length === 0 && itemLines({ kind: 'plan', amount: 5 }).length === 0);
ok('companyIdsOf lists each linked CRM company once, from the lines or the item; a typed name with no CRM link is not listed', companyIdsOf(ex({ amount: 9, lines: [{ companyId: 'c1' }, { companyId: 'c1' }, { companyId: 'c2' }, { companyName: 'Typed only' }, {}] })).join() === 'c1,c2' && companyIdsOf(ex({ amount: 9, companyId: 'c3' })).join() === 'c3' && companyIdsOf(ex({ amount: 9, companyName: 'Typed only' })).length === 0 && companyIdsOf(ex({ amount: 9 })).length === 0);

// ── Cost per company ──
const items = [
  ex({ amount: 100, lines: [FM, SC] }),                                                    // car rental: 50 + 50
  ex({ amount: 30, categoryId: 'meals', ...FM }),
  ex({ amount: 20, categoryId: 'accommodation', ...SC, archived: true }),                  // archived: ignored
  ex({ amount: 15, companyName: 'Not in the CRM' }),                                       // typed name only: counted under that name
  ex({ amount: 8 }),                                                                       // no company
  normalizeItem({ kind: 'income', incomeType: 'supplier_refund', amount: 9, ...FM }),       // refunds are not company costs here
  ex({ amount: 12, date: '2026-12-10', ...FM }),
];
const r = companyReport(items);
const row = (id) => r.rows.find((x) => x.companyId === id);
ok('cost per company: the shared car rental, the meal and a later expense are charged to the right company; archived items, items with no company and refunds are left out', r.rows.length === 3 && row('c1').total === 92 && row('c2').total === 50 && r.total === 157);
ok('a name typed by hand (not in the CRM) is its own row, marked by having no companyId', (() => { const t = r.rows.find((x) => x.name === 'Not in the CRM'); return !!t && t.companyId === '' && t.total === 15; })());
ok('cost per company by category, and the number of expenses touching each company', (() => { const a = row('c1'); return a.byCategory.transport === 62 && a.byCategory.meals === 30 && a.count === 3 && row('c2').count === 1 && r.byCategory.transport === 127 && r.byCategory.meals === 30 && r.companies === 3; })());
ok('companies are listed by cost, highest first', r.rows.map((x) => x.name).join() === 'Frutas Mangas,Setcereal,Not in the CRM');
ok('a date range picks expenses by their own date', companyReport(items, { from: '2026-12-01' }).rows.length === 1 && companyReport(items, { from: '2026-12-01' }).total === 12 && companyReport(items, { to: '2026-11-30' }).total === 145 && companyReport(items, { from: '2027-01-01' }).companies === 0);

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
