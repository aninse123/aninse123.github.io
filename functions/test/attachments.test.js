// Files on outgoing email (3 Nov 2026, switch outreach.attachments): the checks, the bytes for Resend, template files, and saving a received
// attachment to the company. The send itself is tested in outreach_flows.test.js. Synthetic data only.
const F = require("./fake_firebase.js");
const Files = require("../outreach/files.js");
const { store, storageFiles } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const reason = async (p) => { try { await p; return null; } catch (e) { return e.details?.reason || e.message; } };
const mb = (n) => n * 1024 * 1024;
const put = (id, filename, size = 100, extra = {}) => store.set(`outreachFiles/${id}`, { name: filename, filename, storagePath: `outreach/files/${id}/${filename}`, contentType: "application/pdf", size, library: true, ...extra });

(async () => {
  store.clear();
  put("a", "Deck.pdf", 1000); put("b", "Contas.XLSX", 2000); put("big", "Grande.pdf", mb(11)); put("x", "run.exe", 10); put("z", "arquivo.zip", 10);
  ok("no ids, no files", (await Files.resolveAttachments([])).length === 0 && (await Files.resolveAttachments(null)).length === 0);
  const r = await Files.resolveAttachments(["a", "b", "a"]);
  ok("files are resolved with their name, type, size and place; a file listed twice once", r.length === 2 && r[0].filename === "Deck.pdf" && r[0].storagePath === "outreach/files/a/Deck.pdf" && r[1].fileId === "b");
  ok("an unknown file refuses", (await reason(Files.resolveAttachments(["a", "ghost"]))) === "file_not_found");
  ok("exe and zip are refused, whatever the content type says", (await reason(Files.resolveAttachments(["x"]))) === "file_not_allowed" && (await reason(Files.resolveAttachments(["z"]))) === "file_not_allowed" && Files.allowedName("Relatório.PDF") && Files.allowedName("convite.ics") && !Files.allowedName("a.js") && !Files.allowedName("noext"));
  ok("over 10 MB a file, over 5 files, over 20 MB together: refused", (await reason(Files.resolveAttachments(["big"]))) === "file_too_large" && (await reason(Files.resolveAttachments(["a", "b", "c1", "c2", "c3", "c4"]))) === "too_many_files");
  put("m1", "M1.pdf", mb(9)); put("m2", "M2.pdf", mb(9)); put("m3", "M3.pdf", mb(9));
  ok("…total", (await reason(Files.resolveAttachments(["m1", "m2", "m3"]))) === "files_too_large" && (await Files.resolveAttachments(["m1", "m2"])).length === 2);

  storageFiles.set("outreach/files/a/Deck.pdf", { size: 4, meta: {}, buf: Buffer.from("DECK") });
  const pl = await Files.payload(r.slice(0, 1));
  ok("the bytes go to Resend as base64 with the file name and content_type", pl.length === 1 && pl[0].filename === "Deck.pdf" && pl[0].content === Buffer.from("DECK").toString("base64") && pl[0].content_type === "application/pdf");
  ok("the message record keeps name, size and Storage path (like a received attachment) and says it is outgoing", Files.describe(r)[0].outgoing === true && Files.describe(r)[0].storagePath === "outreach/files/a/Deck.pdf" && Files.describe(null).length === 0);

  // a received attachment saved to the company
  store.set("outreachMessages/m", { companyId: "co1", attachments: [{ filename: "Balanço 2025.pdf", storagePath: "outreach/t1/m/bal.pdf", size: 4, contentType: "application/pdf", flagged: false }, { filename: "video.mp4", skippedReason: "too_large" }] });
  storageFiles.set("outreach/t1/m/bal.pdf", { size: 4, meta: {}, buf: Buffer.from("BAL!") });
  const saved = await Files.saveReceived({ messageId: "m", index: 0 }, "andre@x.pt");
  const doc = store.get(`outreachFiles/${saved.fileId}`);
  ok("saving a received attachment copies it inside Storage and makes a file for the company", saved.ok && doc.companyId === "co1" && doc.source === "received" && doc.library === false && doc.messageId === "m" && storageFiles.has(doc.storagePath) && storageFiles.get(doc.storagePath).buf.toString() === "BAL!");
  ok("an attachment that was not copied cannot be saved; a missing company is said", (await reason(Files.saveReceived({ messageId: "m", index: 1 }, "x"))) === "no_file" && (await reason((store.set("outreachMessages/m2", { attachments: [{ filename: "a.pdf", storagePath: "p" }] }), Files.saveReceived({ messageId: "m2", index: 0 }, "x")))) === "no_company");

  ok("a saved attachment is remembered on its message, so the Inbox stops asking", (store.get("outreachMessages/m").savedAttachments || []).join() === "0");
  const fr = Files.fromReceived([{ direction: "in", attachments: [{ filename: "a.pdf", storagePath: "p1", size: 100 }, { filename: "risk.exe", storagePath: "p2", size: 5, flagged: true }, { filename: "big.pdf", storagePath: "p3", size: mb(11) }, { filename: "none.pdf", size: 5 }] }, { direction: "out", attachments: [{ filename: "ours.pdf", storagePath: "p4", size: 1 }] }]);
  ok("a forward takes the received files that were copied: not risky ones, not oversized, not our own", fr.length === 1 && fr[0].filename === "a.pdf");
  const fs = require("fs"), path = require("path"), src = (f) => fs.readFileSync(path.join(__dirname, "..", "outreach", f), "utf8");
  ok("the sender takes the template's files first, then the email's own, and puts the bytes in the Resend call", /templateFiles = Array\.isArray\(tSnap\.data\(\)\.attachments\)/.test(src("send_core.js")) && /resolveAttachments\(\[\.\.\.templateFiles, \.\.\.\(Array\.isArray\(opts\.attachments\)/.test(src("send_core.js")) && /attachments: await Files\.payload\(p\.attachments\)/.test(src("send_core.js")) && /attachments: Files\.describe\(p\.attachments\)/.test(src("send_core.js")));
  ok("outreachSend passes the ids; saving received files is an action behind the switch", /attachments: Array\.isArray\(input\.attachments\)/.test(src("send.js")) && /saveReceivedFiles: "out\.write"/.test(src("campaigns.js")) && /requireFeature\(request, "outreach\.attachments"\)/.test(src("campaigns.js")));

  console.log(fail ? `\n${fail} FAILED` : "\nAll passed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
