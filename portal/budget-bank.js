// Budget v2 — bank file import, pure logic (plan "Budget v2 - Plan.md", Stage 2). No Firebase, no DOM:
// tested in Node (tests/portal/budget_stage2_bank_*.test.mjs) and used by portal/budget-v2.js.
//
// The file is Santander's "Tabulado Excel" (semicolon-separated) or "Tabulado (Folha de Cálculo)" (tab-separated):
// no header, 11 columns —
//   0 account no · 1 posting date dd-mm-yyyy · 2 value date · 3 description (50 chars) · 4 document no
//   5 debit (negative) · 6 credit (positive) · 7 balance after the line · 8 and 9 bank codes · 10 zeros
// Text is ISO-8859-1 (decode as windows-1252).
import { cardFromDescription } from './budget-lib.js';

const num = (s) => {
  const t = String(s == null ? '' : s).trim().replace(/^\+/, '');
  if (!t) return null;
  const v = Number(t.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};
const iso = (s) => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(s || '').trim());
  if (!m) return '';
  const d = new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00Z`);
  return !isNaN(d) && d.getUTCDate() === Number(m[1]) && d.getUTCMonth() + 1 === Number(m[2]) ? `${m[3]}-${m[2]}-${m[1]}` : '';
};
export const cents = (n) => Math.round((Number(n) || 0) * 100);

// Decode the bytes of the file. Santander writes ISO-8859-1, which windows-1252 covers.
export function decodeBank(buffer) {
  return new TextDecoder('windows-1252').decode(buffer);
}

// → { rows, errors, accountNo, chainOk, chainBreak }
export function parseTabulado(text) {
  const rows = [], errors = [];
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    const sep = raw.includes(';') ? ';' : '\t';
    const f = raw.split(sep);
    const lineNo = i + 1;
    if (f.length < 8) { errors.push({ lineNo, reason: 'Too few columns' }); return; }
    const posted = iso(f[1]), value = iso(f[2]);
    const debit = num(f[5]), credit = num(f[6]), balance = num(f[7]);
    if (!posted) { errors.push({ lineNo, reason: 'Posting date is not dd-mm-yyyy' }); return; }
    if (balance == null || (debit == null && credit == null)) { errors.push({ lineNo, reason: 'Amount or balance missing' }); return; }
    const amount = Math.round(((debit || 0) + (credit || 0)) * 100) / 100;
    const description = String(f[3] || '').replace(/\s+/g, ' ').trim();
    rows.push({
      lineNo, accountNo: String(f[0] || '').trim(), posted, value: value || posted, description,
      amount, balance, code2: String(f[8] || '').trim(), code3: String(f[9] || '').trim(),
      cardLast4: cardFromDescription(description),
    });
  });
  // The balance after each line must equal the one before plus the amount.
  let chainOk = true, chainBreak = -1;
  for (let i = 1; i < rows.length; i++) {
    if (Math.abs(cents(rows[i - 1].balance) + cents(rows[i].amount) - cents(rows[i].balance)) > 1) { chainOk = false; chainBreak = i; break; }
  }
  const accounts = [...new Set(rows.map((r) => r.accountNo))];
  return { rows, errors, accountNo: accounts.length === 1 ? accounts[0] : '', accountNos: accounts, chainOk, chainBreak };
}

// A stable id for one bank line. Two identical purchases on one day differ by the balance after each.
export async function fingerprint(row, accountNo) {
  const s = [accountNo || row.accountNo, row.posted, row.value, cents(row.amount), row.description, cents(row.balance)].join('|');
  const bytes = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

// What an import would do. existing = Set of fingerprints already stored; last = the stored line with the
// latest posting date { balance, posted } or null; opening = the account's opening balance or null.
export function planImport({ rows, ids, existing, last, opening }) {
  const lines = rows.map((r, i) => ({ ...r, id: ids[i], isNew: !existing.has(ids[i]) }));
  const fresh = lines.filter((l) => l.isNew);
  const warnings = [];
  const firstNew = lines.findIndex((l) => l.isNew);
  if (firstNew === 0 && lines.length) {
    const implied = (cents(lines[0].balance) - cents(lines[0].amount)) / 100;
    if (last) {
      if (Math.abs(cents(implied) - cents(last.balance)) > 1) {
        warnings.push({ code: 'gap', text: `The file starts with a balance of ${implied.toFixed(2)} but the last stored line (${last.posted}) ended at ${Number(last.balance).toFixed(2)}. A day or more is probably missing between them.` });
      }
    } else if (opening != null && opening !== '' && Math.abs(cents(implied) - cents(opening)) > 1) {
      warnings.push({ code: 'opening', text: `The file starts with a balance of ${implied.toFixed(2)}, but the account's opening balance is ${Number(opening).toFixed(2)}.` });
    }
  }
  const dates = lines.map((l) => l.posted).sort();
  return {
    lines, fresh, dups: lines.length - fresh.length, warnings,
    from: dates[0] || '', to: dates[dates.length - 1] || '',
    sumIn: fresh.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0),
    sumOut: fresh.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0),
    openingBalance: lines.length ? (cents(lines[0].balance) - cents(lines[0].amount)) / 100 : null,
    closingBalance: lines.length ? lines[lines.length - 1].balance : null,
  };
}

// ── Reading a line ──
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STOP = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
const words = (s) => norm(s).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));

// "COMPRA ESTRANG*0435 FLIX" → "FLIX"; "TRF CRED SEPA+ DE ISTRIA CAPITAL III F.C.-44241813" → "ISTRIA CAPITAL III F.C."
export function cleanDescription(desc) {
  let d = String(desc || '').replace(/\s+/g, ' ').trim();
  d = d.replace(/^COMPRA( ESTRANG)?\s*\*\d{4}\s*/i, '')
    .replace(/^TRF\.? ?CR[EÉ]D\.? ?(N\.)?SEPA\+? ?(DE|RECEBIDA)?\s*/i, '')
    .replace(/^TRF\.? ?IMED\.? ?(DE|P\/)?\s*/i, '')
    .replace(/^TRF CRED SEPA\+ DE\s*/i, '');
  d = d.replace(/-[A-Z]?\d{5,}$/i, '').replace(/\s+\d{15,}$/, '').trim();
  return d || String(desc || '').trim();
}

const CHARGE = /JUROS ULTRAP|JUROS DEV|COMISS|IMP\.? ?(DE )?SELO|IS-VERBA|CR\. N.O PRE-CONT|\(DESP\.BEN\)|MANUTEN|ANUIDADE/i;
const PAYEE_PREFIX = /^(COMPRA|TRF|TRANSF|PAG\b|PAGAMENTO|DD\b|DEB\.? ?DIR)/i;
const INTEREST_IN =/JUROS CRED|JUROS ORDEN|JUROS DE DEP/i;

// A partner named in a line: "Devolucao Antonio" (first name) or all words of the partner's name ("ANDRE FILIPE NOGUEIRA DA ROCHA").
export function matchPartner(desc, partners) {
  const text = norm(desc);
  const dev = /devolu[cç][aã]o\s+([a-z]+)/.exec(text);
  const tokensOf = (p) => words(p.name || p.label || '');
  if (dev) {
    const hit = (partners || []).find((p) => tokensOf(p)[0] === dev[1]);
    if (hit) return hit.key;
  }
  // A name the partner's bank writes (remembered on their profile), for example "ANTONIO MARIA OLIVEIRA B N".
  const flat = text.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const p of partners || []) {
    for (const a of p.bankNames || []) {
      const k = norm(a).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (k.length >= 4 && flat.includes(k)) return p.key;
    }
  }
  const w = new Set(words(desc));
  // The bank cuts the name at 26 characters ("ANDRE FILIPE NOGUEIRA DA R"): then the last word of the partner's name may be only the start of it.
  const cut = cleanDescription(desc).replace(/\s+/g, ' ').trim();
  const cutWords = words(cut), lastWord = cutWords[cutWords.length - 1] || '';
  const truncated = cut.length >= 24;
  for (const p of partners || []) {
    const t = tokensOf(p);
    if (t.length >= 2 && t.every((x, i) => w.has(x) || (truncated && i === t.length - 1 && lastWord && x.startsWith(lastWord)))) return p.key;
  }
  return '';
}

// ctx = { partners:[{key,name}], suppliers:[{id,name,aliases,defaultCategoryId,defaultPurposeId}], cards:[{id,last4,accountId}], accountId }
// → a suggestion; nothing is saved from here.
export function recognise(line, ctx = {}) {
  const d = line.description, out = { kind: line.amount < 0 ? 'expense' : 'income', reason: '', sure: false, autoAccept: false };
  const clean = cleanDescription(d);
  const supplier = findSupplier(d, ctx.suppliers);
  if (line.cardLast4) {
    const card = (ctx.cards || []).find((c) => c.last4 === line.cardLast4);
    if (card) out.paidWith = `card:${card.id}`;
  } else if (ctx.accountId) out.paidWith = `account:${ctx.accountId}`;

  // A bank charge is a line the bank writes about itself. A line that starts like a payment to someone (a transfer, a card purchase, a debit order) names a payee, so a word such as COMISS in it is not enough (a commission paid to a broker). The one transfer-shaped charge is the transfer fee marked (DESP.BEN).
  if (line.amount < 0 && CHARGE.test(d) && (/DESP\.BEN/i.test(d) || !PAYEE_PREFIX.test(String(d || '').trim()))) {
    const nm = /DESP\.BEN/i.test(d) ? 'Transfer fee (DESP.BEN)' : clean;
    return { ...out, kind: 'expense', name: nm, categoryId: 'bank-taxes', purposeId: 'admin-compliance', docWaived: 'Bank charge', reason: 'Bank charge, tax or interest', sure: true, autoAccept: true };
  }
  if (line.amount > 0 && INTEREST_IN.test(d)) {
    return { ...out, kind: 'income', incomeType: 'interest', name: 'Interest received', counterparty: 'Bank', reason: 'Interest received', sure: true, autoAccept: true };
  }
  const partnerKey = matchPartner(d, ctx.partners);
  if (partnerKey && line.amount < 0) return { ...out, kind: 'settlement', partnerKey, name: clean, reason: 'Transfer to a partner (reimbursement)', sure: true };
  // Money from a partner is a loan to the company until you say otherwise; never an investor, never accepted without a click.
  if (partnerKey && line.amount > 0) {
    const p = (ctx.partners || []).find((x) => x.key === partnerKey) || {};
    return { ...out, kind: 'income', incomeType: 'partner_loan', partnerKey, name: `Loan from ${p.name || partnerKey}`, counterparty: clean, reason: 'Money from a partner: partner loan (confirm)', sure: false };
  }
  if (line.amount > 0) {
    const who = /^[\d\s]+$/.test(clean) ? '' : clean;   // some lines carry only a reference number, no name
    const hit = who ? findInvestor(who, ctx.investors) : null;
    if (hit) return { ...out, kind: 'income', incomeType: 'capital_call', name: `Received from ${hit.investor.name}`, counterparty: who, investorId: hit.investor.id, investorName: hit.investor.name, reason: hit.how === 'alias' ? `Investor ${hit.investor.name} (remembered sender)` : `Investor ${hit.investor.name} (name matches)`, sure: hit.how === 'alias' };
    return { ...out, kind: 'income', incomeType: 'capital_call', name: who ? `Received from ${who}` : `Transfer received (ref ${clean})`, counterparty: who, reason: 'Money in: probably an investor (confirm)', sure: false };
  }
  if (supplier) {
    return { ...out, kind: 'expense', name: clean, supplierId: supplier.id, supplierName: supplier.name, categoryId: supplier.defaultCategoryId || '', purposeId: supplier.defaultPurposeId || '', reason: `Supplier ${supplier.name}`, sure: !!supplier.defaultCategoryId };
  }
  return { ...out, kind: 'expense', name: clean, reason: line.cardLast4 ? 'Card purchase: pick a category' : 'Payment: pick a category', sure: false };
}

export function findSupplier(desc, suppliers) {
  const text = norm(desc);
  for (const s of suppliers || []) {
    if (s.archived) continue;
    const keys = [s.name, ...(s.aliases || [])].map(norm).filter((k) => k.length >= 3);
    if (keys.some((k) => text.includes(k))) return s;
  }
  return null;
}

// ── Investors (step 2.8) ──
// Words that name a kind of company, not the company: left out when comparing names.
const GENERIC = new Set(['fund', 'funds', 'capital', 'partners', 'partner', 'holding', 'holdings', 'sa', 'lda', 'fc', 'sl', 'sarl', 'limited', 'ltd', 'gmbh', 'ab', 'llc', 'inc', 'group', 'sgps', 'the', 'of', 'and', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'investments', 'investimentos', 'ventures', 'equity', 'search', 'asset', 'assets', 'management', 'family', 'office', 'advisors', 'advisory']);
const sigWords = (s) => [...new Set(words(s).filter((w) => !GENERIC.has(w)))];
// How a sender name in a bank line relates to one investor: 'alias' (a remembered bank name), 'name' (every distinctive word
// of the investor's name is in the line), or ''. A single very short word (under 4 letters) never counts on its own.
export function investorMatch(text, investor) {
  const t = norm(text).replace(/[^a-z0-9 ]+/g, ' ');
  if (!t.trim() || !investor) return '';
  for (const a of investor.bankNames || []) {
    const k = norm(a).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (k.length >= 4 && t.replace(/\s+/g, ' ').includes(k)) return 'alias';
  }
  // Words in brackets ("(Frotcom)", "(previously Iniginy)") are notes on the name, not part of it.
  const nameNoNote = String(investor.name || '').normalize('NFC').replace(/\([^)]*\)/g, ' ');
  const sig = sigWords(nameNoNote);
  // "Sá" with its accent is a surname, not the company ending SA / S.A.: keep it, or "António Sá" would be just "António".
  if (/(^|[\s,.-])s[áÁ](?=$|[\s,.-])/i.test(nameNoNote) && !sig.includes('sa')) sig.push('sa');
  const have = new Set(words(text));
  const squashed = t.replace(/ /g, '');   // "ONE TO ONE" is also "ONEtoONE"
  if (!sig.length || !sig.every((w) => have.has(w) || (w.length >= 6 && squashed.includes(w)))) return '';
  if (sig.length === 1 && sig[0].length < 4) return '';
  return 'name';
}
// The one investor a sender belongs to, or null (no match, or two investors match the same way: never guessed).
export function findInvestor(text, investors) {
  const hits = (investors || []).map((i) => ({ i, how: investorMatch(text, i) })).filter((h) => h.how);
  const alias = hits.filter((h) => h.how === 'alias');
  const pool = alias.length ? alias : hits;
  return pool.length === 1 ? { investor: pool[0].i, how: pool[0].how } : null;
}
// Money-in items (capital calls) that could be this investor's and are not linked to anyone yet.
export function unlinkedForInvestor(items, investor) {
  return (items || []).filter((i) => i.kind === 'income' && i.incomeType === 'capital_call' && !i.investorId && !i.archived
    && investorMatch(`${i.counterparty || ''} ${i.name || ''}`, investor));
}

// Expenses entered by hand that this bank line could be the payment of: same amount, date within a few days.
export function matchCandidates(line, items, days = 10) {
  if (line.amount >= 0) return [];
  const want = cents(Math.abs(line.amount)), t0 = Date.parse(line.posted + 'T12:00:00');
  return (items || []).filter((i) => i.kind === 'expense' && !i.archived && !i.movementId && !i.paidPersonallyBy && cents(i.amount) === want && i.date
    && Math.abs(Date.parse(i.date + 'T12:00:00') - t0) <= days * 86400000)
    .sort((a, b) => Math.abs(Date.parse(a.date) - t0) - Math.abs(Date.parse(b.date) - t0));
}
