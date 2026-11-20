// 20 Nov 2026 (switch outreach.recipientGreeting): the page twin of {{recipient.greeting}} gives the same text as the server, and the
// template editor offers the field. The page's own previews leave it empty (the send decides, by the production setting).
import fs from 'node:fs';
import { createRequire } from 'node:module';
const P = await import('../../portal/recipient-fields.js');
const S = createRequire(import.meta.url)('../../functions/outreach/recipient_fields.js');
const html = fs.readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8');
const feats = fs.readFileSync(new URL('../../portal/features.js', import.meta.url), 'utf8');
let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); };
const CASES = [['JOSE MANUEL DA SILVA'], ['MARIA JOSE SANTOS PEREIRA'], ['MARIA DE FATIMA RODRIGUES'], ['JOAO PEDRO CASTELO BRANCO'], ['ANTONIO SILVA E COSTA'], ['KIM LEE'], ['José Manuel da Silva', [{ name: 'José Manuel Silva', gender: 'M' }]], ['Ariel Costa', [], { gender: 'F', source: 'typed' }]];
ok('page and server agree on every case', CASES.every(([n, o = [], s = null]) => P.greetingOf({ name: n, owners: o, stored: s }) === S.greetingOf({ name: n, owners: o, stored: s })));
ok('…e.g. "Exma. Senhora Maria José Pereira"', P.greetingOf({ name: 'MARIA JOSE SANTOS PEREIRA' }) === 'Exma. Senhora Maria José Pereira');
ok('recipientContext leaves it empty unless asked (the page previews)', P.recipientContext({ name: 'José Silva' }).greeting === '' && P.recipientContext({ name: 'José Silva', greeting: true }).greeting === 'Exmo. Senhor José Silva');
ok('the template editor offers {{recipient.greeting}} with its explanation', html.includes("'recipient.greeting|Bom dia',") && html.includes("'recipient.greeting|Bom dia': 'Formal opening to a person"));
ok('the switch is in the portal list', feats.includes("['outreach.recipientGreeting', 'Outreach', 'release', 'Formal greeting to a person'"));
console.log(fail ? `\n${fail} FAILED` : '\nAll passed');
process.exit(fail ? 1 : 0);
