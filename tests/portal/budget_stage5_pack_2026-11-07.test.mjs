// Budget v2, Stage 5a (7 Nov 2026): the accountant pack — which items, the fingerprint, the sheets, file names — and the Excel writer.
import { monthRange, packHash, changedSince, packCandidates, packSummary, receiptName, packSheets, packFileName } from '../../portal/budget-pack.js';
import { buildXlsx, crc32, colName, sheetName } from '../../portal/xlsx-write.js';
import { normalizeItem } from '../../portal/budget-lib.js';
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
const f = [{ name: 'Invoice 12.PDF', filename: '1_Invoice_12.PDF', url: 'u' }];
const ex = (o) => normalizeItem({ kind: 'expense', amount: 10, date: '2026-10-10', categoryId: 'transport', docType: 'invoice', attachments: f, issuedToCompany: 'yes', supplierName: 'Flix', supplierTaxId: 'DE1', docNumber: '9', ...o });

// ── Period ──
ok('a month becomes its first and last day (leap years too); nonsense gives nothing', (() => { const a = monthRange('2026-10'), b = monthRange('2028-02'), c = monthRange('2026-13'); return a.from === '2026-10-01' && a.to === '2026-10-31' && b.to === '2028-02-29' && monthRange('2026-02').to === '2026-02-28' && !c.from && !monthRange('').from; })());

// ── Fingerprint ──
const a = ex({ id: 'a', sharedAt: '2026-10-31T10:00:00Z' }); a.sharedHash = packHash(a);
ok('the fingerprint is stable, and the same fields give the same value', packHash(a) === packHash({ ...a }) && /^[0-9a-f]{8}$/.test(packHash(a)));
ok('an item is not "changed" right after it is sent', changedSince(a) === false);
ok('amount, supplier, invoice number, our NIF answer, category, VAT, a split or a file change the fingerprint', [{ amount: 11 }, { supplierName: 'Other' }, { docNumber: '10' }, { issuedToCompany: 'no' }, { categoryId: 'meals' }, { vatAmount: 2 }, { lines: [{ weight: 1 }, { weight: 1 }] }, { attachments: [...f, { name: 'b.pdf' }] }, { usedBy: [{ key: 'andre', weight: 1 }] }].every((p) => changedSince({ ...a, ...p })));
ok('comments, tags and who shared it do not count as a change', !changedSince({ ...a, comments: 'new note', tags: ['x'], sharedBy: 'someone', changedSinceShared: false }));
ok('an item shared before fingerprints existed falls back to the stored flag; never shared is never "changed"', changedSince({ sharedAt: 'x', changedSinceShared: true }) && !changedSince({ sharedAt: 'x', changedSinceShared: false }) && !changedSince({ amount: 5 }) && !changedSince(null));

// ── Which items ──
const set = [
  ex({ id: 'n1', date: '2026-10-05', name: 'A' }),
  ex({ id: 'n2', date: '2026-10-20', name: 'B', docType: 'receipt' }),
  (() => { const s = ex({ id: 'sent', date: '2026-10-15', name: 'C', sharedAt: '2026-10-31T10:00:00Z' }); s.sharedHash = packHash(s); return s; })(),
  { ...ex({ id: 'chg', date: '2026-10-16', name: 'D', sharedAt: 'x' }), sharedHash: 'deadbeef' },
  ex({ id: 'out', date: '2026-11-02', name: 'E' }), ex({ id: 'arch', date: '2026-10-07', archived: true }),
  normalizeItem({ id: 'inc', kind: 'income', incomeType: 'capital_call', amount: 500, date: '2026-10-03' }),
  { type: 'revenue', id: 'old', amount: 9, date: '2026-10-04' },                                // old Revenue entry, not reviewed
  normalizeItem({ id: 'plan', kind: 'plan', amount: 100, date: '2026-10-04' }),
  ex({ id: 'nodate', date: '' }),
];
const cand = packCandidates(set, monthRange('2026-10'));
ok('default pack: unsent items in the month plus items changed after sending, oldest first; archived, plan, unreviewed old revenue, undated and other months are left out', cand.map((x) => x.item.id).join() === 'inc,n1,chg,n2');
ok('each item says whether it is new, changed since sent, or already sent', (() => { const m = Object.fromEntries(cand.map((x) => [x.item.id, x.state])); return m.n1 === 'new' && m.chg === 'changed' && m.inc === 'new'; })());
ok('"include already sent" brings the sent ones back', packCandidates(set, { ...monthRange('2026-10'), includeSent: true }).map((x) => x.item.id).includes('sent'));
ok('no period given keeps every date', packCandidates(set, {}).length >= 5);

// ── Summary ──
const sum = packSummary(cand);
ok('summary: counts, totals, files, VAT, how many have paperwork problems and how many changed', sum.expenses === 3 && sum.income === 1 && sum.expenseTotal === 30 && sum.incomeTotal === 500 && sum.files === 3 && sum.warnCount === 1 && sum.changed === 1 && sum.vatTotal === 0);

// ── File names ──
ok('receipt names: date_supplier_amount.ext, accents and odd characters cleaned, extension kept in lower case', receiptName({ date: '2026-10-05', supplierName: 'Café São João, Lda.', amount: 12.5 }, { name: 'scan.PDF' }, 0) === '2026-10-05_Cafe-Sao-Joao-Lda_12.50.pdf');
ok('receipt names: a second file of one item gets _2; identical names never collide; no supplier falls back to the item name', (() => { const u = new Set(); const n1 = receiptName({ date: 'd', supplierName: 'X', amount: 1 }, { name: 'a.jpg' }, 0, u), n2 = receiptName({ date: 'd', supplierName: 'X', amount: 1 }, { name: 'a.jpg' }, 0, u), n3 = receiptName({ date: 'd', supplierName: 'X', amount: 1 }, { name: 'b.png' }, 1, u); return n1 === 'd_X_1.00.jpg' && n2 === 'd_X_1.00-2.jpg' && n3 === 'd_X_1.00_2.png' && receiptName({ date: 'd', name: 'Taxi ride', amount: 3 }, { name: 'x' }, 0) === 'd_Taxi-ride_3.00.pdf'; })());

// ── Sheets ──
const ctx = { company: { companyName: 'Fund Lda', companyNif: '600084779', companyAddress: 'Rua X' }, createdBy: 'andre@x.test', createdAt: '2026-11-07T09:00:00Z', period: monthRange('2026-10'), catLabel: (i) => ({ transport: 'Transport', meals: 'Meals' }[i] || i), purLabel: (i) => i, personLabel: (k) => k, paidWithLabel: (i) => i.paidWith, countryName: (c) => c,
  accountName: () => 'Main', movements: [{ id: 'm1', accountId: 'a', posted: '2026-10-05', description: 'COMPRA X', amount: -10, balance: 90, status: 'linked', lineNo: 1 }, { id: 'm2', accountId: 'a', posted: '2026-11-05', description: 'LATER', amount: -1, balance: 89, status: 'new' }] };
const P = packSheets(cand, ctx);
const sheet = (n) => P.sheets.find((s) => s.name === n);
ok('the pack has the sheets Pack, Expenses, Money received, Bank lines, Missing documents and Files', P.sheets.map((s) => s.name).join() === 'Pack,Expenses,Money received,Bank lines,Missing documents,Files');
ok('Bank lines is left out when the person may not see bank data (no movements given)', !packSheets(cand, { ...ctx, movements: undefined }).sheets.some((s) => s.name === 'Bank lines'));
ok('Expenses: one row per expense with supplier, NIF, number, document, our NIF answer, category, total, VAT and paperwork status', (() => { const r = sheet('Expenses').rows.find((x) => x[8] === 'A'); return r[0] === '2026-10-05' && r[2] === 'Flix' && r[3] === 'DE1' && r[4] === '9' && r[6] === 'Invoice (fatura)' && r[7] === 'Yes' && r[9] === 'Transport' && r[11] === 10 && r[19] === 'Invoice OK'; })());
ok('every row has as many cells as there are columns, on every sheet', P.sheets.every((s) => s.rows.every((r) => r.length === s.columns.length)));
ok('Missing documents lists only the expenses with a paperwork problem, with what to ask for', (() => { const m = sheet('Missing documents'); return m.rows.length === 1 && m.rows[0][1] === 'B' && m.rows[0][4] === 'Receipt only' && /invoice/i.test(m.rows[0][5]); })());
ok('Money received lists the capital call; Bank lines keep only the period, with how each line was booked', sheet('Money received').rows.length === 1 && sheet('Money received').rows[0][1] === 'Capital call' && sheet('Bank lines').rows.length === 1 && sheet('Bank lines').rows[0][5] === 'Booked in the budget');
ok('the Pack sheet carries the period, company, totals and counts; Files maps each receipt to its name in the pack', (() => { const p = Object.fromEntries(sheet('Pack').rows.map((r) => [r[0], r[1]])); return p['Period'] === '2026-10-01 to 2026-10-31' && p['Company NIF'] === '600084779' && p['Expenses'] === 3 && p['Total expenses (EUR)'] === 30 && p['Money received lines'] === 1 && p['Receipt files'] === 3 && sheet('Files').rows.length === 3 && sheet('Files').rows[0][0].endsWith('.pdf'); })());
ok('counts and totals for the saved snapshot', P.counts.expenses === 3 && P.counts.files === 3 && P.counts.missing === 1 && P.totals.expenses === 30 && P.totals.income === 500);
ok('file name: organisation and month; a longer period shows both ends', packFileName('Douro Partners', monthRange('2026-10')) === 'Douro-Partners-accountant-pack-2026-10.xlsx' && packFileName('A', { from: '2026-06-01', to: '2026-10-31' }) === 'A-accountant-pack-2026-06-01_2026-10-31.xlsx');

// ── Excel writer ──
ok('column letters', colName(0) === 'A' && colName(25) === 'Z' && colName(26) === 'AA' && colName(701) === 'ZZ' && colName(702) === 'AAA');
ok('sheet names: bad characters removed, 31 characters at most, unique', (() => { const u = new Set(); return sheetName('A/B:C*?[x]', u) === 'A B C x' && sheetName('a b c x', u) === 'a b c x 2' && sheetName('x'.repeat(50)).length === 31 && sheetName('', new Set()) === 'Sheet'; })());
ok('CRC-32 of "123456789" is the standard check value CBF43926', crc32(new TextEncoder().encode('123456789')) === 0xCBF43926);
const bytes = buildXlsx(P.sheets);
const u16 = (o) => bytes[o] | (bytes[o + 1] << 8), u32 = (o) => (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
const eocd = bytes.length - 22, count = u16(eocd + 10), cdOff = u32(eocd + 16);
const entries = []; { let o = cdOff; for (let i = 0; i < count; i++) { const n = u16(o + 28), nm = new TextDecoder().decode(bytes.slice(o + 46, o + 46 + n)); const lo = u32(o + 42), size = u32(o + 24), crc = u32(o + 16); const ln = u16(lo + 26), le = u16(lo + 28); entries.push({ name: nm, data: bytes.slice(lo + 30 + ln + le, lo + 30 + ln + le + size), crc }); o += 46 + n + u16(o + 30) + u16(o + 32); } }
ok('the file is a zip with the workbook parts: content types, rels, workbook, styles and one sheet per sheet', bytes[0] === 0x50 && bytes[1] === 0x4b && u32(eocd) === 0x06054b50 && ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/styles.xml', 'xl/_rels/workbook.xml.rels'].every((n) => entries.some((e) => e.name === n)) && entries.filter((e) => e.name.startsWith('xl/worksheets/')).length === P.sheets.length);
ok('every entry\'s stored CRC matches its content', entries.every((e) => crc32(e.data) === e.crc));
const txt = (n) => new TextDecoder().decode(entries.find((e) => e.name === n).data);
ok('every part is balanced XML; text is escaped (&, <, quotes) and control characters are dropped', (() => { const x = buildXlsx([{ name: 'T', columns: [{ header: 'H & <b>' }], rows: [['say "hi" & <go>\u0007']] }]); const full = new TextDecoder().decode(x); const s = full.slice(full.indexOf('<worksheet'), full.indexOf('</worksheet>') + 12); const balanced = (t) => { const st = []; for (const m of t.matchAll(/<(\/?)([A-Za-z0-9:_]+)([^>]*?)(\/?)>/g)) { if (m[4]) continue; if (m[1]) { if (st.pop() !== m[2]) return false; } else st.push(m[2]); } return st.length === 0; }; return entries.every((e) => balanced(new TextDecoder().decode(e.data))) && s.includes('H &amp; &lt;b&gt;') && s.includes('say &quot;hi&quot; &amp; &lt;go&gt;') && !s.includes('\u0007'); })());
ok('numbers are stored as numbers (money and percentage styles), text as inline strings, header row frozen and filterable', /<c r="L2" s="2"><v>10<\/v><\/c>/.test(txt('xl/worksheets/sheet2.xml')) && /t="inlineStr"/.test(txt('xl/worksheets/sheet2.xml')) && /state="frozen"/.test(txt('xl/worksheets/sheet2.xml')) && /<autoFilter ref="A1:V4"\/>/.test(txt('xl/worksheets/sheet2.xml')));
ok('a text that starts with "=" is kept as text, never a formula', (() => { const x = new TextDecoder().decode(buildXlsx([{ name: 'T', columns: [{ header: 'H' }], rows: [['=SUM(A1:A9)']] }])); return /<is><t xml:space="preserve">=SUM\(A1:A9\)<\/t><\/is>/.test(x) && !/<f>/.test(x); })());
ok('an empty workbook still opens (one empty sheet)', buildXlsx([]).length > 500);

console.log(fail ? `\n${fail} FAILED` : '\nall budget stage 5a pack tests passed'); process.exit(fail ? 1 : 0);
