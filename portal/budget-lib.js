// Budget v2 — pure logic (plan "Budget v2 - Plan.md", Stage 1). No Firebase, no DOM:
// everything here is exercised in Node (tests/portal/budget_stage1_*.test.mjs) and used by portal/budget-v2.js.

// ── Lists (editable in settings, step 1.3; these are the defaults) ──
// A value is { id, label, archived? }. Items store the id, never the label, so a rename never breaks old items.
export const DEFAULT_CATEGORIES = [
  ['team-pay', 'Team pay', 'Salary, searcher services invoiced through their own company, social contributions'],
  ['professional-services', 'Professional services', 'Accounting, legal, tax, advisors'],
  ['transport', 'Transport', 'Train, bus, taxi, fuel, tolls, parking, car rental'],
  ['accommodation', 'Accommodation', 'Hotels and rentals'],
  ['meals', 'Meals', 'Food and drink'],
  ['software-data', 'Software & data', 'Tools, subscriptions, cloud, databases, domains'],
  ['office-equipment', 'Office & equipment', 'Hardware, supplies, coworking'],
  ['marketing-outreach', 'Marketing & outreach', 'Letters, postage, printing, mailing'],
  ['events-conferences', 'Events & conferences', 'Conference fees and event costs'],
  ['bank-taxes', 'Bank & taxes', 'Bank fees, stamp duty, interest paid'],
  ['insurance', 'Insurance', ''],
  ['training', 'Training', ''],
  ['telecom-internet', 'Telecom & internet', 'Phones and internet'],
  ['other', 'Other', ''],
].map(([id, label, hint]) => ({ id, label, hint }));

export const DEFAULT_PURPOSES = [
  ['field-visit', 'Field visit', 'Going to see a target company'],
  ['sourcing-outreach', 'Sourcing & outreach', 'Finding and contacting companies'],
  ['investor-relations', 'Investor relations', 'Fundraising and keeping investors informed'],
  ['networking-events', 'Networking & events', 'Conferences, meetings, introductions'],
  ['admin-compliance', 'Admin & compliance', 'Accounting, legal, bank, company set-up'],
  ['overhead', 'Overhead', 'Office and tools that keep the search running'],
  ['due-diligence-deal', 'Due diligence & deal', 'After a letter of intent: costs of one deal'],
].map(([id, label, hint]) => ({ id, label, hint }));

export const TEAM_PAY_SUBTYPES = [
  { id: 'salary', label: 'Salary' },
  { id: 'searcher-services', label: 'Searcher services (invoiced by their own company)' },
  { id: 'social-contributions', label: 'Social contributions' },
];

// ── Kinds and money received (step 1.4) ──
export const KINDS = [
  { id: 'expense', label: 'Expense' },
  { id: 'income', label: 'Money received' },
  { id: 'plan', label: 'Plan allocation' },
];
export const INCOME_TYPES = [
  { id: 'capital_call', label: 'Capital call', hint: 'Money an investor paid in', reducesCosts: false },
  { id: 'partner_loan', label: 'Partner loan', hint: 'A partner lent money to the company; it has to be paid back', reducesCosts: false },
  { id: 'interest', label: 'Interest received', hint: 'Interest paid to us by the bank', reducesCosts: false },
  { id: 'supplier_refund', label: 'Supplier refund', hint: 'A supplier gave money back; it lowers costs', reducesCosts: true },
  { id: 'partner_reimbursement', label: 'Partner reimbursement', hint: 'A partner paid back a private use of company money; it lowers costs', reducesCosts: true },
  { id: 'other', label: 'Other', hint: '', reducesCosts: false },
];
const INCOME_BY_ID = Object.fromEntries(INCOME_TYPES.map((t) => [t.id, t]));

// ── Documents (step 1.6) ──
export const DOC_TYPES = [
  { id: 'invoice', label: 'Invoice (fatura)', invoice: true },
  { id: 'invoice_receipt', label: 'Invoice-receipt (fatura-recibo)', invoice: true },
  { id: 'green_receipt', label: 'Green receipt (recibo verde)', invoice: true },
  { id: 'credit_note', label: 'Credit note', invoice: true },
  { id: 'simplified', label: 'Simplified invoice', invoice: false },
  { id: 'receipt', label: 'Receipt only', invoice: false },
  { id: 'card_slip', label: 'Card slip or bank line only', invoice: false },
  { id: 'none', label: 'No document yet', invoice: false },
];
const DOC_BY_ID = Object.fromEntries(DOC_TYPES.map((t) => [t.id, t]));
export const NO_DOC_CATEGORIES = new Set(['bank-taxes']);

export const DOC_STATUS = {
  ok: { label: 'Invoice OK', level: 'ok' },
  incomplete: { label: 'Invoice details missing', level: 'warn' },
  noNif: { label: 'Invoice without our NIF', level: 'warn' },
  receiptOnly: { label: 'Receipt only', level: 'warn' },
  noDocument: { label: 'No document', level: 'warn' },
  notRequired: { label: 'Not required', level: 'na' },
};

// The status of one item's paperwork, worked out from its own fields (D10). Never blocks anything.
export function docStatus(item) {
  const it = item || {};
  const kind = it.kind || 'expense';
  if (kind !== 'expense') return { code: 'notRequired', ...DOC_STATUS.notRequired, missing: [] };
  if (it.docWaived || NO_DOC_CATEGORIES.has(it.categoryId)) return { code: 'notRequired', ...DOC_STATUS.notRequired, missing: [] };
  const t = DOC_BY_ID[it.docType];
  const hasFile = Array.isArray(it.attachments) && it.attachments.length > 0;
  if (!t || t.id === 'none' || t.id === 'card_slip' || !hasFile) {
    return { code: 'noDocument', ...DOC_STATUS.noDocument, missing: !hasFile ? ['file'] : [] };
  }
  if (!t.invoice) return { code: 'receiptOnly', ...DOC_STATUS.receiptOnly, missing: [] };
  if (it.issuedToCompany !== 'yes') return { code: 'noNif', ...DOC_STATUS.noNif, missing: ['issuedToCompany'] };
  const missing = [];
  if (!String(it.supplierName || '').trim()) missing.push('supplierName');
  if (!String(it.supplierTaxId || '').trim()) missing.push('supplierTaxId');
  if (!String(it.docNumber || '').trim()) missing.push('docNumber');
  if (missing.length) return { code: 'incomplete', ...DOC_STATUS.incomplete, missing };
  return { code: 'ok', ...DOC_STATUS.ok, missing: [] };
}

// ── Legacy items (v1 had type cost|revenue and 7 categories) ──
export const LEGACY_CATEGORY = {
  'Professional services': { id: 'professional-services', review: false },
  'Technology & office': { id: 'software-data', review: true },
  'Operating expenses': { id: 'other', review: true },
  'Living expenses': { id: 'team-pay', review: false, subtype: 'salary' },
  'Employer contributions': { id: 'team-pay', review: false, subtype: 'social-contributions' },
  'Contingency': { id: 'other', review: true },
  'Other': { id: 'other', review: false },
};

// A stored item as v2 sees it. v1 items are read through here and are not rewritten until someone saves them.
export function normalizeItem(raw) {
  const r = raw || {};
  const legacy = !r.kind;
  let kind = r.kind || (r.type === 'revenue' ? 'income' : 'expense');
  const out = {
    ...r,
    legacy,
    kind,
    amount: Number(r.amount) || 0,
    tags: Array.isArray(r.tags) ? r.tags : [],
    usedBy: Array.isArray(r.usedBy) ? r.usedBy : [],
    attachments: Array.isArray(r.attachments) ? r.attachments : [],
    archived: !!r.archived,
    needsReview: false,
  };
  if (legacy) {
    const m = LEGACY_CATEGORY[r.category];
    if (kind === 'expense') {
      out.categoryId = m ? m.id : 'other';
      if (m?.subtype) out.subtype = m.subtype;
      out.needsReview = !m || m.review;
    } else {
      out.incomeType = 'other';
      out.needsReview = true; // each old Revenue entry is reviewed: Interest, Plan allocation or Archive
    }
  }
  if (out.kind === 'income' && !out.incomeType) out.incomeType = 'other';
  return out;
}

// ── Totals (Overview) ──
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export function overview(items) {
  const t = { capital: 0, loans: 0, interest: 0, otherIn: 0, expenses: 0, reducers: 0, plan: 0, unreviewed: 0, owedToPartners: {} };
  for (const raw of items || []) {
    const it = raw.legacy === undefined ? normalizeItem(raw) : raw;
    if (it.archived) continue;
    if (it.needsReview && it.legacy && it.kind === 'income') { t.unreviewed++; continue; }
    const a = it.amount;
    if (it.kind === 'expense') {
      t.expenses += a;
      if (it.paidPersonallyBy && it.reimbursement?.status !== 'reimbursed') {
        t.owedToPartners[it.paidPersonallyBy] = round2((t.owedToPartners[it.paidPersonallyBy] || 0) + a);
      }
    } else if (it.kind === 'plan') t.plan += a;
    else if (it.kind === 'income') {
      const ty = INCOME_BY_ID[it.incomeType] || INCOME_BY_ID.other;
      if (ty.reducesCosts) t.reducers += a;
      else if (ty.id === 'capital_call') t.capital += a;
      else if (ty.id === 'partner_loan') t.loans += a;
      else if (ty.id === 'interest') t.interest += a;
      else t.otherIn += a;
    }
  }
  const received = t.capital + t.loans + t.interest + t.otherIn;
  const costs = t.expenses - t.reducers;
  return {
    capital: round2(t.capital), loans: round2(t.loans), interest: round2(t.interest), otherIn: round2(t.otherIn),
    received: round2(received), costs: round2(costs), balance: round2(received - costs),
    plan: round2(t.plan), pctOfPlan: t.plan > 0 ? Math.min(999, (costs / t.plan) * 100) : null,
    unreviewed: t.unreviewed, owedToPartners: t.owedToPartners,
  };
}

// ── Tags (step 1.7) ──
// "Spain trip, frutas mangas" → ['Spain trip', 'frutas mangas']; case-insensitive duplicates dropped, first spelling kept.
export function parseTags(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(/[,;\n]/);
  const seen = new Set(), out = [];
  for (const t of list) {
    const v = String(t).replace(/\s+/g, ' ').trim().slice(0, 40);
    if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
  }
  return out.slice(0, 20);
}
// Cost per tag (expenses only, net of refunds carrying the same tag), most expensive first.
export function tagTotals(items) {
  const m = new Map();
  for (const raw of items || []) {
    const it = raw.legacy === undefined ? normalizeItem(raw) : raw;
    if (it.archived || !it.tags.length) continue;
    let sign = 0;
    if (it.kind === 'expense') sign = 1;
    else if (it.kind === 'income' && INCOME_BY_ID[it.incomeType]?.reducesCosts) sign = -1;
    if (!sign) continue;
    for (const tag of it.tags) {
      const k = tag.toLowerCase();
      const cur = m.get(k) || { tag, total: 0, count: 0 };
      cur.total = round2(cur.total + sign * it.amount); cur.count++;
      m.set(k, cur);
    }
  }
  return [...m.values()].sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag));
}

// ── Shares (steps 1.5 / 3.2): who used it, with weights ──
// shares = [{ key, weight }]; weight defaults to 1. Cents are shared by largest remainder, so the parts always add up.
export function splitShares(total, shares) {
  const cents = Math.round((Number(total) || 0) * 100);
  const list = (shares || []).filter((s) => s && s.key);
  if (!list.length) return [];
  const w = list.map((s) => (Number(s.weight) > 0 ? Number(s.weight) : 0));
  const sum = w.reduce((a, b) => a + b, 0) || list.length;
  const wts = sum === 0 || w.every((x) => x === 0) ? list.map(() => 1) : w;
  const wsum = wts.reduce((a, b) => a + b, 0);
  const raw = wts.map((x) => (cents * x) / wsum);
  const floor = raw.map(Math.floor);
  let left = cents - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - floor[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k++, left--) floor[order[k % order.length][1]]++;
  return list.map((s, i) => ({ key: s.key, amount: floor[i] / 100 }));
}

// ── IBAN (step 1.2) ──
const IBAN_LEN = { PT: 25, ES: 24, FR: 27, DE: 22, GB: 22, IE: 22, NL: 18, BE: 16, IT: 27, LU: 20, CH: 21, AT: 20 };
export const cleanIban = (v) => String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase();
export const formatIban = (v) => cleanIban(v).replace(/(.{4})/g, '$1 ').trim();
// Format, known length for the country, and the two check digits (mod 97).
export function isValidIban(v) {
  const s = cleanIban(v);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const want = IBAN_LEN[s.slice(0, 2)];
  if (want && s.length !== want) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const d = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const x of d) rem = (rem * 10 + Number(x)) % 97;
  }
  return rem === 1;
}
export function ibanStatus(v) {
  const s = cleanIban(v);
  if (!s) return 'empty';
  return isValidIban(s) ? 'ok' : 'bad';
}

// ── Cards and accounts ──
export const last4 = (v) => String(v || '').replace(/\D/g, '').slice(-4);
// "COMPRA *0435 CONTINENTE" → "0435" (used by the bank import later; the card record only stores the last four).
export function cardFromDescription(desc) {
  const m = /\*(\d{4})\b/.exec(String(desc || ''));
  return m ? m[1] : '';
}

// ── Small helpers ──
export const eur2 = (n) => round2(n);
export function labelOf(list, id, fallback = '—') {
  const f = (list || []).find((x) => x.id === id);
  return f ? f.label : (id ? String(id) : fallback);
}
// The lists stored in settings, or the defaults. Archived values stay known (old items keep their label) but are not offered for new items.
export function mergeLists(stored, defaults) {
  const base = Array.isArray(stored) && stored.length ? stored : defaults;
  return base.map((x) => ({ id: x.id, label: x.label, hint: x.hint || '', archived: !!x.archived }));
}
export const activeOnly = (list, keep) => (list || []).filter((x) => !x.archived || x.id === keep);
export function newListId(label, existing) {
  const base = String(label || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
  const taken = new Set((existing || []).map((x) => x.id));
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}
