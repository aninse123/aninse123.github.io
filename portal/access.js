// Team access (Phase 1) — what the signed-in person may see and do.
//
// Permissions come from the sign-in token's custom claims ({ role, perms, key }),
// set by the server (functions/access). Partners (the two founders) have
// everything, also by email. This module only HIDES what someone can't use —
// the Firestore / Storage rules and the Cloud Functions are the real lock.
//
// Hiding is done with one generated style rule: any element with
// data-perm="x" (or several, space-separated — all needed) disappears when
// the person lacks x, including elements rendered later (lists, dialogs).
//
// Keep PERMS in sync with functions/access/perms.js (tests/portal parity test).
import { auth, db, ADMIN_EMAILS, addDoc } from './firebase-config.js';
import { doc, onSnapshot, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import { startFeatures, isOn, onFeaturesChange, PAGE_FEATURE } from './features.js';

// Every CSV export is recorded in the Activity Log (who, which page, how many
// rows) — hiding the Export button is a friction, this is the trail.
export async function logExport(page, rows, what = '') {
  const email = auth.currentUser?.email?.toLowerCase();
  if (!email) return;
  try { await addDoc(collection(db, 'activityLog'), { type: 'data_export', email, page, rows: Number(rows) || 0, what: String(what).slice(0, 200), timestamp: serverTimestamp() }); }
  catch (e) { /* the export itself already happened; never block it */ }
}

export const PERMS = [
  ["search.view", "Search CRM", "See companies, people and activities"],
  ["search.edit", "Search CRM", "Edit companies, contacts, deal; add activities (edit/delete own)"],
  ["search.delete", "Search CRM", "Delete companies and any activity"],
  ["search.import", "Search CRM", "Import companies and people"],
  ["search.export", "Search CRM", "Export CSV (hides the button — not a lock)"],
  ["search.admin", "Search CRM", "Settings, fit criteria, brokers, maintenance"],
  ["out.view", "Outreach", "See Inbox, Sent, Metrics, campaigns, tasks"],
  ["out.draft", "Outreach", "Write emails that wait in To approve (Phase 2)"],
  ["out.send", "Outreach", "Send and reply directly"],
  ["out.approve", "Outreach", "Approve drafts and issues"],
  ["out.tasks", "Outreach", "Do tasks (calls, LinkedIn, letters…)"],
  ["out.campaigns", "Outreach", "Create and run campaigns, lists, recurring emails"],
  ["out.admin", "Outreach", "Addresses, templates, legal footer, suppression, go live"],
  ["net.view", "Network", "See contacts and firms"],
  ["net.edit", "Network", "Edit contacts and firms; add activities (edit/delete own)"],
  ["net.email", "Network", "Send emails to contacts"],
  ["net.delete", "Network", "Delete contacts, firms and any activity"],
  ["net.export", "Network", "Export CSV (hides the button — not a lock)"],
  ["icrm.view", "Investor CRM", "See investors, contacts, commitments"],
  ["icrm.edit", "Investor CRM", "Edit investors, contacts, commitments; add activities (edit/delete own)"],
  ["icrm.email", "Investor CRM", "Send emails to investors"],
  ["icrm.delete", "Investor CRM", "Delete investors and any activity"],
  ["icrm.export", "Investor CRM", "Import / export CSV"],
  ["portal.admin", "Admin", "Investor portal: documents, investors & access, messages, notify"],
  ["portal.viewas", "Admin", "Investor view: see the portal as any investor, incl. their documents (read only)"],
  ["budget.view", "Budget", "See the budget"],
  ["budget.edit", "Budget", "Edit the budget"],
  ["log.view", "Activity Log", "See the portal activity log"],
  ["features.test", "Team & access", "Test features before release (sees features switched to Test)"],
  ["access.manage", "Team & access", "Manage people, roles and access"],
];
export const ALL = PERMS.map(p => p[0]);
const PARTNER_KEYS = { 'andre.rocha@douropartners.pt': 'andre', 'antonio.carvalho@douropartners.pt': 'antonio' };

// Which permission opens each tab, and the order used to pick someone's home tab.
export const TAB_PERM = { investor: 'portal.viewas', admin: 'portal.admin', crm: 'icrm.view', search: 'search.view', outreach: 'out.view', network: 'net.view', budget: 'budget.view', log: 'log.view', team: 'access.manage' };
const TAB_HREF = { investor: '/portal/investor.html', admin: '/portal/admin.html', crm: '/portal/crm.html', search: '/portal/search.html', outreach: '/portal/outreach.html', network: '/portal/network.html', budget: '/portal/budget.html', log: '/portal/log.html', team: '/portal/team.html' };
const HOME_ORDER = ['admin', 'search', 'outreach', 'network', 'crm', 'budget', 'log', 'team'];

// Combined keys for elements allowed by any of several permissions
// (data-perm="out.write" = can send, draft or administer Outreach).
const DERIVED = {
  'out.write': ['out.send', 'out.draft', 'out.admin'],
  'out.start': ['out.approve'],
};
const HIDE_KEYS = [...Object.keys(DERIVED)];

function make(email, role, perms, key) {
  const set = new Set(perms);
  for (const [k, any] of Object.entries(DERIVED)) if (any.some(p => set.has(p))) set.add(k);
  return {
    email, role, key, perms: ALL.filter(p => set.has(p)), keys: set,
    partner: role === 'partner',
    staff: set.size > 0,
    can: (p) => set.has(p),
    canAny: (ps) => ps.some(p => set.has(p)),
  };
}

// "Preview as" (partners only, this browser tab): show the portal with a
// role's permissions. Only what the browser shows changes — the server still
// treats the partner as a partner.
const PREVIEW_KEY = 'douroPreviewAs';
function readPreview() { try { return JSON.parse(sessionStorage.getItem(PREVIEW_KEY) || 'null'); } catch (e) { return null; } }
export function startPreview(name, perms) { try { sessionStorage.setItem(PREVIEW_KEY, JSON.stringify({ name, perms })); } catch (e) {} }
export function stopPreview() { try { sessionStorage.removeItem(PREVIEW_KEY); } catch (e) {} }

// The person's access, from their token (force = fetch a fresh token first).
export async function getAccess(user, { force = false } = {}) {
  if (!user?.email) return null;
  const email = user.email.trim().toLowerCase();
  if (ADMIN_EMAILS.includes(email)) {
    const pv = readPreview();
    if (pv && Array.isArray(pv.perms)) return { ...make(email, 'preview', pv.perms.filter(p => ALL.includes(p)), PARTNER_KEYS[email]), preview: String(pv.name || 'role') };
    return make(email, 'partner', ALL, PARTNER_KEYS[email]);
  }
  let claims = {};
  try { claims = (await user.getIdTokenResult(force)).claims || {}; } catch (e) { claims = {}; }
  return make(email, claims.role || null, Array.isArray(claims.perms) ? claims.perms : [], claims.key || null);
}

// "✎ edited by … · date" badge for a record stamped by firebase-config's stampEdit.
const PARTNER_NAMES = { 'andre.rocha@douropartners.pt': 'André', 'antonio.carvalho@douropartners.pt': 'António' };
export function editedBadge(rec) {
  if (!rec?.updatedBy) return '';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t = rec.updatedByAt?.toMillis ? rec.updatedByAt.toMillis() : rec.updatedByAt?.seconds ? rec.updatedByAt.seconds * 1000 : 0;
  const who = PARTNER_NAMES[rec.updatedBy] || String(rec.updatedBy).split('@')[0];
  const when = t ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Lisbon' }).format(new Date(t)) : '';
  const full = t ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Lisbon' }).format(new Date(t)) : '';
  return `<span class="badge badge-grey" title="Last edited by ${esc(rec.updatedBy)}${full ? ' · ' + esc(full) : ''}">✎ ${esc(who)}${when ? ' · ' + esc(when) : ''}</span>`;
}

// First tab this person may open ('' when none — an investor or nobody).
// A tab whose feature is switched off doesn't count (feature switches).
const tabFeatureOn = (k) => !PAGE_FEATURE[k] || isOn(PAGE_FEATURE[k]);
export function homeFor(a) {
  for (const k of HOME_ORDER) if (a?.can(TAB_PERM[k]) && tabFeatureOn(k)) return TAB_HREF[k];
  return '';
}

// Hide every element whose data-perm the person lacks (now and later).
export function applyPerms(a) {
  let el = document.getElementById('permStyle');
  if (!el) { el = document.createElement('style'); el.id = 'permStyle'; document.head.appendChild(el); }
  const missing = [...ALL, ...HIDE_KEYS].filter(p => !a.keys.has(p));
  el.textContent = missing.length ? `${missing.map(p => `[data-perm~="${p}"]`).join(',\n')} { display: none !important; }` : '';
  document.documentElement.dataset.access = a.partner ? 'partner' : (a.role || 'none');
  if (a.preview && !document.getElementById('previewBar')) {
    const bar = document.createElement('div');
    bar.id = 'previewBar';
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:500;background:#1E2A38;color:#fff;padding:10px 14px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.25);display:flex;gap:12px;align-items:center;font:500 0.86rem Inter,sans-serif;max-width:calc(100vw - 32px);flex-wrap:wrap;';
    bar.innerHTML = '<span>Previewing as <b></b> — this is what they see. You are still a partner on the server.</span><button type="button" style="font:inherit;font-weight:600;background:#fff;color:#1E2A38;border:0;border-radius:6px;padding:5px 10px;cursor:pointer;">Stop preview</button>';
    bar.querySelector('b').textContent = a.preview;
    bar.querySelector('button').addEventListener('click', () => { stopPreview(); window.location.href = '/portal/team.html'; });
    document.body.appendChild(bar);
  }
}

// Reload when the person's own team record changes (role, permissions) and
// sign out at once when their access is suspended or ended.
export function watchAccess(user, a) {
  if (!user || a.partner || a.preview) return;
  let first = true;
  onSnapshot(doc(db, 'team', a.email), async (snap) => {
    if (first) { first = false; return; }
    const m = snap.exists() ? snap.data() : null;
    if (!m || ['suspended', 'ended'].includes(m.status)) {
      await auth.signOut().catch(() => {});
      window.location.href = '/portal/login.html?access=ended';
      return;
    }
    await user.getIdToken(true).catch(() => {});
    window.location.reload();
  }, () => {});
}

// Page guard: the person may open this tab, or is sent to their home tab
// (or the login page). Returns the access object, or null after redirecting.
export async function guardPage(user, tabKey) {
  if (!user) { window.location.href = '/portal/login.html'; return null; }
  const a = await getAccess(user);
  await startFeatures(a); // feature switches: hide what's Off, badge what's in Test
  if (!a.can(TAB_PERM[tabKey]) || !tabFeatureOn(tabKey)) {
    const home = homeFor(a);
    window.location.href = home || '/portal/investor.html';
    return null;
  }
  applyPerms(a);
  watchAccess(user, a);
  // A tab switched off while someone is on it: send them to their home tab.
  onFeaturesChange(() => { if (!tabFeatureOn(tabKey)) window.location.href = homeFor(a) || '/portal/investor.html'; });
  return a;
}
