// Letters to print, page layout (29 Oct 2026, switch outreach.letterTools): the envelope window
// (setting letterWindow, default = André's DL envelope: window 2 cm from the right edge, 4.5 cm
// from the top, 7 x 3.5 cm), where it falls on the folded sheet, the print CSS, the test sheet,
// and that the Settings card and the Letters screen use it.
import { readFileSync } from 'node:fs';
const L = await import('../../portal/letter-layout.js');
const page = readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

ok('default window = 2 cm from the right edge of a 220 mm envelope, 4.5 cm from the top, 70 x 35 mm', JSON.stringify(L.DEFAULT_WINDOW) === JSON.stringify({ left: 130, top: 45, width: 70, height: 35 }) && L.DEFAULT_WINDOW.left + L.DEFAULT_WINDOW.width + 20 === L.ENVELOPE.w);
const p = L.windowOnPaper(L.DEFAULT_WINDOW);
ok('on the folded sheet (centred in the envelope) the window is 5 mm further left and 5.5 mm higher: x 125, y 39.5', p.x === 125 && p.y === 39.5 && p.w === 70 && p.h === 35);
const a = L.addressBox(L.DEFAULT_WINDOW);
ok('the address box keeps 2.5 mm inside the window on every side: 65 x 30 mm', a.x === 127.5 && a.y === 42 && a.w === 65 && a.h === 30);
ok('a missing or silly setting falls back to the default; all four numbers are required', JSON.stringify(L.normalizeWindow(undefined)) === JSON.stringify(L.DEFAULT_WINDOW) && JSON.stringify(L.normalizeWindow({ left: 'x' })) === JSON.stringify(L.DEFAULT_WINDOW) && !L.checkWindow({ left: 130, top: 45, width: 70 }).ok);
ok('validation: inside the envelope, sensible window size, numbers as text accepted', L.checkWindow({ left: '130', top: '45', width: '70', height: '35' }).ok && !L.checkWindow({ left: 190, top: 45, width: 70, height: 35 }).ok && !L.checkWindow({ left: 130, top: 90, width: 70, height: 35 }).ok && !L.checkWindow({ left: 130, top: 45, width: 10, height: 35 }).ok && /fit inside/.test(L.checkWindow({ left: 190, top: 45, width: 70, height: 35 }).error));
const left = L.windowOnPaper({ left: 20, top: 45, width: 90, height: 45 });
ok('another envelope (left-hand window, 90 x 45) moves the address to the left side of the sheet', left.x === 15 && left.y === 39.5 && left.w === 90 && left.h === 45);

const css = L.letterCss(L.DEFAULT_WINDOW);
ok('print CSS: address at 127.5 / 42 mm, 65 x 30 mm; date beside it at the left; logo top-left', css.includes('left: 127.5mm; top: 42mm; width: 65mm; height: 30mm') && css.includes('.date { position: absolute; left: 22mm; top: 42mm') && css.includes('.logo { position: absolute; top: 6mm; left: 15mm'));
ok('the body starts below the window (window bottom 74.5 mm + 9 = 83.5 mm); a short window never starts it above 70 mm', css.includes('padding: 83.5mm 22mm 20mm') && L.letterCss({ left: 130, top: 20, width: 70, height: 20 }).includes('padding: 70mm '));
ok('no footer, 10.5 pt text, A4 with no margins', !/footer/.test(css) && css.includes('font-size: 10.5pt') && css.includes('size: A4; margin: 0'));
ok('the address shrinks (never below 7 pt) instead of being cut off', /fs > 7/.test(L.FIT_SCRIPT) && /scrollHeight > a\.clientHeight/.test(L.FIT_SCRIPT));

const cal = L.calibrationPage(L.DEFAULT_WINDOW, { addressHtml: 'Rua X', logoUrl: 'https://x/logo.png' });
ok('test sheet: the dashed window rectangle at the paper position, fold lines at 99 and 198 mm, rulers, the address, the logo', cal.includes('left:125mm;top:39.5mm;width:70mm;height:35mm') && cal.includes('top:99mm') && cal.includes('top:198mm') && (cal.match(/class="tx"/g) || []).length === 21 && (cal.match(/class="ty"/g) || []).length === 30 && cal.includes('Rua X') && cal.includes('https://x/logo.png'));
ok('test sheet says what to do (100%, fold in three) and states the measures in use', /100%/.test(cal) && /dobre em três/.test(cal) && /começa a 130 do bordo esquerdo e a 45 do topo, e mede 70 × 35/.test(cal));
ok('the ruler labels are scoped so the instructions keep their normal bold', L.calibrationCss.includes('.cal i b {') && !L.calibrationCss.includes('.cal b {'));

// The page
ok('Settings → General: four measurements and a test sheet button, behind the switch', /data-feature="outreach\.letterTools"[^>]*>\n\s*<h3[^>]*>Letters: address window/.test(page) && ['gLwLeft', 'gLwTop', 'gLwW', 'gLwH', 'gLwCal'].every((id) => page.includes(`id="${id}"`)));
ok('loaded from settings.letterWindow (default when empty), tracked as an unsaved change', page.includes('normalizeWindow(s.letterWindow)') && page.includes("'gLwLeft', 'gLwTop', 'gLwW', 'gLwH'"));
ok('saved only while the switch is on, after checking the numbers (comma accepted)', page.includes("if (isOn('outreach.letterTools')) {\n        const lc = checkWindow(") && page.includes('...(letterWindow ? { letterWindow } : {}),') && page.includes("$('gLwLeft').value.replace(',', '.')"));
ok('letters printed with the tools: layout from the setting, logo, no legal entity footer read; old layout untouched otherwise', page.includes('letterCss(letterWindowSetting())') && page.includes('if (!LT) { try { const cs = await getDoc(doc(db, \'outreachCompliance\'') && page.includes("${LT ? `<img class=\"logo\"") && page.includes('@page { size: A4; margin: 0; }'));
ok('the address shrink script runs before printing', page.includes("window.onload = () => { ${LT ? FIT_SCRIPT : ''} window.print(); }"));
ok('Letters to print has a test sheet button (only with the tools); the Settings button prints the typed numbers', page.includes('id="letCal"') && page.includes("$('letCal')?.addEventListener('click', () => printCalibration());") && page.includes('printCalibration(c.ok ? c.value : null)'));
ok('the module is imported from the page', page.includes("from './letter-layout.js'"));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
