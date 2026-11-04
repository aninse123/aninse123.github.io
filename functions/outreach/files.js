// Files attached to outgoing email (3 Nov 2026, switch outreach.attachments). A file is a document in outreachFiles (its name, type, size and where
// it lives in Storage: outreach/files/<id>/<name>), uploaded from the portal into the library or on the spot. An email carries a list of file
// ids; the sender checks them again here (they exist, allowed type, size) and reads the bytes from Storage when it sends. Templates can carry
// files too: they go with every email that uses the template.

const { HttpsError } = require("firebase-functions/v2/https");
const { getStorage } = require("firebase-admin/storage");
const store = require("./store");

const { db } = store;
const MAX_FILES = 5;
const MAX_EACH = 10 * 1024 * 1024;
const MAX_TOTAL = 20 * 1024 * 1024;
// Documents, spreadsheets, slides, images and calendar invites. Nothing that runs (exe, js, scripts) and no archives.
const TYPES = {
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text", ods: "application/vnd.oasis.opendocument.spreadsheet", odp: "application/vnd.oasis.opendocument.presentation",
  txt: "text/plain", csv: "text/csv", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", ics: "text/calendar",
};
const extOf = (name) => String(name || "").toLowerCase().split(".").pop();
const allowedName = (name) => Object.prototype.hasOwnProperty.call(TYPES, extOf(name));

const fail = (code, reason, message) => { throw new HttpsError(code, message, { reason }); };

// ids → [{ fileId, filename, contentType, size, storagePath }], checked. Duplicates are dropped; an unknown or not allowed file refuses the email.
async function resolveAttachments(ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map((x) => String(x || "").trim()).filter(Boolean))];
  if (!list.length) return [];
  if (list.length > MAX_FILES) fail("invalid-argument", "too_many_files", `At most ${MAX_FILES} files per email.`);
  const snaps = await db().getAll(...list.map((id) => db().doc(`outreachFiles/${id}`)));
  const out = [];
  let total = 0;
  for (const s of snaps) {
    if (!s.exists) fail("not-found", "file_not_found", "A file you attached is no longer in the library. Attach it again.");
    const f = s.data();
    if (!f.storagePath || !allowedName(f.filename)) fail("failed-precondition", "file_not_allowed", `${f.filename || "A file"} is not an allowed type (documents, spreadsheets, slides, images, calendar invites).`);
    const size = Number(f.size) || 0;
    if (size > MAX_EACH) fail("invalid-argument", "file_too_large", `${f.filename} is larger than ${MAX_EACH / 1048576} MB.`);
    total += size;
    out.push({ fileId: s.id, filename: f.filename, contentType: f.contentType || TYPES[extOf(f.filename)], size, storagePath: f.storagePath });
  }
  if (total > MAX_TOTAL) fail("invalid-argument", "files_too_large", `The files add up to more than ${MAX_TOTAL / 1048576} MB.`);
  return out;
}

// What goes in the message document (and shows as chips in the conversation, like a received attachment).
const describe = (list) => (list || []).map((a) => ({ filename: a.filename, contentType: a.contentType, size: a.size, storagePath: a.storagePath, fileId: a.fileId, outgoing: true, flagged: false, skippedReason: null }));

// What Resend needs: the bytes, base64.
async function payload(list, { bucket = () => getStorage().bucket() } = {}) {
  const out = [];
  for (const a of list || []) {
    const [buf] = await bucket().file(a.storagePath).download();
    out.push({ filename: a.filename, content: buf.toString("base64"), content_type: a.contentType });
  }
  return out;
}

// The attachments received in a conversation, for an internal forward: copied files only, at most 5 and 20 MB together (the biggest are left out).
function fromReceived(msgs) {
  const all = (msgs || []).filter((m) => m.direction === "in").flatMap((m) => (m.attachments || []).filter((a) => a && a.storagePath && !a.flagged))
    .map((a) => ({ filename: a.filename, contentType: a.contentType || "application/octet-stream", size: Number(a.size) || 0, storagePath: a.storagePath }));
  const out = []; let total = 0;
  for (const a of all.sort((x, y) => x.size - y.size)) { if (out.length >= MAX_FILES || a.size > MAX_EACH || total + a.size > MAX_TOTAL) continue; out.push(a); total += a.size; }
  return out;
}

// A received attachment saved to the company's files, on request (server side copy inside Storage).
async function saveReceived({ messageId, index, companyId, note }, caller, { bucket = () => getStorage().bucket() } = {}) {
  const m = await db().doc(`outreachMessages/${messageId}`).get();
  if (!m.exists) fail("not-found", "message_not_found", "Message not found.");
  const a = (m.data().attachments || [])[Number(index)];
  const cid = companyId || m.data().companyId;
  if (!a || !a.storagePath) fail("failed-precondition", "no_file", "That attachment was not copied, so it cannot be saved here.");
  if (!cid) fail("failed-precondition", "no_company", "Assign the conversation to a company first.");
  const ref = db().collection("outreachFiles").doc();
  const safe = String(a.filename || "file").replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120);
  const to = `outreach/files/${ref.id}/${safe}`;
  await bucket().file(a.storagePath).copy(bucket().file(to));
  await db().doc(`outreachMessages/${messageId}`).update({ savedAttachments: store.FieldValue.arrayUnion(Number(index)) }).catch(() => {}); // the Inbox stops asking about this one
  await ref.set({
    name: a.filename, filename: safe, storagePath: to, contentType: a.contentType || "application/octet-stream", size: a.size || 0,
    library: false, source: "received", companyId: cid, messageId, flagged: !!a.flagged, createdAt: store.FieldValue.serverTimestamp(), createdBy: caller,
    ...(String(note || "").trim() ? { note: String(note).replace(/\s+/g, " ").trim().slice(0, 300) } : {}),  // 4 Nov: what the file is, written when it is saved
  });
  return { ok: true, fileId: ref.id };
}

module.exports = { resolveAttachments, describe, payload, saveReceived, fromReceived, allowedName, TYPES, MAX_FILES, MAX_EACH, MAX_TOTAL };
