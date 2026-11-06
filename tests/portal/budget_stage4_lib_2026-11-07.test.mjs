// Budget v2, Stage 4 (7 Nov 2026): what the company owes each partner, and which expenses a transfer repays — portal/budget-lib.js.
import { partnerBalances, suggestSettlement, normalizeItem, overview } from '../../portal/budget-lib.js';
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
const ex = (o) => normalizeItem({ kind: 'expense', amount: 0, date: '2026-11-03', ...o });
const loan = (o) => normalizeItem({ kind: 'income', incomeType: 'partner_loan', amount: 0, ...o });

// ── Balances ──
const items = [
  ex({ amount: 30, paidPersonallyBy: 'andre' }), ex({ amount: 20, paidPersonallyBy: 'andre' }),
  ex({ amount: 15, paidPersonallyBy: 'antonio', reimbursement: { status: 'reimbursed' } }),   // repaid: not owed
  ex({ amount: 40, paidPersonallyBy: 'antonio' }), ex({ amount: 99 }),                        // company paid: nobody is owed
  ex({ amount: 7, paidPersonallyBy: 'andre', archived: true }),
  loan({ amount: 500, partnerKey: 'antonio' }), loan({ amount: 300, partnerKey: 'andre' }),
  normalizeItem({ kind: 'income', incomeType: 'capital_call', amount: 1000, partnerKey: 'andre' }),   // not a loan
];
const b = partnerBalances(items, [{ status: 'settled', settlementKind: 'loan', partnerKey: 'antonio', amount: -200 }, { status: 'settled', settlementKind: 'expenses', partnerKey: 'andre', amount: -50 }]);
const of = (k) => b.find((r) => r.key === k);
ok('owed for expenses paid personally and not repaid, counted per partner (archived and repaid ones left out)', of('andre').expenses === 50 && of('andre').expenseCount === 2 && of('antonio').expenses === 40 && of('antonio').expenseCount === 1);
ok('loans owed = partner loans − repayments marked as loan repayments; a repayment of expenses does not touch the loan', of('antonio').loans === 500 && of('antonio').loanRepaid === 200 && of('antonio').loansOwed === 300 && of('andre').loansOwed === 300);
ok('total owed = expenses + loans still owed; the largest first; capital calls are not loans', of('antonio').total === 340 && of('andre').total === 350 && b[0].key === 'andre' && b.length === 2);
ok('a fully repaid loan leaves nothing owed; an over-repaid loan never makes the total negative', (() => { const r = partnerBalances([loan({ amount: 100, partnerKey: 'andre' })], [{ status: 'settled', settlementKind: 'loan', partnerKey: 'andre', amount: -100 }]); const o = partnerBalances([loan({ amount: 100, partnerKey: 'andre' })], [{ status: 'settled', settlementKind: 'loan', partnerKey: 'andre', amount: -150 }]); return r.every((x) => x.total === 0) && o.every((x) => x.total === 0 && x.loansOwed === -50); })());
ok('nothing owed: an empty list', partnerBalances([], []).length === 0 && partnerBalances([ex({ amount: 5 })], []).length === 0);
ok('the Overview figure for expenses paid personally still agrees', overview(items).owedToPartners.andre === 50 && overview(items).owedToPartners.antonio === 40);

// ── Which expenses a transfer repays ──
const c = (id, amount, date) => ({ id, amount, date });
ok('one expense equal to the transfer is found', suggestSettlement(-30, [c('a', 30, '2026-11-01'), c('b', 20, '2026-11-02')]).join() === 'a');
ok('several expenses adding up to the transfer, to the cent', suggestSettlement(-1000, [c('a', 400.5, '2026-11-01'), c('b', 300.25, '2026-11-02'), c('c', 299.25, '2026-11-03'), c('d', 77, '2026-11-04')]).sort().join() === 'a,b,c');
ok('when two combinations fit, the oldest expenses win', suggestSettlement(50, [c('new', 50, '2026-11-09'), c('old1', 20, '2026-11-01'), c('old2', 30, '2026-11-02')]).sort().join() === 'old1,old2');
ok('no exact combination: nothing is guessed', suggestSettlement(100, [c('a', 60, '2026-11-01'), c('b', 30, '2026-11-02')]) === null && suggestSettlement(0, [c('a', 10, 'x')]) === null && suggestSettlement(10, []) === null);
ok('an expense larger than the transfer is never part of the suggestion', suggestSettlement(25, [c('big', 500, '2026-11-01'), c('a', 25, '2026-11-02')]).join() === 'a');
ok('amounts are matched in cents without rounding errors (0.1 + 0.2 = 0.3)', suggestSettlement(0.3, [c('a', 0.1, '2026-11-01'), c('b', 0.2, '2026-11-02')]).sort().join() === 'a,b');

console.log(fail ? `\n${fail} FAILED` : '\nall budget stage 4 lib tests passed'); process.exit(fail ? 1 : 0);
