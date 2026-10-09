// CCSL (9 Oct 2026): the Outreach page previews the email footer with
// footerLines() — lifted verbatim — and it must match what the server sends
// (functions/outreach/render.js footerSource). Synthetic text only.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const R = require('../../functions/outreach/render.js');
const page = readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8');

function liftFn(name){
  const start = page.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(name + ' not found');
  let j = page.indexOf('{', page.indexOf(')', start)), depth = 0;
  do { if (page[j] === '{') depth++; else if (page[j] === '}') depth--; j++; } while (depth > 0);
  return page.slice(start, j);
}
const liftLine = (name) => { const i = page.indexOf(`const ${name} =`); return page.slice(i, page.indexOf('\n', i)); };

let fail = 0;
const ok = (l, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${l}`); };
const s = {};
vm.createContext(s);
vm.runInContext([liftLine('PRIVACY_LINE'), liftLine('FOOTER_PLACEHOLDER'), liftFn('footerLines'), 'this.__x = { footerLines, PRIVACY_LINE };'].join('\n'), s);
const { footerLines } = s.__x;

const cases = [
  null,
  { legalEntityLine: 'Valesintemporais, Lda · NIPC 517000000', footerText: 'Remover: {{unsubscribeUrl}}' },
  { legalEntityLine: 'Douro Partners, Lda. · NIPC [___] · [morada]', footerText: 'Remover: {{unsubscribeUrl}}', mentionPrivacy: true },
  { legalEntityLine: '  ', footerText: '', mentionPrivacy: false },
  { legalEntityLine: 'E', footerText: 'T [a definir]', mentionPrivacy: true },
];
ok('company emails: page preview = server footer, every case', cases.every(c => footerLines(c).join('\n') === R.footerSource(c)));
ok('one-to-one: page preview = server footer, every case', cases.every(c => footerLines(c, true).join('\n') === R.footerSource(c, { oneToOne: true })));
ok('same privacy sentence on page and server', s.__x.PRIVACY_LINE === R.PRIVACY_LINE);
ok('one-to-one never carries the removal text', !footerLines(cases[1], true).some(l => l.includes('Remover')));
ok('Go live no longer requires the footer', !/Set up the legal footer first/.test(page) && !/glFooter/.test(page));
ok('draft footer text no longer links to the hidden privacy page', !/const DEFAULT_FOOTER = '[^\n]*privacidade/.test(page));
const toml = readFileSync(new URL('../../netlify.toml', import.meta.url), 'utf8');
ok('privacy page answers 404 until activated (netlify.toml)', ['/privacidade"', '/privacidade.html"', '/privacidade/*"'].every(p => toml.includes(`from = "${p}`)));

if (fail){ console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nall email footer tests passed');
