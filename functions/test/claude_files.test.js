// Claude connector — reading files: PDF, Word, Excel, PowerPoint, CSV; long files
// in parts; extracted text cached; images; files that can't be read.
const X = require("./claude_fixtures");
const F = require("../claude/files");
const { store, storageFiles } = X.F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

(async () => {
  X.seed();
  ok("kinds by name and type", F.kindOf("a.PDF") === "pdf" && F.kindOf("x", "application/vnd.openxmlformats-officedocument.wordprocessingml.document") === "docx" && F.kindOf("b.xlsx") === "xlsx" && F.kindOf("c.pptx") === "pptx" && F.kindOf("d.csv") === "text" && F.kindOf("e.jpg") === "image" && F.kindOf("f.zip") === "other");
  const pdf = await X.tool(X.ANDRE, "read_file", { fileId: "att:i1:0" });
  ok("PDF text with page markers", pdf.result.kind === "pdf" && /--- page 1 of 1 ---/.test(pdf.result.text) && pdf.result.text.includes("Revenue 6.2M"));
  ok("Word text", (await X.tool(X.ANDRE, "read_file", { fileId: "file:f1" })).result.text.includes("Project Norte teaser"));
  const xl = await X.tool(X.ANDRE, "read_file", { fileId: "file:f2" });
  ok("Excel: sheet name and tab-separated cells", xl.result.text.includes("## Sheet: Data") && xl.result.text.includes("2024\t6200"));
  ok("PowerPoint: one section per slide", (await X.tool(X.ANDRE, "read_file", { fileId: "file:f3" })).result.text.includes("## Slide 1\nSlide one title"));
  const csv = await X.tool(X.ANDRE, "read_file", { fileId: "file:f4" });
  ok("CSV as text, bank details removed", csv.result.text.includes("name,iban") && !csv.text.includes("PT50"));
  ok("investor portal document (PDF) for the Admin", (await X.tool(X.ANDRE, "read_file", { fileId: "doc:d1" })).result.text.includes("Quarterly update Q3"));
  ok("extracted text is cached in server-only storage", [...storageFiles.keys()].some((k) => k.startsWith("claude/text/")));
  storageFiles.delete("outreach/files/f1/teaser.docx");
  ok("cached text is reused (the original isn't read again)", (await X.tool(X.ANDRE, "read_file", { fileId: "file:f1" })).result.text.includes("Project Norte teaser"));

  // Long files in parts.
  const long = Array.from({ length: 3000 }, (_, i) => `line ${i} ` + "x".repeat(40)).join("\n");
  storageFiles.set("outreach/files/f9/long.txt", { buf: Buffer.from(long) });
  store.set("outreachFiles/f9", { name: "Long", filename: "long.txt", storagePath: "outreach/files/f9/long.txt", contentType: "text/plain", size: long.length, companyId: "c1" });
  const l1 = await X.tool(X.ANDRE, "read_file", { fileId: "file:f9" });
  ok("a long file comes in parts of about 25,000 characters", l1.result.parts === Math.ceil(long.length / 25000) || l1.result.parts === Math.ceil(long.length / 25000) + 1);
  ok("…the first says to ask for the next", l1.result.part === 1 && l1.result.next === "Ask for part 2.");
  const l3 = await X.tool(X.ANDRE, "read_file", { fileId: "file:f9", part: l1.result.parts });
  ok("…the last part ends the file", l3.result.text.includes("line 2999") && l3.result.next === null);
  ok("each part fits in one answer, escaped, with room for Claude Code", JSON.stringify(l1.result, null, 1).length < 40000);

  // Images and unreadable files.
  ok("an image above 100 KB is refused politely", /too large to show here/.test((await X.tool(X.ANDRE, "read_file", { fileId: "file:f5" })).result.error));
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
  storageFiles.set("outreach/files/f6/dot.png", { buf: png });
  store.set("outreachFiles/f6", { name: "Dot", filename: "dot.png", storagePath: "outreach/files/f6/dot.png", contentType: "image/png", size: png.length, companyId: "c1" });
  const T = require("../claude/tools");
  const img = T.toContent(await T.callTool(await X.who(X.ANDRE), "read_file", { fileId: "file:f6" }));
  ok("a small image comes back as an image", img.content[0].type === "image" && img.content[0].mimeType === "image/png" && img.content[0].data === png.toString("base64"));
  storageFiles.set("outreach/files/f7/scan.pdf", { buf: X.pdf([]) });
  store.set("outreachFiles/f7", { name: "Scan", filename: "scan.pdf", storagePath: "outreach/files/f7/scan.pdf", contentType: "application/pdf", size: 400, companyId: "c1" });
  ok("a PDF without text (a scan) says so", /no text layer/.test((await X.tool(X.ANDRE, "read_file", { fileId: "file:f7" })).result.error));
  store.set("outreachFiles/f8", { name: "Zip", filename: "data.zip", storagePath: "outreach/files/f8/data.zip", contentType: "application/zip", size: 400, companyId: "c1" });
  ok("an unsupported file says what can be read", /PDF, Word, Excel/.test((await X.tool(X.ANDRE, "read_file", { fileId: "file:f8" })).result.error));
  ok("an attachment that stayed in Gmail says so", /stays in Gmail/.test((await X.tool(X.ANDRE, "read_file", { fileId: "att:i1:1" })).result.error));
  ok("an invented file id is refused", /Unknown file id/.test((await X.tool(X.ANDRE, "read_file", { fileId: "../../budget/x" })).result.error));
  const lf = await X.tool(X.ANDRE, "list_files", { companyId: "c1" });
  ok("list_files: ids, names and sizes, never storage paths", lf.result.rows.length >= 5 && !lf.text.includes("storagePath") && !lf.text.includes("outreach/files"));

  console.log(fail ? `\n${fail} FAILED` : "\nall Claude file tests passed");
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
