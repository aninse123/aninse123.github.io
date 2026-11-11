// Budget v2 (11 Nov 2026): the supporting document for money received (partner loan, capital call, VAT refund, supplier refund).
import { readFileSync } from 'node:fs';
import { docStatus, INCOME_DOC, incomeDocNeeded, normalizeItem } from '../../portal/budget-lib.js';
import { packSummary, packSheets } from '../../portal/budget-pack.js';
const v2 = readFileSync(new URL('../../portal/budget-v2.js', import.meta.url), 'utf8');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

const inc = (type, extra = {}) => normalizeItem({ id: 'x', kind: 'income', incomeType: type, amount: 1000, date: '2026-10-14', ...extra });
const file = [{ name: 'contract.pdf', filename: 'f1.pdf' }];

ok('four types need a document: capital call, partner loan, VAT refund, supplier refund; interest, partner reimbursement and other do not', ['capital_call', 'partner_loan', 'vat_refund', 'supplier_refund'].every(incomeDocNeeded) && !['interest', 'partner_reimbursement', 'other', '', undefined].some(incomeDocNeeded) && Object.keys(INCOME_DOC).length === 4);
ok('a partner loan with no file is "Document missing" (a warning that says what is needed); with a file it is "Document attached"', (() => { const a = docStatus(inc('partner_loan')), b = docStatus(inc('partner_loan', { attachments: file })); return a.code === 'incomeMissing' && a.level === 'warn' && /loan agreement/.test(a.need) && b.code === 'attached' && b.level === 'ok'; })());
ok('"No document needed" turns the warning off, with or without a reason', docStatus(inc('capital_call', { docWaived: true })).code === 'notRequired' && docStatus(inc('capital_call', { docWaived: 'bank statement is enough' })).level === 'na');
ok('interest and other money in never warn', docStatus(inc('interest')).code === 'notRequired' && docStatus(inc('other')).level === 'na' && docStatus(inc('partner_reimbursement')).level === 'na');
ok('expenses are judged exactly as before, and plan allocations are never judged', docStatus({ kind: 'expense', docType: 'none', categoryId: 'meals' }).code === 'noDocument' && docStatus({ kind: 'plan' }).code === 'notRequired');
ok('an old money-in item with no type is not judged', docStatus(inc('')).code === 'notRequired');

const sel = [{ item: inc('partner_loan', { name: 'Loan from António Carvalho', counterparty: 'ANTONIO MARIA OLIVEIRA B N' }), state: 'new' }, { item: inc('interest', { id: 'y' }), state: 'new' }];
ok('the pack summary counts money received without its document as an item to fix', packSummary(sel).warnCount === 1);
ok('the pack lists it on Missing documents with what to send, and shows a Document column on Money received', (() => {
  const sheets = packSheets(sel, { company: {}, period: { from: '2026-10-01', to: '2026-10-31' } }).sheets;
  const miss = sheets.find((s) => s.name === 'Missing documents'), got = sheets.find((s) => s.name === 'Money received');
  return miss.rows.length === 1 && miss.rows[0][4] === 'Document missing' && /loan agreement/.test(miss.rows[0][5]) && got.columns[got.columns.length - 1].header === 'Document' && got.rows[0][got.rows[0].length - 1] === 'Document missing';
})());

ok('the item form shows a "Supporting document" section for those money-in types only, with the warning and the "No document needed" tick; the invoice fields stay for expenses', /id="f-doctitle">Paperwork/.test(v2) && /id="f-invfields"/.test(v2) && /income && incomeDocNeeded\(\$\('f-income'\)\.value\)/.test(v2) && /'Supporting document'/.test(v2) && /incomeType: \$\('f-income'\)\.value/.test(v2));
ok('the reminder to ask for an invoice in the company name is only for expenses', /ds\.level === 'warn' && \$\('f-kind'\)\.value === 'expense'/.test(v2));
ok('the waived tick is saved for money received too', /docWaived: \(expense \|\| kind === 'income'\) && \$\('f-waived'\)\.checked/.test(v2));
ok('Overview and Inbox count money received without its document next to the expenses', /money-received item/.test(v2) && /\(i\.kind === 'expense' \|\| i\.kind === 'income'\) && !i\.archived && docStatus\(i\)\.level === 'warn'/.test(v2) && /Every item has its paperwork/.test(v2));

console.log(fail ? `\n${fail} FAILED` : '\nall money-in document tests passed'); process.exit(fail ? 1 : 0);
