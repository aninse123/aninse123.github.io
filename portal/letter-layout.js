// Letters to print — page layout (29 Oct 2026, switch outreach.letterTools).
// A4 folded in three goes into a DL window envelope (110 x 220 mm). The address window is
// measured on the ENVELOPE (settings: letterWindow = { left, top, width, height } in mm, left =
// from the envelope's left edge, top = from its top edge); the folded sheet (210 x 99 mm) sits
// centred in the envelope, so on the paper the window is 5 mm further left and 5.5 mm higher.
// Default = the window of the envelopes André uses: ~2 cm from the right edge, ~4.5 cm from the
// top, ~7 x 3.5 cm -> left 130, top 45, 70 x 35. The page asks for no footer and no city.

export const ENVELOPE = { w: 220, h: 110 };
export const SHEET = { w: 210, folded: 99 };
export const DEFAULT_WINDOW = { left: 130, top: 45, width: 70, height: 35 };
const INNER = 2.5; // margin between the window edge and the address, so a sheet that shifts still shows it all

const n = (x) => (x === '' || x === null || x === undefined || Number.isNaN(Number(x)) ? null : Number(x));
const r1 = (x) => Math.round(x * 10) / 10;

// A usable window or the default; also returns a message when the numbers don't make sense.
export function checkWindow(w) {
  const v = { left: n(w?.left), top: n(w?.top), width: n(w?.width), height: n(w?.height) };
  if (Object.values(v).some((x) => x === null)) return { ok: false, error: 'Fill in all four measurements (in mm).' };
  if (v.width < 30 || v.width > 120 || v.height < 20 || v.height > 60) return { ok: false, error: 'The window should be between 30 and 120 mm wide and 20 and 60 mm high.' };
  if (v.left < 0 || v.top < 0 || v.left + v.width > ENVELOPE.w || v.top + v.height > ENVELOPE.h) return { ok: false, error: `The window must fit inside the ${ENVELOPE.w} x ${ENVELOPE.h} mm envelope.` };
  return { ok: true, value: v };
}
export function normalizeWindow(w) {
  const c = checkWindow(w);
  return c.ok ? c.value : { ...DEFAULT_WINDOW };
}
// Where the window falls on the paper (mm from the sheet's top-left corner).
export function windowOnPaper(w) {
  const v = normalizeWindow(w);
  const dx = (ENVELOPE.w - SHEET.w) / 2, dy = (ENVELOPE.h - SHEET.folded) / 2;
  return { x: r1(v.left - dx), y: r1(v.top - dy), w: v.width, h: v.height };
}
export function addressBox(w) {
  const p = windowOnPaper(w);
  return { x: r1(p.x + INNER), y: r1(p.y + INNER), w: r1(p.w - 2 * INNER), h: r1(p.h - 2 * INNER) };
}

const BASE = 'body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; } .page { width: 210mm; height: 297mm; box-sizing: border-box; position: relative; page-break-after: always; overflow: hidden; } .page:last-child { page-break-after: auto; }';
const SCREEN = '@media screen { body { background: #ddd; } .page { background: #fff; margin: 10mm auto; box-shadow: 0 2px 10px rgba(0,0,0,.2); } }';

// CSS of a letter page. Every page is a fixed A4 box; buildLetters() (below) measures the paragraphs and
// puts them on pages. Page 1: logo, address in the window, date beside it, subject, text. Next pages:
// small logo + "Página n de N" and the text, with the same margins (20 mm top and bottom, 22 mm sides).
export function letterCss(w) {
  const p = windowOnPaper(w), a = addressBox(w);
  return `@page { size: A4; margin: 0; } ${BASE}
    body { font-size: 10.5pt; line-height: 1.35; }
    .page { overflow: visible; }
    .logo { position: absolute; top: 6mm; left: 15mm; width: 28mm; height: 28mm; }
    .addr { position: absolute; left: ${a.x}mm; top: ${a.y}mm; width: ${a.w}mm; height: ${a.h}mm; font-size: 10pt; line-height: 1.25; overflow: hidden; }
    .date { position: absolute; left: 22mm; top: ${r1(p.y + INNER)}mm; margin: 0; }
    .pbody { position: absolute; left: 22mm; right: 22mm; white-space: pre-wrap; }
    .subj { margin: 0 0 5mm; }
    .blk { margin: 0 0 1.35em; } .blk:last-child { margin-bottom: 0; } .blk.sig { padding-top: 8mm; }
    .cont { position: absolute; top: 12mm; left: 22mm; right: 22mm; height: 16mm; border-bottom: 0.2mm solid #ccc; }
    .cont img { position: absolute; left: -6mm; top: -6mm; width: 28mm; height: 28mm; clip-path: inset(6mm 6mm 6mm 6mm); }
    .cont span { position: absolute; right: 0; top: 4mm; font-size: 9pt; color: #666; }
    ${SCREEN}`;
}
// The address block shrinks a little rather than being cut off (7 pt at the least).
export const FIT_SCRIPT = "document.querySelectorAll('.addr').forEach(function (a) { var fs = 10; while (a.scrollHeight > a.clientHeight + 0.5 && fs > 7) { fs -= 0.25; a.style.fontSize = fs + 'pt'; } });";

// One test page to print on plain paper: fold in three, slip into the envelope — the dashed
// rectangle must sit exactly in the window. Rulers every 10 mm (x along the top, y down the left).
export function calibrationPage(w, { addressHtml, logoUrl, escape = (s) => s } = {}) {
  const p = windowOnPaper(w), a = addressBox(w), v = normalizeWindow(w);
  const ticksX = Array.from({ length: 21 }, (_, i) => `<i class="tx" style="left:${i * 10}mm"><b>${i * 10}</b></i>`).join('');
  const ticksY = Array.from({ length: 30 }, (_, i) => `<i class="ty" style="top:${i * 10}mm"><b>${i * 10}</b></i>`).join('');
  return `<section class="page cal">
    ${logoUrl ? `<img class="logo" src="${escape(logoUrl)}" alt="">` : ''}
    ${ticksX}${ticksY}
    <div class="fold" style="top:99mm"><span>dobra</span></div><div class="fold" style="top:198mm"><span>dobra</span></div>
    <div class="winbox" style="left:${p.x}mm;top:${p.y}mm;width:${p.w}mm;height:${p.h}mm"></div>
    <div class="addr" style="left:${a.x}mm;top:${a.y}mm;width:${a.w}mm;height:${a.h}mm">${addressHtml || ''}</div>
    <div class="note" style="top:108mm">
      <b>Folha de teste da janela</b><br>
      Imprima em A4 a <b>100%</b> (sem “ajustar à página”), dobre em três com este lado para fora e o endereço no topo, e coloque no envelope.<br>
      O retângulo tracejado deve coincidir com a janela e o endereço deve ficar todo visível.<br><br>
      Medidas do envelope em uso (mm): a janela começa a ${v.left} do bordo esquerdo e a ${v.top} do topo, e mede ${v.width} × ${v.height}.<br>
      Na folha, a janela fica a ${p.x} mm da esquerda e a ${p.y} mm do topo (a folha dobrada fica centrada no envelope).<br>
      Se não coincidir, corrija as quatro medidas em Definições, Geral, e volte a imprimir.
    </div>
  </section>`;
}
export const calibrationCss = `@page { size: A4; margin: 0; } ${BASE}
    body { font-size: 10pt; line-height: 1.25; }
    .cal i { position: absolute; font-style: normal; } .cal i b { font-weight: 400; font-size: 6.5pt; color: #888; }
    .tx { top: 0; height: 3mm; border-left: 0.2mm solid #999; } .tx b { position: absolute; left: 0.6mm; top: 0.2mm; }
    .ty { left: 0; width: 3mm; border-top: 0.2mm solid #999; } .ty b { position: absolute; left: 3.5mm; top: -1.2mm; }
    .fold { position: absolute; left: 0; right: 0; border-top: 0.2mm dashed #aaa; } .fold span { position: absolute; right: 4mm; top: -3.2mm; font-size: 6.5pt; color: #999; }
    .winbox { position: absolute; border: 0.35mm dashed #c0392b; box-sizing: border-box; }
    .logo { position: absolute; top: 6mm; left: 15mm; width: 28mm; height: 28mm; outline: 0.2mm dotted #bbb; }
    .addr { position: absolute; overflow: hidden; font-size: 10pt; line-height: 1.25; }
    .note { position: absolute; left: 22mm; right: 22mm; font-size: 9.5pt; line-height: 1.4; color: #333; }
    ${SCREEN}`;

// ───────────────────────── Pagination ─────────────────────────
// A letter that does not fit on one page is split BETWEEN paragraphs, never inside one. Rules:
//  - paragraphs = blocks separated by a blank line; a run of lines starting with "•" is one block;
//  - a salutation (first block ending in "," or ":") and any block ending in ":" stay with the next block;
//  - the last two blocks and the signature stay together (the signature is never alone on a page);
//  - a chain taller than a page is split block by block; a single block taller than a page goes alone.
export function parseBlocks(body) {
  const blocks = []; let cur = [];
  const flush = () => { if (cur.length) { blocks.push({ text: cur.join('\n'), list: cur.every((l) => /^\s*[•–-]\s/.test(l)) }); cur = []; } };
  String(body || '').replace(/\r/g, '').split('\n').forEach((l) => { if (!l.trim()) flush(); else cur.push(l); });
  flush();
  return blocks;
}
// keep[i] = block i stays with block i + 1. withSig: the signature is one more block at the end.
export function keepFlags(blocks, withSig = true) {
  const n = blocks.length, keep = blocks.map((b, i) => {
    const t = b.text.trim();
    if (i === 0 && /[,:]$/.test(t) && n > 1) return true;
    if (/:$/.test(t) && i < n - 1) return true;
    return i >= n - 2 && (withSig || i === n - 2);
  });
  if (n === 1 && !withSig) keep[0] = false;
  if (withSig) keep.push(false);
  return keep;
}
// heights in mm (without the gap), keep flags, the room on page 1 and on the next pages, the gap between blocks.
export function paginate(h, keep, capFirst, capNext, gap) {
  var chains = [], cur = [], i, pages = [[]], used = 0, cap = capFirst;
  for (i = 0; i < h.length; i++) { cur.push(i); if (!keep[i]) { chains.push(cur); cur = []; } }
  if (cur.length) chains.push(cur);
  function nonEmpty() { return pages[pages.length - 1].length > 0; }
  function place(k) { used += (nonEmpty() ? gap : 0) + h[k]; pages[pages.length - 1].push(k); }
  function next() { pages.push([]); used = 0; cap = capNext; }
  function height(ch) { var t = 0, j; for (j = 0; j < ch.length; j++) t += h[ch[j]]; return t + gap * (ch.length - 1); }
  chains.forEach(function (ch) {
    var t = height(ch), j;
    if (used + (nonEmpty() ? gap : 0) + t <= cap + 0.01) { ch.forEach(place); return; }
    if (t <= capNext) { if (nonEmpty()) next(); ch.forEach(place); return; }
    for (j = 0; j < ch.length; j++) { if (nonEmpty() && used + gap + h[ch[j]] > cap + 0.01) next(); place(ch[j]); }
  });
  return pages;
}
// Measures the paragraphs in `doc` (a hidden box as wide as the text) and plans the pages: the usual size
// first, then slightly tighter ones, taking the first that fits one page; otherwise the usual size, in pages.
export function planLetter(doc, cfg, subjectText, texts, keep) {
  var MM = 96 / 25.4, root = doc.createElement('div'), best = null, li;
  root.style.cssText = 'position:absolute;left:-9999px;top:0;width:' + cfg.textWidth + 'mm;font-family:Arial,Helvetica,sans-serif;white-space:pre-wrap';
  doc.body.appendChild(root);
  function run(level) {
    root.style.fontSize = cfg.levels[level][0] + 'pt'; root.style.lineHeight = String(cfg.levels[level][1]); root.innerHTML = '';
    var s = null, subjH = 0, subjGap = 0;
    if (subjectText) { s = doc.createElement('p'); s.style.margin = '0'; s.textContent = subjectText; root.appendChild(s); }
    var els = texts.map(function (t) { var p = doc.createElement('p'); p.style.margin = '0 0 1.35em'; if (t.sig) p.style.paddingTop = '8mm'; p.textContent = t.text; root.appendChild(p); return p; });
    var h = els.map(function (e) { return e.getBoundingClientRect().height / MM; });
    var gap = els.length ? parseFloat(doc.defaultView.getComputedStyle(els[0]).marginBottom) / MM : 0;
    if (s) { subjH = s.getBoundingClientRect().height / MM; subjGap = cfg.subjGap; }
    return { level: level, h: h, gap: gap, subjH: subjH, pages: paginate(h, keep, cfg.bottom - cfg.flowTop - subjH - subjGap, cfg.bottom - cfg.contTop, gap) };
  }
  for (li = 0; li < cfg.levels.length; li++) { var r = run(li); if (r.pages.length === 1) { best = r; break; } }
  if (!best) best = run(0);
  doc.body.removeChild(root);
  return best;
}
// Runs in the print window: turns every <div class="letter"> (first-page pieces, subject, source blocks) into
// A4 pages. A one-page letter is one page; a longer one gets continuation pages; with cfg.duplex an odd number
// of pages gets a blank back, so the next letter starts on a fresh sheet.
export function buildLetters(cfg) {
  document.querySelectorAll('.letter').forEach(function (L) {
    var src = [].slice.call(L.querySelectorAll('.src > .blk')), keep = JSON.parse(L.getAttribute('data-keep'));
    var subj = L.querySelector('.subj'), first = L.querySelector('.first'), name = L.getAttribute('data-name') || '';
    var plan = planLetter(document, cfg, subj ? subj.textContent : '', src.map(function (b) { return { text: b.textContent, sig: b.className.indexOf('sig') > -1 }; }), keep);
    var lv = cfg.levels[plan.level], N = plan.pages.length, frag = document.createDocumentFragment();
    plan.pages.forEach(function (idxs, pi) {
      var pg = document.createElement('section'), body = document.createElement('div');
      pg.className = 'page'; pg.style.fontSize = lv[0] + 'pt'; pg.style.lineHeight = String(lv[1]);
      body.className = 'pbody'; body.style.top = (pi === 0 ? cfg.flowTop : cfg.contTop) + 'mm';
      if (pi === 0) { [].slice.call(first.children).forEach(function (c) { pg.appendChild(c); }); if (subj) body.appendChild(subj); }
      else {
        var ch = document.createElement('div'); ch.className = 'cont';
        ch.innerHTML = (cfg.logoUrl ? '<img src="' + cfg.logoUrl + '" alt="">' : '') + '<span></span>';
        ch.querySelector('span').textContent = 'Página ' + (pi + 1) + ' de ' + N + (name ? ' · ' + name : '');
        pg.appendChild(ch);
      }
      idxs.forEach(function (i) { body.appendChild(src[i]); });
      pg.appendChild(body); frag.appendChild(pg);
    });
    if (cfg.duplex && N % 2 === 1) { var blank = document.createElement('section'); blank.className = 'page blank'; frag.appendChild(blank); }
    L.parentNode.replaceChild(frag, L);
  });
}
// Settings for the functions above, from the envelope window (mm on the sheet).
export function layoutCfg(w, { duplex = false, logoUrl = '' } = {}) {
  const p = windowOnPaper(w);
  return { bottom: 277, flowTop: Math.max(70, r1(p.y + p.h + 9)), subjGap: 5, contTop: 36, textWidth: 166, levels: [[10.5, 1.35], [10.25, 1.32], [10, 1.3]], duplex: !!duplex, logoUrl };
}
// The three functions, as source, for the print window (it runs them after loading).
export const LAYOUT_JS = [paginate, planLetter, buildLetters].map((f) => f.toString()).join('\n');
