// Phase 3a: the Search CRM's autoEmailName() (shown as "Email name
// (automatic)") must give the same result as the Outreach server's
// emailNameOf() (functions/outreach/render.js), which is what actually goes
// into emails and letters.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { emailNameOf } = require('../../functions/outreach/render.js');
const page = readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8');

const start = page.indexOf('const EN_SMALL');
const endAnchor = page.indexOf('function autoEmailName(');
const endBody = /\r?\n\}\r?\n/.exec(page.slice(endAnchor));
if (start < 0 || endAnchor < 0 || !endBody) throw new Error('email name helpers not found in search.html');
const src = page.slice(start, endAnchor + endBody.index + endBody[0].length) + '\nglobalThis.autoEmailName = autoEmailName;';
const ctx = {}; vm.createContext(ctx); vm.runInContext(src, ctx);

const cases = [
  { name: 'METALURGICA SILVA, LDA' },
  { name: 'DIMEXA - DISTRIBUICAO, IMPORTACAO E EXPORTACAO, LDA' },
  { name: 'SUE - SPORTS UNIFIED EUROPE, UNIPESSOAL LDA' },
  { name: 'Vinhos do Douro S.A.' },
  { name: 'TN - TEXTEIS DO NORTE E COMERCIO, S.A.', akaName: 'TEXTEIS DO NORTE, S.A.; TN' },
  { name: 'FARMACIA SA DA BANDEIRA, S.A.', akaName: 'n.a.' },
  { name: 'EDP, SA', akaName: '-' },
];
let fail = 0;
for (const c of cases) {
  const a = ctx.autoEmailName(c), b = emailNameOf(c);
  const ok = a === b;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}${c.akaName ? ' / aka ' + c.akaName : ''} → "${a}"${ok ? '' : ` (server: "${b}")`}`);
}
console.log(fail ? `\n${fail} FAILED` : '\nsearch.html and the server agree on email names');
process.exit(fail ? 1 : 0);
