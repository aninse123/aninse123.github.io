// Budget v2, Stage 1 (6 Nov 2026): the pure logic in portal/budget-lib.js — document status, legacy items, totals, tags, shares, IBAN.
import {
  docStatus, normalizeItem, overview, parseTags, tagTotals, splitShares,
  isValidIban, ibanStatus, formatIban, cardFromDescription, newListId, mergeLists, activeOnly,
  DEFAULT_CATEGORIES, DEFAULT_PURPOSES, INCOME_TYPES,
} from '../../portal/budget-lib.js';
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
const f = [{ name: 'a.pdf', url: 'u' }];
const full = { kind: 'expense', docType: 'invoice', attachments: f, issuedToCompany: 'yes', supplierName: 'Hotel X', supplierTaxId: 'ES B1234567', docNumber: 'F-1', categoryId: 'accommodation' };

// ── Document status (D10) ──
ok('invoice with file, our NIF, supplier, tax id and number = Invoice OK', docStatus(full).code === 'ok');
ok('a fatura-recibo and a recibo verde count as invoices', docStatus({ ...full, docType: 'invoice_receipt' }).code === 'ok' && docStatus({ ...full, docType: 'green_receipt' }).code === 'ok');
ok('NIF answer No or Unknown (or missing) = Invoice without our NIF', ['no', 'unknown', undefined].every((v) => docStatus({ ...full, issuedToCompany: v }).code === 'noNif'));
ok('invoice with our NIF but no number / supplier / tax id = details missing, naming what', (() => { const s = docStatus({ ...full, docNumber: '', supplierTaxId: ' ' }); return s.code === 'incomplete' && s.missing.join() === 'supplierTaxId,docNumber'; })());
ok('simplified invoice and receipt only = Receipt only', docStatus({ ...full, docType: 'simplified' }).code === 'receiptOnly' && docStatus({ ...full, docType: 'receipt' }).code === 'receiptOnly');
ok('no file attached = No document, even for an invoice', docStatus({ ...full, attachments: [] }).code === 'noDocument' && docStatus({ ...full, attachments: undefined }).code === 'noDocument');
ok('card slip, "no document yet" and an empty type = No document', ['card_slip', 'none', '', undefined].every((t) => docStatus({ ...full, docType: t }).code === 'noDocument'));
ok('bank & taxes, money received, plan lines and a waived item need no document', docStatus({ kind: 'expense', categoryId: 'bank-taxes' }).code === 'notRequired' && docStatus({ kind: 'income' }).code === 'notRequired' && docStatus({ kind: 'plan' }).code === 'notRequired' && docStatus({ ...full, attachments: [], docWaived: 'Cash tip' }).code === 'notRequired');
ok('every status has a label and a level (ok / warn / na)', ['ok', 'incomplete', 'noNif', 'receiptOnly', 'noDocument', 'notRequired'].every((c) => true) && docStatus(full).level === 'ok' && docStatus({}).level === 'warn' && docStatus({ kind: 'income' }).level === 'na');

// ── Legacy items ──
ok('a v1 cost becomes an expense; Living expenses → Team pay / salary, no review', (() => { const n = normalizeItem({ type: 'cost', category: 'Living expenses', amount: '100' }); return n.kind === 'expense' && n.categoryId === 'team-pay' && n.subtype === 'salary' && !n.needsReview && n.amount === 100 && n.legacy; })());
ok('Employer contributions → Team pay / social contributions', (() => { const n = normalizeItem({ type: 'cost', category: 'Employer contributions' }); return n.categoryId === 'team-pay' && n.subtype === 'social-contributions'; })());
ok('Operating expenses and Technology & office are flagged for review; Professional services is not', normalizeItem({ type: 'cost', category: 'Operating expenses' }).needsReview && normalizeItem({ type: 'cost', category: 'Technology & office' }).needsReview && !normalizeItem({ type: 'cost', category: 'Professional services' }).needsReview);
ok('an unknown old category falls back to Other and is flagged', (() => { const n = normalizeItem({ type: 'cost', category: 'Weird' }); return n.categoryId === 'other' && n.needsReview; })());
ok('a v1 revenue entry becomes money received "Other" waiting for review', (() => { const n = normalizeItem({ type: 'revenue', amount: 5 }); return n.kind === 'income' && n.incomeType === 'other' && n.needsReview && n.legacy; })());
ok('a saved v2 item is not legacy and keeps its own fields', (() => { const n = normalizeItem({ kind: 'income', incomeType: 'interest', amount: 3 }); return !n.legacy && n.incomeType === 'interest' && !n.needsReview; })());

// ── Totals ──
const mk = (o) => normalizeItem({ kind: 'expense', amount: 0, ...o });
ok('overview: capital, loans, interest; costs are expenses minus refunds and partner reimbursements; balance = received − costs', (() => {
  const o = overview([
    mk({ kind: 'income', incomeType: 'capital_call', amount: 1000 }), mk({ kind: 'income', incomeType: 'partner_loan', amount: 200 }),
    mk({ kind: 'income', incomeType: 'interest', amount: 1.5 }), mk({ amount: 300 }), mk({ amount: 100 }),
    mk({ kind: 'income', incomeType: 'supplier_refund', amount: 40 }), mk({ kind: 'income', incomeType: 'partner_reimbursement', amount: 10 }),
  ]);
  return o.capital === 1000 && o.loans === 200 && o.interest === 1.5 && o.received === 1201.5 && o.costs === 350 && o.balance === 851.5;
})());
ok('overview: plan lines are separate and give % of plan used; archived items are ignored', (() => {
  const o = overview([mk({ kind: 'plan', amount: 1000 }), mk({ amount: 250 }), mk({ amount: 999, archived: true })]);
  return o.plan === 1000 && o.pctOfPlan === 25 && o.costs === 250 && overview([]).pctOfPlan === null;
})());
ok('overview: old Revenue entries not yet reviewed are counted aside, not as money received', (() => { const o = overview([{ type: 'revenue', amount: 500 }, { type: 'cost', category: 'Other', amount: 20 }]); return o.unreviewed === 1 && o.received === 0 && o.costs === 20; })());
ok('overview: paid personally and not reimbursed adds up per partner', (() => {
  const o = overview([mk({ amount: 30, paidPersonallyBy: 'andre' }), mk({ amount: 20, paidPersonallyBy: 'andre' }), mk({ amount: 15, paidPersonallyBy: 'antonio', reimbursement: { status: 'reimbursed' } }), mk({ amount: 99 })]);
  return o.owedToPartners.andre === 50 && !o.owedToPartners.antonio;
})());
ok('every money-received type is listed once, and refunds / partner reimbursements are the ones that lower costs', INCOME_TYPES.length === 6 && new Set(INCOME_TYPES.map((t) => t.id)).size === 6 && INCOME_TYPES.filter((t) => t.reducesCosts).map((t) => t.id).join() === 'supplier_refund,partner_reimbursement');

// ── Tags ──
ok('tags: split on comma / semicolon / new line, trimmed, duplicates ignored whatever the case', parseTags(' Spain trip, spain TRIP ;Frutas Mangas field visit\n, ').join('|') === 'Spain trip|Frutas Mangas field visit');
ok('tags: capped at 20 of 40 characters', parseTags(Array.from({ length: 30 }, (_, i) => 't' + i)).length === 20 && parseTags('x'.repeat(100))[0].length === 40);
ok('tag totals: expenses add up, refunds with the same tag subtract, untagged and archived are left out, largest first', (() => {
  const t = tagTotals([mk({ amount: 100, tags: ['Spain trip'] }), mk({ amount: 50, tags: ['spain trip', 'Fuel'] }), mk({ kind: 'income', incomeType: 'supplier_refund', amount: 20, tags: ['Spain trip'] }), mk({ amount: 7 }), mk({ amount: 500, tags: ['Spain trip'], archived: true }), mk({ kind: 'income', incomeType: 'capital_call', amount: 900, tags: ['Spain trip'] })]);
  return t.length === 2 && t[0].tag === 'Spain trip' && t[0].total === 130 && t[0].count === 3 && t[1].tag === 'Fuel' && t[1].total === 50;
})());

// ── Shares ──
ok('shares: equal by default, 100 / 3 gives 33.34 / 33.33 / 33.33 and always adds up', (() => { const s = splitShares(100, [{ key: 'a' }, { key: 'b' }, { key: 'c' }]); return s.map((x) => x.amount).join() === '33.34,33.33,33.33' && Math.round(s.reduce((a, b) => a + b.amount, 0) * 100) === 10000; })());
ok('shares: 70 / 30 and 2:1 by weight', splitShares(200, [{ key: 'andre', weight: 70 }, { key: 'antonio', weight: 30 }]).map((x) => x.amount).join() === '140,60' && splitShares(120, [{ key: 'x', weight: 2 }, { key: 'y', weight: 1 }]).map((x) => x.amount).join() === '80,40');
ok('shares: one person gets all; nobody gives an empty list; zero weights count as equal', splitShares(9.99, [{ key: 'a' }])[0].amount === 9.99 && splitShares(5, []).length === 0 && splitShares(10, [{ key: 'a', weight: 0 }, { key: 'b', weight: 0 }]).map((x) => x.amount).join() === '5,5');
ok('shares: sums stay exact over many awkward totals', (() => { for (let c = 1; c < 400; c++) { const s = splitShares(c / 100, [{ key: 'a', weight: 3 }, { key: 'b', weight: 5 }, { key: 'c', weight: 7 }]); if (Math.round(s.reduce((a, b) => a + b.amount, 0) * 100) !== c) return false; } return true; })());

// ── IBAN and cards ──
ok('IBAN: the standard Portuguese and British examples pass, with spaces or lower case', isValidIban('PT50 0002 0123 1234 5678 9015 4') && isValidIban('gb82west12345698765432'));
ok('IBAN: one wrong digit, a wrong length for the country, or rubbish fails', !isValidIban('PT50 0002 0123 1234 5678 9015 5') && !isValidIban('PT50 0002 0123 1234 5678 9015') && !isValidIban('hello') && !isValidIban(''));
ok('IBAN: status and display grouping', ibanStatus('') === 'empty' && ibanStatus('PT50000201231234567890154') === 'ok' && ibanStatus('PT50') === 'bad' && formatIban('pt50000201231234567890154') === 'PT50 0002 0123 1234 5678 9015 4');
ok('card number in a bank line is read from "*0435"', cardFromDescription('COMPRA *0435 CONTINENTE') === '0435' && cardFromDescription('COMPRA ESTRANG*0435 FLIX') === '0435' && cardFromDescription('TRF CRED SEPA+') === '');

// ── Lists ──
ok('default lists: 14 categories, 7 purposes, unique ids, Due diligence & deal and Team pay present', DEFAULT_CATEGORIES.length === 14 && DEFAULT_PURPOSES.length === 7 && new Set(DEFAULT_CATEGORIES.map((c) => c.id)).size === 14 && DEFAULT_PURPOSES.some((p) => p.id === 'due-diligence-deal') && DEFAULT_CATEGORIES[0].id === 'team-pay');
ok('lists: stored lists win, archived values are kept but only offered when already used', (() => {
  const l = mergeLists([{ id: 'a', label: 'A' }, { id: 'b', label: 'B', archived: true }], DEFAULT_CATEGORIES);
  return l.length === 2 && activeOnly(l).length === 1 && activeOnly(l, 'b').length === 2 && mergeLists([], DEFAULT_CATEGORIES).length === 14;
})());
ok('a new list value gets a readable unique id (accents removed)', newListId('Saúde & Bem-estar', []) === 'saude-bem-estar' && newListId('Other', DEFAULT_CATEGORIES) === 'other-2' && newListId('!!!', []) === 'item');

console.log(fail ? `\n${fail} FAILED` : '\nall budget stage 1 lib tests passed'); process.exit(fail ? 1 : 0);
