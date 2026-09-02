import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, setDoc, onSnapshot, increment } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import { getStorage }     from "https://www.gstatic.com/firebasejs/12.13.0/firebase-storage.js";

const firebaseConfig = {
  apiKey:            "AIzaSyAxdEIeLgCp1Eg6J3vMEMnwI6BaIeoyjnk",
  authDomain:        "douro-partners.firebaseapp.com",
  projectId:         "douro-partners",
  storageBucket:     "douro-partners.firebasestorage.app",
  messagingSenderId: "20074053140",
  appId:             "1:20074053140:web:64a790cc558f0688017101"
};

const app = initializeApp(firebaseConfig);

export const auth        = getAuth(app);
// Firestore with offline persistence (IndexedDB) + multi-tab support.
// Serves repeat page loads from local cache and only fetches changed docs from
// the server — keeps reads low at scale and makes navigation fast. Falls back
// to memory cache automatically if IndexedDB is unavailable.
export const db          = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
export const storage     = getStorage(app);
export const ADMIN_EMAILS = [
  'andre.rocha@douropartners.pt',
  'antonio.carvalho@douropartners.pt'
];

// Rough, local, per-browser estimate of Firestore document reads "today" —
// not billing-grade (Firestore's SDK doesn't expose actual billed reads to
// the client), but close: an onSnapshot listener's first snapshot bills for
// every doc it returns, and each snapshot after that only bills for the docs
// that actually changed (snap.docChanges().length), so callers pass exactly
// those numbers in. Keyed by calendar date (not a tab session) because the
// number that actually matters — the 50k reads/day free-tier quota — resets
// daily, not per-tab; localStorage (not sessionStorage) so it's shared across
// every tab on this browser, not reset by opening a new one.
function todayDateStr(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function todayReadsKey(){
  return 'dp_reads_' + todayDateStr();
}
export function addReads(n){
  if (!n) return getTodayReads();
  const key = todayReadsKey();
  const total = (Number(localStorage.getItem(key)) || 0) + n;
  localStorage.setItem(key, total);
  addSharedReads(n);
  return total;
}
export function getTodayReads(){
  return Number(localStorage.getItem(todayReadsKey())) || 0;
}
// Firestore Spark/Blaze free-tier daily read quota — see infra doc §11b.
export const FREE_TIER_DAILY_READS = 50000;

// Shared, cross-browser version of the counter above: one Firestore doc per
// day (admin-only, covered by the existing catch-all rule — no rules change
// needed), incremented atomically so André's and António's browsers add up to
// one real total instead of two separate personal ones. Best-effort — never
// throws, since the localStorage count above is always shown first/instead
// if this write or read fails (offline, permission hiccup, etc).
// Buffered on purpose. This used to write once per Firestore *query*, and
// every write landed on the SAME document — Firestore sustains roughly one
// write per second per document, so a bulk import's ~31,800 queries queued
// ~31,800 increments behind a 1/sec ceiling. The SDK does not drop them: it
// persists them in IndexedDB and retries, so the backlog competed with the
// import's own writes, survived reloads, and made ordinary navigation hang.
//
// Accumulating in memory and flushing on a timer keeps the counter just as
// accurate — it is a daily total, so a few seconds' lag is immaterial — while
// turning tens of thousands of writes into a few dozen.
const SHARED_READS_FLUSH_MS = 5000;
let pendingSharedReads = 0;
let sharedReadsTimer = null;

export function flushSharedReads(){
  if (sharedReadsTimer){ clearTimeout(sharedReadsTimer); sharedReadsTimer = null; }
  const n = pendingSharedReads;
  if (!n) return Promise.resolve();
  pendingSharedReads = 0;   // clear first, so a failed write cannot double-count on retry
  return setDoc(doc(db, 'dailyReadCounters', todayDateStr()), { count: increment(n) }, { merge: true })
    .catch(e => { console.warn('Shared read counter write failed:', e?.message || e); });
}

export function addSharedReads(n){
  if (!n) return;
  pendingSharedReads += n;
  if (!sharedReadsTimer) sharedReadsTimer = setTimeout(flushSharedReads, SHARED_READS_FLUSH_MS);
}

// Never lose the tail: a closing tab, a backgrounded phone, or a navigation
// away would otherwise drop whatever is still buffered.
if (typeof document !== 'undefined'){
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSharedReads(); });
  window.addEventListener('pagehide', flushSharedReads);
}
export function watchSharedReads(callback){
  return onSnapshot(
    doc(db, 'dailyReadCounters', todayDateStr()),
    snap => callback(snap.exists() ? (snap.data().count || 0) : 0),
    () => {}
  );
}
