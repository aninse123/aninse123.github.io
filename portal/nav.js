// Shared admin nav bar — injected into <nav class="nav" id="siteNav"></nav>.
// Centralizes markup, active-link state, the account dropdown (avatar +
// email + reads pill + sign out), and the daily-reads display, which were
// previously ~40 near-identical lines duplicated across all 5 admin pages —
// duplication that caused real drift (spacing fixed on one page but not
// another, an overlap bug, container widths desyncing from body width).
import { signOut } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import {
  auth, getTodayReads, FREE_TIER_DAILY_READS, watchSharedReads,
  getTodayWrites, getTodayDeletes, FREE_TIER_DAILY_WRITES, FREE_TIER_DAILY_DELETES,
  watchSharedWriteCounters
} from './firebase-config.js';

const PAGES = [
  { key: 'investor', href: '/portal/investor.html', label: 'Investor view' },
  { key: 'admin',    href: '/portal/admin.html',    label: 'Admin' },
  { key: 'crm',      href: '/portal/crm.html',      label: 'Investor CRM' },
  { key: 'search',   href: '/portal/search.html',   label: 'Search CRM' },
  { key: 'network',  href: '/portal/network.html',  label: 'Network' },
  { key: 'budget',   href: '/portal/budget.html',   label: 'Budget' },
  { key: 'log',      href: '/portal/log.html',      label: 'Activity Log' },
];

let sharedReads = null;
let sharedWrites = null;
let sharedDeletes = null;

// Firestore Blaze pricing beyond the free tier: $0.06 per 100,000 document
// reads, $0.18 per 100,000 writes, $0.02 per 100,000 deletes (publicly
// documented rates, not project-specific). USD_TO_EUR is a fixed rough
// conversion, not a live rate — the resulting €/day figures are a ballpark,
// same spirit as the rest of these counters ("not billing-exact").
const USD_PER_100K_EXTRA_READS = 0.06;
const USD_PER_100K_EXTRA_WRITES = 0.18;
const USD_PER_100K_EXTRA_DELETES = 0.02;
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
            <span class="nav__writes" id="navWrites" title="Rough estimate of Firestore writes today — resets at midnight, not billing-exact. Firestore free tier: 20.000 writes/day."></span>
            <div class="nav__quota-bar"><div class="nav__quota-fill" id="navWriteQuotaFill"></div></div>
            <span class="nav__deletes" id="navDeletes" title="Rough estimate of Firestore deletes today — a separate quota from writes. Firestore free tier: 20.000 deletes/day."></span>
            <span class="nav__cost" id="navCost" title="Very rough estimate: $0.06/100k reads, $0.18/100k writes and $0.02/100k deletes beyond the free tier, converted to EUR at a fixed approximate rate. Not billing-exact — check the Firebase Console for the real number."></span>
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

// Shared quota-bar fill logic (amber → red at 100%), used for both the read
// bar and the write bar.
function fillBar(elId, shown, limit) {
  const pct = Math.min(100, (shown / limit) * 100);
  const isFull = shown >= limit;
  const fill = document.getElementById(elId);
  if (fill) {
    fill.style.width = pct + '%';
    fill.classList.toggle('nav__quota-fill--full', isFull);
  }
  return { pct, isFull };
}

function refreshCost() {
  const extraReads = Math.max(0, (sharedReads != null ? sharedReads : getTodayReads()) - FREE_TIER_DAILY_READS);
  const extraWrites = Math.max(0, (sharedWrites != null ? sharedWrites : getTodayWrites()) - FREE_TIER_DAILY_WRITES);
  const extraDeletes = Math.max(0, (sharedDeletes != null ? sharedDeletes : getTodayDeletes()) - FREE_TIER_DAILY_DELETES);
  const estEur =
    (extraReads / 100000) * USD_PER_100K_EXTRA_READS * USD_TO_EUR +
    (extraWrites / 100000) * USD_PER_100K_EXTRA_WRITES * USD_TO_EUR +
    (extraDeletes / 100000) * USD_PER_100K_EXTRA_DELETES * USD_TO_EUR;
  const cost = document.getElementById('navCost');
  if (cost) cost.textContent = `${estEur.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}€ est. today`;
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

  const { pct, isFull } = fillBar('navQuotaFill', shown, FREE_TIER_DAILY_READS);
  const fillColor = isFull ? '#B33A3A' : '#F59E0B';

  // Same amber→red fill as the bar above, radially, so the avatar doubles as
  // a compact at-a-glance echo of the same quota signal shown in the dropdown.
  // A conic-gradient is a closed loop with two colors here, which means two
  // seams: the one at pct% (fill→track) AND the 12-o'clock wrap-around
  // (track ending at 100% meeting fill starting fresh at 0%). Chromium
  // anti-aliases any hard 0-width stop into a visible fringe past the
  // circle's border, so both seams need a hair of transition — not just
  // the one at pct%. At the 0%/100% extremes there's only one color, so
  // skip the gradient machinery entirely (nothing to seam).
  const avatarBtn = document.getElementById('navAvatarBtn');
  if (avatarBtn) {
    const track = 'rgba(255,255,255,0.12)';
    if (pct <= 0) {
      avatarBtn.style.background = track;
    } else if (pct >= 100) {
      avatarBtn.style.background = fillColor;
    } else {
      const seam = Math.min(0.75, pct, 100 - pct);
      avatarBtn.style.background =
        `conic-gradient(${track} 0%, ${fillColor} ${seam}%, ${fillColor} ${pct}%, ${track} ${pct + seam}%, ${track} 100%)`;
    }
  }

  refreshCost();
}

// Call after any addWrites()/addDeletes() to refresh the local-estimate
// figures shown until the shared cross-browser totals (see
// startSharedReadsWatch) report in. Writes get a bar (same amber→red pattern
// as reads, since 20k/day is tight enough to matter for a bulk import);
// deletes get a compact text line only — no page in this portal deletes in
// volume, so a second full bar would be space spent on a number that never
// moves much.
export function refreshWrites() {
  const wEl = document.getElementById('navWrites');
  const dEl = document.getElementById('navDeletes');
  if (!wEl && !dEl) return;
  const localW = getTodayWrites();
  const localD = getTodayDeletes();
  const shownW = sharedWrites != null ? sharedWrites : localW;
  const shownD = sharedDeletes != null ? sharedDeletes : localD;

  if (wEl) {
    wEl.textContent = `${shownW.toLocaleString('de-DE')} est./${FREE_TIER_DAILY_WRITES.toLocaleString('de-DE')} free writes`;
    wEl.title = `Rough estimate of Firestore writes today — resets at midnight, not billing-exact. Firestore free tier: 20.000 writes/day. This browser: ${localW.toLocaleString('de-DE')}.`;
  }
  fillBar('navWriteQuotaFill', shownW, FREE_TIER_DAILY_WRITES);

  if (dEl) {
    dEl.textContent = `${shownD.toLocaleString('de-DE')} deletes today`;
    dEl.title = `Rough estimate of Firestore deletes today — a separate quota from writes. Firestore free tier: 20.000 deletes/day. This browser: ${localD.toLocaleString('de-DE')}.`;
  }

  refreshCost();
}

// Call once, after auth confirms the user is an admin (the shared counter
// docs are admin-only, matching the rest of adminConfig/*).
export function startSharedReadsWatch() {
  watchSharedReads(n => { sharedReads = n; refreshReads(); });
  watchSharedWriteCounters(({ writes, deletes }) => { sharedWrites = writes; sharedDeletes = deletes; refreshWrites(); });
}
