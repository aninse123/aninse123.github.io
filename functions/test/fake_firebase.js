// Minimal in-memory stand-ins for firebase-admin (Firestore + Storage) and
// firebase-functions, just enough to exercise functions/outreach end to end
// without the emulator (no Java on this machine).
const Module = require("module");

// ── Firestore sentinels ──
class Timestamp {
  constructor(ms) { this._ms = ms; }
  static now() { return new Timestamp(Date.now()); }
  static fromDate(d) { return new Timestamp(d.getTime()); }
  toMillis() { return this._ms; }
  toDate() { return new Date(this._ms); }
}
const SERVER_TS = { __op: "serverTimestamp" };
const FieldValue = {
  serverTimestamp: () => SERVER_TS,
  increment: (n) => ({ __op: "increment", n }),
  arrayUnion: (...v) => ({ __op: "arrayUnion", v }),
  delete: () => DELETE,
};
const DELETE = { __op: "delete" };

const store = new Map(); // path -> data
let autoId = 0;
const newId = () => "id" + String(++autoId).padStart(18, "0");
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x, (k, v) => (v instanceof Timestamp ? { __ts: v._ms } : v)), (k, v) => (v && v.__ts != null ? new Timestamp(v.__ts) : v)));

function applyValue(oldVal, v) {
  if (v === SERVER_TS) return Timestamp.now();
  if (v && v.__op === "increment") return (typeof oldVal === "number" ? oldVal : 0) + v.n;
  if (v && v.__op === "arrayUnion") {
    const arr = Array.isArray(oldVal) ? [...oldVal] : [];
    for (const x of v.v) if (!arr.some((y) => JSON.stringify(y) === JSON.stringify(x))) arr.push(x);
    return arr;
  }
  if (v && typeof v === "object" && !(v instanceof Timestamp) && !Array.isArray(v)) {
    const base = oldVal && typeof oldVal === "object" && !Array.isArray(oldVal) && !(oldVal instanceof Timestamp) ? { ...oldVal } : {};
    for (const [k, vv] of Object.entries(v)) base[k] = applyValue(base[k], vv);
    return base;
  }
  if (Array.isArray(v)) return v.map((x) => applyValue(undefined, x));
  return v;
}
function writeDoc(path, data, { merge = false } = {}) {
  const old = merge ? (store.get(path) || {}) : {};
  const out = merge ? { ...old } : {};
  for (const [k, v] of Object.entries(data)) {
    if (v === DELETE) { delete out[k]; continue; }
    out[k] = merge ? applyValue(old[k], v) : applyValue(undefined, v);
  }
  store.set(path, out);
}
function updateDoc(path, data) {
  if (!store.has(path)) { const e = new Error(`NOT_FOUND ${path}`); e.code = 5; throw e; }
  const cur = clone(store.get(path));
  for (const [k, v] of Object.entries(data)) {
    // "a.b" is a field path in update(), as in Firestore.
    const parts = k.split("."); const last = parts.pop();
    let obj = cur;
    for (const p of parts) { if (!obj[p] || typeof obj[p] !== "object") obj[p] = {}; obj = obj[p]; }
    if (v === DELETE) { delete obj[last]; continue; }
    obj[last] = applyValue(obj[last], v);
  }
  store.set(path, cur);
}

class DocSnap {
  constructor(ref) { this.ref = ref; this.id = ref.id; this.exists = store.has(ref.path); this._d = clone(store.get(ref.path)); }
  data() { return this._d; }
}
class DocRef {
  constructor(path) { this.path = path; this.id = path.split("/").pop(); }
  async get() { return new DocSnap(this); }
  async set(data, opts) { writeDoc(this.path, data, opts); }
  async update(data) { updateDoc(this.path, data); }
  async delete() { store.delete(this.path); }
  collection(n) { return new CollRef(`${this.path}/${n}`); }
}
class Query {
  constructor(coll, filters = [], order = null, lim = null) { this.coll = coll; this.filters = filters; this.order = order; this.lim = lim; }
  where(f, op, v) { return new Query(this.coll, [...this.filters, { f, op, v }], this.order, this.lim); }
  orderBy(f, dir = "asc") { return new Query(this.coll, this.filters, { f, dir }, this.lim); }
  limit(n) { return new Query(this.coll, this.filters, this.order, n); }
  async get() {
    let docs = [...store.keys()].filter((p) => p.startsWith(this.coll + "/") && p.split("/").length === this.coll.split("/").length + 1)
      .map((p) => new DocSnap(new DocRef(p)));
    for (const { f, op, v } of this.filters) {
      docs = docs.filter((d) => {
        const x = d.data()[f];
        if (op === "==") return JSON.stringify(x) === JSON.stringify(v);
        if (op === "array-contains-any") return Array.isArray(x) && x.some((y) => v.includes(y));
        if (op === "in") return v.some((y) => JSON.stringify(x) === JSON.stringify(y));
        if (op === "<=" || op === "<" || op === ">=" || op === ">") {
          if (x == null) return false;
          const a = x instanceof Timestamp ? x.toMillis() : x, b = v instanceof Timestamp ? v.toMillis() : v;
          return op === "<=" ? a <= b : op === "<" ? a < b : op === ">=" ? a >= b : a > b;
        }
        throw new Error("op " + op);
      });
    }
    if (this.order) {
      const { f, dir } = this.order;
      const val = (d) => { const x = d.data()[f]; return x instanceof Timestamp ? x.toMillis() : x ?? 0; };
      docs.sort((a, b) => (dir === "desc" ? val(b) - val(a) : val(a) - val(b)));
    }
    if (this.lim != null) docs = docs.slice(0, this.lim);
    return { empty: docs.length === 0, docs, size: docs.length };
  }
}
class CollRef extends Query {
  constructor(name) { super(name); this.name = name; }
  doc(id) { return new DocRef(`${this.name}/${id || newId()}`); }
  async add(data) { const r = this.doc(); await r.set(data); return r; }
}
const fakeDb = {
  doc: (p) => new DocRef(p),
  collection: (n) => new CollRef(n),
  async getAll(...refs) { return refs.map((r) => new DocSnap(r)); },
  batch() {
    const ops = [];
    return {
      set: (r, d, o) => ops.push(() => writeDoc(r.path, d, o)),
      update: (r, d) => ops.push(() => updateDoc(r.path, d)),
      delete: (r) => ops.push(() => store.delete(r.path)),
      commit: async () => ops.forEach((f) => f()),
    };
  },
  async runTransaction(fn) {
    // Like Firestore: all reads happen before the writes, which are applied
    // together when fn resolves (a throw discards them).
    const ops = [];
    const tx = {
      get: (r) => (r instanceof Query ? r.get() : r.get()),
      getAll: (...refs) => Promise.all(refs.map((r) => r.get())),
      update: (r, d) => { ops.push(() => updateDoc(r.path, d)); return tx; },
      set: (r, d, o) => { ops.push(() => writeDoc(r.path, d, o)); return tx; },
      create: (r, d) => { ops.push(() => { if (store.has(r.path)) { const e = new Error(`ALREADY_EXISTS ${r.path}`); e.code = 6; throw e; } writeDoc(r.path, d); }); return tx; },
      delete: (r) => { ops.push(() => store.delete(r.path)); return tx; },
    };
    const out = await fn(tx);
    ops.forEach((f) => f());
    return out;
  },
};

// ── Storage ──
const storageFiles = new Map();
const bucket = {
  file: (p) => ({ save: async (buf, meta) => storageFiles.set(p, { size: Buffer.byteLength(buf), meta }) }),
  deleteFiles: async ({ prefix }) => { for (const k of [...storageFiles.keys()]) if (k.startsWith(prefix)) storageFiles.delete(k); },
};

// ── firebase-functions ──
class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
const functionsMock = {
  "firebase-admin/firestore": { getFirestore: () => fakeDb, FieldValue, Timestamp },
  "firebase-admin/storage": { getStorage: () => ({ bucket: () => bucket }) },
  "firebase-admin/app": { initializeApp: () => {} },
  "firebase-functions/v2/https": { onCall: (o, fn) => fn, onRequest: (o, fn) => fn, HttpsError },
  "firebase-functions/v2/scheduler": { onSchedule: (o, fn) => fn },
  "firebase-functions/v2/identity": { beforeUserCreated: (fn) => fn, beforeUserSignedIn: (fn) => fn, HttpsError },
  "firebase-functions/params": { defineSecret: (name) => ({ value: () => (name === "RESEND_WEBHOOK_SECRET" ? "whsec_" + Buffer.from("hook-key").toString("base64") : "secret-" + name) }) },
  "firebase-functions": { logger: { info() {}, warn() {}, error() {} } },
};
const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (functionsMock[req]) return functionsMock[req];
  return origLoad.apply(this, arguments);
};

module.exports = { store, storageFiles, Timestamp, FieldValue, HttpsError, fakeDb, resetIds: () => { autoId = 0; } };
