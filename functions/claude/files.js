// Claude connector — reading files: text from PDF, Word, Excel, PowerPoint, CSV
// and plain text; small images as images. Extracted text is cached in Cloud
// Storage (claude/text/…, server-only) and handed out in parts.

const zlib = require("zlib");
const { getStorage } = require("firebase-admin/storage");
const U = require("./util");
const R = require("./redact");

const PART_CHARS = 25000; // escaped in JSON, a part stays well inside Claude Code's answer limit
const MAX_IMAGE_BYTES = 100 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // the portal holds up to 20 MB (investor documents)

// ── A small zip reader (central directory; stored and deflated entries) ──
function unzip(buf) {
  const out = new Map();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    const lNameLen = buf.readUInt16LE(local + 26), lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(start, start + csize);
    out.set(name, () => (method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : Buffer.alloc(0)));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
const xmlText = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&");
const read = (zip, name) => (zip.has(name) ? zip.get(name)().toString("utf8") : "");

function xlsxText(buf) {
  const zip = unzip(buf);
  const shared = [];
  const ss = read(zip, "xl/sharedStrings.xml");
  for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) || []) shared.push(xmlText((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
  const wb = read(zip, "xl/workbook.xml");
  const rels = read(zip, "xl/_rels/workbook.xml.rels");
  const relMap = Object.fromEntries([...rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const sheets = [...wb.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"/g)].map((m) => ({ name: xmlText(m[1]), path: "xl/" + String(relMap[m[2]] || "").replace(/^\/?xl\//, "") }));
  const parts = [];
  for (const sh of sheets) {
    const xml = read(zip, sh.path);
    const lines = [];
    for (const row of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []) {
      const cells = [];
      for (const c of row.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
        const ref = (c.match(/\br="([A-Z]+)\d+"/) || [])[1] || "";
        const t = (c.match(/\bt="([^"]+)"/) || [])[1];
        const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        const is = (c.match(/<is>[\s\S]*?<\/is>/) || [])[0];
        let val = t === "s" ? shared[+v] ?? "" : t === "inlineStr" ? xmlText((is || "").replace(/<[^>]+>/g, "")) : v != null ? xmlText(v) : "";
        let col = 0; for (const ch of ref) col = col * 26 + (ch.charCodeAt(0) - 64);
        while (cells.length < col - 1) cells.push("");
        cells.push(String(val).replace(/[\t\n]+/g, " "));
      }
      if (cells.some((x) => x !== "")) lines.push(cells.join("\t"));
    }
    parts.push(`## Sheet: ${sh.name}\n${lines.join("\n")}`);
  }
  return parts.join("\n\n");
}
function pptxText(buf) {
  const zip = unzip(buf);
  const slides = [...zip.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  return slides.map((n, i) => {
    const xml = read(zip, n);
    const paras = (xml.match(/<a:p>[\s\S]*?<\/a:p>/g) || []).map((p) => xmlText((p.match(/<a:t>([\s\S]*?)<\/a:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join(""))).filter(Boolean);
    const notesXml = read(zip, n.replace("slides/slide", "notesSlides/notesSlide"));
    const notes = (notesXml.match(/<a:t>([\s\S]*?)<\/a:t>/g) || []).map((t) => xmlText(t.replace(/<[^>]+>/g, ""))).join(" ");
    return `## Slide ${i + 1}\n${paras.join("\n")}${notes ? `\n[notes] ${notes}` : ""}`;
  }).join("\n\n");
}
async function pdfText(buf) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [String(text)];
  const joined = pages.map((t, i) => `--- page ${i + 1} of ${totalPages} ---\n${t}`).join("\n\n");
  return pages.join("").replace(/\s+/g, "").length < 20 ? "" : joined;
}
async function docxText(buf) {
  const mammoth = require("mammoth");
  const r = await mammoth.extractRawText({ buffer: buf });
  return r.value || "";
}

function kindOf(name, contentType) {
  const ext = String(name || "").toLowerCase().split(".").pop();
  const ct = String(contentType || "").toLowerCase();
  if (ext === "pdf" || ct === "application/pdf") return "pdf";
  if (ext === "docx" || ct.includes("wordprocessingml")) return "docx";
  if (ext === "xlsx" || ext === "xlsm" || ct.includes("spreadsheetml")) return "xlsx";
  if (ext === "pptx" || ct.includes("presentationml")) return "pptx";
  if (["csv", "txt", "md", "json", "tsv", "ics", "vcf"].includes(ext) || ct.startsWith("text/plain") || ct === "text/csv") return "text";
  if (["html", "htm"].includes(ext) || ct === "text/html") return "html";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext) || /^image\/(png|jpeg|gif|webp)$/.test(ct)) return "image";
  return "other";
}
const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

async function extract(buf, name, contentType) {
  const k = kindOf(name, contentType);
  if (k === "pdf") return { kind: k, text: await pdfText(buf) };
  if (k === "docx") return { kind: k, text: await docxText(buf) };
  if (k === "xlsx") return { kind: k, text: xlsxText(buf) };
  if (k === "pptx") return { kind: k, text: pptxText(buf) };
  if (k === "text") return { kind: k, text: buf.toString("utf8") };
  if (k === "html") return { kind: k, text: R.htmlToText(buf.toString("utf8")) };
  return { kind: k, text: null };
}
function split(text) {
  const parts = [];
  let s = String(text || "");
  while (s.length > PART_CHARS) {
    let cut = s.lastIndexOf("\n", PART_CHARS);
    if (cut < PART_CHARS * 0.5) cut = PART_CHARS;
    parts.push(s.slice(0, cut));
    s = s.slice(cut);
  }
  parts.push(s);
  return parts;
}

// Read a stored file → { parts[], kind } (cached) or { image } or { problem }.
async function readStored(storagePath, { name, contentType, size }, ctx) {
  const kind = kindOf(name, contentType);
  if (size && size > MAX_FILE_BYTES) return { problem: "This file is larger than the portal allows; open it in the portal." };
  const bucket = getStorage().bucket();
  if (kind === "image") {
    if (size && size > MAX_IMAGE_BYTES) return { problem: `This image is ${Math.round(size / 1024)} KB, too large to show here (limit 100 KB). Open it in the portal.` };
    const [buf] = await bucket.file(storagePath).download();
    if (buf.length > MAX_IMAGE_BYTES) return { problem: `This image is ${Math.round(buf.length / 1024)} KB, too large to show here (limit 100 KB). Open it in the portal.` };
    const ext = String(name || "").toLowerCase().split(".").pop();
    return { image: { data: buf.toString("base64"), mimeType: IMAGE_TYPES[ext] || contentType || "image/png" } };
  }
  if (kind === "other") return { problem: "This kind of file can't be read here (PDF, Word, Excel, PowerPoint, CSV, text and small images can). Open it in the portal." };
  const cachePath = `claude/text/p${PART_CHARS}_${U.sha256(storagePath).slice(0, 40)}.json`;
  try {
    const [c] = await bucket.file(cachePath).download();
    const cached = JSON.parse(c.toString("utf8"));
    if (cached && Array.isArray(cached.parts)) return { parts: cached.parts, kind: cached.kind, cached: true };
  } catch (e) { /* not cached yet */ }
  const [buf] = await bucket.file(storagePath).download();
  const { text } = await extract(buf, name, contentType);
  if (!text || !text.trim()) return { problem: kind === "pdf" ? "This PDF has no text layer (a scan); it can't be read here yet. Open it in the portal." : "No text found in this file." };
  const parts = split(R.cleanText(text));
  await bucket.file(cachePath).save(Buffer.from(JSON.stringify({ kind, parts, at: Date.now() })), { contentType: "application/json" }).catch(() => null);
  return { parts, kind };
}

module.exports = { PART_CHARS, MAX_IMAGE_BYTES, unzip, xlsxText, pptxText, kindOf, extract, split, readStored };
