// Shared admin nav bar — injected into <nav class="nav" id="siteNav"></nav>.
// Centralizes markup, active-link state, the account dropdown (avatar +
// email + reads pill + sign out), and the daily-reads display, which were
// previously ~40 near-identical lines duplicated across all 5 admin pages —
// duplication that caused real drift (spacing fixed on one page but not
// another, an overlap bug, container widths desyncing from body width).
import { signOut } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import { collection, query, where, getCountFromServer, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import {
  auth, db, addReads, getTodayReads, FREE_TIER_DAILY_READS, watchSharedReads,
  getTodayWrites, getTodayDeletes, FREE_TIER_DAILY_WRITES, FREE_TIER_DAILY_DELETES,
  watchSharedWriteCounters, onWriteCountChange
} from './firebase-config.js';

// Registered once, module-load time (not per initNav() call, since initNav()
// can re-render the dropdown's DOM but this listener must survive that) —
// every addWrites()/addDeletes() anywhere in the app, on any of the six
// pages, calls this automatically. No page/handler has to remember to.
onWriteCountChange(() => refreshWrites());

const PAGES = [
  { key: 'investor', href: '/portal/investor.html', label: 'Investor view' },
  { key: 'admin',    href: '/portal/admin.html',    label: 'Investor portal' }, // was "Admin" (renamed 30 Sep: "Admin" is now the top level)
  { key: 'crm',      href: '/portal/crm.html',      label: 'Investor CRM' },
  { key: 'search',   href: '/portal/search.html',   label: 'Search CRM' },
  { key: 'outreach', href: '/portal/outreach.html', label: 'Outreach', badge: 'navOutreachBadge' },
  { key: 'network',  href: '/portal/network.html',  label: 'Network' },
  { key: 'budget',   href: '/portal/budget.html',   label: 'Budget' },
  { key: 'log',      href: '/portal/log.html',      label: 'Activity Log' },
  { key: 'team',     href: '/portal/team.html',     label: 'Team' },
];
// Team access: the permission that shows each link (access.js hides the rest;
// links stay invisible until the page knows who is signed in).
const PAGE_PERM = { investor: 'portal.viewas', admin: 'portal.admin', crm: 'icrm.view', search: 'search.view', outreach: 'out.view', network: 'net.view', budget: 'budget.view', log: 'log.view', team: 'access.manage' };
// Feature switches: a tab that is a feature as a whole (features.js PAGE_FEATURE).
const PAGE_FEATURE_ATTR = { outreach: 'outreach' };

let sharedReads = null;
let sharedWrites = null;
let sharedDeletes = null;


// activeKey: which PAGES entry is the current page.
// opts.beforeSignOut: optional async hook run (and awaited) before signOut —
// e.g. admin.html logs a 'logout' activity event first; the other pages don't.
export function initNav(activeKey, opts = {}) {
  const mount = document.getElementById('siteNav');
  if (!mount) return;

  const links = PAGES.map(p =>
    `<a href="${p.href}" class="nav__link${p.key === activeKey ? ' active' : ''}" data-perm="${PAGE_PERM[p.key]}"${PAGE_FEATURE_ATTR[p.key] ? ` data-feature="${PAGE_FEATURE_ATTR[p.key]}"` : ''}>${p.label}${p.badge ? `<span class="nav__badge" id="${p.badge}" hidden></span>` : ''}</a>`
  ).join('\n        ');

  mount.innerHTML = `
    <div class="nav__inner">
      <div class="nav__left">
        <a href="/"><img src="../assets/logo.png" alt="Douro Partners" class="nav__logo"></a>
      </div>
      <div class="nav__right">
        <div class="nav__links">
        ${links}
        </div>
        <div class="nav__status">
          <button class="nav__avatar" id="navAvatarBtn" type="button" aria-haspopup="true" aria-expanded="false" title="Account"></button>
          <div class="nav__dropdown" id="navDropdown" hidden>
            <span class="nav__email" id="navEmail"></span>
            <button class="nav__signout" id="signOutBtn" type="button">Sign out</button>
          </div>
        </div>
      </div>
    </div>`;

  const avatarBtn = document.getElementById('navAvatarBtn');
  const dropdown  = document.getElementById('navDropdown');

  const closeDropdown = () => {
    dropdown.setAttribute('hidden', '');
    avatarBtn.setAttribute('aria-expanded', 'false');
  };
  const openDropdown = () => {
    dropdown.removeAttribute('hidden');
    avatarBtn.setAttribute('aria-expanded', 'true');
  };

  avatarBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dropdown.hasAttribute('hidden')) openDropdown(); else closeDropdown();
  });
  document.addEventListener('click', (e) => {
    if (!dropdown.hasAttribute('hidden') && !dropdown.contains(e.target) && e.target !== avatarBtn) {
      closeDropdown();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dropdown.hasAttribute('hidden')) {
      closeDropdown();
      avatarBtn.focus();
    }
  });

  document.getElementById('signOutBtn').addEventListener('click', async () => {
    if (opts.beforeSignOut) {
      try { await opts.beforeSignOut(); } catch (e) { /* non-fatal */ }
    }
    await signOut(auth);
    window.location.href = '/portal/login.html';
  });

  refreshReads();
  refreshWrites();
}

// Two letters from the email's local part (e.g. "andre.rocha" → "AR"),
// so different admins with the same first initial (André/António both
// start with "A") are still distinguishable at a glance.
function initials(email) {
  const local = (email || '').split('@')[0];
  const parts = local.split(/[.\-_]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase() || '?';
}

export function setNavEmail(email) {
  const el = document.getElementById('navEmail');
  if (el) el.textContent = email;
  const btn = document.getElementById('navAvatarBtn');
  if (btn) btn.textContent = initials(email);
}

// The account menu shows only the email and Sign out (30 Sep): usage lives in
// Team → Usage (Admin). Pages still call these after counting reads / writes
// (the counting feeds the Usage tab); all that's left to update on screen is
// the Admin's alert strip.
export function refreshReads() { renderUsageAlert(); }
export function refreshWrites() { renderUsageAlert(); }

// Call once, after auth confirms the user is an admin (the shared counter
// docs are admin-only, matching the rest of adminConfig/*).
export function startSharedReadsWatch() {
  watchSharedReads(n => { sharedReads = n; refreshReads(); renderUsageAlert(); });
  watchSharedWriteCounters(({ writes, deletes }) => { sharedWrites = writes; sharedDeletes = deletes; refreshWrites(); renderUsageAlert(); });
  refreshOutreachBadge();
  startUsageAlerts();
}

// Usage alerts (the Admin — "usage.view"): a strip under the menu when a day
// passes 80% of a free database limit, or a sending address nears its cap
// (usageAlerts/current, kept by the Outreach scheduler).
let usageManager = false, usageSenders = [];
async function startUsageAlerts() {
  try {
    const u = auth.currentUser; if (!u || usageManager) return;
    const perms = (await u.getIdTokenResult()).claims.perms || [];
    const isAdmin = String(u.email || '').toLowerCase() === 'andre.rocha@douropartners.pt';
    if (!isAdmin && !perms.includes('usage.view')) return; // the Admin
    usageManager = true;
    onSnapshot(doc(db, 'usageAlerts', 'current'), (s) => { addReads(1); usageSenders = s.data()?.senders || []; renderUsageAlert(); }, () => {});
    renderUsageAlert();
  } catch (e) { /* alerts are a convenience */ }
}
function renderUsageAlert() {
  if (!usageManager) return;
  const nf = (n) => Number(n || 0).toLocaleString('de-DE');
  const msgs = [];
  const r = sharedReads != null ? sharedReads : getTodayReads();
  const w = sharedWrites != null ? sharedWrites : getTodayWrites();
  const d = sharedDeletes != null ? sharedDeletes : getTodayDeletes();
  if (r >= 0.8 * FREE_TIER_DAILY_READS) msgs.push(`reads ${nf(r)} of ${nf(FREE_TIER_DAILY_READS)} (${Math.round(r / FREE_TIER_DAILY_READS * 100)}%)`);
  if (w >= 0.8 * FREE_TIER_DAILY_WRITES) msgs.push(`writes ${nf(w)} of ${nf(FREE_TIER_DAILY_WRITES)} (${Math.round(w / FREE_TIER_DAILY_WRITES * 100)}%)`);
  if (d >= 0.8 * FREE_TIER_DAILY_DELETES) msgs.push(`deletes ${nf(d)} of ${nf(FREE_TIER_DAILY_DELETES)} (${Math.round(d / FREE_TIER_DAILY_DELETES * 100)}%)`);
  const dbAlert = msgs.length > 0;
  usageSenders.forEach((s) => msgs.push(`${s.id} sent ${nf(s.sent)} of its ${nf(s.cap)} a day`));
  let bar = document.getElementById('usageAlertBar');
  if (!msgs.length) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'usageAlertBar';
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'background:#FDF3DC;color:#7A4E00;border-bottom:1px solid #EFD9A6;font:600 0.8rem Inter,sans-serif;padding:7px 16px;text-align:center;';
    const nav = document.getElementById('siteNav');
    if (nav?.parentNode) nav.parentNode.insertBefore(bar, nav.nextSibling); else document.body.prepend(bar);
  }
  bar.innerHTML = `⚠ Usage today: ${msgs.map((m) => m.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))).join(' · ')} — <a href="/portal/team.html#usage-${dbAlert ? 'db' : 'email'}" style="color:inherit;">Team → Usage</a>`;
}

// Unread-replies count on the Outreach tab. One count aggregation per page
// load (billed as a single read), not a live listener on every admin page;
// outreach.html calls setOutreachBadge() itself with its live number.
export async function refreshOutreachBadge() {
  try {
    const snap = await getCountFromServer(query(collection(db, 'outreachThreads'), where('unread', '==', true)));
    addReads(1);
    setOutreachBadge(snap.data().count);
  } catch (e) { /* the badge is a convenience — never block a page on it */ }
}
export function setOutreachBadge(n) {
  const el = document.getElementById('navOutreachBadge');
  if (!el) return;
  el.textContent = n > 99 ? '99+' : String(n);
  el.hidden = !n;
  el.title = `${n} unread repl${n === 1 ? 'y' : 'ies'}`;
}
