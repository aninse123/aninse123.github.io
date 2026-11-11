// Budget v2 — the accountant pack, pure logic (plan "Budget v2 - Plan.md", Stage 5a). No Firebase, no DOM:
// tested in Node (tests/portal/budget_stage5_*.test.mjs) and used by portal/budget-v2.js.
import { docStatus, DOC_TYPES, INCOME_TYPES, KINDS, labelOf, itemLines, normalizeItem } from './budget-lib.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ── Period ──
export function monthRange(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return { from: '', to: '' };
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}` };
}

// ── Has an item changed since it was sent? ──
// The fingerprint covers what the accountant sees; a comment or a tag does not count. Stored on the item when it is shared.
export const PACK_FIELDS = ['kind', 'name', 'amount', 'date', 'invoiceDate', 'categoryId', 'subtype', 'purposeId', 'supplierName', 'supplierTaxId', 'docType', 'docNumber', 'atcud', 'issuedToCompany', 'country', 'vatRate', 'vatAmount', 'vatDeductible', 'currency', 'incomeType', 'counterparty', 'investorId', 'partnerKey', 'paidWith', 'paidPersonallyBy', 'docWaived'];
const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
export function packHash(item) {
  const it = item || {}, o = {};
  PACK_FIELDS.forEach((k) => { o[k] = it[k] === undefined ? null : it[k]; });
  o.lines = Array.isArray(it.lines) ? it.lines.map((l) => [l.weight ?? 1, l.categoryId || '', l.purposeId || '', l.visitId || '']) : [];
  o.usedBy = Array.isArray(it.usedBy) ? it.usedBy.map((u) => [u.key, u.weight ?? 1]) : [];
  o.files = (Array.isArray(it.attachments) ? it.attachments : []).map((a) => a.filename || a.name || '').join('|');
  return fnv(JSON.stringify(o));
}
export function changedSince(item) {
  return !!item && !!item.sharedAt && (item.sharedHash ? packHash(item) !== item.sharedHash : !!item.changedSinceShared);
}

// ── Which items go in a pack ──
// Expenses and money received, not archived, dated inside the period, not an old Revenue entry still waiting for review. By default only
// what has not been sent, plus what changed after it was sent; "include already sent" brings back the rest.
export function packCandidates(items, { from = '', to = '', includeSent = false } = {}) {
  const out = [];
  for (const raw of items || []) {
    const it = raw.legacy === undefined ? normalizeItem(raw) : raw;
    if (it.archived || (it.kind !== 'expense' && it.kind !== 'income')) continue;
    if (it.legacy && it.needsReview && it.kind === 'income') continue;
    if (!it.date || (from && it.date < from) || (to && it.date > to)) continue;
    const sent = !!it.sharedAt, changed = changedSince(it);
    if (sent && !changed && !includeSent) continue;
    out.push({ item: it, state: !sent ? 'new' : changed ? 'changed' : 'sent' });
  }
  return out.sort((a, b) => String(a.item.date).localeCompare(String(b.item.date)) || String(a.item.name || '').localeCompare(String(b.item.name || '')));
}

// What the person sees before creating the pack.
export function packSummary(selected) {
  const exp = selected.filter((s) => s.item.kind === 'expense'), inc = selected.filter((s) => s.item.kind === 'income');
  const warn = selected.filter((s) => (s.item.kind === 'expense' || s.item.kind === 'income') && docStatus(s.item).level === 'warn');
  return {
    expenses: exp.length, income: inc.length, files: selected.reduce((n, s) => n + (s.item.attachments || []).length, 0),
    expenseTotal: round2(exp.reduce((x, s) => x + s.item.amount, 0)), incomeTotal: round2(inc.reduce((x, s) => x + s.item.amount, 0)),
    vatTotal: round2(exp.reduce((x, s) => x + (Number(s.item.vatAmount) > 0 ? Number(s.item.vatAmount) : 0), 0)),
    warnCount: warn.length, warn,
    changed: selected.filter((s) => s.state === 'changed').length,
  };
}

// ── Names of the receipt files inside the pack: date_supplier_amount.ext ──
const deburr = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
export function receiptName(item, attachment, index, used = new Set()) {
  const who = deburr(item.supplierName || item.name || item.counterparty || 'item').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';
  const ext = (/\.([A-Za-z0-9]{2,5})$/.exec(attachment?.name || attachment?.filename || '') || [, 'pdf'])[1].toLowerCase();
  const amt = Math.abs(Number(item.amount) || 0).toFixed(2);
  const base = `${item.date || 'undated'}_${who}_${amt}${index > 0 ? '_' + (index + 1) : ''}`;
  let name = `${base}.${ext}`, k = 2;
  while (used.has(name.toLowerCase())) name = `${base}-${k++}.${ext}`;
  used.add(name.toLowerCase());
  return name;
}

// What to ask the supplier for, by paperwork status.
export const FIX_HINT = {
  noDocument: 'Send the invoice (PDF or photo).',
  receiptOnly: 'Ask the supplier for an invoice with the company name and NIF.',
  noNif: 'The invoice must show the company NIF: ask the supplier to reissue it.',
  incomplete: 'The invoice details (supplier, NIF or VAT ID, number) are not filled in yet.',
};

// ── The sheets ──
// ctx = { company:{companyName,companyNif,companyAddress}, createdBy, createdAt, catLabel(id), purLabel(id), personLabel(key), paidWithLabel(item),
//         countryName(code), accountName(id), movements:[], period:{from,to} }
export function packSheets(selected, ctx) {
  const c = ctx || {};
  const exp = selected.filter((s) => s.item.kind === 'expense').map((s) => s.item);
  const inc = selected.filter((s) => s.item.kind === 'income').map((s) => s.item);
  const used = new Set(), files = [];
  const fileNames = (it) => (it.attachments || []).map((a, i) => { const n = receiptName(it, a, i, used); files.push({ item: it, original: a.name || '', name: n, storagePath: a.filename ? `budget/${a.filename}` : '' }); return n; });
  const cat = (it) => (Array.isArray(it.lines) && it.lines.length > 1 ? `Split (${it.lines.length} lines)` : (c.catLabel ? c.catLabel(it.categoryId) : it.categoryId) || '');
  const purpose = (it) => (Array.isArray(it.lines) && it.lines.length > 1 ? itemLines(it).map((l) => (c.purLabel ? c.purLabel(l.purposeId) : l.purposeId)).filter(Boolean).join(' / ') : (c.purLabel ? c.purLabel(it.purposeId) : it.purposeId) || '');
  const expenses = {
    name: 'Expenses',
    columns: [
      { header: 'Payment date', width: 12 }, { header: 'Invoice date', width: 12 }, { header: 'Supplier', width: 26 }, { header: 'Supplier NIF / VAT ID', width: 18 },
      { header: 'Invoice no.', width: 14 }, { header: 'ATCUD', width: 14 }, { header: 'Document', width: 18 }, { header: 'Invoice shows company NIF', width: 14 },
      { header: 'Description', width: 30 }, { header: 'Category', width: 20 }, { header: 'Purpose', width: 20 },
      { header: 'Total (EUR)', width: 12, fmt: 'money' }, { header: 'VAT %', width: 8, fmt: 'pct' }, { header: 'VAT (EUR)', width: 11, fmt: 'money' }, { header: 'VAT deductible', width: 14 },
      { header: 'Country', width: 12 }, { header: 'Currency', width: 9 }, { header: 'Paid with', width: 20 }, { header: 'Paid personally by', width: 16 },
      { header: 'Paperwork', width: 22 }, { header: 'Files in the pack', width: 40 }, { header: 'Comments', width: 30, fmt: 'wrap' },
    ],
    rows: exp.map((it) => [
      it.date, it.invoiceDate, it.supplierName, it.supplierTaxId, it.docNumber, it.atcud, labelOf(DOC_TYPES, it.docType, ''),
      it.issuedToCompany === 'yes' ? 'Yes' : it.issuedToCompany === 'no' ? 'No' : 'Unknown', it.name, cat(it), purpose(it),
      round2(it.amount), it.vatRate == null || it.vatRate === '' ? null : Number(it.vatRate), Number(it.vatAmount) > 0 ? round2(it.vatAmount) : null,
      it.vatDeductible === 'yes' ? 'Yes' : it.vatDeductible === 'no' ? 'No' : 'Ask accountant',
      c.countryName ? c.countryName(it.country) : it.country, it.currency && it.currency !== 'EUR' ? it.currency : 'EUR',
      c.paidWithLabel ? c.paidWithLabel(it) : it.paidWith, it.paidPersonallyBy ? (c.personLabel ? c.personLabel(it.paidPersonallyBy) : it.paidPersonallyBy) : '',
      docStatus(it).label, fileNames(it).join('\n'), it.comments,
    ]),
  };
  const received = {
    name: 'Money received',
    columns: [{ header: 'Date', width: 12 }, { header: 'Type', width: 22 }, { header: 'From', width: 32 }, { header: 'Description', width: 30 }, { header: 'Amount (EUR)', width: 14, fmt: 'money' }, { header: 'Files in the pack', width: 40 }, { header: 'Document', width: 22 }],
    rows: inc.map((it) => [it.date, labelOf(INCOME_TYPES, it.incomeType, ''), it.counterparty || it.investorName || (it.partnerKey && c.personLabel ? c.personLabel(it.partnerKey) : ''), it.name, round2(it.amount), fileNames(it).join('\n'), docStatus(it).label]),
  };
  const mv = (c.movements || []).filter((m) => (!c.period?.from || m.posted >= c.period.from) && (!c.period?.to || m.posted <= c.period.to)).sort((a, b) => String(a.posted).localeCompare(String(b.posted)) || (a.lineNo || 0) - (b.lineNo || 0));
  const bank = {
    name: 'Bank lines',
    columns: [{ header: 'Date', width: 12 }, { header: 'Account', width: 20 }, { header: 'Description (as in the bank file)', width: 48 }, { header: 'Amount (EUR)', width: 14, fmt: 'money' }, { header: 'Balance after (EUR)', width: 16, fmt: 'money' }, { header: 'Booked as', width: 26 }],
    rows: mv.map((m) => [m.posted, c.accountName ? c.accountName(m.accountId) : '', m.description, round2(m.amount), round2(m.balance),
      m.status === 'linked' ? 'Booked in the budget' : m.status === 'settled' ? (m.settlementKind === 'loan' ? 'Partner loan repaid' : 'Repays a partner') : m.status === 'settlement' ? 'Transfer to a partner' : m.status === 'ignored' ? 'Ignored (own transfer)' : 'Not booked yet']),
  };
  const missing = {
    name: 'Missing documents',
    columns: [{ header: 'Date', width: 12 }, { header: 'Item', width: 30 }, { header: 'Supplier', width: 26 }, { header: 'Amount (EUR)', width: 14, fmt: 'money' }, { header: 'Problem', width: 26 }, { header: 'What to do', width: 60, fmt: 'wrap' }],
    rows: [...exp, ...inc].filter((it) => docStatus(it).level === 'warn').map((it) => { const d = docStatus(it); return [it.date, it.name, it.kind === 'income' ? (it.counterparty || it.investorName || '') : it.supplierName, round2(it.amount), d.label, d.code === 'incomeMissing' ? `Send the ${d.need}.` : FIX_HINT[d.code] || '']; }),
  };
  const totalExp = round2(exp.reduce((x, i) => x + i.amount, 0)), totalInc = round2(inc.reduce((x, i) => x + i.amount, 0));
  const vat = round2(exp.reduce((x, i) => x + (Number(i.vatAmount) > 0 ? Number(i.vatAmount) : 0), 0));
  const co = c.company || {};
  const manifest = {
    name: 'Pack',
    columns: [{ header: 'Item', width: 30 }, { header: 'Value', width: 60, fmt: 'wrap' }],
    rows: [
      ['Period', `${c.period?.from || ''} to ${c.period?.to || ''}`], ['Created on', String(c.createdAt || '').slice(0, 10)], ['Created by', c.createdBy || ''],
      ['Company', co.companyName || ''], ['Company NIF', co.companyNif || ''], ['Company address', co.companyAddress || ''],
      ['Expenses', exp.length], ['Total expenses (EUR)', totalExp], ['VAT on those expenses (EUR)', vat],
      ['Money received lines', inc.length], ['Total money received (EUR)', totalInc], ['Bank lines in the period', mv.length],
      ['Receipt files', files.length], ['Expenses with missing or wrong paperwork', missing.rows.length],
    ],
  };
  const fileSheet = {
    name: 'Files',
    columns: [{ header: 'Name in the pack', width: 52 }, { header: 'Original name', width: 36 }, { header: 'Item', width: 30 }, { header: 'Date', width: 12 }, { header: 'Amount (EUR)', width: 14, fmt: 'money' }],
    rows: files.map((f) => [f.name, f.original, f.item.name, f.item.date, round2(f.item.amount)]),
  };
  return { sheets: [manifest, expenses, received, ...(c.movements ? [bank] : []), missing, fileSheet], files, counts: { expenses: exp.length, income: inc.length, bank: mv.length, files: files.length, missing: missing.rows.length }, totals: { expenses: totalExp, income: totalInc, vat } };
}

export function packFileName(orgName, period) {
  const org = deburr(orgName || 'Budget').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'Budget';
  const when = period?.from && period?.to && period.from.slice(0, 7) === period.to.slice(0, 7) ? period.from.slice(0, 7) : `${period?.from || 'start'}_${period?.to || 'end'}`;
  return `${org}-accountant-pack-${when}.xlsx`;
}
