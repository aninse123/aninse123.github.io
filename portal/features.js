// Feature switches — page side ("Portal - Feature Switches Plan.md").
//
// Each feature is Off / Test / On, separately for staging and production.
// Elements tagged data-feature="key" (several = all needed) disappear when
// the feature isn't available to this viewer; for testers, anything shown
// only because it's in Test gets a TEST badge. Settings live in
// config/features (read live; the last known is remembered for a fast start);
// anything missing uses the catalog default below.
//
// Keep FEATURES in sync with functions/features/catalog.js (parity test).
import { db } from './firebase-config.js';
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

export const STATES = ['off', 'test', 'on'];
export const FEATURES = [
  ['outreach', 'Outreach', 'release', 'Outreach', 'The Outreach tab: inbox, compose, sent, campaigns, tasks, metrics, settings.'],
  ['outreach.campaigns', 'Outreach', 'release', 'Company campaigns', 'Campaigns to companies, and "Add to campaign" / email in the Search CRM.'],
  ['outreach.people', 'Outreach', 'release', 'People campaigns & lists', 'Campaigns to people (investors, brokers, press…), lists, adding people.'],
  ['outreach.recurring', 'Outreach', 'release', 'Recurring emails', 'Recurring emails, e.g. the investor update.'],
  ['outreach.ai', 'Outreach', 'release', 'AI openers', 'AI-written first lines in drafts.'],
  ['outreach.relationship', 'Outreach', 'release', 'Emails from Investor CRM / Network', '"Send email" in the Investor CRM and Network, sent through Outreach. (Admin notices to investors are never switched.)'],
  ['investorview', 'Investor portal', 'release', 'Investor view', '"View the portal as" a chosen investor, read only.'],
  ['search.tier', 'Search CRM', 'release', 'Target tier & contactable', 'Target tier (rules and per company), contactable, their filters and bulk actions, and the campaign option to include not-contactable companies.'],
  ['search.contactableRules', 'Search CRM', 'release', 'Contactable rules & owner data', 'Owner size, listing and country on the company page (from the Orbis owner columns); later the contactable rules panel, its preview and the reason on each company.'],
  ['mobile', 'Mobile', 'release', 'Douro mobile', 'The phone app (portal/m/) and its search.'],
  ['kill.outreach.sending', 'Kill switches', 'kill', 'Outreach: automatic sending', 'Off: the scheduler sends no campaign emails (drafts still wait). Test: only test campaigns send.'],
  ['kill.outreach.scheduler', 'Kill switches', 'kill', 'Outreach: scheduler', 'Off: nothing moves — no drafts, tasks, starts or new audience matches. Test: only test campaigns move.'],
  ['kill.recurring.drafting', 'Kill switches', 'kill', 'Recurring emails: drafting', 'Off: no new issues are written. Test: only while Outreach is in test mode.'],
  ['kill.ai', 'Kill switches', 'kill', 'AI openers', 'Off: no AI calls at all (also stops the Anthropic cost). Test: only testers\' requests.'],
].map(([key, area, kind, name, description]) => ({ key, area, kind, name, description, defaults: kind === 'kill' ? { staging: 'on', production: 'on' } : { staging: 'on', production: 'off' } }));
const BY_KEY = Object.fromEntries(FEATURES.map((f) => [f.key, f]));

// Tabs that are a feature as a whole.
export const PAGE_FEATURE = { outreach: 'outreach' };

const PRODUCTION_HOSTS = new Set(['douropartners.pt', 'www.douropartners.pt']);
export const siteOfHost = (host) => (PRODUCTION_HOSTS.has(String(host || '').toLowerCase()) ? 'production' : 'staging');
export const SITE = typeof location !== 'undefined' ? siteOfHost(location.hostname) : 'staging';

export function stateOf(flags, key, site = SITE) {
  const f = BY_KEY[key];
  if (!f) return 'off';
  const v = flags?.[key]?.[site];
  return STATES.includes(v) ? v : f.defaults[site];
}
// Testers: the permission, or named on the switch — in Preview only the
// previewed role counts (so previewing as Intern hides Test features).
export function isTester(a, flags, key) {
  if (!a) return false;
  if (a.can?.('features.test')) return true;
  return !a.preview && !!a.email && (flags?.[key]?.testers || []).includes(a.email);
}
export function available(flags, key, a, site = SITE) {
  const st = stateOf(flags, key, site);
  return st === 'on' || (st === 'test' && isTester(a, flags, key));
}

// ── Live state ──
const CACHE_KEY = 'douroFeatures';
let flags = (() => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') || {}; } catch (e) { return {}; } })();
let access = null, started = null, observer = null;
const listeners = [];
export const currentFlags = () => flags;
export const isOn = (key) => available(flags, key, access);
export const onFeaturesChange = (fn) => listeners.push(fn);

// Start once per page (guardPage does it for every staff page). Resolves when
// the settings are known (or after 2.5 s with the last known / defaults).
export function startFeatures(a) {
  access = a;
  if (started) { apply(); return started; }
  started = new Promise((resolve) => {
    const done = () => { apply(); resolve(); };
    const t = setTimeout(done, 2500);
    try {
      onSnapshot(doc(db, 'config', 'features'), (snap) => {
        flags = snap.exists() ? (snap.data().flags || {}) : {};
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(flags)); } catch (e) { /* private mode */ }
        clearTimeout(t); done();
        listeners.forEach((fn) => { try { fn(flags); } catch (e) { /* a listener's problem */ } });
      }, () => { clearTimeout(t); done(); });
    } catch (e) { clearTimeout(t); done(); }
  });
  return started;
}

// Hide what isn't available; badge what's visible only because it's in Test.
function apply() {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('featureStyle');
  if (!el) { el = document.createElement('style'); el.id = 'featureStyle'; document.head.appendChild(el); }
  const hidden = FEATURES.filter((f) => !available(flags, f.key, access)).map((f) => `[data-feature~="${f.key}"]`);
  el.textContent = (hidden.length ? `${hidden.join(',\n')} { display: none !important; }\n` : '')
    + '.feat-test:not(a):not(button):not(span):not(summary) { outline: 1px dashed #B45309; outline-offset: 2px; }\n'
    + 'a.feat-test::after, button.feat-test::after, span.feat-test::after, summary.feat-test::after { content: "TEST"; margin-left: 6px; font: 700 9px/1 Inter, sans-serif; letter-spacing: .06em; color: #fff; background: #B45309; border-radius: 4px; padding: 2px 4px; vertical-align: middle; }';
  tagTests(document);
  if (!observer && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver((muts) => { for (const m of muts) m.addedNodes.forEach((n) => { if (n.nodeType === 1) tagTests(n); }); });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  testerNote();
}
const testKeys = () => FEATURES.filter((f) => stateOf(flags, f.key) === 'test' && isTester(access, flags, f.key)).map((f) => f.key);
function tagTests(root) {
  const keys = new Set(testKeys());
  const nodes = [...(root.matches?.('[data-feature]') ? [root] : []), ...(root.querySelectorAll?.('[data-feature]') || [])];
  nodes.forEach((n) => n.classList.toggle('feat-test', n.dataset.feature.split(/\s+/).some((k) => keys.has(k))));
}
// A tester sees which features are in Test on this site.
function testerNote() {
  const keys = testKeys();
  let n = document.getElementById('featureTestNote');
  if (!keys.length) { n?.remove(); return; }
  if (!n) {
    n = document.createElement('div');
    n.id = 'featureTestNote';
    n.setAttribute('role', 'status');
    n.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:400;background:#B45309;color:#fff;font:600 0.74rem Inter,sans-serif;padding:5px 10px;border-radius:999px;box-shadow:0 2px 10px rgba(0,0,0,.2);cursor:default;';
    document.body.appendChild(n);
  }
  n.textContent = `Testing: ${keys.length} feature${keys.length === 1 ? '' : 's'}`;
  n.title = `In Test on ${SITE} (only testers see them):\n` + keys.map((k) => '• ' + BY_KEY[k].name).join('\n');
}
