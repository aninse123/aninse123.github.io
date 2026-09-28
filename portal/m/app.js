// Douro mobile — Search CRM on the phone (read-only, M1).
// Search (companies and people by name, or by NIF) runs on the server
// (functions/mobile/search.js → short rows); a company or person page reads
// its record and links straight from Firestore, like the desktop Search CRM.
// Ownership, control tiers, ages and target tiers use the desktop's own
// functions (crm-helpers.js, copied from search.html and parity-tested).
import { auth, db } from '../firebase-config.js';
import { getAccess } from '../access.js';
import { loadDirectory } from '../team-dir.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import { doc, getDoc, getDocs, collection, query, where, limit } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-functions.js";
import * as H from './crm-helpers.js';

const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const callSearch = httpsCallable(getFunctions(auth.app, 'us-central1'), 'mobileSearch');
let dir = [];
const ownerLabel = (k) => dir.find((m) => m.key === k)?.label || k;

// ── Formatting ──
export function money(v) {
  if (v == null || v === '' || isNaN(Number(v))) return '—';
  const n = Number(v), a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1).replace('.0', '') + ' B€';
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + ' M€';
  if (a >= 1e3) return Math.round(n / 1e3) + ' k€';
  return Math.round(n) + ' €';
}
const pct = (v) => (v == null || !isFinite(v) ? '—' : (Math.round(v * 1000) / 10) + '%');
const intFmt = (v) => (v == null || v === '' || isNaN(Number(v)) ? '—' : Number(v).toLocaleString('pt-PT'));
const tsMs = (t) => (t?.toMillis ? t.toMillis() : t?.seconds != null ? t.seconds * 1000 : t ? new Date(t).getTime() || 0 : 0);
const dateFmt = (t) => { const ms = tsMs(t); return ms ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms)) : ''; };
const extUrl = (u) => (/^https?:\/\//i.test(u) ? u : 'https://' + u);
const tel = (n) => 'tel:' + String(n || '').replace(/[^\d+]/g, '');
const stagePill = (s) => { const st = H.STAGES[s || 'universe']; return st ? `<span class="pill ${st.cls}">${esc(st.label)}</span>` : ''; };

// Key financials: the last 5 years with data (Orbis first, the old Y1–Y5 grid as fallback).
export function keyFinancials(c) {
  const fin = c.orbisFinancials || {};
  const years = Object.keys(fin).filter((y) => /^\d{4}$/.test(y) && fin[y] && Object.keys(fin[y]).length).sort().reverse().slice(0, 5);
  if (years.length) {
    const rev = (y) => fin[y].operatingRevenue ?? fin[y].sales ?? null;
    return {
      source: 'Orbis', cols: years,
      rows: [
        ['Revenue', years.map((y) => money(rev(y)))],
        ['EBITDA', years.map((y) => money(fin[y].ebitda))],
        ['EBITDA margin', years.map((y) => (rev(y) && fin[y].ebitda != null ? pct(fin[y].ebitda / rev(y)) : '—'))],
        ['Net income', years.map((y) => money(fin[y].profitForPeriodNetIncome))],
        ['Employees', years.map((y) => intFmt(fin[y].numberOfEmployees))],
      ],
    };
  }
  const f = c.financials || {};
  const ys = ['Y1', 'Y2', 'Y3', 'Y4', 'Y5'].filter((y) => f[y] && Object.values(f[y]).some((v) => v !== '' && v != null));
  if (!ys.length) return null;
  return {
    source: 'imported', cols: ys.map((y) => (y === 'Y1' ? 'Latest' : y)),
    rows: [
      ['Revenue', ys.map((y) => money(f[y].revenue))],
      ['EBITDA', ys.map((y) => money(f[y].ebitda))],
      ['EBITDA margin', ys.map((y) => (Number(f[y].revenue) && f[y].ebitda !== '' && f[y].ebitda != null ? pct(Number(f[y].ebitda) / Number(f[y].revenue)) : '—'))],
      ['Employees', ys.map((y) => intFmt(f[y].employees))],
    ],
  };
}

// ── Search rows ──
export function companyRowHtml(c) {
  const tier = H.tierOf(c);
  const sub = [c.nif ? 'NIF ' + c.nif : '', c.town, c.sector].filter(Boolean).join(' · ');
  return `<a class="row" href="#c/${encodeURIComponent(c.id)}">
    <span class="row__main"><span class="row__title">${esc(c.name || '—')}</span><span class="row__sub">${esc(sub)}</span></span>
    <span class="row__side">${stagePill(c.stage)}${tier ? `<span class="pill tier">Tier ${tier}</span>` : ''}${c.doNotContact ? '<span class="pill bad">Do not contact</span>' : c.contactable === false ? '<span class="pill muted">Not contactable</span>' : ''}</span></a>`;
}
export function personRowHtml(p) {
  const kind = p.entityType === 'entity' ? 'Company (shareholder)' : 'Person';
  const pos = p.linkCount ? `${p.currentLinkCount || 0} current · ${p.linkCount} position${p.linkCount === 1 ? '' : 's'}` : '';
  const sub = [kind, p.country, p.nif ? 'NIF ' + p.nif : '', pos].filter(Boolean).join(' · ');
  return `<a class="row" href="#p/${encodeURIComponent(p.id)}"><span class="row__main"><span class="row__title">${esc(p.name || '—')}</span><span class="row__sub">${esc(sub)}</span></span><span class="chev" aria-hidden="true">›</span></a>`;
}

// ── Recently viewed (this phone only) ──
const RECENT_KEY = 'douroM.recent';
function recents() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; } }
function addRecent(item) { try { localStorage.setItem(RECENT_KEY, JSON.stringify([item, ...recents().filter((x) => !(x.t === item.t && x.id === item.id))].slice(0, 12))); } catch (e) { /* private mode */ } }

// ── Views ──
function show(view, title, back) {
  $('viewSearch').hidden = view !== 'search';
  $('viewDetail').hidden = view !== 'detail';
  $('barTitle').textContent = title;
  $('backBtn').hidden = !back;
  window.scrollTo(0, 0);
}
let searchSeq = 0, searchTimer = null;
function renderRecents() {
  const r = recents();
  $('results').innerHTML = r.length
    ? `<h2 class="sec">Recently viewed</h2><div class="list">${r.map((x) => `<a class="row" href="#${x.t}/${encodeURIComponent(x.id)}"><span class="row__main"><span class="row__title">${esc(x.name)}</span><span class="row__sub">${x.t === 'c' ? 'Company' : 'Person'}</span></span><span class="chev" aria-hidden="true">›</span></a>`).join('')}</div>`
    : '<p class="hint">Search by company name, person name or NIF.</p>';
}
// ── Keeping reads low ──
// A name search needs 3 characters (the server refuses fewer too); answers are
// remembered for this visit; and when the last answer was complete (every
// match seen), a longer query is narrowed here with no reads at all.
export const MIN_NAME = 3;
const STOP = new Set(['lda', 'sa', 'unipessoal', 'limitada', 'sgps', 'eireli', 'ltda', 'de', 'da', 'do', 'dos', 'das', 'e']);
export const normQ = (q) => H.deburr(q).replace(/[^a-z0-9]+/g, ' ').trim();
export function nifDigits(q) {   // same rule as the server's nifQuery
  const s = String(q || '').trim().replace(/^pt/i, '');
  const d = H.onlyDigits(s);
  return d.length >= 3 && d.length === s.replace(/[\s.\-]/g, '').length ? d : null;
}
const queryTokens = (q) => normQ(q).split(' ').filter((w) => w.length > 1 && !STOP.has(w));
function nameMatches(name, tokens) {
  const n = normQ(name), words = n.split(' ');
  return tokens.every((t) => words.some((w) => w.startsWith(t)) || n.includes(t));
}
// Narrow a complete earlier answer to a longer query (null = ask the server).
export function narrowFrom(prev, q) {
  if (!prev || !prev.r.companiesComplete || !prev.r.peopleComplete) return null;
  const d = nifDigits(q);
  let keep;
  if (d) {
    if (!prev.digits || !d.startsWith(prev.digits)) return null;
    keep = (x) => H.onlyDigits(x.nif).startsWith(d) || H.onlyDigits(x.foreignTaxId).startsWith(d);
  } else {
    if (prev.digits || !normQ(q).startsWith(prev.norm)) return null;
    const tokens = queryTokens(q);
    keep = (x) => nameMatches(x.name, tokens);
  }
  return { ...prev.r, companies: prev.r.companies.filter(keep), people: prev.r.people.filter(keep), narrowed: true };
}
const answers = new Map();   // this visit only
let lastComplete = null;     // { norm, digits, r }

async function runSearch(q) {
  const seq = ++searchSeq;
  const text = q.trim(), digits = nifDigits(text);
  if (!text) { renderRecents(); return; }
  if (!digits && text.length < MIN_NAME) { $('results').innerHTML = `<p class="hint">Type at least ${MIN_NAME} letters (or a NIF).</p>`; return; }
  const key = digits ? 'nif:' + digits : 'name:' + normQ(text);
  let r = answers.get(key) || narrowFrom(lastComplete, text);
  if (!r) {
    $('results').innerHTML = '<p class="hint">Searching…</p>';
    try { r = (await callSearch({ q: text })).data; }
    catch (e) { if (seq === searchSeq) $('results').innerHTML = `<p class="hint err">${esc(e.message || 'Search failed — try again.')}</p>`; return; }
    if (answers.size > 60) answers.delete(answers.keys().next().value);
    answers.set(key, r);
  }
  if (r.companiesComplete && r.peopleComplete) lastComplete = { norm: normQ(text), digits, r };
  if (seq !== searchSeq) return;
  const block = (title, items, more, row) => items.length ? `<h2 class="sec">${title} <span class="n">${items.length}${more ? '+' : ''}</span></h2><div class="list">${items.map(row).join('')}</div>${more ? '<p class="hint">More matches — add a word to narrow it down.</p>' : ''}` : '';
  const html = block('Companies', r.companies, r.moreCompanies, companyRowHtml) + block('People', r.people, r.morePeople, personRowHtml);
  $('results').innerHTML = html || `<p class="hint">Nothing found for “${esc(q)}”.${r.mode === 'nif' ? ' NIF searches match the start of the number.' : ''}</p>`;
}
function showSearch() {
  show('search', 'Douro', false);
  const q = $('q').value;
  if (q.trim()) runSearch(q); else renderRecents();   // coming back: the remembered answer, 0 reads
}

const section = (title, body, open = true, id = '') => `<details class="card"${open ? ' open' : ''}${id ? ` id="${id}"` : ''}><summary>${title}</summary><div class="card__body">${body}</div></details>`;
const kv = (k, v) => (v ? `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${v}</span></div>` : '');

async function showCompany(id) {
  show('detail', 'Company', true);
  $('detail').innerHTML = '<p class="hint">Loading…</p>';
  let snap, links, acts;
  try {
    [snap, links, acts] = await Promise.all([
      getDoc(doc(db, 'searchCompanies', id)),
      getDocs(query(collection(db, 'searchPersonLinks'), where('companyId', '==', id))).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      getDocs(query(collection(db, 'searchActivities'), where('companyId', '==', id))).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))).catch(() => []),
    ]);
  } catch (e) { $('detail').innerHTML = `<p class="hint err">Could not load: ${esc(e.message)}</p>`; return; }
  if (!snap.exists()) { $('detail').innerHTML = '<p class="hint">Company not found.</p>'; return; }
  const c = { id: snap.id, ...snap.data() };
  addRecent({ t: 'c', id: c.id, name: c.name || 'Company' });
  $('barTitle').textContent = c.name || 'Company';
  // Ultimate owner in the pipeline → link to it.
  const om = c.ownershipMeta || null;
  let guoCo = null;
  if (om?.guoNif && om.guoNif !== H.nifFromAny(c.nif, c.bvdId)) {
    try { const g = await getDocs(query(collection(db, 'searchCompanies'), where('nif', '==', om.guoNif), limit(1))); guoCo = g.docs[0] ? { id: g.docs[0].id, name: g.docs[0].data().name } : null; } catch (e) { /* optional */ }
  }
  $('detail').innerHTML = companyHtml(c, links, acts, guoCo);
}

export function companyHtml(c, links, acts, guoCo) {
  const tier = H.tierOf(c);
  const yr = H.foundedYear(c);
  const addr = [c.hqAddress, [c.postcode, c.concelho].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const header = `<header class="head">
    <h1>${esc(c.name || '—')}</h1>
    <p class="head__sub">${esc([c.nif ? 'NIF ' + c.nif : '', c.concelho || c.city].filter(Boolean).join(' · '))}</p>
    <div class="pills">${stagePill(c.stage)}${c.owner ? `<span class="pill muted">${esc(ownerLabel(c.owner))}</span>` : ''}${tier ? `<span class="pill tier">Tier ${tier}</span>` : ''}${c.doNotContact?.on ? `<span class="pill bad">Do not contact</span>` : ''}${c.contactable === false ? '<span class="pill muted">Not contactable</span>' : ''}${c.activeCampaignName ? `<span class="pill info">In campaign: ${esc(c.activeCampaignName)}</span>` : ''}</div>
  </header>`;

  const latestEmp = (() => { const f = c.orbisFinancials || {}; const y = Object.keys(f).filter((k) => f[k]?.numberOfEmployees != null).sort().pop(); return y ? `${intFmt(f[y].numberOfEmployees)} (${y})` : (c.financials?.Y1?.employees ? intFmt(c.financials.Y1.employees) : ''); })();
  const overview = [
    kv('Sector', esc([c.sector, c.subSector].filter(Boolean).join(' › '))),
    kv('CAE', esc([c.caeCode, c.caeDescription].filter(Boolean).join(' — '))),
    kv('NACE', esc([c.naceCode, c.naceDescription].filter(Boolean).join(' — '))),
    kv('Legal form', esc(H.legalFormOf(c))),
    kv('Founded', yr ? `${yr} <span class="muted">(${new Date().getFullYear() - yr} years)</span>` : ''),
    kv('Employees', esc(latestEmp)),
    kv('Address', addr ? `${esc(addr)}<br><a href="https://maps.apple.com/?q=${encodeURIComponent(addr)}" target="_blank" rel="noopener">Open in Maps</a>` : ''),
    kv('Website', c.website ? `<a href="${esc(extUrl(c.website))}" target="_blank" rel="noopener">${esc(c.website)}</a>` : ''),
    kv('Phone', c.companyPhone ? `<a href="${esc(tel(c.companyPhone))}">${esc(c.companyPhone)}</a>` : ''),
    kv('Email', c.companyEmail ? `<a href="mailto:${esc(c.companyEmail)}">${esc(c.companyEmail)}</a>` : ''),
  ].join('') || '<p class="hint">No details yet.</p>';

  const kf = keyFinancials(c);
  const financials = kf ? `<div class="scroll"><table class="fin"><thead><tr><th></th>${kf.cols.map((y) => `<th>${esc(y)}</th>`).join('')}</tr></thead><tbody>${kf.rows.map(([k, vals]) => `<tr><th>${esc(k)}</th>${vals.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="hint small">Source: ${kf.source}.</p>` : '<p class="hint">No financials.</p>';

  const own = H.resolveOwnership(c, links);
  const shs = links.filter(H.linkIsShareholder);
  const curSh = shs.filter((l) => l.shCurrent !== false).sort((a, b) => (b.shDirectPct || 0) - (a.shDirectPct || 0));
  const prevSh = shs.filter((l) => l.shCurrent === false);
  const shRow = (l) => {
    const t = l.shCurrent === false ? null : H.controlTier(l.shDirectPct);
    const crown = own.ownerIds.has(l.personId) ? `<span class="pill ${own.source === 'orbis' ? 'good' : 'warn'}">${own.source === 'orbis' ? 'Controlling' : 'Largest'}</span>` : '';
    return `<a class="row" href="#p/${encodeURIComponent(l.personId)}"><span class="row__main"><span class="row__title">${esc(l.personName || '—')}${l.personEntityType === 'entity' ? ' <span class="muted">(company)</span>' : ''}</span>
      <span class="row__sub">${esc(H.fmtPctOwn(l.shDirectPct))}${l.shTotalPct != null && l.shTotalPct !== l.shDirectPct ? ' · ' + esc(H.fmtPctOwn(l.shTotalPct)) + ' total' : ''}${l.shDate ? ' · as of ' + esc(l.shDate) : ''}</span></span>
      <span class="row__side">${crown}${t ? `<span class="pill muted">${esc(t.label)}</span>` : ''}</span></a>`;
  };
  const guo = own.guoName ? `Ultimate owner: ${guoCo ? `<a href="#c/${encodeURIComponent(guoCo.id)}">${esc(own.guoName)}</a>` : esc(own.guoName)}${own.guoType ? ` <span class="muted">(${esc(own.guoType)})</span>` : ''}` : '';
  const ownNote = [own.note ? esc(own.note) : '', own.treasuryPct != null ? `${esc(own.treasuryPct)}% held by the company itself (treasury)` : '', guo].filter(Boolean).join('<br>');
  const shareholders = (ownNote ? `<p class="note">${ownNote}</p>` : '')
    + (curSh.length ? `<div class="list">${curSh.map(shRow).join('')}</div>` : '<p class="hint">No shareholders recorded.</p>')
    + (prevSh.length ? `<details class="sub"><summary>Previous shareholders (${prevSh.length})</summary><div class="list">${prevSh.map(shRow).join('')}</div></details>` : '');

  const contactsList = (c.contacts || []).map((ct) => `<div class="contact"><div class="row__title">${esc(ct.name || 'Contact')}${ct.isPrimary ? ' <span class="pill muted">Primary</span>' : ''}</div>
    ${ct.role ? `<div class="row__sub">${esc(ct.role)}</div>` : ''}
    <div class="acts">${ct.phone ? `<a href="${esc(tel(ct.phone))}">${esc(ct.phone)}</a>` : ''}${ct.email ? `<a href="mailto:${esc(ct.email)}">${esc(ct.email)}</a>` : ''}${ct.linkedin ? `<a href="${esc(extUrl(ct.linkedin))}" target="_blank" rel="noopener">LinkedIn</a>` : ''}</div></div>`).join('');
  const contacts = contactsList || '<p class="hint">No contacts yet.</p>';

  const mgs = links.filter(H.linkIsManager);
  const curMg = mgs.filter((l) => l.mgmtCurrent !== false), prevMg = mgs.filter((l) => l.mgmtCurrent === false);
  const mgRow = (l) => `<a class="row" href="#p/${encodeURIComponent(l.personId)}"><span class="row__main"><span class="row__title">${esc(l.personName || '—')}</span><span class="row__sub">${esc((l.mgmtRoles || []).join(' · ') || 'Management')}${l.mgmtBoard ? ' · ' + esc(l.mgmtBoard) : ''}</span></span>${/highest/i.test(l.mgmtLevel || '') ? '<span class="pill info">Top exec</span>' : '<span class="chev" aria-hidden="true">›</span>'}</a>`;
  const management = (curMg.length ? `<div class="list">${curMg.map(mgRow).join('')}</div>` : '<p class="hint">No current managers recorded.</p>')
    + (prevMg.length ? `<details class="sub"><summary>Previous (${prevMg.length})</summary><div class="list">${prevMg.map(mgRow).join('')}</div></details>` : '');

  const lastActs = [...acts].sort((a, b) => tsMs(b.date || b.createdAt) - tsMs(a.date || a.createdAt)).slice(0, 10);
  const activities = lastActs.length ? `<div class="list">${lastActs.map((a) => `<div class="act"><div class="row__sub">${esc(dateFmt(a.date || a.createdAt))} · ${esc(String(a.type || '').replace(/_/g, ' '))}${a.createdBy ? ' · ' + esc(String(a.createdBy).split('@')[0]) : ''}</div><div class="row__title">${esc(a.title || '')}</div>${a.content ? `<div class="act__body">${esc(String(a.content).slice(0, 400))}</div>` : ''}</div>`).join('')}</div>` : '<p class="hint">No activities.</p>';

  return header
    + section('Overview', overview)
    + section('Key financials', financials)
    + section(`Shareholders <span class="n">${curSh.length}</span>`, shareholders)
    + section(`Contacts <span class="n">${(c.contacts || []).length}</span>`, contacts)
    + section(`Management <span class="n">${curMg.length}</span>`, management)
    + section(`Activities <span class="n">${acts.length}</span>`, activities, false)
    + `<p class="foot"><a href="/portal/search.html?company=${encodeURIComponent(c.id)}">Open in the full Search CRM</a></p>`;
}

async function showPerson(id) {
  show('detail', 'Person', true);
  $('detail').innerHTML = '<p class="hint">Loading…</p>';
  let snap, links;
  try {
    [snap, links] = await Promise.all([
      getDoc(doc(db, 'searchPeople', id)),
      getDocs(query(collection(db, 'searchPersonLinks'), where('personId', '==', id))).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))),
    ]);
  } catch (e) { $('detail').innerHTML = `<p class="hint err">Could not load: ${esc(e.message)}</p>`; return; }
  if (!snap.exists()) { $('detail').innerHTML = '<p class="hint">Person not found.</p>'; return; }
  const p = { id: snap.id, ...snap.data() };
  addRecent({ t: 'p', id: p.id, name: p.name || 'Person' });
  $('barTitle').textContent = p.name || 'Person';
  $('detail').innerHTML = personHtml(p, links);
}

const CONTACT_FIELDS = [['phone', 'orbisPhones', 'Phone'], ['email', 'orbisEmails', 'Email'], ['linkedin', '', 'LinkedIn'], ['address', 'orbisAddresses', 'Address']];
export function personHtml(p, links) {
  const entity = p.entityType === 'entity';
  const cur = links.filter(H.linkIsCurrent), prev = links.filter((l) => !H.linkIsCurrent(l));
  const age = H.personAge(p);
  const nat = p.nationality && p.nationality !== p.country ? String(p.nationality).split(';').map((x) => x.trim()).filter(Boolean).join(' · ') : '';
  const header = `<header class="head"><h1>${esc(p.name || '—')}</h1>
    <p class="head__sub">${esc([entity ? 'Company (shareholder)' : 'Person', p.country, nat, p.nif ? 'NIF ' + p.nif : ''].filter(Boolean).join(' · '))}</p>
    <div class="pills"><span class="pill muted">${cur.length} current · ${links.length} position${links.length === 1 ? '' : 's'}</span>${age ? `<span class="pill ${age.age >= 60 ? 'warn' : 'muted'}">${age.age}${age.exact ? '' : '~'} years</span>` : ''}</div>
    ${entity && p.matchedCompanyId ? `<a class="btn" href="#c/${encodeURIComponent(p.matchedCompanyId)}">Open company</a>` : ''}
  </header>`;
  const contact = CONTACT_FIELDS.map(([k, orbis, label]) => {
    const vals = [...new Set([p[k], ...H.orbisValues(p, orbis)].filter(Boolean))];
    if (!vals.length) return '';
    const link = (v) => (k === 'phone' ? `<a href="${esc(tel(v))}">${esc(v)}</a>` : k === 'email' ? `<a href="mailto:${esc(v)}">${esc(v)}</a>` : k === 'linkedin' ? `<a href="${esc(extUrl(v))}" target="_blank" rel="noopener">${esc(v)}</a>` : `${esc(v)}<br><a href="https://maps.apple.com/?q=${encodeURIComponent(v)}" target="_blank" rel="noopener">Open in Maps</a>`);
    return kv(label, vals.map(link).join('<br>'));
  }).join('');
  const posRow = (l) => {
    const bits = [];
    if (H.linkIsManager(l)) bits.push((l.mgmtRoles || []).join(' · ') || 'Manager');
    if (H.linkIsShareholder(l)) bits.push('Shareholder ' + H.fmtPctOwn(l.shDirectPct));
    const t = H.linkIsCurrent(l) ? H.controlTier(l.shDirectPct) : null;
    return `<a class="row" href="#c/${encodeURIComponent(l.companyId)}"><span class="row__main"><span class="row__title">${esc(l.companyName || '—')}</span><span class="row__sub">${esc(bits.join(' · ') || '—')}</span></span><span class="row__side">${t ? `<span class="pill muted">${esc(t.label)}</span>` : '<span class="chev" aria-hidden="true">›</span>'}</span></a>`;
  };
  const sortPos = (a, b) => (b.shDirectPct || 0) - (a.shDirectPct || 0) || String(a.companyName || '').localeCompare(String(b.companyName || ''));
  return header
    + section('Contact', contact || '<p class="hint">No contact details.</p>')
    + section(`Current positions <span class="n">${cur.length}</span>`, cur.length ? `<div class="list">${[...cur].sort(sortPos).map(posRow).join('')}</div>` : '<p class="hint">None recorded.</p>')
    + (prev.length ? section(`Previous positions <span class="n">${prev.length}</span>`, `<div class="list">${[...prev].sort(sortPos).map(posRow).join('')}</div>`, false) : '')
    + (p.notes ? section('Notes', `<p>${esc(p.notes)}</p>`) : '');
}

// ── Router ──
function route() {
  const [t, id] = location.hash.replace(/^#\/?/, '').split('/');
  if (t === 'c' && id) showCompany(decodeURIComponent(id));
  else if (t === 'p' && id) showPerson(decodeURIComponent(id));
  else showSearch();
}

function start() {
  $('q').addEventListener('input', () => { clearTimeout(searchTimer); const q = $('q').value; searchTimer = setTimeout(() => runSearch(q), 600); });
  $('searchForm').addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(searchTimer); $('q').blur(); runSearch($('q').value); });
  $('backBtn').addEventListener('click', () => { if (history.length > 1) history.back(); else location.hash = ''; });
  $('signOutBtn').addEventListener('click', async () => { await signOut(auth); toLogin(); });
  window.addEventListener('hashchange', route);
  route();
}

// Full-screen web app from the home screen ("Open as Web App" on iOS): the
// email link signs in Safari, never this app — show how to re-add it instead.
export function isStandalone(nav = navigator, mm = (q) => window.matchMedia?.(q)) {
  return nav?.standalone === true || !!mm?.('(display-mode: standalone)')?.matches || !!mm?.('(display-mode: fullscreen)')?.matches;
}
function showStandaloneHelp() {
  $('loading').hidden = true; $('app').hidden = true;
  $('standaloneUrl').textContent = location.origin + '/portal/m/';
  $('standaloneHelp').hidden = false;
}
const toLogin = () => (isStandalone() ? showStandaloneHelp() : location.replace('/portal/login.html?next=/portal/m/'));

if (typeof window !== 'undefined' && document.getElementById('app')) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { toLogin(); return; }
    const a = await getAccess(user).catch(() => null);
    $('loading').hidden = true;
    if (!a?.can('search.view')) { $('noAccess').hidden = false; return; }
    $('who').textContent = user.email;
    [dir] = await Promise.all([
      loadDirectory().catch(() => []),
      getDoc(doc(db, 'searchConfig', 'targetTiers')).then((s) => H.setTierRules(s.exists() ? s.data().rules : [])).catch(() => {}),
    ]);
    $('app').hidden = false;
    start();
  });
}
