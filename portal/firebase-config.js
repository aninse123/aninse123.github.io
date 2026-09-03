import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, setDoc as _setDoc, addDoc as _addDoc, updateDoc as _updateDoc, deleteDoc as _deleteDoc,
  writeBatch as _writeBatch, onSnapshot, increment
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
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

function todayDateStr(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// ── Reads ─────────────────────────────────────────────────────────────────
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
// Firestore Spark/Blaze free-tier daily quotas — see infra doc §11b. Reads,
// writes and deletes are three SEPARATE quotas (each 50k/20k/20k per day) —
// a page that deletes heavily doesn't touch the write budget and vice versa,
// so they're tracked as three separate counters throughout this file, not
// one combined "writes" bucket that would measure against the wrong number.
export const FREE_TIER_DAILY_READS = 50000;
export const FREE_TIER_DAILY_WRITES = 20000;
export const FREE_TIER_DAILY_DELETES = 20000;

// ── Writes & deletes ─────────────────────────────────────────────────────
// Same local-estimate pattern as reads above, but fed by the counting
// wrappers below (addDoc/setDoc/updateDoc/writeBatch → addWrites; deleteDoc
// → addDeletes) instead of being called by hand at each call site — every
// page that imports its Firestore write functions from here (rather than
// straight from the gstatic CDN) gets counted automatically, with no risk of
// a call site being missed the way a hand-placed counter would risk.
function todayWritesKey(){ return 'dp_writes_' + todayDateStr(); }
function todayDeletesKey(){ return 'dp_deletes_' + todayDateStr(); }
// The read counter's display only ever refreshes where a page happens to
// call refreshReads() by hand (nav.js) -- fine for reads, since those mostly
// happen inside render functions that already call it. Writes and deletes
// happen inside dozens of small, scattered handlers (saveContact,
// changeStage, saveActivity, removeContact, ...) across six pages, and none
// of them call anything write-counter-related -- retrofitting every one by
// hand is exactly the per-call-site risk the counting wrappers above were
// built to avoid, just moved from counting to display. So the count and the
// display refresh happen together, from here: nav.js registers itself once
// via onWriteCountChange(), and every addWrites()/addDeletes() call notifies
// it automatically, no matter which of the six pages or which handler made
// the write.
const writeCountListeners = [];
export function onWriteCountChange(cb){ writeCountListeners.push(cb); }
function notifyWriteCountChange(){ writeCountListeners.forEach(cb => { try { cb(); } catch(e){} }); }
export function addWrites(n){
  if (!n) return getTodayWrites();
  const key = todayWritesKey();
  const total = (Number(localStorage.getItem(key)) || 0) + n;
  localStorage.setItem(key, total);
  addSharedWrites(n);
  notifyWriteCountChange();
  return total;
}
export function getTodayWrites(){
  return Number(localStorage.getItem(todayWritesKey())) || 0;
}
export function addDeletes(n){
  if (!n) return getTodayDeletes();
  const key = todayDeletesKey();
  const total = (Number(localStorage.getItem(key)) || 0) + n;
  localStorage.setItem(key, total);
  addSharedDeletes(n);
  notifyWriteCountChange();
  return total;
}
export function getTodayDeletes(){
  return Number(localStorage.getItem(todayDeletesKey())) || 0;
}

// ── Shared, cross-browser totals ────────────────────────────────────────
// One Firestore doc per day per counter kind (admin-only, covered by the
// existing catch-all rule — no rules change needed), incremented atomically
// so André's and António's browsers add up to one real total instead of two
// separate personal ones. Best-effort — never throws, since the localStorage
// count above is always shown first/instead if a shared write or read fails
// (offline, permission hiccup, etc).
//
// Buffered on purpose, same reasoning as the read counter: writing once per
// Firestore *operation* would land every increment on the SAME document, and
// Firestore sustains roughly one write per second per document — a bulk
// import's tens of thousands of writes would queue behind that ceiling,
// competing with the import's own writes and making the page hang. A single
// timer flushes BOTH the write and delete counts together (one doc, two
// fields) so a page that only writes never pays for an empty delete flush
// and vice versa, while still costing just one extra write per 5-second
// window regardless of how many operations happened inside it.
const SHARED_FLUSH_MS = 5000;
let pendingSharedReads = 0;
let pendingSharedWrites = 0;
let pendingSharedDeletes = 0;
let sharedReadsTimer = null;
let sharedWriteTimer = null;

export function flushSharedReads(){
  if (sharedReadsTimer){ clearTimeout(sharedReadsTimer); sharedReadsTimer = null; }
  const n = pendingSharedReads;
  if (!n) return Promise.resolve();
  pendingSharedReads = 0;   // clear first, so a failed write cannot double-count on retry
  return _setDoc(doc(db, 'dailyReadCounters', todayDateStr()), { count: increment(n) }, { merge: true })
    .catch(e => { console.warn('Shared read counter write failed:', e?.message || e); });
}
export function addSharedReads(n){
  if (!n) return;
  pendingSharedReads += n;
  if (!sharedReadsTimer) sharedReadsTimer = setTimeout(flushSharedReads, SHARED_FLUSH_MS);
}

export function flushSharedWrites(){
  if (sharedWriteTimer){ clearTimeout(sharedWriteTimer); sharedWriteTimer = null; }
  const w = pendingSharedWrites, d = pendingSharedDeletes;
  if (!w && !d) return Promise.resolve();
  pendingSharedWrites = 0; pendingSharedDeletes = 0;   // clear first, same reasoning as reads
  const payload = {};
  if (w) payload.writes = increment(w);
  if (d) payload.deletes = increment(d);
  return _setDoc(doc(db, 'dailyWriteCounters', todayDateStr()), payload, { merge: true })
    .catch(e => { console.warn('Shared write counter write failed:', e?.message || e); });
}
function scheduleSharedWriteFlush(){
  if (!sharedWriteTimer) sharedWriteTimer = setTimeout(flushSharedWrites, SHARED_FLUSH_MS);
}
export function addSharedWrites(n){
  if (!n) return;
  pendingSharedWrites += n;
  scheduleSharedWriteFlush();
}
export function addSharedDeletes(n){
  if (!n) return;
  pendingSharedDeletes += n;
  scheduleSharedWriteFlush();
}

// Never lose the tail: a closing tab, a backgrounded phone, or a navigation
// away would otherwise drop whatever is still buffered.
if (typeof document !== 'undefined'){
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden'){ flushSharedReads(); flushSharedWrites(); }
  });
  window.addEventListener('pagehide', () => { flushSharedReads(); flushSharedWrites(); });
}
export function watchSharedReads(callback){
  return onSnapshot(
    doc(db, 'dailyReadCounters', todayDateStr()),
    snap => callback(snap.exists() ? (snap.data().count || 0) : 0),
    () => {}
  );
}
// callback receives { writes, deletes } — one listener covers both since
// they live on the same daily doc.
export function watchSharedWriteCounters(callback){
  return onSnapshot(
    doc(db, 'dailyWriteCounters', todayDateStr()),
    snap => {
      const data = snap.exists() ? snap.data() : {};
      callback({ writes: data.writes || 0, deletes: data.deletes || 0 });
    },
    () => {}
  );
}

// ── Counting wrappers ────────────────────────────────────────────────────
// Every page imports its Firestore write functions from here instead of
// straight from the gstatic CDN, so every write/delete is counted with no
// per-call-site bookkeeping and no risk of a call site being missed — a
// counter that only sees some of the writes is worse than no counter, since
// it looks authoritative while quietly under-reporting. Same call signature
// and behavior as the real functions; the only addition is the count, and
// only on success (if the underlying call throws, nothing was committed to
// Firestore, so nothing is counted — matches how addReads only ever sees
// results that actually came back).
export async function addDoc(...args){ const r = await _addDoc(...args); addWrites(1); return r; }
export async function setDoc(...args){ const r = await _setDoc(...args); addWrites(1); return r; }
export async function updateDoc(...args){ const r = await _updateDoc(...args); addWrites(1); return r; }
export async function deleteDoc(...args){ const r = await _deleteDoc(...args); addDeletes(1); return r; }
// writeBatch: counted on commit(), by however many set/update/delete calls
// were actually staged into that batch instance — not on the individual
// calls, since nothing is written to Firestore until commit() succeeds (and
// a batch commit is all-or-nothing, so a failed commit correctly counts
// nothing).
export function writeBatch(dbArg){
  const b = _writeBatch(dbArg);
  let staged = 0, stagedDeletes = 0;
  const rawSet = b.set.bind(b), rawUpdate = b.update.bind(b), rawDelete = b.delete.bind(b), rawCommit = b.commit.bind(b);
  b.set    = (...a) => { staged++;        return rawSet(...a); };
  b.update = (...a) => { staged++;        return rawUpdate(...a); };
  b.delete = (...a) => { stagedDeletes++; return rawDelete(...a); };
  b.commit = async (...a) => {
    const r = await rawCommit(...a);
    if (staged) addWrites(staged);
    if (stagedDeletes) addDeletes(stagedDeletes);
    staged = 0; stagedDeletes = 0;
    return r;
  };
  return b;
}
