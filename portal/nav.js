// Shared admin nav bar — injected into <nav class="nav" id="siteNav"></nav>.
// Centralizes markup, active-link state, the account dropdown (avatar +
// email + reads pill + sign out), and the daily-reads display, which were
// previously ~40 near-identical lines duplicated across all 5 admin pages —
// duplication that caused real drift (spacing fixed on one page but not
// another, an overlap bug, container widths desyncing from body width).
import { signOut } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import { auth, getTodayReads, FREE_TIER_DAILY_READS, watchSharedReads } from './firebase-config.js';

const PAGES = [
  { key: 'investor', href: '/portal/investor.html', label: 'Investor view' },
  { key: 'admin',    href: '/portal/admin.html',    label: 'Admin' },
  { key: 'crm',      href: '/portal/crm.html',      label: 'Investor CRM' },
  { key: 'search',   href: '/portal/search.html',   label: 'Search CRM' },
  { key: 'budget',   href: '/portal/budget.html',   label: 'Budget' },
  { key: 'log',      href: '/portal/log.html',      label: 'Activity Log' },
];

let sharedReads = null;

// Firestore Blaze pricing beyond the free tier: $0.06 per 100,000 document
// reads (publicly documented rate, not project-specific). USD_TO_EUR is a
// fixed rough conversion, not a live rate — the resulting €/day figure is a
// ballpark, same spirit as the rest of this counter ("not billing-exact").
const USD_PER_100K_EXTRA_READS = 0.06;
const USD_TO_EUR = 0.92;

// activeKey: which PAGES entry is the current page.
// opts.beforeSignOut: optional async hook run (and awaited) before signOut —
// e.g. admin.html logs a 'logout' activity event first; the other pages don't.
export function initNav(activeKey, opts = {}) {
  const mount = document.getElementById('siteNav');
  if (!mount) return;

  const links = PAGES.map(p =>
    `<a href="${p.href}" class="nav__link${p.key === activeKey ? ' active' : ''}">${p.label}</a>`
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
            <span class="nav__reads" id="navReads" title="Rough estimate of Firestore reads today — resets at midnight, not billing-exact. Firestore free tier: 50.000 reads/day."></span>
            <div class="nav__quota-bar"><div class="nav__quota-fill" id="navQuotaFill"></div></div>
            <span class="nav__cost" id="navCost" title="Very rough estimate: $0.06/100k reads beyond the free tier, converted to EUR at a fixed approximate rate. Not billing-exact — check the Firebase Console for the real number."></span>
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
}

export function setNavEmail(email) {
  const el = document.getElementById('navEmail');
  if (el) el.textContent = email;
  const btn = document.getElementById('navAvatarBtn');
  if (btn) btn.textContent = (email || '?').charAt(0).toUpperCase();
}

// Call after any addReads() to refresh the local-estimate figure shown until
// the shared cross-browser total (see startSharedReadsWatch) reports in.
export function refreshReads() {
  const el = document.getElementById('navReads');
  if (!el) return;
  const local = getTodayReads();
  const shown = sharedReads != null ? sharedReads : local;
  el.textContent = `${shown.toLocaleString('de-DE')} est./${FREE_TIER_DAILY_READS.toLocaleString('de-DE')} free reads`;
  el.title = `Rough estimate of Firestore reads today — resets at midnight, not billing-exact. Firestore free tier: 50.000 reads/day. This browser: ${local.toLocaleString('de-DE')}.`;

  const pct = Math.min(100, (shown / FREE_TIER_DAILY_READS) * 100);
  const fill = document.getElementById('navQuotaFill');
  if (fill) {
    fill.style.width = pct + '%';
    fill.classList.toggle('nav__quota-fill--full', shown >= FREE_TIER_DAILY_READS);
  }

  const extraReads = Math.max(0, shown - FREE_TIER_DAILY_READS);
  const estEur = (extraReads / 100000) * USD_PER_100K_EXTRA_READS * USD_TO_EUR;
  const cost = document.getElementById('navCost');
  if (cost) cost.textContent = `${estEur.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}€ est. today`;
}

// Call once, after auth confirms the user is an admin (the shared counter
// doc is admin-only, matching the rest of adminConfig/*).
export function startSharedReadsWatch() {
  watchSharedReads(n => { sharedReads = n; refreshReads(); });
}
