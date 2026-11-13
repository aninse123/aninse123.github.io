// Claude connector — helpers shared by the tools: counted reads, paging, answer size.

const U = require("../util");
const R = require("../redact");

const MAX_CHARS = 60000; // fits Claude Code's 25,000-token answer limit with room to spare

// Every database read a tool makes goes through ctx, so the log and the Usage
// tab see the connector's reads.
function makeCtx(who, { limits, connectionId = null } = {}) {
  const ctx = {
    who, connectionId, reads: 0, rowsLimit: Math.min(100, limits?.rows || 100),
    async doc(path) { ctx.reads++; const s = await U.db().doc(path).get(); return s.exists ? s.data() : null; },
    async docs(paths) {
      if (!paths.length) return [];
      ctx.reads += paths.length;
      const snaps = await U.db().getAll(...paths.map((p) => U.db().doc(p)));
      return snaps.map((s) => (s.exists ? { id: s.id, ...s.data() } : null));
    },
    async query(q) { const snap = await q.get(); ctx.reads += Math.max(1, snap.size); return snap.docs.map((d) => ({ id: d.id, ...d.data(), __snap: d })); },
  };
  return ctx;
}
const db = () => U.db();

// Cursors: an offset (index lists) or the last document id (database lists).
const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function dec(c) { if (!c) return null; try { return JSON.parse(Buffer.from(String(c), "base64url").toString("utf8")); } catch (e) { return null; } }
function pageSize(ctx, n) { const v = Math.round(Number(n)); return Number.isFinite(v) && v > 0 ? Math.min(v, ctx.rowsLimit) : ctx.rowsLimit; }

// Keep the answer under MAX_CHARS: fewer rows if needed, then say where to continue.
function fit(payload, rowsKey = "rows") {
  let out = R.scrub(payload);
  let s = JSON.stringify(out);
  if (s.length <= MAX_CHARS || !Array.isArray(out[rowsKey])) return out;
  const all = out[rowsKey];
  let n = all.length;
  while (n > 1) {
    n = Math.floor(n * 0.8);
    const trial = { ...out, [rowsKey]: all.slice(0, n), cutShort: `Only ${n} of ${all.length} rows fit in one answer; ask for fewer fields or a smaller pageSize.` };
    s = JSON.stringify(trial);
    if (s.length <= MAX_CHARS) return trial;
  }
  return { ...out, [rowsKey]: all.slice(0, 1), cutShort: "One row only: the rows are very large; ask for fewer fields." };
}
// Database list paging: orderBy + limit + startAfter(last document).
async function pageQuery(ctx, coll, q, { cursor, size }) {
  const c = dec(cursor);
  let qq = q;
  if (c?.after && /^[A-Za-z0-9_-]{1,200}$/.test(String(c.after))) {
    ctx.reads++;
    const snap = await U.db().doc(`${coll}/${c.after}`).get();
    if (snap.exists) qq = qq.startAfter(snap);
  }
  const rows = await ctx.query(qq.limit(size + 1));
  const more = rows.length > size;
  const page = rows.slice(0, size);
  return { page, next: more ? enc({ after: page[page.length - 1].id }) : null };
}
const strip = (d) => { if (!d) return d; const { __snap, ...rest } = d; return rest; };
const toMs = (v) => (v == null || v === "" ? null : typeof v === "number" ? v : new Date(v).getTime() || null);
const iso = (t) => { const m = U.ms(t); return m ? new Date(m).toISOString() : null; };

module.exports = { MAX_CHARS, makeCtx, db, enc, dec, pageSize, fit, pageQuery, strip, toMs, iso };
