// Budget v2, Stage 5b (7 Nov 2026): the accountant pack as a link and a code — the helpers (secrets, link state, zip, emails) and the whole flow
// against in-memory Firestore / Storage: sending, the public page, wrong codes, expiry, revoking. Synthetic data only; no real mail is sent.
const F = require("./fake_firebase.js");
const sends = [];
global.fetch = async (url, opts = {}) => {
  if (String(url).endsWith("/emails") && opts.method === "POST") sends.push(JSON.parse(opts.body));
  const hdrs = new Map([["x-resend-daily-quota", "5"], ["x-resend-monthly-quota", "50"]]);
  if (global.__failMail && String(url).endsWith("/emails")) return { ok: false, status: 422, headers: { get: (h) => hdrs.get(h.toLowerCase()) ?? null }, text: async () => JSON.stringify({ message: "domain not verified", name: "validation_error" }) };
  return { ok: true, status: 200, headers: { get: (h) => hdrs.get(h.toLowerCase()) ?? null }, text: async () => JSON.stringify({ id: "rs_" + sends.length }) };
};
const U = require("../budget/pack_util");
const B = require("../budget/pack");
const Feat = require("../features");
const { FEATURES } = require("../features/catalog");
const { store, storageFiles } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const reason = async (p) => { try { await p; return "ok"; } catch (e) { return e.details?.reason || e.message; } };
const STAGING = { rawRequest: { headers: { origin: "https://staging--douro-partners.netlify.app" } } };
const PROD = { rawRequest: { headers: { origin: "https://douropartners.pt" } } };
const ANDRE = "andre.rocha@douropartners.pt";
const asPartner = (site) => ({ ...site, auth: { token: { email: ANDRE } } });
const asEditor = (site) => ({ ...site, auth: { token: { email: "rui@douropartners.pt", perms: ["budget.edit", "budget.view"] } } });
const asViewer = (site) => ({ ...site, auth: { token: { email: "ana@douropartners.pt", perms: ["budget.view"] } } });
const PACK = "pk1234567890";

// ── helpers ──
ok("a token is 64 hex characters, a code 6 digits, and two secrets never repeat", (() => { const a = U.newSecret(), b = U.newSecret(); return /^[0-9a-f]{64}$/.test(a.token) && /^\d{6}$/.test(a.code) && a.token !== b.token && a.salt !== b.salt; })());
ok("codes use the whole range, with leading zeros kept", (() => { let zeros = 0; for (let i = 0; i < 4000; i++) if (U.newSecret().code.startsWith("0")) zeros++; return zeros > 100 && zeros < 700; })());
ok("only hashes are stored: the hash differs with the salt and is not the secret", (() => { const h1 = U.hashSecret("123456", "s1"), h2 = U.hashSecret("123456", "s2"); return h1 !== h2 && h1 !== "123456" && /^[0-9a-f]{64}$/.test(h1); })());
ok("safeEqual: equal strings only; empty and different lengths never match", U.safeEqual("abc", "abc") && !U.safeEqual("abc", "abd") && !U.safeEqual("abc", "ab") && !U.safeEqual("", "") && !U.safeEqual(null, null));
const sec = U.newSecret();
const secrets = { tokenHash: U.hashSecret(sec.token, sec.salt), codeHash: U.hashSecret(sec.code, sec.salt), salt: sec.salt };
const link = (o = {}) => ({ revoked: false, locked: false, attempts: 0, expiresAt: Date.now() + 86400000, ...o });
ok("link state: the right token on a live link works", U.linkState({ secrets, link: link(), token: sec.token }).ok);
ok("link state: a wrong, malformed or missing token is 'invalid' (never says why)", ["0".repeat(64), "nope", "", null, undefined].every((t) => U.linkState({ secrets, link: link(), token: t }).reason === "invalid") && U.linkState({ secrets: null, link: link(), token: sec.token }).reason === "invalid" && U.linkState({ secrets, link: null, token: sec.token }).reason === "invalid");
ok("link state: revoked, locked and expired are all just 'gone'", U.linkState({ secrets, link: link({ revoked: true }), token: sec.token }).reason === "gone" && U.linkState({ secrets, link: link({ locked: true }), token: sec.token }).reason === "gone" && U.linkState({ secrets, link: link({ expiresAt: Date.now() - 1 }), token: sec.token }).reason === "gone");
ok("code: the right code works, spaces ignored; 5 wrong ones lock; a non-six-digit entry is a typo, not an attempt", U.checkCode({ secrets, link: link(), code: sec.code }).ok && U.checkCode({ secrets, link: link(), code: ` ${sec.code.slice(0, 3)} ${sec.code.slice(3)} ` }).ok && (() => { const w = sec.code === "000000" ? "111111" : "000000"; const a = U.checkCode({ secrets, link: link({ attempts: 3 }), code: w }), b = U.checkCode({ secrets, link: link({ attempts: 4 }), code: w }), t = U.checkCode({ secrets, link: link(), code: "12" }); return !a.ok && a.attemptsLeft === 1 && !a.lock && !b.ok && b.lock === true && t.typo === true && !t.lock; })());
ok("a path /<id>/<token> is read; anything else is refused", (() => { const p = U.parsePath(`/${PACK}/${sec.token}`); return p && p.id === PACK && p.token === sec.token && !U.parsePath("/") && !U.parsePath(`/${sec.token}`) && !U.parsePath(`/${PACK}/short`) && !U.parsePath(`/../../x/${sec.token}`) && U.parsePath(`/budgetPackDownload/${PACK}/${sec.token}`).id === PACK; })());
ok("recipients: unique, lower case, bad ones named, at most three", (() => { const r = U.cleanRecipients(" Ana@X.pt; ana@x.pt, bad@, b@y.pt "); const t = U.cleanRecipients("a@x.pt,b@x.pt,c@x.pt,d@x.pt"); return r.list.join() === "ana@x.pt,b@y.pt" && r.bad.join() === "bad@" && t.tooMany && U.cleanRecipients([]).list.length === 0; })());
ok("entry names: accents and slashes cleaned, never a path, never empty", U.safeEntryName("2026-10-05_Café São João_12.50.pdf") === "2026-10-05_Cafe Sao Joao_12.50.pdf" && !U.safeEntryName("../../etc/passwd").includes("/") && !U.safeEntryName("..\\x").includes("\\") && U.safeEntryName("") === "file" && U.safeEntryName("///") === "-");

// zip: read it back
function readZip(buf) {
  const eocd = buf.length - 22; if (buf.readUInt32LE(eocd) !== 0x06054b50) throw new Error("no eocd");
  const n = buf.readUInt16LE(eocd + 10); let o = buf.readUInt32LE(eocd + 16); const out = [];
  for (let i = 0; i < n; i++) { const nl = buf.readUInt16LE(o + 28), name = buf.slice(o + 46, o + 46 + nl).toString("utf8"), lo = buf.readUInt32LE(o + 42), size = buf.readUInt32LE(o + 24), crc = buf.readUInt32LE(o + 16); const ln = buf.readUInt16LE(lo + 26), le = buf.readUInt16LE(lo + 28); out.push({ name, data: buf.slice(lo + 30 + ln + le, lo + 30 + ln + le + size), crc }); o += 46 + nl + buf.readUInt16LE(o + 30) + buf.readUInt16LE(o + 32); }
  return out;
}
const z = readZip(U.zipStored([{ name: "a.xlsx", data: Buffer.from("XLSX") }, { name: "receipts/b.pdf", data: Buffer.from("PDF!") }, { name: "receipts/b.pdf", data: Buffer.from("PDF2") }, { name: "é.txt", data: Buffer.alloc(0) }]));
ok("zip: every entry is read back with its content and its CRC; a repeated name gets a number; accents survive; empty files are fine", z.length === 4 && z[0].data.toString() === "XLSX" && z[1].name === "receipts/b.pdf" && z[2].name === "receipts/b-2.pdf" && z[2].data.toString() === "PDF2" && z[3].name === "é.txt" && z.every((e) => U.crc32(e.data) === e.crc));
ok("CRC-32 check value", U.crc32(Buffer.from("123456789")) === 0xCBF43926);
ok("emails: Portuguese by default, the link, the expiry and who gives the code; English on request; the code email carries the code", (() => {
  const a = U.linkEmail({ lang: "pt", org: "Fundo", from: "2026-10-01", to: "2026-10-31", url: "https://x/p/1/2", expiresAtMs: Date.UTC(2026, 10, 21), by: "andre@x", codeMode: "screen" });
  const b = U.linkEmail({ lang: "en", org: "Fundo", from: "a", to: "b", url: "https://x/p/1/2", expiresAtMs: Date.UTC(2026, 10, 21), by: "andre@x", codeMode: "email" });
  const c = U.codeEmail({ lang: "pt", org: "Fundo", from: "a", to: "b", code: "042042" });
  return /Pack contabilístico/.test(a.subject) && a.message.includes("https://x/p/1/2") && /novembro de 2026/.test(a.message) && /andre@x lhe vai indicar/.test(a.message) && /separate email/.test(b.message) && /Accountant pack/.test(b.subject) && c.message.includes("042042") && !a.message.includes("042042");
})());

(async () => {
  // ── switch and limits ──
  const f = FEATURES.find((x) => x.key === "budget.packLink");
  ok("switch budget.packLink: a release switch in the Budget area, Off in production", !!f && f.kind === "release" && f.area === "Budget" && f.defaults.production === "off" && f.defaults.staging === "on");
  ok("limits: 14 days, 5 wrong codes, 25 MB, 3 recipients", U.LIMITS.days === 14 && U.LIMITS.maxAttempts === 5 && U.LIMITS.maxBytes === 25 * 1024 * 1024 && U.LIMITS.maxRecipients === 3);

  // ── set up a pack with two receipts, one of them not the pack's ──
  const setup = () => {
    store.clear(); storageFiles.clear(); sends.length = 0; global.__failMail = false; Feat._reset();
    store.set(`budgetPacks/${PACK}`, { status: "created", from: "2026-10-01", to: "2026-10-31", itemIds: ["i1", "i2"], files: [{ storagePath: "budget/1_flix.pdf", name: "2026-10-05_Flix_8.98.pdf" }, { storagePath: "budget/gone.pdf", name: "2026-10-06_Gone_1.00.pdf" }, { storagePath: "budget/SECRET_OTHER.pdf", name: "x.pdf" }] });
    store.set("budgetItems/i1", { attachments: [{ name: "Flix.pdf", filename: "1_flix.pdf" }] }); store.set("budgetItems/i2", { attachments: [{ name: "Gone.pdf", filename: "gone.pdf" }] });
    store.set("team/maria@douropartners.pt", { email: "maria@douropartners.pt", status: "active" });
    storageFiles.set(`budget-packs/${PACK}/pack.xlsx`, { size: 4, meta: {}, buf: Buffer.from("XLSX") });
    storageFiles.set("budget/1_flix.pdf", { size: 4, meta: {}, buf: Buffer.from("FLIX") });
    storageFiles.set("budget/SECRET_OTHER.pdf", { size: 6, meta: {}, buf: Buffer.from("SECRET") });
  };
  const send = (who, data) => B.sendPack({ packId: PACK, recipients: ["maria@douropartners.pt"], ...data }, "andre.rocha@douropartners.pt", who);

  // ── permissions and checks ──
  setup();
  const call = require("../index.js").budgetPackLink;
  ok("sending needs permission: nobody signed in, a viewer: refused; an editor and the Admin may", (await reason(call({ ...STAGING, data: { action: "send", packId: PACK } }))) === "unauthenticated" && (await reason(call({ ...asViewer(STAGING), data: { action: "send", packId: PACK } }))) === "no_permission" && (await reason(call({ ...asEditor(STAGING), data: { action: "send", packId: PACK, recipients: [] } }))) === "no_recipient" && (await reason(call({ ...asPartner(STAGING), data: { action: "nonsense" } }))) === "bad_action");
  ok("production with the switch Off (the default there): refused, nothing built", (await reason(call({ ...asPartner(PROD), data: { action: "send", packId: PACK, recipients: ["maria@douropartners.pt"] } }))) === "feature_off" && !storageFiles.has(`budget-packs/${PACK}/pack.zip`) && sends.length === 0);
  ok("an unknown pack, an undone pack, bad and too many addresses, missing Excel: each refused with its own reason", (async () => 0) && (await reason(B.sendPack({ packId: "doesnotexist1", recipients: ["maria@douropartners.pt"] }, ANDRE, asPartner(STAGING)))) === "no_pack");
  store.set(`budgetPacks/${PACK}`, { ...store.get(`budgetPacks/${PACK}`), status: "undone" });
  ok("…an undone pack", (await reason(send(asPartner(STAGING), {}))) === "pack_undone");
  setup();
  ok("…bad address / too many / no Excel", (await reason(send(asPartner(STAGING), { recipients: ["not-an-email"] }))) === "bad_recipient" && (await reason(send(asPartner(STAGING), { recipients: ["a@x.pt", "b@x.pt", "c@x.pt", "d@x.pt"] }))) === "too_many_recipients" && (storageFiles.delete(`budget-packs/${PACK}/pack.xlsx`), (await reason(send(asPartner(STAGING), {}))) === "no_xlsx"));
  setup();
  ok("on the staging site a pack goes only to team addresses (the rule for test sends): an outside address is refused before anything is built", (await reason(send(asPartner(STAGING), { recipients: ["accountant@outside.pt"] }))) === "staging_team_only" && !storageFiles.has(`budget-packs/${PACK}/pack.zip`) && sends.length === 0);

  // ── a send, code by email ──
  setup();
  const r = await send(asPartner(STAGING), { codeMode: "email" });
  const zip = readZip(storageFiles.get(`budget-packs/${PACK}/pack.zip`).buf);
  ok("send: the zip holds the Excel, the receipts that exist and belong to the pack, and a README for what is missing; a file that is not one of the pack's receipts is never included", r.sent && zip.some((e) => e.name === "Accountant-pack-2026-10-01_2026-10-31.xlsx" && e.data.toString() === "XLSX") && zip.some((e) => e.name === "receipts/2026-10-05_Flix_8.98.pdf" && e.data.toString() === "FLIX") && !zip.some((e) => e.data.toString() === "SECRET") && zip.some((e) => e.name === "README.txt" && /Gone/.test(e.data.toString()) && /not one of this pack's receipts/.test(e.data.toString())) && r.skipped === 2);
  const L = store.get(`budgetPackLinks/${PACK}`), S = store.get(`budgetPackSecrets/${PACK}`);
  ok("send: the link record has expiry in 14 days, recipients, no token or code; the secrets record has hashes only", L.recipients.join() === "maria@douropartners.pt" && Math.abs(L.expiresAt.toMillis() - (Date.now() + 14 * 86400000)) < 5000 && L.revoked === false && L.attempts === 0 && L.downloads === 0 && L.emailed === true && !JSON.stringify(L).includes(r.url.split("/").pop()) && /^[0-9a-f]{64}$/.test(S.tokenHash) && /^[0-9a-f]{64}$/.test(S.codeHash) && !JSON.stringify(S).includes(r.url.split("/").pop()));
  ok("send: two emails from the no-reply address with the sender as Reply-To — the link first, the code on its own; the link email never contains the code", sends.length === 2 && sends.every((m) => m.from.includes("noreply@douropartners.pt") && m.reply_to === ANDRE && m.to.join() === "maria@douropartners.pt") && sends[0].text.includes(r.url) && !/\b\d{6}\b/.test(sends[0].text.replace(/\d{4}-\d{2}-\d{2}/g, "")) && /\b\d{6}\b/.test(sends[1].text) && !sends[1].text.includes(r.url) && r.code === undefined);
  const parts = r.url.split("/"), token = parts.pop(), id = parts.pop();
  ok("send: the link is on the site the request came from (staging here) as /p/<pack>/<token>", r.url === `https://staging--douro-partners.netlify.app/p/${PACK}/${token}` && id === PACK);
  const code = /\b(\d{6})\b/.exec(sends[1].text)[1];

  // ── the public page ──
  const mkRes = () => ({ h: {}, code: 200, body: null, headersSent: false, set(k, v) { this.h[k] = v; }, status(n) { this.code = n; return this; }, send(b) { this.body = b; this.headersSent = true; } });
  const hit = async (path, method = "GET", body = null) => { const res = mkRes(); await B.download({ path, method, body, get: () => "TestBrowser/1.0" }, res); return res; };
  let res = await hit(`/${PACK}/${token}`);
  ok("GET with the right token: the code form (no pack contents, never cached or indexed)", res.code === 200 && /name="code"/.test(res.body) && !/Flix/.test(res.body) && res.h["Cache-Control"] === "no-store" && /noindex/.test(res.h["X-Robots-Tag"]) && /noindex/.test(res.body));
  res = await hit(`/${PACK}/${"0".repeat(64)}`);
  ok("a wrong token: the same generic page as an unknown pack (nothing leaks)", res.code === 400 && /inválido ou expirado/.test(res.body) && (await hit(`/nonexistent12/${token}`)).body === res.body);
  res = await hit(`/${PACK}/${token}`, "POST", { code: "12" });
  ok("a typo (not six digits) is not counted as an attempt", res.code === 400 && /6 dígitos/.test(res.body) && store.get(`budgetPackLinks/${PACK}`).attempts === 0);
  const wrong = code === "000000" ? "111111" : "000000";
  res = await hit(`/${PACK}/${token}`, "POST", { code: wrong });
  ok("a wrong code: 403, an attempt counted, how many are left", res.code === 403 && /Tentativas restantes: 4/.test(res.body) && store.get(`budgetPackLinks/${PACK}`).attempts === 1 && store.get(`budgetPackLinks/${PACK}`).downloads === 0);
  res = await hit(`/${PACK}/${token}`, "POST", { code });
  const got = readZip(res.body);
  ok("the right code: the zip is downloaded as an attachment, and the download is logged (count, time, browser)", res.code === 200 && res.h["Content-Type"] === "application/zip" && /attachment; filename="Douro-Partners-pack-2026-10-01_2026-10-31\.zip"/.test(res.h["Content-Disposition"]) && got.some((e) => e.name.startsWith("receipts/")) && store.get(`budgetPackLinks/${PACK}`).downloads === 1 && store.get(`budgetPackLinks/${PACK}`).log.length === 1 && store.get(`budgetPackLinks/${PACK}`).log[0].ua === "TestBrowser/1.0");
  res = await hit(`/${PACK}/${token}`, "POST", `code=${code}`);
  ok("a form-encoded body works too, and a second download is logged again", res.code === 200 && store.get(`budgetPackLinks/${PACK}`).downloads === 2 && (await hit(`/${PACK}/${token}`, "PUT")).code === 405);
  // five wrong codes lock it
  for (let i = 0; i < 5; i++) res = await hit(`/${PACK}/${token}`, "POST", { code: wrong });
  const afterLock = await hit(`/${PACK}/${token}`, "POST", { code });
  ok("five wrong codes lock the link: even the right code and token no longer work", res.code === 410 && store.get(`budgetPackLinks/${PACK}`).locked === true && afterLock.code === 410 && /inválido ou expirado/.test(afterLock.body) && (await hit(`/${PACK}/${token}`)).code === 410);

  // ── expiry, revoke, resend ──
  setup(); const r2 = await send(asPartner(STAGING), { codeMode: "email" }); const t2 = r2.url.split("/").pop(), c2 = /\b(\d{6})\b/.exec(sends[1].text)[1];
  store.set(`budgetPackLinks/${PACK}`, { ...store.get(`budgetPackLinks/${PACK}`), expiresAt: F.Timestamp.fromMillis(Date.now() - 1000) });
  ok("after 14 days the link is gone", (await hit(`/${PACK}/${t2}`)).code === 410 && (await hit(`/${PACK}/${t2}`, "POST", { code: c2 })).code === 410);
  setup(); const r3 = await send(asPartner(STAGING), { codeMode: "email" }); const t3 = r3.url.split("/").pop(), c3 = /\b(\d{6})\b/.exec(sends[1].text)[1];
  ok("revoke needs permission, then the link stops at once and the zip is deleted", (await reason(B.revokePack({ packId: PACK }, ANDRE))) === "ok" && (await hit(`/${PACK}/${t3}`)).code === 410 && (await hit(`/${PACK}/${t3}`, "POST", { code: c3 })).code === 410 && !storageFiles.has(`budget-packs/${PACK}/pack.zip`) && store.get(`budgetPackLinks/${PACK}`).revoked === true && store.get(`budgetPackLinks/${PACK}`).revokedBy === ANDRE);
  ok("revoking is refused for viewers; revoking a pack that was never sent says so", (await reason(call({ ...asViewer(STAGING), data: { action: "revoke", packId: PACK } }))) === "no_permission" && (await reason(B.revokePack({ packId: "neversent123" }, ANDRE))) === "no_link");
  setup(); const first = await send(asPartner(STAGING), { codeMode: "email" }); const second = await send(asPartner(STAGING), { codeMode: "email" });
  ok("sending again makes a new link and code; the earlier link stops working", first.url !== second.url && (await hit(`/${PACK}/${first.url.split("/").pop()}`)).code === 400 && (await hit(`/${PACK}/${second.url.split("/").pop()}`)).code === 200);

  // ── code on screen ──
  setup(); sends.length = 0; const r4 = await send(asPartner(STAGING), { codeMode: "screen" });
  ok("code on screen: only one email (the link); the code is returned once to the person and appears in no email; it opens the link", sends.length === 1 && /^\d{6}$/.test(r4.code) && !sends[0].text.includes(r4.code) && (await hit(`/${PACK}/${r4.url.split("/").pop()}`, "POST", { code: r4.code })).code === 200 && store.get(`budgetPackLinks/${PACK}`).codeMode === "screen" && !JSON.stringify(store.get(`budgetPackLinks/${PACK}`)).includes(r4.code));
  // ── English ──
  setup(); await send(asPartner(STAGING), { codeMode: "email", lang: "en" });
  ok("language: English emails on request", /Accountant pack/.test(sends[0].subject) && /Download:/.test(sends[0].text));

  // ── limits ──
  setup(); storageFiles.set("budget/1_flix.pdf", { size: 26 * 1024 * 1024, meta: {}, buf: Buffer.alloc(26 * 1024 * 1024) });
  ok("a pack over 25 MB with its receipts is refused with advice, and nothing is shared", (await reason(send(asPartner(STAGING), {}))) === "pack_too_large" && !storageFiles.has(`budget-packs/${PACK}/pack.zip`) && sends.length === 0 && !store.has(`budgetPackLinks/${PACK}`));
  // ── the mail fails ──
  setup(); global.__failMail = true;
  ok("if the email cannot be sent the link is closed and the zip removed: nobody is left with a live link", (await reason(send(asPartner(STAGING), {}))) === "email_failed" && store.get(`budgetPackLinks/${PACK}`).revoked === true && /domain not verified/.test(store.get(`budgetPackLinks/${PACK}`).emailError) && !storageFiles.has(`budget-packs/${PACK}/pack.zip`));
  global.__failMail = false;

  // ── wiring ──
  const fs = require("fs"), path = require("path");
  const idx = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8"), net = fs.readFileSync(path.join(__dirname, "..", "..", "netlify.toml"), "utf8"), rules = fs.readFileSync(path.join(__dirname, "..", "..", "firestore.rules"), "utf8"), st = fs.readFileSync(path.join(__dirname, "..", "..", "storage.rules"), "utf8");
  ok("both functions are exported from index.js", /exports\.budgetPackLink = require\(".\/budget\/pack"\)\.budgetPackLink/.test(idx) && /exports\.budgetPackDownload = require\(".\/budget\/pack"\)\.budgetPackDownload/.test(idx));
  ok("Netlify serves /p/* from the budgetPackDownload function (status 200 rewrite, like /u/*)", /from = "\/p\/\*"\s*to = "https:\/\/us-central1-douro-partners\.cloudfunctions\.net\/budgetPackDownload\/:splat"\s*status = 200/.test(net));
  ok("rules: the link state is readable with budget.view and has no write rule; the secrets have no rule at all", /match \/budgetPackLinks\/\{id\} \{\s*allow read: if can\('budget\.view'\);\s*\}/.test(rules) && !/budgetPackSecrets/.test(rules.replace(/\/\/.*budgetPackSecrets.*/g, "")));
  ok("storage: the pack's Excel may be uploaded by budget editors (under 5 MB) and read by no browser; the zip has no rule", /match \/budget-packs\/\{packId\}\/pack\.xlsx \{\s*allow write: if \(isAdmin\(\) \|\| can\('budget\.edit'\)\) && request\.resource\.size < 5 \* 1024 \* 1024;\s*\}/.test(st) && !/budget-packs[^\n]*allow read/.test(st));

  console.log(fail ? `\n${fail} FAILED` : "\nAll passed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
