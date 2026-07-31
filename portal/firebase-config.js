import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
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
function todayReadsKey(){
  const d = new Date();
  return 'dp_reads_' + d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
export function addReads(n){
  if (!n) return getTodayReads();
  const key = todayReadsKey();
  const total = (Number(localStorage.getItem(key)) || 0) + n;
  localStorage.setItem(key, total);
  return total;
}
export function getTodayReads(){
  return Number(localStorage.getItem(todayReadsKey())) || 0;
}
// Firestore Spark/Blaze free-tier daily read quota — see infra doc §11b.
export const FREE_TIER_DAILY_READS = 50000;
