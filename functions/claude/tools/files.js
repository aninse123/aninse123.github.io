// Claude connector — list_files and read_file.
//
// File ids handed to Claude:
//   file:<outreachFiles id>        company Files tab and saved attachments   search.view or out.view
//   att:<messageId>:<index>        an email attachment                       out.view
//   doc:<documents id>             an investor portal document               portal.admin
// Storage paths and download links never leave the server.

const { z } = require("zod");
const C = require("./common");
const R = require("../redact");
const F = require("../files");

const has = (who, p) => who.perms.includes(p);
const okId = (s) => /^(?!__)[A-Za-z0-9_-]{1,200}$/.test(String(s || "")); // __x__ ids are reserved by Firestore

const listFiles = {
  name: "list_files", perm: (who) => has(who, "search.view") || has(who, "out.view") || has(who, "portal.admin"),
  description: "Files the portal holds: a company's Files tab (companyId), an email's attachments (messageId), or the investor portal documents (scope \"portal\", Partner and Admin). Returns file ids to read with read_file.",
  schema: { companyId: z.string().optional(), messageId: z.string().optional(), scope: z.enum(["company", "email", "portal"]).optional() },
  async run(ctx, a) {
    const who = ctx.who;
    if (a.scope === "portal") {
      if (!has(who, "portal.admin")) return { error: "Investor portal documents need the investor portal permission." };
      const docs = await ctx.query(C.db().collection("documents").limit(500));
      return C.fit({ rows: docs.map((d) => ({ fileId: `doc:${d.id}`, ...R.pick("documents", d.id, d) })) });
    }
    if (a.messageId) {
      if (!has(who, "out.view")) return { error: "Email attachments need the Outreach view permission." };
      if (!okId(a.messageId)) return { error: "Bad message id." };
      const m = await ctx.doc(`outreachMessages/${a.messageId}`);
      if (!m) return { error: "No email with that id." };
      return C.fit({ rows: (m.attachments || []).map((x, i) => (x && !x.inline ? { fileId: `att:${a.messageId}:${i}`, filename: x.filename, contentType: x.contentType, size: x.size, available: !!x.storagePath || !!x.fileId, skippedReason: x.skippedReason || null } : null)).filter(Boolean) });
    }
    if (a.companyId) {
      if (!has(who, "search.view") && !has(who, "out.view")) return { error: "Company files need the Search CRM or Outreach view permission." };
      if (!okId(a.companyId)) return { error: "Bad company id." };
      const files = await ctx.query(C.db().collection("outreachFiles").where("companyId", "==", a.companyId).limit(200));
      return C.fit({ rows: files.map((f) => ({ fileId: `file:${f.id}`, ...R.pick("outreachFiles", f.id, f) })) });
    }
    return { error: "Give a companyId, a messageId, or scope \"portal\"." };
  },
};

// fileId → { storagePath, name, contentType, size } or { error }.
async function resolve(ctx, fileId) {
  const who = ctx.who;
  const s = String(fileId || "");
  let m;
  if ((m = s.match(/^file:([A-Za-z0-9_-]{1,200})$/))) {
    if (!has(who, "search.view") && !has(who, "out.view")) return { error: "Company files need the Search CRM or Outreach view permission." };
    const f = await ctx.doc(`outreachFiles/${m[1]}`);
    if (!f || !f.storagePath) return { error: "No file with that id." };
    if (f.library && !has(who, "out.view")) return { error: "Library files need the Outreach view permission." };
    return { storagePath: f.storagePath, name: f.filename || f.name, contentType: f.contentType, size: f.size, label: `file "${f.name || f.filename}"` };
  }
  if ((m = s.match(/^att:([A-Za-z0-9_-]{1,200}):(\d{1,3})$/))) {
    if (!has(who, "out.view")) return { error: "Email attachments need the Outreach view permission." };
    const msg = await ctx.doc(`outreachMessages/${m[1]}`);
    const x = msg?.attachments?.[+m[2]];
    if (!x) return { error: "No attachment with that id." };
    if (x.storagePath) return { storagePath: x.storagePath, name: x.filename, contentType: x.contentType, size: x.size, label: `attachment "${x.filename}" of an email from ${msg.from || "unknown"}` };
    if (x.fileId && okId(x.fileId)) { const f = await ctx.doc(`outreachFiles/${x.fileId}`); if (f?.storagePath) return { storagePath: f.storagePath, name: f.filename || x.filename, contentType: f.contentType, size: f.size, label: `attachment "${x.filename}"` }; }
    return { error: x.skippedReason ? `This attachment wasn't kept (${x.skippedReason}); it stays in Gmail.` : "This attachment wasn't kept; it stays in Gmail." };
  }
  if ((m = s.match(/^doc:([A-Za-z0-9_-]{1,200})$/))) {
    if (!has(who, "portal.admin")) return { error: "Investor portal documents need the investor portal permission." };
    const d = await ctx.doc(`documents/${m[1]}`);
    if (!d || !d.filename || /[/\\]/.test(d.filename)) return { error: "No document with that id." };
    return { storagePath: `documents/${d.filename}`, name: d.filename, contentType: d.contentType || "application/pdf", size: d.size, label: `investor portal document "${d.name || d.filename}"` };
  }
  return { error: "Unknown file id. Use list_files or get_company first." };
}

const readFile = {
  name: "read_file", perm: (who) => has(who, "search.view") || has(who, "out.view") || has(who, "portal.admin"),
  description: "Read a file listed by list_files, get_company or get_message: text from PDF, Word, Excel, PowerPoint, CSV and text files (labelled as outside content), in parts of about 25,000 characters (ask for part 2, 3… as needed), or a small image.",
  schema: { fileId: z.string(), part: z.number().int().optional() },
  async run(ctx, a) {
    const r = await resolve(ctx, a.fileId);
    if (r.error) return { error: r.error };
    const got = await F.readStored(r.storagePath, r, ctx);
    if (got.problem) return { error: got.problem };
    if (got.image) return { __image: got.image, note: `Image ${r.name}` };
    const n = got.parts.length;
    const part = Math.min(Math.max(1, a.part || 1), n);
    return { fileId: a.fileId, name: r.name, kind: got.kind, part, parts: n, text: R.untrusted(got.parts[part - 1], `${r.label}${n > 1 ? `, part ${part} of ${n}` : ""}`), next: part < n ? `Ask for part ${part + 1}.` : null };
  },
};

module.exports = { tools: [listFiles, readFile], resolve };
