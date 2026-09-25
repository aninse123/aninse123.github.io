// Outreach → Tasks (Phase 2b): waNumber(), isMobilePt(), fillText(),
// lifted from outreach.html.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8');
function liftFn(name) {
  const start = page.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(name + ' not found');
  let p = page.indexOf('(', start), pd = 0;
  do { if (page[p] === '(') pd++; else if (page[p] === ')') pd--; p++; } while (pd > 0);
  const b = page.indexOf('{', p); let d = 0, j = b;
  do { if (page[j] === '{') d++; else if (page[j] === '}') d--; j++; } while (d > 0);
  return page.slice(start, j);
}
// fillText holds {{ … }} in a regex, which brace counting can't skip — cut it at its closing line instead.
const liftToClose = (name) => { const i = page.indexOf(`function ${name}(`); if (i < 0) throw new Error(name); const m = /\r?\n    \}\r?\n/.exec(page.slice(i)); return page.slice(i, i + m.index + m[0].length); };
const line = (a) => { const i = page.indexOf(a); if (i < 0) throw new Error(a); return page.slice(i, page.indexOf('\n', i)); };
const ctx = {}; vm.createContext(ctx);
vm.runInContext([liftFn('waNumber'), line('const isMobilePt = (n) =>'), liftToClose('fillText'), 'globalThis.api = { waNumber, isMobilePt, fillText };'].join('\n'), ctx);
const { waNumber, isMobilePt, fillText } = ctx.api;
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
ok('PT mobile/landline → 351 prefix', waNumber('912 345 678') === '351912345678' && waNumber('226 000 000') === '351226000000');
ok('+ and 00 prefixes kept as international', waNumber('+34 600 111 222') === '34600111222' && waNumber('0044 7700 900123') === '447700900123');
ok('too short → no link', waNumber('1234') === null && waNumber('') === null);
ok('PT mobile detection (9…, with or without 351)', isMobilePt('912345678') && isMobilePt('+351 961 234 567') && !isMobilePt('226000000'));
const c = { company: { shortName: 'Silva', city: '' }, sender: { firstName: 'André' } };
ok('fillText: variables, fallback, missing marked', fillText('Olá {{company.shortName}}, {{company.city|no Norte}} — {{sender.firstName}} {{x.y}}', c) === 'Olá Silva, no Norte — André [x.y]');
console.log(fail ? `\n${fail} FAILED` : '\nall task helper tests passed'); process.exit(fail ? 1 : 0);
