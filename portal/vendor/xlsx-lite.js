// xlsx-lite — minimal read-only .xlsx reader for Orbis exports.
//
// Why this exists: Orbis writes a stylesheet that standard parsers reject
// (openpyxl and markitdown both fail on it with
// "CellStyle.__init__() got an unexpected keyword argument 'applyNumFmt'").
// We only ever need cell *text*, never formatting, so this reader skips
// styles.xml entirely and reads just the strings — which sidesteps the bug.
//
// No dependencies: unzip uses the browser's built-in DecompressionStream
// ('deflate-raw', Chrome 103+), XML uses DOMParser.
//
// Scope: reads sheet cell text only. No formulas (cached values are used),
// no dates-as-numbers conversion, no styles. Cells keep their internal
// newlines, which matters here — the Orbis list export packs several
// shareholders into one cell separated by "\n".

const ZIP_EOCD = 0x06054b50;      // End of central directory
const ZIP_EOCD64_LOC = 0x07064b50; // Zip64 EOCD locator
const ZIP_CDH  = 0x02014b50;      // Central directory file header

function findEOCD(view, bytes){
  // EOCD is at the end, but a trailing comment can push it back up to 64KB.
  const max = Math.min(bytes.length, 65557);
  for (let i = 22; i <= max; i++){
    const off = bytes.length - i;
    if (view.getUint32(off, true) === ZIP_EOCD) return off;
  }
  throw new Error('Not a valid .xlsx file (no ZIP end-of-directory record found).');
}

function readCentralDirectory(buf){
  const view = new DataView(buf), bytes = new Uint8Array(buf);
  const eocd = findEOCD(view, bytes);
  let count = view.getUint16(eocd + 10, true);
  let cdOffset = view.getUint32(eocd + 16, true);

  // Zip64: the 32-bit fields are saturated and the real values live in the
  // Zip64 EOCD record. Orbis files are small, but a full-universe export
  // could plausibly cross the 4GB/65535-entry line, so handle it.
  if (cdOffset === 0xFFFFFFFF || count === 0xFFFF){
    for (let i = eocd - 20; i >= 0; i--){
      if (view.getUint32(i, true) === ZIP_EOCD64_LOC){
        const z64 = Number(view.getBigUint64(i + 8, true));
        count = Number(view.getBigUint64(z64 + 32, true));
        cdOffset = Number(view.getBigUint64(z64 + 48, true));
        break;
      }
    }
  }

  const entries = new Map();
  let p = cdOffset;
  for (let n = 0; n < count; n++){
    if (view.getUint32(p, true) !== ZIP_CDH) break;
    const method   = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen  = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const cmtLen   = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, compSize, localOff });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return { entries, view, bytes };
}

async function inflateEntry(zip, name){
  const e = zip.entries.get(name);
  if (!e) return null;
  // The local header repeats the name/extra lengths, and they can differ
  // from the central directory's — always read the local ones.
  const nameLen  = zip.view.getUint16(e.localOff + 26, true);
  const extraLen = zip.view.getUint16(e.localOff + 28, true);
  const start = e.localOff + 30 + nameLen + extraLen;
  const raw = zip.bytes.subarray(start, start + e.compSize);
  if (e.method === 0) return new TextDecoder().decode(raw);            // stored
  if (e.method !== 8) throw new Error(`Unsupported ZIP compression (method ${e.method}) for ${name}.`);
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([raw]).stream().pipeThrough(ds);
  return await new Response(stream).text();
}

function colToIndex(ref){
  // "BC12" -> 55 (1-based column number)
  let n = 0;
  for (let i = 0; i < ref.length; i++){
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n;
}

// Concatenate every <t> under a node — rich-text runs split a single string
// across many <r><t> children.
function textOf(node){
  let s = '';
  const ts = node.getElementsByTagName('t');
  for (let i = 0; i < ts.length; i++) s += ts[i].textContent;
  return s;
}

/**
 * Read an .xlsx File/Blob/ArrayBuffer into { sheetNames, sheets }.
 * sheets: { [name]: string[][] } — every cell as text, '' when empty.
 */
export async function readXlsx(input){
  const buf = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
  const zip = readCentralDirectory(buf);
  const parser = new DOMParser();
  const parse = xml => {
    const d = parser.parseFromString(xml, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) throw new Error('Malformed XML inside the .xlsx file.');
    return d;
  };

  // Shared strings table (most cell text lives here, by index).
  let shared = [];
  const ssXml = await inflateEntry(zip, 'xl/sharedStrings.xml');
  if (ssXml){
    const sis = parse(ssXml).getElementsByTagName('si');
    shared = new Array(sis.length);
    for (let i = 0; i < sis.length; i++) shared[i] = textOf(sis[i]);
  }

  // Sheet name -> part path, resolved through the workbook relationships.
  const wbXml = await inflateEntry(zip, 'xl/workbook.xml');
  if (!wbXml) throw new Error('Not a valid .xlsx file (no workbook part).');
  const relsXml = await inflateEntry(zip, 'xl/_rels/workbook.xml.rels') || '<x/>';
  const relMap = {};
  const rels = parse(relsXml).getElementsByTagName('Relationship');
  for (let i = 0; i < rels.length; i++) relMap[rels[i].getAttribute('Id')] = rels[i].getAttribute('Target');

  const sheetEls = parse(wbXml).getElementsByTagName('sheet');
  const sheetNames = [], sheets = {};
  for (let i = 0; i < sheetEls.length; i++){
    const el = sheetEls[i];
    const name = el.getAttribute('name');
    const rid = el.getAttribute('r:id') || el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = relMap[rid] || `worksheets/sheet${i + 1}.xml`;
    if (target.startsWith('/')) target = target.slice(1);
    else if (!target.startsWith('xl/')) target = 'xl/' + target;

    const sheetXml = await inflateEntry(zip, target);
    const rows = [];
    if (sheetXml){
      const rowEls = parse(sheetXml).getElementsByTagName('row');
      for (let r = 0; r < rowEls.length; r++){
        const cells = rowEls[r].getElementsByTagName('c');
        const arr = [];
        let width = 0;
        for (let c = 0; c < cells.length; c++){
          const cell = cells[c];
          const ref = cell.getAttribute('r') || '';
          const idx = ref ? colToIndex(ref) : (c + 1);
          const t = cell.getAttribute('t');
          let val = '';
          if (t === 'inlineStr'){
            val = textOf(cell);
          } else {
            const v = cell.getElementsByTagName('v')[0];
            if (v){
              if (t === 's') val = shared[+v.textContent] ?? '';
              else val = v.textContent;
            }
          }
          arr[idx - 1] = val;
          if (idx > width) width = idx;
        }
        for (let k = 0; k < width; k++) if (arr[k] === undefined) arr[k] = '';
        rows.push(arr);
      }
    }
    sheetNames.push(name);
    sheets[name] = rows;
  }
  return { sheetNames, sheets };
}
