// Budget v2 — the page itself (plan "Budget v2 - Plan.md", Stage 1; switch budget.v2).
// budget.html loads this only when the switch is available to the viewer and hides the v1 page; with the switch Off
// nothing here runs. Pure logic lives in budget-lib.js / budget-fiscal.js (tested in Node).
import { db, storage, addReads, addDoc, setDoc, updateDoc, deleteDoc, writeBatch } from './firebase-config.js';
import { loadDirectory } from './team-dir.js';
import { INSTANCE } from './instance-config.js';
import { decodeBank, parseTabulado, fingerprint, planImport, recognise, cleanDescription, matchCandidates } from './budget-bank.js';
import { nifStatus, normalizeNif, cleanCompanyDetails } from './budget-fiscal.js';
import {
  DEFAULT_CATEGORIES, DEFAULT_PURPOSES, TEAM_PAY_SUBTYPES, KINDS, INCOME_TYPES, DOC_TYPES, DOC_STATUS, DEDUCTIBLE, VAT_BUCKETS, vatBucket, vatSummary,
  docStatus, normalizeItem, overview, parseTags, tagTotals, splitShares, isValidIban, ibanStatus, formatIban, cleanIban,
  last4, labelOf, mergeLists, activeOnly, newListId,
} from './budget-lib.js';
import {
  collection, getDocs, getDoc, doc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-storage.js";

const eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
const COUNTRIES = [['PT', 'Portugal'], ['ES', 'Spain'], ['FR', 'France'], ['DE', 'Germany'], ['GB', 'United Kingdom'], ['IE', 'Ireland'], ['NL', 'Netherlands'], ['BE', 'Belgium'], ['IT', 'Italy'], ['LU', 'Luxembourg'], ['CH', 'Switzerland'], ['AT', 'Austria'], ['SE', 'Sweden'], ['DK', 'Denmark'], ['FI', 'Finland'], ['PL', 'Poland'], ['GR', 'Greece'], ['US', 'United States'], ['XX', 'Other country']];
const COUNTRY_NAME = Object.fromEntries(COUNTRIES);
const SUPPLIER_TYPES = [['accountant', 'Accountant'], ['lawyer', 'Lawyer'], ['advisor', 'Advisor'], ['software', 'Software or data'], ['office', 'Office'], ['transport', 'Transport'], ['accommodation', 'Accommodation'], ['food', 'Food'], ['searcher-company', 'Searcher’s own company'], ['bank', 'Bank'], ['other', 'Other']];
const SUPPLIER_TYPE_NAME = Object.fromEntries(SUPPLIER_TYPES);
const PAID_NOW = { cash: 'Cash', personal: 'Paid personally' };

// Hover / tap explanations (the i icon next to a field name).
const TIPS = {
  kind: 'Expense = money we spent. Money received = money that came in (investors, interest, refunds…). Plan allocation = how much we planned to spend; it is not money.',
  category: 'What the money bought: transport, meals, software… You can add or rename values in Settings.',
  purpose: 'Why we spent it: a field visit, sourcing, investor relations… A taxi to a company is Category Transport and Purpose Field visit.',
  tags: 'Free labels such as "Spain trip". Several per item; type and press comma. Each tag gets its own total.',
  paidWith: 'Which company account or card the money left from. Choose "Paid personally" when one of you paid with your own money and the company pays you back later.',
  paidPersonallyBy: 'The partner whose own money was used. The Overview lists what the company still owes each of you.',
  usedBy: 'Who the expense was for, not whose card paid. Tick one or more people; with several, the weight sets their share (equal by default).',
  docType: 'What paperwork you have. For tax the company needs an invoice with its NIF; a receipt or simplified invoice alone is not enough.',
  issuedToCompany: 'Does the invoice show the company’s name and NIF? Choose Unknown until you have checked; Unknown counts as a warning.',
  supplier: 'Who we paid. Pick a saved supplier to fill NIF, country and defaults, or type a new name and it is saved for next time.',
  supplierTaxId: 'The supplier’s NIF (Portugal) or VAT ID (abroad, for example ES B1234567). NIF and VAT are different: the NIF identifies a person or company, VAT (IVA) is the tax on the invoice.',
  docNumber: 'The invoice number printed on the document.',
  atcud: 'The unique document code Portuguese invoices carry next to the QR code. Optional.',
  invoiceDate: 'The date on the invoice. It can differ from the payment date.',
  country: 'The country the expense belongs to (where it was bought or the supplier is). Foreign invoices usually need separate VAT treatment; your accountant decides.',
  vatRate: 'The VAT (IVA) percentage on the invoice, for example 23 on the mainland.',
  vatAmount: 'The VAT amount on the invoice. Filled in from the rate (assuming the amount includes VAT) while you have not typed it. With several rates on one invoice, type the total VAT shown on it.',
  vatDeductible: 'Whether the company can get this VAT back. The app does not decide: leave "Ask the accountant" unless they told you. "No" takes the item out of the recoverable total.',
  currency: 'The currency of the invoice. The amount above is always the euros that left the bank.',
  shared: 'Tick when this item has been sent to the accountant. The date and your name are saved.',
  incomeType: 'Capital call = an investor paid in. Partner loan = a partner lent money. Refunds and partner reimbursements lower costs.',
  waived: 'Tick for items that never get an invoice (a tip, a toll). Say why; it stops the document warning.',
  counterparty: 'Who the money came from, for example the investor.',
  subtype: 'For Team pay: salary, searcher services invoiced by their own company, or social contributions.',
  iban: 'Two check digits inside an IBAN catch most typing mistakes. A valid IBAN does not prove the account exists.',
  fileAccountNo: 'The account number as it appears in the bank’s export files. Used later to match imported bank lines to this account.',
};
const tip = (k) => `<span class="v2-tip" tabindex="0" role="img" aria-label="${esc(TIPS[k] || '')}" data-tip="${esc(TIPS[k] || '')}">i</span>`;

const CSS = `
#v2root .v2-tabs { display:flex; gap:4px; flex-wrap:wrap; border-bottom:2px solid var(--border); margin-bottom:24px; }
#v2root .v2-tabs button { background:none; border:none; padding:10px 16px; font:600 0.9rem var(--font-sans); color:var(--text-light); cursor:pointer; border-bottom:3px solid transparent; margin-bottom:-2px; }
#v2root .v2-tabs button.on { color:var(--primary); border-bottom-color:var(--primary); }
#v2root .v2-tabs .cnt { background:var(--danger); color:#fff; border-radius:100px; font-size:0.68rem; padding:1px 7px; margin-left:6px; }
#v2root .v2-tip { display:inline-flex; align-items:center; justify-content:center; width:15px; height:15px; margin-left:6px; border-radius:50%; background:#E4EAF0; color:var(--primary-dark); font:700 0.68rem/1 var(--font-sans); text-transform:none; letter-spacing:0; cursor:help; position:relative; vertical-align:middle; }
#v2root .v2-tip:hover::after, #v2root .v2-tip:focus::after { content:attr(data-tip); position:absolute; left:50%; top:calc(100% + 6px); transform:translateX(-30%); width:260px; max-width:70vw; background:var(--bg-dark); color:#fff; padding:9px 11px; border-radius:6px; font:400 0.78rem/1.45 var(--font-sans); text-transform:none; letter-spacing:0; z-index:400; white-space:normal; box-shadow:0 6px 20px rgba(0,0,0,.25); }
#v2root .badge-doc { display:inline-block; padding:2px 9px; border-radius:100px; font-size:0.7rem; font-weight:700; white-space:nowrap; }
#v2root .badge-doc.ok { background:#EBF5EB; color:var(--secondary); }
#v2root .badge-doc.warn { background:#FFF3D6; color:#8A5A00; }
#v2root .badge-doc.na { background:#F0EDE8; color:var(--text-light); }
#v2root .pill--income { background:#EBF5EB; color:var(--secondary); }
#v2root .pill--plan { background:#EDE9F6; color:#5B4A8A; }
#v2root .pill--review { background:#FFF3D6; color:#8A5A00; }
#v2root .tagchip { display:inline-block; background:#E8F0F8; color:var(--primary-dark); border-radius:100px; padding:2px 9px; font-size:0.72rem; margin:1px 3px 1px 0; cursor:pointer; border:none; font-family:var(--font-sans); }
#v2root .tagchip:hover { background:#D5E4F2; }
#v2root .tagchip small { opacity:.7; margin-left:4px; }
#v2root .amt-in { color:var(--secondary); }
#v2root .bulkbar { display:none; gap:8px; align-items:center; flex-wrap:wrap; padding:10px 16px; background:#EEF3F8; border-bottom:1px solid var(--border); font-size:0.85rem; }
#v2root .bulkbar.on { display:flex; }
#v2root .sect { border:1px solid var(--border); border-radius:var(--radius); padding:14px 16px 4px; margin-bottom:16px; }
#v2root .sect > .sect-title { font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:var(--primary); margin-bottom:12px; }
#v2root .warnbox { border-radius:var(--radius); padding:10px 12px; font-size:0.82rem; line-height:1.5; margin-bottom:14px; }
#v2root .warnbox.warn { background:#FFF3D6; color:#6B4700; } #v2root .warnbox.ok { background:#EBF5EB; color:#2A5A22; } #v2root .warnbox.na { background:#F0EDE8; color:var(--text-light); }
#v2root .shares { display:flex; flex-direction:column; gap:6px; }
#v2root .share-row { display:flex; align-items:center; gap:10px; font-size:0.88rem; }
#v2root .share-row label { text-transform:none; letter-spacing:0; font-weight:500; margin:0; display:flex; align-items:center; gap:6px; min-width:140px; }
#v2root .share-row input[type=number] { width:80px; padding:6px 8px; }
#v2root .share-row input[type=checkbox] { width:auto; }
#v2root .checkline { display:flex; align-items:center; gap:8px; font-size:0.88rem; }
#v2root .checkline input { width:auto; }
#v2root .checkline label { margin:0; text-transform:none; letter-spacing:0; font-weight:500; }
#v2root .mini { font-size:0.78rem; color:var(--text-light); }
#v2root .cardgrid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:16px; }
#v2root .acard { background:var(--white); border:1px solid var(--border); border-radius:var(--radius); padding:16px 18px; }
#v2root .acard h3 { font-size:1rem; margin-bottom:4px; }
#v2root .acard .iban { font-variant-numeric:tabular-nums; letter-spacing:.03em; font-size:0.9rem; margin:8px 0; word-break:break-all; }
#v2root .row-actions { display:flex; gap:6px; flex-wrap:wrap; margin-top:10px; }
#v2root .list-edit { display:flex; flex-direction:column; gap:6px; }
#v2root .list-edit .le { display:flex; gap:8px; align-items:center; }
#v2root .list-edit .le input[type=text] { flex:1; padding:7px 10px; border:1.5px solid var(--border); border-radius:var(--radius); font:inherit; }
#v2root .list-edit .le.arch input[type=text] { opacity:.55; text-decoration:line-through; }
#v2root .two { display:grid; grid-template-columns:1fr 1fr; gap:24px; }
@media (max-width:768px){ #v2root .two { grid-template-columns:1fr; } }
#v2root .modal { max-width:640px; }
#v2root td.chk, #v2root th.chk { width:28px; padding-right:0; }
#v2root .copy-note { font-size:0.75rem; color:var(--secondary); margin-left:6px; }
`;

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const fmtDate = (d) => { if (!d) return '—'; const dt = new Date(String(d).slice(0, 10) + 'T12:00:00'); return isNaN(dt) ? esc(d) : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
const today = () => new Date().toISOString().slice(0, 10);

export async function mountBudgetV2({ root, access, logEvent, refreshReads }) {
  const can = (p) => !!access?.can?.(p);
  const myKey = access?.key || null;
  const isAdmin = !!access?.admin;

  // ── State ──
  const S = {
    tab: 'overview', items: [], accounts: [], cards: [], suppliers: [], people: {}, company: {}, lists: { categories: [], purposes: [] },
    movements: [], imports: [], dir: [], filter: { search: '', kind: '', category: '', purpose: '', tag: '', doc: '', shared: '', usedBy: '', from: '', to: '', archived: false, review: false, vat: '' },
    sort: { field: 'date', dir: 'desc' }, selected: new Set(), edit: null,
  };
  const reads = (n) => { try { addReads(n); refreshReads(); } catch (e) { /* counter only */ } };

  if (!document.getElementById('v2style')) { const st = document.createElement('style'); st.id = 'v2style'; st.textContent = CSS; document.head.appendChild(st); }

  async function loadAll() {
    const [it, ac, cd, su, pe, main, lst, dir, mv, im] = await Promise.all([
      getDocs(collection(db, 'budgetItems')),
      can('budget.accounts') ? getDocs(collection(db, 'budgetAccounts')).catch(() => null) : null,
      can('budget.accounts') ? getDocs(collection(db, 'budgetCards')).catch(() => null) : null,
      getDocs(collection(db, 'budgetSuppliers')).catch(() => null),
      can('budget.accounts') ? getDocs(collection(db, 'budgetPeople')).catch(() => null) : null,
      getDoc(doc(db, 'budgetSettings', 'main')).catch(() => null),
      getDoc(doc(db, 'budgetSettings', 'lists')).catch(() => null),
      loadDirectory().catch(() => []),
      can('budget.accounts') ? getDocs(collection(db, 'budgetMovements')).catch(() => null) : null,
      can('budget.accounts') ? getDocs(collection(db, 'budgetImports')).catch(() => null) : null,
    ]);
    const n = (x) => (x ? x.docs.length : 0);
    reads(n(it) + n(ac) + n(cd) + n(su) + n(pe) + n(mv) + n(im) + 2);
    S.movements = mv ? mv.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
    S.imports = im ? im.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || ''))) : [];
    S.items = it.docs.map((d) => normalizeItem({ id: d.id, ...d.data() }));
    S.accounts = ac ? ac.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
    S.cards = cd ? cd.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
    S.suppliers = su ? su.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
    S.people = {}; if (pe) pe.docs.forEach((d) => { S.people[d.id] = d.data(); });
    S.company = main && main.exists() ? main.data() : {};
    const l = lst && lst.exists() ? lst.data() : {};
    S.lists = { categories: mergeLists(l.categories, DEFAULT_CATEGORIES), purposes: mergeLists(l.purposes, DEFAULT_PURPOSES) };
    S.dir = dir;
  }

  // ── Small lookups ──
  const catLabel = (id) => labelOf(S.lists.categories, id);
  const purLabel = (id) => labelOf(S.lists.purposes, id, '');
  const personLabel = (key) => key === 'external' ? 'External' : (S.dir.find((m) => m.key === key)?.label || key);
  const accountOf = (id) => S.accounts.find((a) => a.id === id);
  const cardOf = (id) => S.cards.find((c) => c.id === id);
  function paidWithLabel(it) {
    const v = it.paidWith || '';
    if (v === 'cash') return 'Cash';
    if (v === 'personal') return it.paidPersonallyBy ? `${personLabel(it.paidPersonallyBy)} (own money)` : 'Paid personally';
    if (v.startsWith('card:')) { const c = cardOf(v.slice(5)); return c ? `Card *${esc(c.last4)}${c.label ? ' ' + esc(c.label) : ''}` : 'Card'; }
    if (v.startsWith('account:')) { const a = accountOf(v.slice(8)); return a ? esc(a.name) : 'Account'; }
    return '—';
  }
  const usedByLabel = (it) => {
    const u = it.usedBy || [];
    if (!u.length) return '—';
    if (u.length === 1) return esc(personLabel(u[0].key));
    const parts = splitShares(it.amount, u);
    return u.map((x, i) => `${esc(personLabel(x.key))} ${parts[i] ? Math.round((parts[i].amount / (it.amount || 1)) * 100) : ''}%`).join(' / ');
  };
  const incomeLabel = (id) => labelOf(INCOME_TYPES, id, 'Money received');
  const allTags = () => [...new Set(S.items.flatMap((i) => i.tags))].sort((a, b) => a.localeCompare(b));

  const inboxCount = () => S.movements.filter((m) => m.status === 'new').length;

  // ── Shell ──
  function shell() {
    const unrev = S.items.filter((i) => i.legacy && i.needsReview && !i.archived).length;
    root.innerHTML = `
      <div class="v2-tabs" id="v2tabs">
        <button data-tab="overview">Overview</button>
        <button data-tab="items">Items${unrev ? `<span class="cnt" title="Old items to review">${unrev}</span>` : ''}</button>
        <button data-tab="inbox" data-perm="budget.accounts">Inbox${inboxCount() ? `<span class="cnt" title="Bank lines waiting">${inboxCount()}</span>` : ''}</button>
        <button data-tab="accounts" data-perm="budget.accounts">Accounts</button>
        <button data-tab="bank" data-perm="budget.import">Bank</button>
        <button data-tab="suppliers">Suppliers</button>
        <button data-tab="settings">Settings</button>
      </div>
      <div id="v2body"></div>
      <div class="modal-overlay" id="v2modal"><div class="modal" id="v2modalBox"></div></div>`;
    root.querySelectorAll('#v2tabs button').forEach((b) => b.addEventListener('click', () => { S.tab = b.dataset.tab; render(); }));
    root.querySelector('#v2modal').addEventListener('click', (e) => { if (e.target.id === 'v2modal') closeModal(); });
  }
  function render() {
    root.querySelectorAll('#v2tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
    const body = root.querySelector('#v2body');
    ({ overview: renderOverview, items: renderItems, inbox: renderInbox, bank: renderBank, accounts: renderAccounts, suppliers: renderSuppliers, settings: renderSettings }[S.tab] || renderOverview)(body);
  }
  const openModal = (html) => { root.querySelector('#v2modalBox').innerHTML = html; root.querySelector('#v2modal').classList.add('open'); };
  const closeModal = () => { root.querySelector('#v2modal').classList.remove('open'); S.edit = null; };
  const refresh = async () => { await loadAll(); shell(); render(); };

  // ── Overview ──
  function renderOverview(body) {
    const o = overview(S.items), vat = vatSummary(S.items);
    const costs = S.items.filter((i) => i.kind === 'expense' && !i.archived);
    const warn = costs.filter((i) => docStatus(i).level === 'warn').length;
    const unrev = S.items.filter((i) => i.legacy && i.needsReview && !i.archived).length;
    const owed = Object.entries(o.owedToPartners).filter(([, v]) => v > 0);
    const byCat = {}, byPur = {};
    costs.forEach((i) => { byCat[i.categoryId || 'other'] = (byCat[i.categoryId || 'other'] || 0) + i.amount; byPur[i.purposeId || ''] = (byPur[i.purposeId || ''] || 0) + i.amount; });
    const tbl = (m, lab) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(lab(k) || 'No purpose yet')}</td><td class="num">${eur.format(v)}</td></tr>`).join('') || '<tr class="empty-row"><td colspan="2">Nothing yet.</td></tr>';
    const tags = tagTotals(S.items).slice(0, 12);
    body.innerHTML = `
      <div class="section"><div class="section-header"><h2 class="section-title">Overview</h2></div>
        <div class="summary-grid">
          <div class="stat-card"><div class="stat-card__label">Money received</div><div class="stat-card__value">${eur.format(o.received)}</div><div class="stat-card__sub">Capital ${eur.format(o.capital)} · loans ${eur.format(o.loans)} · interest ${eur.format(o.interest)}</div></div>
          <div class="stat-card"><div class="stat-card__label">Costs</div><div class="stat-card__value">${eur.format(o.costs)}</div><div class="stat-card__sub">${costs.length} expense${costs.length === 1 ? '' : 's'}, net of refunds</div></div>
          <div class="stat-card"><div class="stat-card__label">Balance</div><div class="stat-card__value stat-card__value--${o.balance < 0 ? 'bad' : 'good'}">${eur.format(o.balance)}</div><div class="stat-card__sub">Received − costs</div></div>
          <div class="stat-card"><div class="stat-card__label">Plan used</div><div class="stat-card__value">${o.pctOfPlan == null ? '—' : o.pctOfPlan.toFixed(0) + '%'}</div><div class="stat-card__sub">${o.plan ? `Plan ${eur.format(o.plan)}` : 'No plan allocated yet'}</div>${o.pctOfPlan == null ? '' : `<div class="progress"><div class="progress__bar" style="width:${Math.min(100, o.pctOfPlan)}%"></div></div>`}</div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;">
          ${warn ? `<button class="btn btn--ghost btn--sm" data-go="doc">⚠ ${warn} expense${warn === 1 ? '' : 's'} with missing or wrong paperwork</button>` : '<span class="mini">✓ Every expense has its paperwork.</span>'}
          ${unrev ? `<button class="btn btn--ghost btn--sm" data-go="review">⚠ ${unrev} old item${unrev === 1 ? '' : 's'} to review</button>` : ''}
          ${owed.length ? `<span class="mini">Owed to partners (paid personally, not reimbursed): ${owed.map(([k, v]) => `${esc(personLabel(k))} ${eur.format(v)}`).join(' · ')}</span>` : ''}
        </div>
      </div>
      <div class="section"><div class="section-header"><h2 class="section-title" style="font-size:1.15rem">VAT paid ${tip('vatDeductible')}</h2></div>
        <div class="summary-grid">
          <div class="stat-card" title="All VAT on expenses, whatever its status"><div class="stat-card__label">Total VAT paid</div><div class="stat-card__value">${eur.format(vat.total)}</div><div class="stat-card__sub">On ${costs.filter((i) => vatBucket(i) !== 'none').length} expense${costs.filter((i) => vatBucket(i) !== 'none').length === 1 ? '' : 's'} with a VAT amount</div></div>
          <div class="stat-card" title="VAT refunds booked in Items as money received"><div class="stat-card__label">VAT recovered</div><div class="stat-card__value stat-card__value--good">${eur.format(vat.recovered)}</div><div class="stat-card__sub">Booked as "VAT refund" in money received</div></div>
          <div class="stat-card" title="Potentially recoverable plus foreign VAT, minus what is already back"><div class="stat-card__label">Still to recover</div><div class="stat-card__value">${eur.format(vat.toRecover)}</div><div class="stat-card__sub">Potential, the accountant decides</div></div>
          <div class="stat-card" title="${esc(VAT_BUCKETS.atRisk.hint)}"><div class="stat-card__label">At risk</div><div class="stat-card__value ${vat.atRisk > 0 ? 'stat-card__value--bad' : ''}">${eur.format(vat.atRisk)}</div><div class="stat-card__sub">${vat.atRisk > 0 ? '<button class="btn btn--ghost btn--sm" data-go="vatrisk">Show them</button>' : 'Paperwork is in order'}</div></div>
        </div>
        <p class="mini" style="margin-top:10px">Of the total: ${eur.format(vat.recoverable)} potentially recoverable (complete invoice with our NIF), ${eur.format(vat.atRisk)} at risk (paperwork to fix), ${eur.format(vat.foreign)} foreign, ${eur.format(vat.notDeductible)} marked not deductible. The app only groups the VAT; your accountant decides what can be recovered. When a refund arrives, add it in Items as money received, type "VAT refund".${vat.missing ? ` ${vat.missing} complete invoice${vat.missing === 1 ? ' has' : 's have'} no VAT amount typed yet.` : ''}</p>
      </div>
      <div class="two">
        <div class="section"><div class="section-header"><h2 class="section-title" style="font-size:1.15rem">Costs by category</h2></div><div class="card"><table><tbody>${tbl(byCat, catLabel)}</tbody></table></div></div>
        <div class="section"><div class="section-header"><h2 class="section-title" style="font-size:1.15rem">Costs by purpose</h2></div><div class="card"><table><tbody>${tbl(byPur, purLabel)}</tbody></table></div></div>
      </div>
      <div class="section"><div class="section-header"><h2 class="section-title" style="font-size:1.15rem">Cost per tag</h2></div>
        <div class="card" style="padding:14px 16px;">${tags.length ? tags.map((t) => `<button class="tagchip" data-tagfilter="${esc(t.tag)}">${esc(t.tag)} · ${eur.format(t.total)}<small>${t.count}</small></button>`).join('') : '<span class="mini">No tags yet. Add tags such as "Spain trip" on an item.</span>'}</div></div>`;
    body.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { S.filter = { ...S.filter, doc: b.dataset.go === 'doc' ? 'warn' : '', review: b.dataset.go === 'review', vat: b.dataset.go === 'vatrisk' ? 'atRisk' : '' }; S.tab = 'items'; render(); }));
    body.querySelectorAll('[data-tagfilter]').forEach((b) => b.addEventListener('click', () => { S.filter.tag = b.dataset.tagfilter; S.tab = 'items'; render(); }));
  }

  // ── Items ──
  function filtered() {
    const f = S.filter, q = f.search.toLowerCase();
    let list = S.items.filter((i) => {
      if (!f.archived && i.archived) return false;
      if (f.review && !(i.legacy && i.needsReview)) return false;
      if (q && !`${i.name || ''} ${i.comments || ''} ${i.supplierName || ''} ${i.counterparty || ''}`.toLowerCase().includes(q)) return false;
      if (f.kind && i.kind !== f.kind) return false;
      if (f.category && i.categoryId !== f.category) return false;
      if (f.purpose && i.purposeId !== f.purpose) return false;
      if (f.tag && !i.tags.some((t) => t.toLowerCase() === f.tag.toLowerCase())) return false;
      if (f.doc === 'warn' && docStatus(i).level !== 'warn') return false;
      if (f.doc && f.doc !== 'warn' && docStatus(i).code !== f.doc) return false;
      if (f.shared === 'yes' && !i.sharedAt) return false;
      if (f.shared === 'no' && (i.sharedAt || i.kind === 'plan')) return false;
      if (f.usedBy && !i.usedBy.some((u) => u.key === f.usedBy)) return false;
      if (f.vat && vatBucket(i) !== f.vat) return false;
      if (f.from && (!i.date || i.date < f.from)) return false;
      if (f.to && (!i.date || i.date > f.to)) return false;
      return true;
    });
    const dir = S.sort.dir === 'asc' ? 1 : -1, fld = S.sort.field;
    list.sort((a, b) => {
      if (fld === 'amount') return (a.amount - b.amount) * dir;
      const va = String(a[fld] || '').toLowerCase(), vb = String(b[fld] || '').toLowerCase();
      return va < vb ? -dir : va > vb ? dir : 0;
    });
    return list;
  }
  const opts = (list, sel, blank) => (blank != null ? `<option value="">${esc(blank)}</option>` : '') + list.map((x) => `<option value="${esc(x.id ?? x.key ?? x)}"${(x.id ?? x.key ?? x) === sel ? ' selected' : ''}>${esc(x.label ?? x)}</option>`).join('');

  function kindPill(i) {
    if (i.kind === 'income') return `<span class="pill pill--income">${esc(incomeLabel(i.incomeType))}</span>`;
    if (i.kind === 'plan') return '<span class="pill pill--plan">Plan</span>';
    return '<span class="pill pill--cost">Expense</span>';
  }
  function itemRow(i) {
    const ds = docStatus(i);
    const sign = i.kind === 'income' ? '+' : '';
    const att = i.attachments.length ? `<a href="${esc(i.attachments[0].url || '#')}" target="_blank" rel="noopener" title="${i.attachments.length} file(s)" style="text-decoration:none">📎${i.attachments.length > 1 ? ' ' + i.attachments.length : ''}</a>` : '';
    const rev = i.legacy && i.needsReview && !i.archived
      ? (i.kind === 'expense'
        ? `<span class="pill pill--review" title="Old item: check the category and add the new fields">Review</span>`
        : `<span class="pill pill--review">Review</span> <span class="row-actions" style="display:inline-flex;margin:0" data-perm="budget.edit"><button class="btn btn--ghost btn--sm" data-rev="${i.id}" data-as="capital_call">Capital</button><button class="btn btn--ghost btn--sm" data-rev="${i.id}" data-as="interest">Interest</button><button class="btn btn--ghost btn--sm" data-rev="${i.id}" data-as="plan">Plan</button><button class="btn btn--ghost btn--sm" data-rev="${i.id}" data-as="archive">Archive</button></span>`)
      : '';
    return `<tr style="${i.archived ? 'opacity:.5' : ''}">
      <td class="chk"><input type="checkbox" data-sel="${i.id}" ${S.selected.has(i.id) ? 'checked' : ''} aria-label="Select"></td>
      <td style="white-space:nowrap">${fmtDate(i.date)}</td>
      <td><strong>${esc(i.name || '—')}</strong>${i.supplierName ? `<div class="mini">${esc(i.supplierName)}</div>` : ''}${i.counterparty ? `<div class="mini">${esc(i.counterparty)}</div>` : ''} ${rev}</td>
      <td>${kindPill(i)}</td>
      <td>${i.kind === 'expense' ? esc(catLabel(i.categoryId)) : ''}${i.kind === 'expense' && i.subtype ? `<div class="mini">${esc(labelOf(TEAM_PAY_SUBTYPES, i.subtype))}</div>` : ''}</td>
      <td>${esc(purLabel(i.purposeId))}</td>
      <td class="num ${i.kind === 'income' ? 'amt-in' : ''}">${sign}${eur.format(i.amount)}</td>
      <td>${i.kind === 'expense' ? paidWithLabel(i) : ''}</td>
      <td class="mini">${i.kind === 'expense' ? usedByLabel(i) : ''}</td>
      <td>${i.kind === 'expense' ? `<span class="badge-doc ${ds.level}" title="${esc(ds.missing.length ? 'Missing: ' + ds.missing.join(', ') : ds.label)}">${esc(ds.label)}</span>` : ''}</td>
      <td class="num">${vatBucket(i) !== 'none' ? `<span title="${esc(VAT_BUCKETS[vatBucket(i)].label)}">${eur.format(Number(i.vatAmount))}</span>` : ''}</td>
      <td>${i.tags.map((t) => `<button class="tagchip" data-tagfilter="${esc(t)}">${esc(t)}</button>`).join('')}</td>
      <td>${i.sharedAt ? `<span title="Shared ${esc(String(i.sharedAt).slice(0, 10))} by ${esc(i.sharedBy || '')}" style="color:var(--secondary);font-weight:700">✓</span>${i.changedSinceShared ? '<span title="Changed since it was shared" style="color:#8A5A00"> ⚠</span>' : ''}` : ''}</td>
      <td>${att}</td>
      <td style="white-space:nowrap;text-align:right"><button class="icon-btn" data-edit="${i.id}" data-perm="budget.edit" title="Edit">✎</button><button class="icon-btn" data-del="${i.id}" data-perm="budget.edit" title="Delete">🗑</button></td></tr>`;
  }
  function renderItems(body) {
    const f = S.filter, list = filtered();
    const costs = list.filter((i) => i.kind === 'expense').reduce((s, i) => s + i.amount, 0);
    const recv = list.filter((i) => i.kind === 'income').reduce((s, i) => s + i.amount, 0);
    const th = (fld, label, cls = '') => `<th class="sortable ${cls} ${S.sort.field === fld ? 'sort-' + S.sort.dir : ''}" data-sort="${fld}">${label}</th>`;
    const tags = tagTotals(S.items);
    body.innerHTML = `
      <div class="section">
        <div class="section-header"><h2 class="section-title">Items</h2>
          <div class="section-actions">
            <button class="btn btn--ghost" id="v2export">↓ Export CSV</button>
            <button class="btn btn--primary" id="v2new" data-perm="budget.edit">+ New item</button>
          </div></div>
        ${tags.length ? `<div style="margin-bottom:10px">${tags.slice(0, 14).map((t) => `<button class="tagchip" data-tagfilter="${esc(t.tag)}" style="${f.tag.toLowerCase() === t.tag.toLowerCase() ? 'outline:2px solid var(--primary)' : ''}">${esc(t.tag)} · ${eur.format(t.total)}<small>${t.count}</small></button>`).join('')}</div>` : ''}
        <div class="card">
          <div class="filter-bar">
            <input type="text" id="fSearch" placeholder="Search name, supplier, comments…" value="${esc(f.search)}">
            <select id="fKind"><option value="">All kinds</option>${KINDS.map((k) => `<option value="${k.id}"${f.kind === k.id ? ' selected' : ''}>${k.label}</option>`).join('')}</select>
            <select id="fCategory">${opts(S.lists.categories, f.category, 'All categories')}</select>
            <select id="fPurpose">${opts(S.lists.purposes, f.purpose, 'All purposes')}</select>
            <select id="fTag">${opts(allTags().map((t) => ({ id: t, label: t })), f.tag, 'All tags')}</select>
            <select id="fDoc"><option value="">Any paperwork</option><option value="warn"${f.doc === 'warn' ? ' selected' : ''}>⚠ Needs attention</option>${Object.entries(DOC_STATUS).map(([k, v]) => `<option value="${k}"${f.doc === k ? ' selected' : ''}>${v.label}</option>`).join('')}</select>
            <select id="fVat"><option value="">Any VAT</option>${Object.entries(VAT_BUCKETS).map(([k, v]) => `<option value="${k}"${f.vat === k ? ' selected' : ''}>VAT: ${v.label}</option>`).join('')}</select>
            <select id="fShared"><option value="">Shared or not</option><option value="no"${f.shared === 'no' ? ' selected' : ''}>Not shared with accountant</option><option value="yes"${f.shared === 'yes' ? ' selected' : ''}>Shared with accountant</option></select>
            <select id="fUsed">${opts(S.dir.map((m) => ({ id: m.key, label: m.label })), f.usedBy, 'Used by anyone')}</select>
            <span class="filter-bar__label">From</span><input type="date" id="fFrom" value="${esc(f.from)}">
            <span class="filter-bar__label">To</span><input type="date" id="fTo" value="${esc(f.to)}">
            <label class="mini" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="fArch" ${f.archived ? 'checked' : ''}> Show archived</label>
            <label class="mini" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="fReview" ${f.review ? 'checked' : ''}> Only old items to review</label>
          </div>
          <div class="bulkbar ${S.selected.size ? 'on' : ''}" id="bulkbar" data-perm="budget.edit">
            <strong>${S.selected.size} selected</strong>
            <button class="btn btn--ghost btn--sm" data-bulk="share">Mark shared with accountant</button>
            <button class="btn btn--ghost btn--sm" data-bulk="unshare">Mark not shared</button>
            <input type="text" id="bulkTag" placeholder="Tag to add…" style="padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;font:inherit;font-size:.8rem">
            <button class="btn btn--ghost btn--sm" data-bulk="tag">Add tag</button>
            <select id="bulkCat" style="padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;font:inherit;font-size:.8rem">${opts(activeOnly(S.lists.categories), '', 'Category…')}</select>
            <select id="bulkPur" style="padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;font:inherit;font-size:.8rem">${opts(activeOnly(S.lists.purposes), '', 'Purpose…')}</select>
            <button class="btn btn--ghost btn--sm" data-bulk="classify">Set category / purpose</button>
            <button class="btn btn--ghost btn--sm" data-bulk="archive">Archive</button>
            <button class="btn btn--ghost btn--sm" data-bulk="restore">Restore</button>
            <button class="btn btn--ghost btn--sm" data-bulk="clear">Clear</button>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th class="chk"><input type="checkbox" id="selAll" aria-label="Select all shown"></th>${th('date', 'Date')}${th('name', 'Item')}<th>Kind</th><th>Category</th><th>Purpose</th>${th('amount', 'Amount', 'num')}<th>Paid with</th><th>Used by</th><th>Paperwork</th><th class="num">VAT</th><th>Tags</th><th title="Shared with accountant">Shared</th><th>📎</th><th></th></tr></thead>
            <tbody>${list.length ? list.map(itemRow).join('') : '<tr class="empty-row"><td colspan="15">No items match the filter.</td></tr>'}</tbody>
            <tfoot><tr><td colspan="6">Shown: ${list.length} item${list.length === 1 ? '' : 's'}</td><td class="num">${eur.format(costs)}</td><td colspan="3"></td><td class="num">${eur.format(list.reduce((s, i) => s + (vatBucket(i) !== 'none' ? Number(i.vatAmount) : 0), 0))}</td><td colspan="4" class="mini">VAT · expenses${recv ? ` · received ${eur.format(recv)}` : ''}</td></tr></tfoot>
          </table></div>
        </div>
      </div>`;
    const re = () => renderItems(body);
    const bind = (id, key, ev = 'change') => { const el = body.querySelector('#' + id); if (!el) return; el.addEventListener(ev, () => { S.filter[key] = el.type === 'checkbox' ? el.checked : el.value; re(); if (id === 'fSearch') { const n = body.querySelector('#fSearch'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); };
    bind('fSearch', 'search', 'input'); bind('fKind', 'kind'); bind('fCategory', 'category'); bind('fPurpose', 'purpose'); bind('fTag', 'tag'); bind('fDoc', 'doc'); bind('fShared', 'shared'); bind('fVat', 'vat'); bind('fUsed', 'usedBy'); bind('fFrom', 'from'); bind('fTo', 'to'); bind('fArch', 'archived'); bind('fReview', 'review');
    body.querySelectorAll('[data-sort]').forEach((t) => t.addEventListener('click', () => { const fl = t.dataset.sort; if (S.sort.field === fl) S.sort.dir = S.sort.dir === 'asc' ? 'desc' : 'asc'; else S.sort = { field: fl, dir: fl === 'date' ? 'desc' : 'asc' }; re(); }));
    body.querySelectorAll('[data-sel]').forEach((c) => c.addEventListener('change', () => { c.checked ? S.selected.add(c.dataset.sel) : S.selected.delete(c.dataset.sel); re(); }));
    body.querySelector('#selAll').addEventListener('change', (e) => { list.forEach((i) => (e.target.checked ? S.selected.add(i.id) : S.selected.delete(i.id))); re(); });
    body.querySelectorAll('[data-tagfilter]').forEach((b) => b.addEventListener('click', () => { S.filter.tag = S.filter.tag.toLowerCase() === b.dataset.tagfilter.toLowerCase() ? '' : b.dataset.tagfilter; re(); }));
    body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openItem(b.dataset.edit)));
    body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => deleteItem(b.dataset.del)));
    body.querySelectorAll('[data-rev]').forEach((b) => b.addEventListener('click', () => reviewRevenue(b.dataset.rev, b.dataset.as)));
    body.querySelectorAll('[data-bulk]').forEach((b) => b.addEventListener('click', () => bulk(b.dataset.bulk, body)));
    body.querySelector('#v2new').addEventListener('click', () => openItem(null));
    body.querySelector('#v2export').addEventListener('click', () => exportCsv(list));
  }

  async function reviewRevenue(id, as) {
    const patch = as === 'archive' ? { archived: true } : as === 'plan' ? { kind: 'plan' } : { kind: 'income', incomeType: as };
    try { await updateDoc(doc(db, 'budgetItems', id), patch); logEvent('budget_reviewed', { itemName: id, review: as }); await refresh(); }
    catch (e) { alert('Could not save: ' + e.message); }
  }
  async function bulk(action, body) {
    const ids = [...S.selected];
    if (action === 'clear') { S.selected.clear(); renderItems(body); return; }
    if (!ids.length) return;
    const tag = body.querySelector('#bulkTag').value.trim();
    if (action === 'tag' && !tag) { alert('Type the tag to add first.'); return; }
    const bCat = body.querySelector('#bulkCat')?.value || '', bPur = body.querySelector('#bulkPur')?.value || '';
    if (action === 'classify' && !bCat && !bPur) { alert('Choose a category and/or a purpose first.'); return; }
    if (action === 'archive' && !confirm(`Archive ${ids.length} item(s)? They stop counting in totals and can be restored.`)) return;
    try {
      for (const id of ids) {
        const it = S.items.find((x) => x.id === id); if (!it) continue;
        let p = null;
        if (action === 'share') p = { sharedAt: new Date().toISOString(), sharedBy: access.email, changedSinceShared: false };
        else if (action === 'unshare') p = { sharedAt: '', sharedBy: '', changedSinceShared: false };
        else if (action === 'tag') p = { tags: parseTags([...it.tags, tag]) };
        else if (action === 'classify') { if (it.kind === 'income') continue; p = { ...(bCat && it.kind === 'expense' ? { categoryId: bCat } : {}), ...(bPur ? { purposeId: bPur } : {}) }; if (!Object.keys(p).length) continue; }
        else if (action === 'archive') p = { archived: true };
        else if (action === 'restore') p = { archived: false };
        if (p) await updateDoc(doc(db, 'budgetItems', id), p);
      }
      logEvent('budget_bulk', { itemName: action, amount: ids.length });
      S.selected.clear(); await refresh();
    } catch (e) { alert('Could not save: ' + e.message); }
  }
  async function deleteItem(id) {
    const it = S.items.find((x) => x.id === id); if (!it) return;
    if (!confirm(`Delete "${it.name}"?\n\nThis permanently removes the item${it.attachments.length ? ' and its attachment(s)' : ''}. Archive it instead if you only want it out of the totals.`)) return;
    for (const a of it.attachments) { if (!a.filename) continue; try { await deleteObject(ref(storage, `budget/${a.filename}`)); } catch (e) { if (e.code !== 'storage/object-not-found') console.error('attachment delete:', e); } }
    await deleteDoc(doc(db, 'budgetItems', id));
    logEvent('budget_deleted', { itemName: it.name, amount: it.amount });
    await refresh();
  }
  function exportCsv(list) {
    if (!list.length) { alert('No items to export.'); return; }
    const cell = (v) => { const s = String(v == null ? '' : v); const d = /^[=+\-@\t\r]/.test(s) && isNaN(s); return `"${(d ? "'" + s : s).replace(/"/g, '""')}"`; };
    const head = ['Date', 'Item', 'Kind', 'Money received type', 'Category', 'Purpose', 'Amount (EUR)', 'Paid with', 'Paid personally by', 'Used by', 'Supplier', 'Supplier NIF / VAT ID', 'Document type', 'Invoice number', 'ATCUD', 'Invoice date', 'Invoice shows our NIF', 'VAT rate %', 'VAT amount', 'VAT deductible', 'VAT group', 'Country', 'Paperwork status', 'Tags', 'Shared with accountant', 'Shared on', 'Comments', 'Files'];
    const strip = (h) => String(h).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&');
    const rows = list.map((i) => [i.date, i.name, labelOf(KINDS, i.kind), i.kind === 'income' ? incomeLabel(i.incomeType) : '', i.kind === 'expense' ? catLabel(i.categoryId) : '', purLabel(i.purposeId), i.amount.toFixed(2),
      i.kind === 'expense' ? strip(paidWithLabel(i)) : '', i.paidPersonallyBy ? personLabel(i.paidPersonallyBy) : '', (i.usedBy || []).map((u) => personLabel(u.key)).join(' / '), i.supplierName, i.supplierTaxId, labelOf(DOC_TYPES, i.docType, ''), i.docNumber, i.atcud, i.invoiceDate, i.issuedToCompany || '', i.vatRate ?? '', i.vatAmount ?? '', i.kind === 'expense' ? labelOf(DEDUCTIBLE, i.vatDeductible || 'ask') : '', vatBucket(i) !== 'none' ? VAT_BUCKETS[vatBucket(i)].label : '', i.country ? (COUNTRY_NAME[i.country] || i.country) : '', i.kind === 'expense' ? docStatus(i).label : '', i.tags.join(', '), i.sharedAt ? 'Yes' : 'No', i.sharedAt ? String(i.sharedAt).slice(0, 10) : '', i.comments, i.attachments.length].map(cell).join(','));
    const csv = [head.map(cell).join(','), ...rows].join('\r\n');
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })), download: `douro-budget-${today()}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  }

  // ── Item form ──
  const fld = (label, tipKey, inner, extra = '') => `<div class="form-group" ${extra}><label>${label}${tipKey ? tip(tipKey) : ''}</label>${inner}</div>`;
  function paidWithOptions(sel) {
    const accs = S.accounts.map((a) => `<option value="account:${a.id}"${sel === 'account:' + a.id ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
    const cds = S.cards.map((c) => `<option value="card:${c.id}"${sel === 'card:' + c.id ? ' selected' : ''}>Card *${esc(c.last4)}${c.label ? ' ' + esc(c.label) : ''}${c.holderKey ? ' (' + esc(personLabel(c.holderKey)) + ')' : ''}</option>`).join('');
    return `<option value="">Not recorded</option>${accs ? `<optgroup label="Company accounts">${accs}</optgroup>` : ''}${cds ? `<optgroup label="Company cards">${cds}</optgroup>` : ''}<option value="cash"${sel === 'cash' ? ' selected' : ''}>Cash</option><option value="personal"${sel === 'personal' ? ' selected' : ''}>Paid personally (own money)…</option>`;
  }
  function sharesHtml(usedBy) {
    const sel = Object.fromEntries((usedBy || []).map((u) => [u.key, u.weight || 1]));
    const people = [...S.dir.filter((m) => m.active || sel[m.key]).map((m) => ({ key: m.key, label: m.label })), { key: 'external', label: 'External' }];
    return `<div class="shares">${people.map((p) => `<div class="share-row"><label><input type="checkbox" data-used="${esc(p.key)}" ${sel[p.key] ? 'checked' : ''}> ${esc(p.label)}</label><input type="number" min="0" step="any" data-weight="${esc(p.key)}" value="${esc(sel[p.key] || 1)}" title="Weight (share)" style="${sel[p.key] ? '' : 'visibility:hidden'}"></div>`).join('')}</div>`;
  }
  function openItem(id, preset) {
    const it = id ? S.items.find((x) => x.id === id) : null;
    S.edit = { id: id || null, attachments: it ? [...it.attachments] : [], movementId: preset?.movementId || null };
    const d = it || preset || { kind: 'expense', date: today(), country: 'PT', currency: 'EUR', issuedToCompany: 'unknown', docType: 'none', usedBy: [], tags: [], paidWith: '' };
    const sub = TEAM_PAY_SUBTYPES;
    openModal(`
      <h2>${it ? 'Edit item' : 'New item'}${it && it.legacy ? ' <span class="pill pill--review" style="vertical-align:middle">old item</span>' : ''}</h2>
      <div class="sect"><div class="sect-title">What</div>
        <div class="form-row">${fld('Kind', 'kind', `<select id="f-kind">${KINDS.map((k) => `<option value="${k.id}"${d.kind === k.id ? ' selected' : ''}>${k.label}</option>`).join('')}</select>`)}
          ${fld('Date', '', `<input type="date" id="f-date" value="${esc(d.date || '')}">`)}</div>
        <div class="form-group"><label for="f-name">Name</label><input type="text" id="f-name" value="${esc(d.name || '')}" placeholder="e.g. Train Lisbon–Porto, Accounting (October)"></div>
        <div class="form-row">${fld('Amount in euros', '', `<input type="number" id="f-amount" step="0.01" min="0" value="${esc(d.amount ?? '')}" placeholder="0.00">`)}
          <div id="f-incomewrap">${fld('Type of money received', 'incomeType', `<select id="f-income">${INCOME_TYPES.map((t) => `<option value="${t.id}"${d.incomeType === t.id ? ' selected' : ''} title="${esc(t.hint)}">${t.label}</option>`).join('')}</select>`)}</div></div>
        <div id="f-counterwrap">${fld('From', 'counterparty', `<input type="text" id="f-counter" value="${esc(d.counterparty || '')}" placeholder="e.g. investor name">`)}</div>
      </div>
      <div class="sect" id="f-classify"><div class="sect-title">Classification</div>
        <div class="form-row">${fld('Category', 'category', `<select id="f-category">${opts(activeOnly(S.lists.categories, d.categoryId), d.categoryId || (it ? 'other' : ''), it ? null : 'Choose…')}</select>`)}
          ${fld('Purpose', 'purpose', `<select id="f-purpose">${opts(activeOnly(S.lists.purposes, d.purposeId), d.purposeId || '', 'None')}</select>`)}</div>
        <div id="f-subwrap">${fld('Team pay type', 'subtype', `<select id="f-subtype"><option value="">—</option>${sub.map((s) => `<option value="${s.id}"${d.subtype === s.id ? ' selected' : ''}>${s.label}</option>`).join('')}</select>`)}</div>
        ${fld('Tags', 'tags', `<input type="text" id="f-tags" list="f-taglist" value="${esc((d.tags || []).join(', '))}" placeholder="Spain trip, Frutas Mangas field visit"><datalist id="f-taglist">${allTags().map((t) => `<option value="${esc(t)}">`).join('')}</datalist>`)}
      </div>
      <div class="sect" id="f-who"><div class="sect-title">Who and how it was paid</div>
        <div class="form-row">${fld('Paid with', 'paidWith', `<select id="f-paidwith">${paidWithOptions(d.paidWith)}</select>`)}
          <div id="f-personalwrap">${fld('Paid personally by', 'paidPersonallyBy', `<select id="f-personal"><option value="">Choose…</option>${S.dir.filter((m) => m.active || m.key === d.paidPersonallyBy).map((m) => `<option value="${esc(m.key)}"${d.paidPersonallyBy === m.key ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}</select>`)}</div></div>
        ${fld('Used by', 'usedBy', sharesHtml(d.usedBy))}
      </div>
      <div class="sect" id="f-docsect"><div class="sect-title">Paperwork</div>
        <div class="warnbox" id="f-warn"></div>
        <div class="form-row">${fld('Document', 'docType', `<select id="f-doctype">${DOC_TYPES.map((t) => `<option value="${t.id}"${d.docType === t.id ? ' selected' : ''}>${t.label}</option>`).join('')}</select>`)}
          ${fld('Invoice shows our NIF', 'issuedToCompany', `<select id="f-issued"><option value="unknown"${d.issuedToCompany === 'unknown' || !d.issuedToCompany ? ' selected' : ''}>Unknown</option><option value="yes"${d.issuedToCompany === 'yes' ? ' selected' : ''}>Yes</option><option value="no"${d.issuedToCompany === 'no' ? ' selected' : ''}>No</option></select>`)}</div>
        <div class="form-row">${fld('Supplier', 'supplier', `<input type="text" id="f-supplier" list="f-suplist" value="${esc(d.supplierName || '')}" placeholder="Name"><datalist id="f-suplist">${S.suppliers.filter((s) => !s.archived).map((s) => `<option value="${esc(s.name)}">`).join('')}</datalist>`)}
          ${fld('Supplier NIF / VAT ID', 'supplierTaxId', `<input type="text" id="f-taxid" value="${esc(d.supplierTaxId || '')}" placeholder="NIF or VAT ID">`)}</div>
        <div class="form-row">${fld('Invoice number', 'docNumber', `<input type="text" id="f-docnum" value="${esc(d.docNumber || '')}">`)}${fld('ATCUD', 'atcud', `<input type="text" id="f-atcud" value="${esc(d.atcud || '')}" placeholder="Optional">`)}</div>
        <div class="form-row">${fld('Invoice date', 'invoiceDate', `<input type="date" id="f-invdate" value="${esc(d.invoiceDate || '')}">`)}
          ${fld('Country', 'country', `<select id="f-country">${COUNTRIES.map(([c, n]) => `<option value="${c}"${(d.country || 'PT') === c ? ' selected' : ''}>${n}</option>`).join('')}</select>`)}</div>
        <div class="form-row">${fld('VAT rate %', 'vatRate', `<input type="number" id="f-vatrate" step="any" min="0" value="${esc(d.vatRate ?? '')}" list="f-vatlist"><datalist id="f-vatlist">${[0, 4, 6, 9, 12, 13, 16, 22, 23].map((v) => `<option value="${v}">`).join('')}</datalist>`)}
          ${fld('VAT amount', 'vatAmount', `<input type="number" id="f-vatamt" step="0.01" min="0" value="${esc(d.vatAmount ?? '')}">`)}</div>
        ${fld('VAT deductible?', 'vatDeductible', `<select id="f-vatded">${DEDUCTIBLE.map((x) => `<option value="${x.id}"${(d.vatDeductible || 'ask') === x.id ? ' selected' : ''}>${x.label}</option>`).join('')}</select>`)}
        <div class="form-row">${fld('Currency', 'currency', `<select id="f-currency">${['EUR', 'GBP', 'USD', 'CHF', 'SEK', 'DKK', 'PLN'].map((c) => `<option${(d.currency || 'EUR') === c ? ' selected' : ''}>${c}</option>`).join('')}</select>`)}
          <div id="f-origwrap">${fld('Amount in that currency', '', `<input type="number" id="f-orig" step="0.01" min="0" value="${esc(d.originalAmount ?? '')}">`)}</div></div>
        <div class="checkline" style="margin-bottom:14px"><input type="checkbox" id="f-waived" ${d.docWaived ? 'checked' : ''}><label for="f-waived">No document needed for this item${tip('waived')}</label></div>
        <div id="f-waivedwrap">${fld('Why', '', `<input type="text" id="f-waivedwhy" value="${esc(typeof d.docWaived === 'string' ? d.docWaived : '')}" placeholder="e.g. toll paid in cash, no receipt available">`)}</div>
      </div>
      <div class="sect"><div class="sect-title">Notes and files</div>
        <div class="form-group"><label for="f-comments">Comments</label><textarea id="f-comments" placeholder="Optional notes…">${esc(d.comments || '')}</textarea></div>
        <div class="form-group"><label>Files (PDF or image)</label><input type="file" id="f-files" accept="application/pdf,image/png,image/jpeg" multiple><div class="attach-list" id="f-attlist"></div>
          <div class="upload-progress" id="f-up"><span class="hint" id="f-uptxt">Uploading…</span><div class="progress"><div class="progress__bar" id="f-upbar" style="width:0%"></div></div></div></div>
        <div class="checkline" style="margin-bottom:14px"><input type="checkbox" id="f-shared" ${d.sharedAt ? 'checked' : ''}><label for="f-shared">Shared with the accountant${tip('shared')}</label></div>
      </div>
      <div class="modal-actions"><button class="btn btn--ghost" id="f-cancel">Cancel</button><button class="btn btn--primary" id="f-save">Save</button></div>`);
    wireItemForm(it);
  }
  function wireItemForm(existing) {
    const m = root.querySelector('#v2modalBox'), $ = (id) => m.querySelector('#' + id);
    const company = S.company || {};
    const readDraft = () => ({
      kind: $('f-kind').value, categoryId: $('f-category').value, amount: parseFloat($('f-amount').value) || 0, docType: $('f-doctype').value,
      issuedToCompany: $('f-issued').value, supplierName: $('f-supplier').value, supplierTaxId: $('f-taxid').value, docNumber: $('f-docnum').value,
      // Files picked but not saved yet count too, so the warning clears as soon as a file is chosen.
      attachments: [...S.edit.attachments, ...Array.from($('f-files').files || []).map((f) => ({ name: f.name }))],
      docWaived: $('f-waived').checked ? ($('f-waivedwhy').value.trim() || true) : false,
    });
    const sync = () => {
      const k = $('f-kind').value, expense = k === 'expense', income = k === 'income';
      $('f-incomewrap').style.display = income ? '' : 'none'; $('f-counterwrap').style.display = income ? '' : 'none';
      $('f-classify').style.display = expense || k === 'plan' ? '' : 'none';
      $('f-who').style.display = expense ? '' : 'none'; $('f-docsect').style.display = expense ? '' : 'none';
      $('f-subwrap').style.display = expense && $('f-category').value === 'team-pay' ? '' : 'none';
      $('f-personalwrap').style.display = $('f-paidwith').value === 'personal' ? '' : 'none';
      $('f-origwrap').style.display = $('f-currency').value !== 'EUR' ? '' : 'none';
      $('f-waivedwrap').style.display = $('f-waived').checked ? '' : 'none';
      m.querySelectorAll('[data-used]').forEach((c) => { const w = m.querySelector(`[data-weight="${c.dataset.used}"]`); w.style.visibility = c.checked ? '' : 'hidden'; });
      const ds = docStatus(readDraft()), box = $('f-warn');
      const reminder = company.companyName || company.companyNif ? `Ask for the invoice in the name of <strong>${esc(company.companyName || '')}</strong>${company.companyNif ? `, NIF <strong>${esc(company.companyNif)}</strong>` : ''}${company.companyAddress ? `, ${esc(String(company.companyAddress).replace(/\n/g, ', '))}` : ''}.` : 'Fill in Company details in Settings to see the name and NIF to ask for.';
      const msgs = { ok: 'Invoice complete: file, our NIF, supplier, tax ID and number are all there.', incomplete: `Invoice details missing: ${ds.missing.map((x) => ({ supplierName: 'supplier name', supplierTaxId: 'supplier NIF / VAT ID', docNumber: 'invoice number' }[x] || x)).join(', ')}.`, noNif: 'The invoice must show our company NIF. Set “Invoice shows our NIF” to Yes once you have checked, or ask the supplier to reissue it.', receiptOnly: 'A receipt or simplified invoice is not enough for tax: ask the supplier for an invoice with our NIF.', noDocument: 'No document yet: attach the invoice (PDF or photo) and pick its type.', notRequired: 'No document needed for this item.' };
      box.className = 'warnbox ' + ds.level;
      box.innerHTML = `<strong>${esc(ds.label)}.</strong> ${msgs[ds.code]}${ds.level === 'warn' ? `<div style="margin-top:4px">${reminder}</div>` : ''}`;
    };
    m.addEventListener('input', sync); m.addEventListener('change', sync);
    const renderAtt = () => {
      const el = $('f-attlist');
      el.innerHTML = S.edit.attachments.map((a, i) => `<span class="attach-chip"><a href="${esc(a.url || '#')}" target="_blank" rel="noopener">${esc(a.name || 'file')}</a><span class="rm" data-rm="${i}" title="Remove">×</span></span>`).join('');
      el.querySelectorAll('.rm').forEach((r) => r.addEventListener('click', () => { S.edit.attachments.splice(Number(r.dataset.rm), 1); renderAtt(); sync(); }));
    };
    renderAtt();
    // Picking a saved supplier fills what is still empty.
    $('f-supplier').addEventListener('change', () => {
      const s = S.suppliers.find((x) => x.name.toLowerCase() === $('f-supplier').value.trim().toLowerCase()); if (!s) return;
      if (!$('f-taxid').value) $('f-taxid').value = s.taxId || '';
      if (s.country) $('f-country').value = s.country;
      if (!$('f-category').value && s.defaultCategoryId) $('f-category').value = s.defaultCategoryId;
      if (!$('f-purpose').value && s.defaultPurposeId) $('f-purpose').value = s.defaultPurposeId;
      sync();
    });
    // VAT amount from the rate while the amount was not typed by hand.
    let vatTouched = !!(existing && existing.vatAmount != null && existing.vatAmount !== '');
    $('f-vatamt').addEventListener('input', () => { vatTouched = true; });
    const vatCalc = () => { if (vatTouched) return; const r = parseFloat($('f-vatrate').value), a = parseFloat($('f-amount').value); if (r >= 0 && a > 0) $('f-vatamt').value = (a - a / (1 + r / 100)).toFixed(2); };
    $('f-vatrate').addEventListener('input', vatCalc); $('f-amount').addEventListener('input', vatCalc);
    $('f-cancel').addEventListener('click', closeModal);
    $('f-save').addEventListener('click', () => saveItem(existing));
    sync();
  }
  async function uploadFiles(files, m) {
    const out = [], wrap = m.querySelector('#f-up'), bar = m.querySelector('#f-upbar'), txt = m.querySelector('#f-uptxt');
    wrap.style.display = 'block';
    for (let n = 0; n < files.length; n++) {
      const file = files[n];
      if (file.size > 20 * 1024 * 1024) { alert(`"${file.name}" is larger than 20 MB — skipped.`); continue; }
      txt.textContent = `Uploading ${n + 1}/${files.length}: ${file.name}`;
      const filename = `${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
      const task = uploadBytesResumable(ref(storage, `budget/${filename}`), file);
      await new Promise((res, rej) => task.on('state_changed', (s) => { bar.style.width = Math.round((s.bytesTransferred / s.totalBytes) * 100) + '%'; }, rej, res));
      out.push({ name: file.name, url: await getDownloadURL(task.snapshot.ref), filename });
    }
    wrap.style.display = 'none'; bar.style.width = '0%';
    return out;
  }
  async function saveItem(existing) {
    const m = root.querySelector('#v2modalBox'), $ = (id) => m.querySelector('#' + id);
    const kind = $('f-kind').value, name = $('f-name').value.trim(), amount = parseFloat($('f-amount').value);
    if (!name) { alert('Name is required.'); return; }
    if (isNaN(amount)) { alert('Please enter a valid amount.'); return; }
    if (kind === 'expense' && !$('f-category').value) { alert('Choose a category.'); return; }
    const btn = $('f-save'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const files = $('f-files').files;
      const attachments = [...S.edit.attachments, ...(files.length ? await uploadFiles(files, m) : [])];
      const usedBy = [...m.querySelectorAll('[data-used]:checked')].map((c) => ({ key: c.dataset.used, weight: Number(m.querySelector(`[data-weight="${c.dataset.used}"]`).value) > 0 ? Number(m.querySelector(`[data-weight="${c.dataset.used}"]`).value) : 1 }));
      const expense = kind === 'expense';
      const cat = $('f-category').value;
      const supplierName = expense ? $('f-supplier').value.trim() : '';
      const taxRaw = expense ? $('f-taxid').value.trim() : '';
      // A Portuguese NIF is kept as 9 digits ("PT 600 084 779" → 600084779); a foreign VAT ID is kept as typed.
      const taxId = $('f-country').value === 'PT' && /^\s*(PT)?[\s.\-\d]+$/i.test(taxRaw) ? normalizeNif(taxRaw) : taxRaw;
      const paidWith = expense ? $('f-paidwith').value : '';
      const data = {
        kind, name, amount, date: $('f-date').value || '',
        type: kind === 'expense' ? 'cost' : 'revenue',                  // keeps the v1 page readable if the switch is turned Off
        category: existing?.category || (kind === 'expense' ? 'Other' : 'Other'),
        periodicity: existing?.periodicity || 'one_time',
        categoryId: expense ? cat : '', subtype: expense && cat === 'team-pay' ? $('f-subtype').value : '',
        purposeId: expense || kind === 'plan' ? $('f-purpose').value : '',
        tags: parseTags($('f-tags').value),
        incomeType: kind === 'income' ? $('f-income').value : '', counterparty: kind === 'income' ? $('f-counter').value.trim() : '',
        paidWith, paidPersonallyBy: expense && paidWith === 'personal' ? $('f-personal').value : '',
        usedBy: expense ? usedBy : [],
        docType: expense ? $('f-doctype').value : '', issuedToCompany: expense ? $('f-issued').value : '',
        supplierName, supplierTaxId: taxId, docNumber: expense ? $('f-docnum').value.trim() : '', atcud: expense ? $('f-atcud').value.trim() : '',
        invoiceDate: expense ? $('f-invdate').value || '' : '', country: expense ? $('f-country').value : '',
        vatRate: expense && $('f-vatrate').value !== '' ? Number($('f-vatrate').value) : null,
        vatAmount: expense && $('f-vatamt').value !== '' ? Number($('f-vatamt').value) : null,
        vatDeductible: expense ? $('f-vatded').value : '',
        currency: expense ? $('f-currency').value : 'EUR', originalAmount: expense && $('f-currency').value !== 'EUR' && $('f-orig').value !== '' ? Number($('f-orig').value) : null,
        docWaived: expense && $('f-waived').checked ? ($('f-waivedwhy').value.trim() || true) : false,
        comments: $('f-comments').value.trim(), attachments,
      };
      if (expense && data.paidWith === 'personal' && !data.paidPersonallyBy) { alert('Choose who paid personally.'); btn.disabled = false; btn.textContent = 'Save'; return; }
      const wasShared = !!existing?.sharedAt, nowShared = $('f-shared').checked;
      if (nowShared && !wasShared) { data.sharedAt = new Date().toISOString(); data.sharedBy = access.email; data.changedSinceShared = false; }
      else if (!nowShared) { data.sharedAt = ''; data.sharedBy = ''; data.changedSinceShared = false; }
      else data.changedSinceShared = true;   // it was already sent and this save may change it (Stage 5 refines this)
      // A new supplier name is saved for next time.
      if (expense && supplierName && !S.suppliers.some((s) => s.name.toLowerCase() === supplierName.toLowerCase())) {
        const sid = await addDoc(collection(db, 'budgetSuppliers'), { name: supplierName, taxId, country: data.country, type: 'other', defaultCategoryId: cat, defaultPurposeId: data.purposeId, aliases: [], notes: '', archived: false, createdAt: serverTimestamp(), createdBy: access.email });
        data.supplierId = sid.id;
      } else if (expense && supplierName) data.supplierId = S.suppliers.find((s) => s.name.toLowerCase() === supplierName.toLowerCase())?.id || '';
      if (existing) { await updateDoc(doc(db, 'budgetItems', existing.id), data); logEvent('budget_edited', { itemName: name, amount }); }
      else {
        const movementId = S.edit?.movementId || '';
        if (movementId) data.movementId = movementId;
        const added = await addDoc(collection(db, 'budgetItems'), { ...data, createdAt: serverTimestamp(), createdBy: access.email });
        if (movementId) await updateDoc(doc(db, 'budgetMovements', movementId), { status: 'linked', itemId: added.id });
        logEvent('budget_added', { itemName: name, amount });
      }
      closeModal(); await refresh();
    } catch (e) { alert('Failed to save: ' + e.message); btn.disabled = false; btn.textContent = 'Save'; }
  }

  // ── Accounts ──
  const copyText = async (text, el) => { try { await navigator.clipboard.writeText(text); if (el) { const n = document.createElement('span'); n.className = 'copy-note'; n.textContent = 'Copied'; el.after(n); setTimeout(() => n.remove(), 1500); } } catch (e) { prompt('Copy:', text); } };
  function renderAccounts(body) {
    const o = overview(S.items);
    const partners = S.dir.filter((m) => m.partner);
    const cardsOf = (id) => S.cards.filter((c) => c.accountId === id);
    body.innerHTML = `
      <div class="section"><div class="section-header"><h2 class="section-title">Company accounts</h2><div class="section-actions"><button class="btn btn--primary" id="a-new" data-perm="budget.edit">+ Account</button></div></div>
        <div class="cardgrid">${S.accounts.length ? S.accounts.map((a) => `<div class="acard"><h3>${esc(a.name)}</h3><div class="mini">${esc(a.bank || '')} · ${a.kind === 'cash' ? 'Cash' : 'Bank account'} · ${esc(a.currency || 'EUR')}${a.holderKey ? ' · ' + esc(personLabel(a.holderKey)) : ' · Company'}</div>
          <div class="iban">${a.iban ? esc(formatIban(a.iban)) : '<span class="mini">No IBAN yet</span>'}</div>
          ${a.fileAccountNo ? `<div class="mini">In bank files: ${esc(a.fileAccountNo)}</div>` : ''}
          ${a.openingBalance != null && a.openingBalance !== '' ? `<div class="mini">Opening balance ${eur.format(a.openingBalance)} on ${fmtDate(a.openingDate)}</div>` : ''}
          <div style="margin-top:10px">${cardsOf(a.id).map((c) => `<div class="mini" style="display:flex;gap:8px;align-items:center">💳 *${esc(c.last4)} ${esc(c.label || '')} · ${esc(c.holderKey ? personLabel(c.holderKey) : 'Company')} <button class="icon-btn" data-card="${c.id}" data-perm="budget.edit" title="Edit card">✎</button></div>`).join('') || '<div class="mini">No cards.</div>'}</div>
          <div class="row-actions">${a.iban ? `<button class="btn btn--ghost btn--sm" data-copyiban="${a.id}">Copy IBAN</button>` : ''}<button class="btn btn--ghost btn--sm" data-newcard="${a.id}" data-perm="budget.edit">+ Card</button><button class="btn btn--ghost btn--sm" data-acc="${a.id}" data-perm="budget.edit">Edit</button></div></div>`).join('') : '<div class="card" style="padding:24px"><span class="mini">No accounts yet. Add Santander and BiG, then add the company card *0435 on Santander.</span></div>'}</div></div>
      <div class="section"><div class="section-header"><h2 class="section-title">Partner profiles</h2></div>
        <p class="mini" style="margin:-6px 0 14px">Each partner keeps their own IBAN here so the other can transfer money back. The app never moves money.</p>
        <div class="cardgrid">${partners.map((p) => { const pr = S.people[p.key] || {}; const mine = isAdmin || myKey === p.key; const owed = o.owedToPartners[p.key] || 0; return `<div class="acard"><h3>${esc(p.name || p.label)}</h3><div class="mini">${esc(pr.bank || '')}</div>
          <div class="iban">${pr.iban ? esc(formatIban(pr.iban)) : '<span class="mini">No IBAN yet</span>'}</div>
          ${owed > 0 ? `<div class="mini">The company owes ${eur.format(owed)} (paid personally, not reimbursed)</div>` : ''}
          <div class="row-actions">${pr.iban ? `<button class="btn btn--ghost btn--sm" data-copyp="${esc(p.key)}">Copy IBAN</button><button class="btn btn--ghost btn--sm" data-copyd="${esc(p.key)}">Copy transfer details</button>` : ''}${mine ? `<button class="btn btn--ghost btn--sm" data-prof="${esc(p.key)}">Edit</button>` : ''}</div></div>`; }).join('') || '<span class="mini">No partners found in the team directory.</span>'}</div></div>`;
    body.querySelector('#a-new').addEventListener('click', () => openAccount(null));
    body.querySelectorAll('[data-acc]').forEach((b) => b.addEventListener('click', () => openAccount(b.dataset.acc)));
    body.querySelectorAll('[data-newcard]').forEach((b) => b.addEventListener('click', () => openCard(null, b.dataset.newcard)));
    body.querySelectorAll('[data-card]').forEach((b) => b.addEventListener('click', () => openCard(b.dataset.card)));
    body.querySelectorAll('[data-copyiban]').forEach((b) => b.addEventListener('click', () => copyText(cleanIban(accountOf(b.dataset.copyiban).iban), b)));
    body.querySelectorAll('[data-copyp]').forEach((b) => b.addEventListener('click', () => copyText(cleanIban(S.people[b.dataset.copyp].iban), b)));
    body.querySelectorAll('[data-copyd]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.copyd, p = partners.find((x) => x.key === k), pr = S.people[k]; const owed = o.owedToPartners[k] || 0; copyText(`${pr.holderName || p.name}\nIBAN ${formatIban(pr.iban)}${pr.bank ? '\n' + pr.bank : ''}${owed > 0 ? `\nAmount ${owed.toFixed(2)} EUR` : ''}\nReference: ${INSTANCE.orgName} reimbursement`, b); }));
    body.querySelectorAll('[data-prof]').forEach((b) => b.addEventListener('click', () => openProfile(b.dataset.prof)));
  }
  function ibanHint(v) { const st = ibanStatus(v); return st === 'empty' ? '' : st === 'ok' ? '✓ Valid IBAN.' : 'This IBAN does not pass the check digits, so there is probably a typo. You can still save it.'; }
  function openAccount(id) {
    const a = id ? accountOf(id) : { kind: 'bank', currency: 'EUR' };
    openModal(`<h2>${id ? 'Edit account' : 'New account'}</h2>
      <div class="form-group"><label for="a-name">Name</label><input type="text" id="a-name" value="${esc(a.name || '')}" placeholder="e.g. Santander main"></div>
      <div class="form-row"><div class="form-group"><label for="a-bank">Bank</label><input type="text" id="a-bank" value="${esc(a.bank || '')}" placeholder="Santander, BiG…"></div>
        <div class="form-group"><label for="a-kind">Type</label><select id="a-kind"><option value="bank"${a.kind !== 'cash' ? ' selected' : ''}>Bank account</option><option value="cash"${a.kind === 'cash' ? ' selected' : ''}>Cash</option></select></div></div>
      ${fld('IBAN', 'iban', `<input type="text" id="a-iban" value="${esc(formatIban(a.iban || ''))}" placeholder="PT50 …"><div class="hint" id="a-ibanhint">${ibanHint(a.iban)}</div>`)}
      ${fld('Account number in bank files', 'fileAccountNo', `<input type="text" id="a-fileno" value="${esc(a.fileAccountNo || '')}" placeholder="e.g. 000370071261020">`)}
      <div class="form-row"><div class="form-group"><label for="a-open">Opening balance (€)</label><input type="number" id="a-open" step="0.01" value="${esc(a.openingBalance ?? '')}"></div>
        <div class="form-group"><label for="a-opendate">On</label><input type="date" id="a-opendate" value="${esc(a.openingDate || '')}"></div></div>
      <div class="modal-actions">${id ? '<button class="btn btn--danger" id="a-del" style="margin-right:auto">Delete</button>' : ''}<button class="btn btn--ghost" id="a-cancel">Cancel</button><button class="btn btn--primary" id="a-save">Save</button></div>`);
    const m = root.querySelector('#v2modalBox');
    m.querySelector('#a-iban').addEventListener('input', (e) => { m.querySelector('#a-ibanhint').textContent = ibanHint(e.target.value); });
    m.querySelector('#a-cancel').addEventListener('click', closeModal);
    m.querySelector('#a-save').addEventListener('click', async () => {
      const name = m.querySelector('#a-name').value.trim(); if (!name) { alert('Name is required.'); return; }
      const iban = cleanIban(m.querySelector('#a-iban').value);
      const ob = m.querySelector('#a-open').value;
      const data = { name, bank: m.querySelector('#a-bank').value.trim(), kind: m.querySelector('#a-kind').value, currency: 'EUR', iban, fileAccountNo: m.querySelector('#a-fileno').value.trim(), openingBalance: ob === '' ? null : Number(ob), openingDate: m.querySelector('#a-opendate').value || '' };
      try { if (id) await updateDoc(doc(db, 'budgetAccounts', id), data); else await addDoc(collection(db, 'budgetAccounts'), { ...data, createdAt: serverTimestamp(), createdBy: access.email }); logEvent('budget_account_saved', { itemName: name }); closeModal(); await refresh(); } catch (e) { alert('Failed to save: ' + e.message); }
    });
    const del = m.querySelector('#a-del');
    if (del) del.addEventListener('click', async () => {
      const used = S.items.filter((i) => (i.paidWith || '').startsWith('account:' + id) || cardsOfAccountIds(id).some((c) => i.paidWith === 'card:' + c)).length;
      if (!confirm(used ? `${used} item(s) use this account. Delete it anyway? They keep their other data but lose the account.` : `Delete "${a.name}" and its cards?`)) return;
      try { for (const c of S.cards.filter((x) => x.accountId === id)) await deleteDoc(doc(db, 'budgetCards', c.id)); await deleteDoc(doc(db, 'budgetAccounts', id)); logEvent('budget_account_deleted', { itemName: a.name }); closeModal(); await refresh(); } catch (e) { alert('Failed: ' + e.message); }
    });
  }
  const cardsOfAccountIds = (id) => S.cards.filter((c) => c.accountId === id).map((c) => c.id);
  function openCard(id, accountId) {
    const c = id ? cardOf(id) : { accountId, holderKey: myKey || '' };
    openModal(`<h2>${id ? 'Edit card' : 'New card'}</h2>
      <div class="form-row"><div class="form-group"><label for="c-last4">Last four digits</label><input type="text" id="c-last4" maxlength="4" inputmode="numeric" value="${esc(c.last4 || '')}" placeholder="0435"></div>
        <div class="form-group"><label for="c-label">Label</label><input type="text" id="c-label" value="${esc(c.label || '')}" placeholder="optional"></div></div>
      <div class="form-row"><div class="form-group"><label for="c-acc">Draws on account</label><select id="c-acc">${opts(S.accounts.map((a) => ({ id: a.id, label: a.name })), c.accountId, null)}</select></div>
        <div class="form-group"><label for="c-holder">Cardholder</label><select id="c-holder"><option value="">Company</option>${S.dir.filter((m) => m.active || m.key === c.holderKey).map((m) => `<option value="${esc(m.key)}"${c.holderKey === m.key ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}</select></div></div>
      <p class="hint">The cardholder is whose name is on the card. It does not say who used it: that is "Used by" on each item.</p>
      <div class="modal-actions">${id ? '<button class="btn btn--danger" id="c-del" style="margin-right:auto">Delete</button>' : ''}<button class="btn btn--ghost" id="c-cancel">Cancel</button><button class="btn btn--primary" id="c-save">Save</button></div>`);
    const m = root.querySelector('#v2modalBox');
    m.querySelector('#c-cancel').addEventListener('click', closeModal);
    m.querySelector('#c-save').addEventListener('click', async () => {
      const l4 = last4(m.querySelector('#c-last4').value); if (l4.length !== 4) { alert('Enter the last four digits of the card.'); return; }
      const data = { last4: l4, label: m.querySelector('#c-label').value.trim(), accountId: m.querySelector('#c-acc').value, holderKey: m.querySelector('#c-holder').value };
      if (!data.accountId) { alert('Add the account first, then its cards.'); return; }
      try { if (id) await updateDoc(doc(db, 'budgetCards', id), data); else await addDoc(collection(db, 'budgetCards'), { ...data, createdAt: serverTimestamp(), createdBy: access.email }); logEvent('budget_card_saved', { itemName: '*' + l4 }); closeModal(); await refresh(); } catch (e) { alert('Failed to save: ' + e.message); }
    });
    const del = m.querySelector('#c-del');
    if (del) del.addEventListener('click', async () => { if (!confirm(`Delete card *${c.last4}?`)) return; try { await deleteDoc(doc(db, 'budgetCards', id)); closeModal(); await refresh(); } catch (e) { alert('Failed: ' + e.message); } });
  }
  function openProfile(key) {
    const p = S.dir.find((m) => m.key === key) || { name: key }, pr = S.people[key] || {};
    openModal(`<h2>${esc(p.name || key)} — IBAN profile</h2>
      <div class="form-group"><label for="p-holder">Name on the account</label><input type="text" id="p-holder" value="${esc(pr.holderName || p.name || '')}"></div>
      <div class="form-group"><label for="p-bank">Bank</label><input type="text" id="p-bank" value="${esc(pr.bank || '')}"></div>
      ${fld('IBAN', 'iban', `<input type="text" id="p-iban" value="${esc(formatIban(pr.iban || ''))}" placeholder="PT50 …"><div class="hint" id="p-ibanhint">${ibanHint(pr.iban)}</div>`)}
      <p class="hint">Visible to the Partners and the Admin. You can edit only your own profile.</p>
      <div class="modal-actions"><button class="btn btn--ghost" id="p-cancel">Cancel</button><button class="btn btn--primary" id="p-save">Save</button></div>`);
    const m = root.querySelector('#v2modalBox');
    m.querySelector('#p-iban').addEventListener('input', (e) => { m.querySelector('#p-ibanhint').textContent = ibanHint(e.target.value); });
    m.querySelector('#p-cancel').addEventListener('click', closeModal);
    m.querySelector('#p-save').addEventListener('click', async () => {
      const data = { holderName: m.querySelector('#p-holder').value.trim(), bank: m.querySelector('#p-bank').value.trim(), iban: cleanIban(m.querySelector('#p-iban').value), updatedBy: access.email, updatedAt: serverTimestamp() };
      try { await setDoc(doc(db, 'budgetPeople', key), data, { merge: true }); logEvent('budget_profile_saved', { itemName: key }); closeModal(); await refresh(); } catch (e) { alert('Failed to save: ' + e.message); }
    });
  }

  // ── Suppliers ──
  function renderSuppliers(body) {
    const spent = (s) => S.items.filter((i) => !i.archived && i.kind === 'expense' && (i.supplierId === s.id || (i.supplierName || '').toLowerCase() === s.name.toLowerCase()));
    const rows = S.suppliers.slice().sort((a, b) => a.name.localeCompare(b.name)).map((s) => { const its = spent(s), tot = its.reduce((x, i) => x + i.amount, 0), w = its.filter((i) => docStatus(i).level === 'warn').length; return `<tr style="${s.archived ? 'opacity:.5' : ''}"><td><strong>${esc(s.name)}</strong>${s.aliases?.length ? `<div class="mini">Bank lines: ${esc(s.aliases.join(', '))}</div>` : ''}</td><td>${esc(SUPPLIER_TYPE_NAME[s.type] || '')}</td><td>${esc(s.taxId || '')}</td><td>${esc(COUNTRY_NAME[s.country] || s.country || '')}</td><td>${esc(catLabel(s.defaultCategoryId))}${s.defaultPurposeId ? `<div class="mini">${esc(purLabel(s.defaultPurposeId))}</div>` : ''}</td><td class="num">${eur.format(tot)}<div class="mini">${its.length} item${its.length === 1 ? '' : 's'}${w ? ` · <span style="color:#8A5A00">${w} ⚠</span>` : ''}</div></td><td class="num">${eur.format(its.reduce((x, i) => x + (vatBucket(i) !== 'none' ? Number(i.vatAmount) : 0), 0))}</td><td style="text-align:right"><button class="icon-btn" data-sup="${s.id}" data-perm="budget.edit" title="Edit">✎</button></td></tr>`; }).join('');
    body.innerHTML = `<div class="section"><div class="section-header"><h2 class="section-title">Suppliers</h2><div class="section-actions"><button class="btn btn--primary" id="s-new" data-perm="budget.edit">+ Supplier</button></div></div>
      <p class="mini" style="margin:-6px 0 14px">Anyone we pay: the accountant, the lawyer, the office, Uber, a searcher's own company. A new supplier name typed on an item is saved here automatically.</p>
      <div class="card"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>NIF / VAT ID</th><th>Country</th><th>Defaults</th><th class="num">Spent</th><th class="num">VAT</th><th></th></tr></thead><tbody>${rows || '<tr class="empty-row"><td colspan="8">No suppliers yet.</td></tr>'}</tbody></table></div></div></div>`;
    body.querySelector('#s-new').addEventListener('click', () => openSupplier(null));
    body.querySelectorAll('[data-sup]').forEach((b) => b.addEventListener('click', () => openSupplier(b.dataset.sup)));
  }
  function openSupplier(id) {
    const s = id ? S.suppliers.find((x) => x.id === id) : { country: 'PT', type: 'other', aliases: [] };
    openModal(`<h2>${id ? 'Edit supplier' : 'New supplier'}</h2>
      <div class="form-group"><label for="s-name">Name</label><input type="text" id="s-name" value="${esc(s.name || '')}"></div>
      <div class="form-row">${fld('NIF / VAT ID', 'supplierTaxId', `<input type="text" id="s-tax" value="${esc(s.taxId || '')}"><div class="hint" id="s-taxhint"></div>`)}
        <div class="form-group"><label for="s-country">Country</label><select id="s-country">${COUNTRIES.map(([c, n]) => `<option value="${c}"${(s.country || 'PT') === c ? ' selected' : ''}>${n}</option>`).join('')}</select></div></div>
      <div class="form-group"><label for="s-type">Type</label><select id="s-type">${SUPPLIER_TYPES.map(([k, l]) => `<option value="${k}"${s.type === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="form-row"><div class="form-group"><label for="s-cat">Default category</label><select id="s-cat">${opts(activeOnly(S.lists.categories, s.defaultCategoryId), s.defaultCategoryId || '', 'None')}</select></div>
        <div class="form-group"><label for="s-pur">Default purpose</label><select id="s-pur">${opts(activeOnly(S.lists.purposes, s.defaultPurposeId), s.defaultPurposeId || '', 'None')}</select></div></div>
      <div class="form-group"><label for="s-alias">Names in bank lines</label><input type="text" id="s-alias" value="${esc((s.aliases || []).join(', '))}" placeholder="e.g. FLIX, Flix SE"><div class="hint">Comma-separated. Used later to recognise this supplier when you import the bank file.</div></div>
      <div class="form-group"><label for="s-notes">Notes</label><textarea id="s-notes">${esc(s.notes || '')}</textarea></div>
      <div class="checkline" style="margin-bottom:6px"><input type="checkbox" id="s-arch" ${s.archived ? 'checked' : ''}><label for="s-arch">Archived (no longer offered on new items)</label></div>
      <div class="modal-actions"><button class="btn btn--ghost" id="s-cancel">Cancel</button><button class="btn btn--primary" id="s-save">Save</button></div>`);
    const m = root.querySelector('#v2modalBox');
    const taxHint = () => { const v = m.querySelector('#s-tax').value, c = m.querySelector('#s-country').value; const h = m.querySelector('#s-taxhint'); if (!v || c !== 'PT') { h.textContent = ''; return; } const st = nifStatus(v); h.textContent = st === 'ok' ? '✓ Valid NIF.' : st === 'badFormat' ? 'A Portuguese NIF has 9 digits.' : 'This NIF does not pass the check digit: probably a typo.'; };
    m.querySelector('#s-tax').addEventListener('input', taxHint); m.querySelector('#s-country').addEventListener('change', taxHint); taxHint();
    m.querySelector('#s-cancel').addEventListener('click', closeModal);
    m.querySelector('#s-save').addEventListener('click', async () => {
      const name = m.querySelector('#s-name').value.trim(); if (!name) { alert('Name is required.'); return; }
      if (S.suppliers.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) { alert('A supplier with this name already exists.'); return; }
      const country = m.querySelector('#s-country').value, tax = m.querySelector('#s-tax').value.trim();
      const data = { name, taxId: country === 'PT' ? normalizeNif(tax) || tax : tax, country, type: m.querySelector('#s-type').value, defaultCategoryId: m.querySelector('#s-cat').value, defaultPurposeId: m.querySelector('#s-pur').value, aliases: m.querySelector('#s-alias').value.split(',').map((x) => x.trim()).filter(Boolean), notes: m.querySelector('#s-notes').value.trim(), archived: m.querySelector('#s-arch').checked };
      try { if (id) await updateDoc(doc(db, 'budgetSuppliers', id), data); else await addDoc(collection(db, 'budgetSuppliers'), { ...data, createdAt: serverTimestamp(), createdBy: access.email }); logEvent('budget_supplier_saved', { itemName: name }); closeModal(); await refresh(); } catch (e) { alert('Failed to save: ' + e.message); }
    });
  }

  // ── Settings ──
  const plain = (v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : Array.isArray(v) ? v.map(plain) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v);
  function listEditor(key, title, list) {
    return `<div class="section"><div class="section-header"><h2 class="section-title" style="font-size:1.15rem">${title}</h2></div>
      <div class="list-edit" id="le-${key}">${list.map((x, i) => `<div class="le ${x.archived ? 'arch' : ''}" data-i="${i}"><input type="text" value="${esc(x.label)}" aria-label="Name" ${can('budget.edit') ? '' : 'disabled'}><button class="btn btn--ghost btn--sm" data-arch="${i}" data-perm="budget.edit">${x.archived ? 'Restore' : 'Retire'}</button></div>`).join('')}</div>
      <div class="row-actions" data-perm="budget.edit"><input type="text" id="le-new-${key}" placeholder="New value…" style="padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font:inherit"><button class="btn btn--ghost btn--sm" data-add="${key}">Add</button><button class="btn btn--primary btn--sm" data-savelist="${key}">Save ${title.toLowerCase()}</button></div>
      <p class="hint">Renaming changes the name everywhere. A value that is in use is never deleted: retire it and it stays on old items but is not offered for new ones.</p></div>`;
  }
  function renderSettings(body) {
    const c = S.company || {};
    const unrev = S.items.filter((i) => i.legacy && i.needsReview && !i.archived).length;
    const work = { categories: S.lists.categories.map((x) => ({ ...x })), purposes: S.lists.purposes.map((x) => ({ ...x })) };
    body.innerHTML = `
      <div class="section"><div class="section-header"><h2 class="section-title">Company details</h2></div>
        <div class="card" style="padding:20px 22px"><p class="hint" style="margin:0 0 14px">Shown as a reminder wherever an invoice is entered: ask the supplier for the invoice in exactly this name, NIF and address.</p>
          <div class="form-group"><label for="cs-name">Company name</label><input type="text" id="cs-name" maxlength="200" value="${esc(c.companyName || '')}"></div>
          <div class="form-group"><label for="cs-nif">NIF</label><input type="text" id="cs-nif" inputmode="numeric" maxlength="14" value="${esc(c.companyNif || '')}"><div class="hint" id="cs-nifhint"></div></div>
          <div class="form-group"><label for="cs-addr">Address on invoices</label><textarea id="cs-addr" maxlength="500">${esc(c.companyAddress || '')}</textarea></div>
          <button class="btn btn--primary" id="cs-save" data-perm="budget.edit">Save company details</button> <span class="mini" id="cs-meta">${c.updatedBy ? 'Last saved by ' + esc(c.updatedBy) : ''}</span></div></div>
      <div class="two">${listEditor('categories', 'Categories', work.categories)}${listEditor('purposes', 'Purposes', work.purposes)}</div>
      <div class="section"><div class="section-header"><h2 class="section-title">Backup and old items</h2></div>
        <div class="card" style="padding:20px 22px"><p class="hint" style="margin:0 0 14px">The backup is every item exactly as stored, in one JSON file. Take one before changing old items.</p>
          <button class="btn btn--ghost" id="bk">↓ Backup (JSON)</button>
          <p class="hint" style="margin:14px 0 0">${unrev ? `${unrev} old item${unrev === 1 ? '' : 's'} from the first version still to review (their category is a guess, and old Revenue entries need a type). ` : 'No old items waiting for review. '}<button class="btn btn--ghost btn--sm" id="goreview">Show them</button></p></div></div>`;
    const nh = () => { const st = nifStatus(body.querySelector('#cs-nif').value); const h = body.querySelector('#cs-nifhint'); h.textContent = { empty: 'The Portuguese taxpayer number. A VAT ID is "PT" plus the NIF.', ok: '✓ Valid NIF.', badFormat: 'A NIF has 9 digits (a leading "PT" is fine).', badCheck: 'These 9 digits do not pass the NIF check, so there is probably a typo. You can still save it.' }[st]; h.style.color = st === 'ok' ? 'var(--secondary)' : st === 'empty' ? '' : 'var(--danger)'; };
    body.querySelector('#cs-nif').addEventListener('input', nh); nh();
    body.querySelector('#cs-save').addEventListener('click', async () => {
      const data = cleanCompanyDetails({ companyName: body.querySelector('#cs-name').value, companyNif: body.querySelector('#cs-nif').value, companyAddress: body.querySelector('#cs-addr').value });
      if (data.companyNif && nifStatus(data.companyNif) === 'badFormat') { alert('A NIF has 9 digits.'); return; }
      try { await setDoc(doc(db, 'budgetSettings', 'main'), { ...data, updatedAt: serverTimestamp(), updatedBy: access.email }, { merge: true }); logEvent('budget_company_saved', { itemName: data.companyName }); S.company = { ...S.company, ...data, updatedBy: access.email }; body.querySelector('#cs-meta').textContent = 'Saved.'; } catch (e) { alert('Failed to save: ' + e.message); }
    });
    for (const key of ['categories', 'purposes']) {
      const box = body.querySelector('#le-' + key);
      const pull = () => box.querySelectorAll('.le').forEach((r) => { work[key][Number(r.dataset.i)].label = r.querySelector('input').value.trim() || work[key][Number(r.dataset.i)].label; });
      box.querySelectorAll('[data-arch]').forEach((b) => b.addEventListener('click', () => { pull(); const x = work[key][Number(b.dataset.arch)]; x.archived = !x.archived; b.textContent = x.archived ? 'Restore' : 'Retire'; b.parentElement.classList.toggle('arch', x.archived); }));
      body.querySelector(`[data-add="${key}"]`)?.addEventListener('click', () => { pull(); const inp = body.querySelector('#le-new-' + key), label = inp.value.trim(); if (!label) return; work[key].push({ id: newListId(label, work[key]), label, hint: '', archived: false }); S.lists[key] = work[key]; saveLists(work, body, false).then(() => renderSettings(body)); });
      body.querySelector(`[data-savelist="${key}"]`)?.addEventListener('click', () => { pull(); saveLists(work, body, true); });
    }
    body.querySelector('#bk').addEventListener('click', backupJson);
    body.querySelector('#goreview').addEventListener('click', () => { S.filter = { ...S.filter, review: true, doc: '' }; S.tab = 'items'; render(); });
  }
  async function saveLists(work, body, say) {
    try {
      await setDoc(doc(db, 'budgetSettings', 'lists'), { categories: work.categories, purposes: work.purposes, updatedAt: serverTimestamp(), updatedBy: access.email });
      S.lists = { categories: work.categories.map((x) => ({ ...x })), purposes: work.purposes.map((x) => ({ ...x })) };
      logEvent('budget_lists_saved', {});
      if (say) alert('Saved.');
    } catch (e) { alert('Failed to save: ' + e.message); }
  }
  async function backupJson() {
    try {
      const snap = await getDocs(collection(db, 'budgetItems')); reads(snap.docs.length);
      const items = snap.docs.map((d) => ({ id: d.id, ...plain(d.data()) }));
      const out = { exportedAt: new Date().toISOString(), exportedBy: access.email, collection: 'budgetItems', count: items.length, items };
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })), download: `douro-budget-backup-${today()}.json` });
      a.click(); URL.revokeObjectURL(a.href); logEvent('budget_backup', { count: items.length });
    } catch (e) { alert('Backup failed: ' + e.message); }
  }


  // ── Bank (Stage 2): import Santander files ──
  const digits = (v) => String(v || '').replace(/\D/g, '');
  const fmtMoney = (n) => eur.format(Number(n) || 0);
  const lastStored = (accountId) => {
    const key = (m) => `${m.posted}|${m.batchAt || ''}|${String(m.lineNo || 0).padStart(6, '0')}`;
    const mine = S.movements.filter((m) => m.accountId === accountId).sort((a, b) => (key(a) < key(b) ? 1 : -1));
    return mine.length ? { balance: mine[0].balance, posted: mine[0].posted } : null;
  };
  const recCtx = (accountId) => ({
    partners: S.dir.filter((m) => m.partner).map((m) => ({ key: m.key, name: m.name || m.label })),
    suppliers: S.suppliers, cards: S.cards, accountId,
  });
  const KIND_TEXT = { expense: 'Expense', income: 'Money in', settlement: 'To a partner' };
  let bankPlans = [];

  function renderBank(body) {
    const accs = S.accounts.filter((a) => a.kind !== 'cash');
    body.innerHTML = `
      <div class="section"><div class="section-header"><h2 class="section-title">Import a bank file</h2></div>
        <div class="card" style="padding:20px 22px">
          <p class="hint" style="margin:0 0 14px">Santander: Exportar, then "Tabulado Excel" (or "Tabulado (Folha de Cálculo)"). Pick several files at once if you like, for example one per month: lines already imported are skipped, so overlapping files are safe. Nothing is booked yet; the lines go to the Inbox.</p>
          <div class="form-row"><div class="form-group"><label for="b-acc">Account</label><select id="b-acc">${accs.length ? opts(accs.map((a) => ({ id: a.id, label: a.name })), '', null) : '<option value="">Add a bank account first (Accounts tab)</option>'}</select></div>
            <div class="form-group"><label for="b-files">File(s)</label><input type="file" id="b-files" accept=".csv,.txt" multiple></div></div>
          <button class="btn btn--primary" id="b-read" ${accs.length ? '' : 'disabled'}>Read files</button>
          <div id="b-preview" style="margin-top:18px"></div></div></div>
      <div class="section"><div class="section-header"><h2 class="section-title">Imports so far</h2></div>
        <div class="card"><div class="table-wrap"><table><thead><tr><th>When</th><th>File</th><th>Account</th><th>Period</th><th class="num">New lines</th><th class="num">Skipped</th><th>By</th><th></th></tr></thead>
          <tbody>${S.imports.length ? S.imports.map((b) => `<tr style="${b.status === 'undone' ? 'opacity:.5' : ''}"><td style="white-space:nowrap">${fmtDate(String(b.createdAtIso || '').slice(0, 10))}</td><td>${esc(b.fileName || '')}</td><td>${esc(accountOf(b.accountId)?.name || '')}</td><td style="white-space:nowrap">${fmtDate(b.from)} – ${fmtDate(b.to)}</td><td class="num">${esc(b.newLines)}</td><td class="num">${esc(b.dups)}</td><td class="mini">${esc(String(b.createdBy || '').split('@')[0])}</td><td style="text-align:right">${b.status === 'undone' ? '<span class="mini">undone</span>' : `<button class="btn btn--ghost btn--sm" data-undo="${b.id}">Undo</button>`}</td></tr>`).join('') : '<tr class="empty-row"><td colspan="8">No imports yet.</td></tr>'}</tbody></table></div></div></div>`;
    body.querySelector('#b-read').addEventListener('click', () => readBankFiles(body));
    body.querySelectorAll('[data-undo]').forEach((b) => b.addEventListener('click', () => undoImport(b.dataset.undo)));
    if (bankPlans.length) showBankPreview(body);
  }

  async function readBankFiles(body) {
    const accountId = body.querySelector('#b-acc').value, files = [...body.querySelector('#b-files').files];
    const prev = body.querySelector('#b-preview');
    if (!accountId) { prev.innerHTML = '<div class="warnbox warn">Choose the account first.</div>'; return; }
    if (!files.length) { prev.innerHTML = '<div class="warnbox warn">Choose one or more files.</div>'; return; }
    prev.innerHTML = '<span class="mini">Reading…</span>';
    const acc = accountOf(accountId), existing = new Set(S.movements.map((m) => m.id));
    const parsed = [];
    for (const f of files) { const p = parseTabulado(decodeBank(await f.arrayBuffer())); parsed.push({ file: f, p, from: p.rows[0]?.posted || '9999' }); }
    parsed.sort((a, b) => a.from.localeCompare(b.from));         // oldest first, so each file is checked against the one before
    let last = lastStored(accountId);
    bankPlans = [];
    for (const { file, p } of parsed) {
      const block = [];
      if (!p.rows.length) block.push('No readable lines in this file. Is it the "Tabulado" export?');
      if (p.accountNos.length > 1) block.push('The file mixes several accounts.');
      if (p.accountNo && acc.fileAccountNo && digits(p.accountNo) !== digits(acc.fileAccountNo)) block.push(`This file is for account ${p.accountNo}, but "${acc.name}" is set to ${acc.fileAccountNo}. Pick the right account.`);
      const ids = await Promise.all(p.rows.map((r) => fingerprint(r, p.accountNo)));
      const plan = planImport({ rows: p.rows, ids, existing, last, opening: acc.openingBalance });
      if (!p.chainOk) plan.warnings.push({ code: 'chain', text: `The balances in this file do not add up from line ${p.chainBreak + 1} (a line may be missing or out of order).` });
      const ctx = recCtx(accountId);
      plan.fresh.forEach((l) => { l.sug = recognise(l, ctx); });
      bankPlans.push({ file, name: file.name, accountId, accountNo: p.accountNo, plan, errors: p.errors, block, on: !block.length && plan.fresh.length > 0, setFileNo: !acc.fileAccountNo && !!p.accountNo });
      plan.fresh.forEach((l) => existing.add(l.id));
      if (plan.lines.length) { const lastLine = plan.lines[plan.lines.length - 1]; last = { balance: lastLine.balance, posted: lastLine.posted }; }
    }
    showBankPreview(body);
  }
  function showBankPreview(body) {
    const prev = body.querySelector('#b-preview');
    const total = bankPlans.filter((b) => b.on).reduce((s2, b) => s2 + b.plan.fresh.length, 0);
    prev.innerHTML = bankPlans.map((b, i) => {
      const pl = b.plan;
      return `<div class="sect"><div class="sect-title">${esc(b.name)}</div>
        ${b.block.map((t) => `<div class="warnbox warn">${esc(t)}</div>`).join('')}
        ${pl.warnings.map((w) => `<div class="warnbox warn"><strong>Check:</strong> ${esc(w.text)}</div>`).join('')}
        ${b.errors.length ? `<div class="warnbox warn">${b.errors.length} line(s) could not be read and will be skipped (line ${b.errors.slice(0, 5).map((e) => e.lineNo).join(', ')}).</div>` : ''}
        <p style="margin-bottom:10px"><strong>${pl.fresh.length} new</strong> · ${pl.dups} already imported · ${fmtDate(pl.from)} – ${fmtDate(pl.to)} · in ${fmtMoney(pl.sumIn)} · out ${fmtMoney(Math.abs(pl.sumOut))} · balance ${pl.openingBalance == null ? '' : fmtMoney(pl.openingBalance) + ' → '}${pl.closingBalance == null ? '' : fmtMoney(pl.closingBalance)}</p>
        ${pl.fresh.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Line</th><th class="num">Amount</th><th>Looks like</th></tr></thead><tbody>${pl.fresh.slice(0, 12).map((l) => `<tr><td style="white-space:nowrap">${fmtDate(l.posted)}</td><td>${esc(cleanDescription(l.description))}</td><td class="num ${l.amount > 0 ? 'amt-in' : ''}">${fmtMoney(l.amount)}</td><td class="mini">${esc(KIND_TEXT[l.sug.kind] || '')} · ${esc(l.sug.reason)}</td></tr>`).join('')}</tbody></table></div>${pl.fresh.length > 12 ? `<div class="mini" style="margin-top:6px">…and ${pl.fresh.length - 12} more.</div>` : ''}` : ''}
        ${b.setFileNo ? `<p class="mini" style="margin-top:8px">The account will remember number ${esc(b.accountNo)} for next time.</p>` : ''}
        <div class="checkline" style="margin:10px 0 12px"><input type="checkbox" id="b-on-${i}" data-on="${i}" ${b.on ? 'checked' : ''} ${b.block.length || !pl.fresh.length ? 'disabled' : ''}><label for="b-on-${i}">Import this file</label></div></div>`;
    }).join('') + `<button class="btn btn--primary" id="b-go" ${total ? '' : 'disabled'}>Import ${total} new line${total === 1 ? '' : 's'}</button>`;
    prev.querySelectorAll('[data-on]').forEach((c) => c.addEventListener('change', () => { bankPlans[Number(c.dataset.on)].on = c.checked; showBankPreview(body); }));
    prev.querySelector('#b-go').addEventListener('click', () => doImport(body));
  }
  async function doImport(body) {
    const go = body.querySelector('#b-go'); go.disabled = true; go.textContent = 'Importing…';
    try {
      let n = 0;
      for (const b of bankPlans.filter((x) => x.on)) {
        const pl = b.plan, at = new Date().toISOString();
        const batch = await addDoc(collection(db, 'budgetImports'), { accountId: b.accountId, accountNo: b.accountNo, fileName: b.name, lines: pl.lines.length, newLines: pl.fresh.length, dups: pl.dups, from: pl.from, to: pl.to, openingBalance: pl.openingBalance, closingBalance: pl.closingBalance, status: 'done', createdAt: serverTimestamp(), createdAtIso: at, createdBy: access.email });
        for (let i = 0; i < pl.fresh.length; i += 400) {
          const wb = writeBatch(db);
          pl.fresh.slice(i, i + 400).forEach((l) => {
            const sug = Object.fromEntries(Object.entries(l.sug).filter(([, v]) => v !== undefined && v !== ''));
            wb.set(doc(db, 'budgetMovements', l.id), { accountId: b.accountId, accountNo: b.accountNo, posted: l.posted, value: l.value, description: l.description, amount: l.amount, balance: l.balance, code2: l.code2, code3: l.code3, cardLast4: l.cardLast4, lineNo: l.lineNo, batchId: batch.id, batchAt: at, status: 'new', sug, createdAt: serverTimestamp(), createdBy: access.email });
          });
          await wb.commit();
        }
        if (b.setFileNo) await updateDoc(doc(db, 'budgetAccounts', b.accountId), { fileAccountNo: b.accountNo });
        n += pl.fresh.length;
        logEvent('budget_bank_import', { itemName: b.name, amount: pl.fresh.length });
      }
      bankPlans = [];
      await refresh();
      S.tab = 'inbox'; render();
      alert(`${n} bank line${n === 1 ? '' : 's'} imported. They are waiting in the Inbox.`);
    } catch (e) { alert('Import failed: ' + e.message); go.disabled = false; go.textContent = 'Try again'; }
  }
  async function undoImport(batchId) {
    const mine = S.movements.filter((m) => m.batchId === batchId), used = mine.filter((m) => m.status === 'linked' || m.status === 'settlement');
    if (!confirm(`Undo this import?\n\n${mine.length - used.length} bank line(s) are removed from the Inbox.${used.length ? `\n${used.length} line(s) are already booked or marked as partner transfers and stay.` : ''}`)) return;
    try {
      const gone = mine.filter((m) => m.status === 'new' || m.status === 'ignored');
      for (let i = 0; i < gone.length; i += 400) { const wb = writeBatch(db); gone.slice(i, i + 400).forEach((m) => wb.delete(doc(db, 'budgetMovements', m.id))); await wb.commit(); }
      await updateDoc(doc(db, 'budgetImports', batchId), { status: 'undone' });
      logEvent('budget_bank_undo', { amount: gone.length });
      await refresh(); S.tab = 'bank'; render();
    } catch (e) { alert('Undo failed: ' + e.message); }
  }

  // ── Inbox (Stage 2): what needs a decision ──
  const inboxSel = new Set();
  let showIgnored = false;
  function draftFromMovement(m, over = {}) {
    const g = { ...(m.sug || {}), ...over }, amt = Math.abs(m.amount);
    if (g.kind === 'income') {
      return { movementId: m.id, kind: 'income', name: g.name || cleanDescription(m.description), amount: amt, date: m.posted, incomeType: g.incomeType || 'other', counterparty: g.counterparty || '', paidWith: g.paidWith || '', comments: '', tags: [], usedBy: [] };
    }
    return { movementId: m.id, kind: 'expense', name: g.name || cleanDescription(m.description), amount: amt, date: m.posted, categoryId: g.categoryId || '', purposeId: g.purposeId || '', paidWith: g.paidWith || '', supplierName: g.supplierName || '', supplierId: g.supplierId || '', docType: g.docWaived ? 'none' : 'none', docWaived: g.docWaived || false, country: 'PT', currency: 'EUR', issuedToCompany: 'unknown', tags: [], usedBy: [] };
  }
  function itemDocFromDraft(d) {
    const exp = d.kind === 'expense';
    return {
      kind: d.kind, name: d.name, amount: d.amount, date: d.date, type: exp ? 'cost' : 'revenue', category: 'Other', periodicity: 'one_time',
      categoryId: exp ? d.categoryId : '', subtype: '', purposeId: exp ? d.purposeId || '' : '', tags: [], incomeType: exp ? '' : d.incomeType, counterparty: exp ? '' : d.counterparty,
      paidWith: d.paidWith || '', paidPersonallyBy: '', usedBy: [], docType: exp ? 'none' : '', issuedToCompany: exp ? 'unknown' : '', supplierName: d.supplierName || '', supplierId: d.supplierId || '', supplierTaxId: '', docNumber: '', atcud: '', invoiceDate: '', country: exp ? 'PT' : '', vatRate: null, vatAmount: null, vatDeductible: exp ? 'ask' : '', currency: 'EUR', originalAmount: null, docWaived: exp ? d.docWaived || false : false,
      comments: 'From the bank file', attachments: [], sharedAt: '', sharedBy: '', changedSinceShared: false, movementId: d.movementId,
    };
  }
  async function acceptMovements(list, over = {}) {
    const ok = [], skip = [];
    for (const m of list) {
      const g = { ...(m.sug || {}), ...over };
      if (g.kind === 'settlement') { ok.push({ m, settle: true }); continue; }
      if (g.kind === 'expense' && !g.categoryId) { skip.push(m); continue; }
      ok.push({ m, d: draftFromMovement(m, over) });
    }
    if (!ok.length) { alert('Nothing to accept: these lines still need a category. Use "Categorise…" on a line, or pick a category above first.'); return; }
    try {
      for (let i = 0; i < ok.length; i += 200) {
        const wb = writeBatch(db);
        ok.slice(i, i + 200).forEach(({ m, d, settle }) => {
          if (settle) { wb.update(doc(db, 'budgetMovements', m.id), { status: 'settlement', partnerKey: (m.sug || {}).partnerKey || '' }); return; }
          const iref = doc(collection(db, 'budgetItems'));
          wb.set(iref, { ...itemDocFromDraft(d), createdAt: serverTimestamp(), createdBy: access.email });
          wb.update(doc(db, 'budgetMovements', m.id), { status: 'linked', itemId: iref.id });
        });
        await wb.commit();
      }
      logEvent('budget_bank_accept', { amount: ok.length });
      inboxSel.clear(); await refresh(); S.tab = 'inbox'; render();
      if (skip.length) alert(`${ok.length} booked. ${skip.length} line(s) still need a category and stay in the Inbox.`);
    } catch (e) { alert('Could not save: ' + e.message); }
  }
  async function setMovementStatus(ids, status, extra = {}) {
    try {
      const wb = writeBatch(db);
      ids.forEach((id) => wb.update(doc(db, 'budgetMovements', id), { status, ...extra }));
      await wb.commit(); inboxSel.clear(); await refresh(); S.tab = 'inbox'; render();
    } catch (e) { alert('Could not save: ' + e.message); }
  }
  async function linkMovement(m, itemId) {
    try {
      const wb = writeBatch(db);
      wb.update(doc(db, 'budgetMovements', m.id), { status: 'linked', itemId });
      wb.update(doc(db, 'budgetItems', itemId), { movementId: m.id, paidWith: (m.sug || {}).paidWith || S.items.find((x) => x.id === itemId)?.paidWith || '' });
      await wb.commit(); logEvent('budget_bank_link', { amount: Math.abs(m.amount) }); await refresh(); S.tab = 'inbox'; render();
    } catch (e) { alert('Could not save: ' + e.message); }
  }

  function renderInbox(body) {
    const accountsOn = can('budget.accounts');
    const lines = S.movements.filter((m) => m.status === 'new').sort((a, b) => (a.posted < b.posted ? 1 : a.posted > b.posted ? -1 : (b.lineNo || 0) - (a.lineNo || 0)));
    const settle = S.movements.filter((m) => m.status === 'settlement');
    const ignored = S.movements.filter((m) => m.status === 'ignored');
    const costs = S.items.filter((i) => i.kind === 'expense' && !i.archived);
    const docWarn = costs.filter((i) => docStatus(i).level === 'warn');
    const notShared = S.items.filter((i) => !i.archived && i.kind !== 'plan' && !(i.legacy && i.needsReview) && !i.sharedAt);
    const o = overview(S.items), owed = Object.entries(o.owedToPartners).filter(([, v]) => v > 0);
    const autoN = lines.filter((m) => (m.sug || {}).autoAccept).length;
    const sugPill = (m) => { const g = m.sug || {}; const t = KIND_TEXT[g.kind] || ''; return `<span class="pill ${g.kind === 'income' ? 'pill--income' : g.kind === 'settlement' ? 'pill--plan' : 'pill--cost'}">${esc(t)}</span><div class="mini">${esc(g.reason || '')}${g.categoryId ? ' · ' + esc(catLabel(g.categoryId)) : ''}</div>`; };
    const row = (m) => {
      const g = m.sug || {}, cands = matchCandidates(m, S.items);
      const canAccept = g.kind === 'income' || g.kind === 'settlement' || (g.kind === 'expense' && g.categoryId);
      return `<tr><td class="chk"><input type="checkbox" data-isel="${m.id}" ${inboxSel.has(m.id) ? 'checked' : ''} aria-label="Select"></td>
        <td style="white-space:nowrap">${fmtDate(m.posted)}</td>
        <td><strong>${esc(g.name || cleanDescription(m.description))}</strong><div class="mini" title="As in the bank file">${esc(m.description)}</div></td>
        <td class="num ${m.amount > 0 ? 'amt-in' : ''}">${m.amount > 0 ? '+' : ''}${fmtMoney(m.amount)}</td>
        <td>${sugPill(m)}</td>
        <td style="white-space:nowrap" data-perm="budget.edit">
          ${canAccept ? `<button class="btn btn--primary btn--sm" data-acc="${m.id}">Accept</button>` : ''}
          <button class="btn btn--ghost btn--sm" data-cat="${m.id}">${canAccept ? 'Edit…' : 'Categorise…'}</button>
          ${cands.length ? `<button class="btn btn--ghost btn--sm" data-link="${m.id}" title="${esc(cands.map((c) => c.name).join(', '))}">Link to “${esc(cands[0].name.slice(0, 18))}”</button>` : ''}
          <button class="btn btn--ghost btn--sm" data-ign="${m.id}" title="For example a transfer between our own accounts">Ignore</button></td></tr>`;
    };
    const itemLine = (i) => `<tr><td>${fmtDate(i.date)}</td><td><strong>${esc(i.name)}</strong>${i.supplierName ? `<div class="mini">${esc(i.supplierName)}</div>` : ''}</td><td class="num">${fmtMoney(i.amount)}</td><td><span class="badge-doc ${docStatus(i).level}">${esc(docStatus(i).label)}</span></td><td style="text-align:right"><button class="btn btn--ghost btn--sm" data-ed="${i.id}" data-perm="budget.edit">Edit</button></td></tr>`;
    body.innerHTML = `
      <div class="section"><div class="section-header"><h2 class="section-title">Inbox</h2></div>
        <p class="mini" style="margin:-6px 0 14px">What needs a decision. Nothing here is created by hand: it fills from the bank files and from your items.</p></div>
      ${accountsOn ? `<div class="section"><div class="section-header"><h2 class="section-title" style="font-size:1.15rem">Bank lines to categorise (${lines.length})</h2>
          <div class="section-actions" data-perm="budget.edit">${autoN ? `<button class="btn btn--ghost btn--sm" id="i-auto">Accept all ${autoN} bank charge${autoN === 1 ? '' : 's'} and interest</button>` : ''}<span data-perm="budget.import"><button class="btn btn--ghost btn--sm" id="i-bank">Import a bank file</button></span></div></div>
        <div class="card">
          <div class="bulkbar ${inboxSel.size ? 'on' : ''}" data-perm="budget.edit"><strong>${inboxSel.size} selected</strong>
            <select id="ib-cat" style="padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;font:inherit;font-size:.8rem">${opts(activeOnly(S.lists.categories), '', 'Category…')}</select>
            <select id="ib-pur" style="padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;font:inherit;font-size:.8rem">${opts(activeOnly(S.lists.purposes), '', 'Purpose…')}</select>
            <button class="btn btn--primary btn--sm" id="ib-go">Book as expenses</button>
            <button class="btn btn--ghost btn--sm" id="ib-acc">Accept suggestions</button>
            <button class="btn btn--ghost btn--sm" id="ib-ign">Ignore</button>
            <button class="btn btn--ghost btn--sm" id="ib-clear">Clear</button></div>
          <div class="table-wrap"><table><thead><tr><th class="chk"><input type="checkbox" id="i-all" aria-label="Select all"></th><th>Date</th><th>Line</th><th class="num">Amount</th><th>Looks like</th><th></th></tr></thead>
            <tbody>${lines.length ? lines.map(row).join('') : `<tr class="empty-row"><td colspan="6">${S.movements.length ? 'All bank lines are dealt with.' : 'No bank lines yet. Import a Santander file in the Bank tab.'}</td></tr>`}</tbody></table></div></div></div>
        ${settle.length ? `<div class="section"><div class="section-header"><h2 class="section-title" style="font-size:1.15rem">Transfers to partners (${settle.length})</h2></div><div class="card"><div class="table-wrap"><table><tbody>${settle.map((m) => `<tr><td>${fmtDate(m.posted)}</td><td>${esc(personLabel(m.partnerKey || (m.sug || {}).partnerKey))}</td><td>${esc(cleanDescription(m.description))}</td><td class="num">${fmtMoney(m.amount)}</td><td style="text-align:right" data-perm="budget.import"><button class="btn btn--ghost btn--sm" data-back="${m.id}">Back to categorise</button></td></tr>`).join('')}</tbody></table></div></div><p class="mini" style="margin-top:8px">Linking these to the expenses they repay comes in the reimbursements step.</p></div>` : ''}` : ''}
      <div class="section"><div class="section-header"><h2 class="section-title" style="font-size:1.15rem">Documents to fix (${docWarn.length})</h2>${docWarn.length > 8 ? '<div class="section-actions"><button class="btn btn--ghost btn--sm" id="i-alldocs">Show all in Items</button></div>' : ''}</div>
        <div class="card"><div class="table-wrap"><table><tbody>${docWarn.length ? docWarn.slice(0, 8).map(itemLine).join('') : '<tr class="empty-row"><td colspan="5">Every expense has its paperwork.</td></tr>'}</tbody></table></div></div></div>
      <div class="two">
        <div class="section"><div class="section-header"><h2 class="section-title" style="font-size:1.15rem">Not shared with the accountant (${notShared.length})</h2></div><div class="card" style="padding:14px 16px"><span class="mini">${notShared.length ? 'Select them in Items and use "Mark shared with accountant".' : 'Everything has been shared.'}</span> ${notShared.length ? '<button class="btn btn--ghost btn--sm" id="i-notshared">Show them</button>' : ''}</div></div>
        <div class="section"><div class="section-header"><h2 class="section-title" style="font-size:1.15rem">To reimburse</h2></div><div class="card" style="padding:14px 16px"><span class="mini">${owed.length ? owed.map(([k, v]) => `The company owes ${esc(personLabel(k))} ${fmtMoney(v)}`).join(' · ') : 'Nobody is owed money.'}</span></div></div></div>
      ${ignored.length ? `<div class="section"><button class="btn btn--ghost btn--sm" id="i-showign">${showIgnored ? 'Hide' : 'Show'} ${ignored.length} ignored line${ignored.length === 1 ? '' : 's'}</button>${showIgnored ? `<div class="card" style="margin-top:10px"><div class="table-wrap"><table><tbody>${ignored.map((m) => `<tr><td>${fmtDate(m.posted)}</td><td>${esc(cleanDescription(m.description))}</td><td class="num">${fmtMoney(m.amount)}</td><td style="text-align:right" data-perm="budget.import"><button class="btn btn--ghost btn--sm" data-back="${m.id}">Restore</button></td></tr>`).join('')}</tbody></table></div></div>` : ''}</div>` : ''}`;
    const by = (id) => S.movements.find((m) => m.id === id);
    const q = (sel, fn, ev = 'click') => body.querySelectorAll(sel).forEach((b) => b.addEventListener(ev, () => fn(b)));
    q('[data-isel]', (c) => { c.checked ? inboxSel.add(c.dataset.isel) : inboxSel.delete(c.dataset.isel); renderInbox(body); }, 'change');
    body.querySelector('#i-all')?.addEventListener('change', (e) => { lines.forEach((m) => (e.target.checked ? inboxSel.add(m.id) : inboxSel.delete(m.id))); renderInbox(body); });
    q('[data-acc]', (b) => acceptMovements([by(b.dataset.acc)]));
    q('[data-cat]', (b) => { const m = by(b.dataset.cat); openItem(null, draftFromMovement(m)); });
    q('[data-link]', (b) => { const m = by(b.dataset.link), c = matchCandidates(m, S.items)[0]; if (c && confirm(`Link this bank line to the expense "${c.name}" (${fmtMoney(c.amount)}, ${c.date})?`)) linkMovement(m, c.id); });
    q('[data-ign]', (b) => setMovementStatus([b.dataset.ign], 'ignored'));
    q('[data-back]', (b) => setMovementStatus([b.dataset.back], 'new'));
    q('[data-ed]', (b) => openItem(b.dataset.ed));
    body.querySelector('#i-auto')?.addEventListener('click', () => { const l = lines.filter((m) => (m.sug || {}).autoAccept); if (confirm(`Book ${l.length} bank charge / interest line(s) as expenses and income? They need no document.`)) acceptMovements(l); });
    body.querySelector('#i-bank')?.addEventListener('click', () => { S.tab = 'bank'; render(); });
    body.querySelector('#ib-clear')?.addEventListener('click', () => { inboxSel.clear(); renderInbox(body); });
    body.querySelector('#ib-ign')?.addEventListener('click', () => setMovementStatus([...inboxSel], 'ignored'));
    body.querySelector('#ib-acc')?.addEventListener('click', () => acceptMovements([...inboxSel].map(by).filter(Boolean)));
    body.querySelector('#ib-go')?.addEventListener('click', () => {
      const cat = body.querySelector('#ib-cat').value, pur = body.querySelector('#ib-pur').value;
      if (!cat) { alert('Choose a category first.'); return; }
      const sel = [...inboxSel].map(by).filter(Boolean), exp = sel.filter((m) => m.amount < 0);
      if (!exp.length) { alert('Only payments (money out) can be booked as expenses.'); return; }
      if (confirm(`Book ${exp.length} payment(s) as expenses in "${catLabel(cat)}"${pur ? ' / ' + purLabel(pur) : ''}?`)) acceptMovements(exp, { kind: 'expense', categoryId: cat, purposeId: pur });
    });
    body.querySelector('#i-alldocs')?.addEventListener('click', () => { S.filter = { ...S.filter, doc: 'warn', review: false, vat: '' }; S.tab = 'items'; render(); });
    body.querySelector('#i-notshared')?.addEventListener('click', () => { S.filter = { ...S.filter, shared: 'no', doc: '', review: false, vat: '' }; S.tab = 'items'; render(); });
    body.querySelector('#i-showign')?.addEventListener('click', () => { showIgnored = !showIgnored; renderInbox(body); });
  }

  // ── Go ──
  root.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-light)">Loading…</div>';
  await loadAll();
  shell(); render();
  return { refresh };
}
