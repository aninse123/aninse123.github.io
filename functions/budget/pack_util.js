// Budget v2, Stage 5b — the accountant pack link: pure helpers (no Firebase), tested in functions/test/budget_pack.test.js.
//
// A pack is sent as a link <site>/p/<packId>/<token> plus a 6-digit code. The token and the code are never stored in the clear:
// budgetPackSecrets/<packId> holds only their salted SHA-256 hashes (and no browser can read that collection). Wrong codes count;
// after MAX_ATTEMPTS the link locks. Every failure of the token itself answers with the same generic message.

const crypto = require("crypto");

const LIMITS = {
  days: 14,                       // how long a link works
  maxAttempts: 5,                 // wrong codes before the link locks
  maxBytes: 25 * 1024 * 1024,     // the zip (receipts + Excel) — larger packs are refused with advice to choose a shorter period
  maxRecipients: 3,
  logKeep: 50,                    // download log entries kept on the link
};

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[A-Za-z]{2,}$/;
const normEmail = (s) => String(s || "").trim().toLowerCase();

// → { list, bad }. Unique, lower case, at most LIMITS.maxRecipients; `bad` are the ones that are not addresses.
function cleanRecipients(input) {
  const raw = Array.isArray(input) ? input : String(input || "").split(/[,;\s]+/);
  const list = [], bad = [];
  for (const r of raw) {
    const e = normEmail(r);
    if (!e) continue;
    if (!EMAIL_RE.test(e)) { bad.push(e); continue; }
    if (!list.includes(e)) list.push(e);
  }
  return { list, bad, tooMany: list.length > LIMITS.maxRecipients };
}

// ── Secrets ──
function newSecret() {
  return {
    token: crypto.randomBytes(32).toString("hex"),                      // 256 bits, goes in the link
    code: String(crypto.randomInt(0, 1000000)).padStart(6, "0"),        // goes by email or is shown on screen
    salt: crypto.randomBytes(16).toString("hex"),
  };
}
const hashSecret = (value, salt) => crypto.createHash("sha256").update(`${salt}:${value}`).digest("hex");
function safeEqual(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  if (x.length !== y.length || x.length === 0) return false;
  return crypto.timingSafeEqual(x, y);
}
const msOf = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : Number(t) || 0);

// What may happen to a link right now. `secrets` = budgetPackSecrets doc, `link` = budgetPackLinks doc.
// → { ok:true } | { ok:false, reason: 'invalid' | 'gone' }  ('gone' = revoked, expired or locked: one message for all three)
function linkState({ secrets, link, token, now = Date.now() }) {
  if (!secrets || !link || !/^[0-9a-f]{64}$/.test(String(token || ""))) return { ok: false, reason: "invalid" };
  if (!safeEqual(hashSecret(token, secrets.salt), secrets.tokenHash)) return { ok: false, reason: "invalid" };
  if (link.revoked || link.locked || msOf(link.expiresAt) <= now) return { ok: false, reason: "gone" };
  return { ok: true };
}
// → { ok } or { ok:false, attemptsLeft, lock } — a code that is not six digits is a typo, not an attempt.
function checkCode({ secrets, link, code }) {
  const c = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(c)) return { ok: false, typo: true, attemptsLeft: Math.max(0, LIMITS.maxAttempts - (link.attempts || 0)) };
  if (safeEqual(hashSecret(c, secrets.salt), secrets.codeHash)) return { ok: true };
  const used = (link.attempts || 0) + 1;
  return { ok: false, attemptsLeft: Math.max(0, LIMITS.maxAttempts - used), lock: used >= LIMITS.maxAttempts };
}

// /<packId>/<token> (the part after /p/) → { id, token } or null.
function parsePath(path) {
  const parts = String(path || "").split("/").filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch (e) { return ""; } });
  const [id, token] = parts.slice(-2);
  if (parts.length < 2 || !/^[A-Za-z0-9]{10,40}$/.test(id || "") || !/^[0-9a-f]{64}$/.test(token || "")) return null;
  return { id, token };
}

// ── Names inside the zip ──
const deburr = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
function safeEntryName(name, fallback = "file") {
  const n = deburr(String(name || "")).replace(/[\\/]+/g, "-").replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^\.+/, "").replace(/\s+/g, " ").trim().slice(0, 100);
  return n || fallback;
}

// ── A zip with stored (uncompressed) entries: no dependency to install ──
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStored(entries) {
  const parts = [], central = [];
  let offset = 0;
  const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }, u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
  const seen = new Set();
  for (const e of entries) {
    let nm = e.name, k = 2;
    while (seen.has(nm.toLowerCase())) { const dot = e.name.lastIndexOf("."); nm = dot > 0 ? `${e.name.slice(0, dot)}-${k++}${e.name.slice(dot)}` : `${e.name}-${k++}`; }
    seen.add(nm.toLowerCase());
    const name = Buffer.from(nm, "utf8"), data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data), crc = crc32(data);
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0)]);
    parts.push(local, name, data);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += local.length + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  return Buffer.concat([...parts, cd, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(offset), u16(0)]);
}

// ── The emails ──
const fmtDate = (ms, lang) => new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "pt-PT", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Lisbon" }).format(new Date(ms));
function linkEmail({ lang, org, from, to, url, expiresAtMs, by, codeMode }) {
  const when = fmtDate(expiresAtMs, lang);
  if (lang === "en") {
    return {
      subject: `Accountant pack ${from} to ${to} — ${org}`,
      message: ["Hello,", "", `Here is the pack of expenses and receipts of ${org} for ${from} to ${to}: an Excel file and the receipts, in one download.`, "", `Download: ${url}`, "",
        `The link works until ${when}. To open it you need a 6-digit code, ${codeMode === "email" ? "which we are sending you in a separate email" : `which ${by} will give you separately`}.`, "", "If something is missing or unclear, just reply to this email."].join("\n"),
    };
  }
  return {
    subject: `Pack contabilístico ${from} a ${to} — ${org}`,
    message: ["Olá,", "", `Segue o pack de despesas e recibos da ${org} de ${from} a ${to}: um ficheiro Excel e os recibos, numa só descarga.`, "", `Descarregar: ${url}`, "",
      `O link funciona até ${when}. Para o abrir precisa de um código de 6 dígitos, ${codeMode === "email" ? "que lhe enviamos num email à parte" : `que ${by} lhe vai indicar à parte`}.`, "", "Se faltar alguma coisa ou algo não estiver claro, responda a este email."].join("\n"),
  };
}
function codeEmail({ lang, org, from, to, code }) {
  if (lang === "en") return { subject: `Code for the ${org} pack ${from} to ${to}`, message: ["Hello,", "", `Your 6-digit code for the pack download: ${code}`, "", "You need it together with the link we sent in the other email. After 5 wrong codes the link locks."].join("\n") };
  return { subject: `Código do pack ${org} ${from} a ${to}`, message: ["Olá,", "", `O seu código de 6 dígitos para descarregar o pack: ${code}`, "", "Precisa dele junto com o link que enviámos no outro email. Depois de 5 códigos errados o link bloqueia."].join("\n") };
}

module.exports = { LIMITS, EMAIL_RE, normEmail, cleanRecipients, newSecret, hashSecret, safeEqual, linkState, checkCode, parsePath, safeEntryName, crc32, zipStored, linkEmail, codeEmail, fmtDate, msOf };
