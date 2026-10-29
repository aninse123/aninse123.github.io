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

// CSS of a letter page: logo top-left, address in the window, date beside it, body from below the window.
export function letterCss(w) {
  const p = windowOnPaper(w), a = addressBox(w);
  const flowTop = Math.max(70, r1(p.y + p.h + 9));
  return `@page { size: A4; margin: 0; } ${BASE}
    body { font-size: 10.5pt; line-height: 1.35; }
    .page { height: auto; min-height: 297mm; overflow: visible; padding: ${flowTop}mm 22mm 20mm; }
    .logo { position: absolute; top: 6mm; left: 15mm; width: 28mm; height: 28mm; }
    .addr { position: absolute; left: ${a.x}mm; top: ${a.y}mm; width: ${a.w}mm; height: ${a.h}mm; font-size: 10pt; line-height: 1.25; overflow: hidden; }
    .date { position: absolute; left: 22mm; top: ${r1(p.y + INNER)}mm; margin: 0; }
    .subj { margin: 0 0 5mm; }
    .body { white-space: pre-wrap; }
    .sig { white-space: pre-wrap; margin-top: 8mm; }
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
