// Recipient fields (30 Oct 2026, plan step 5): the page module gives the same fields as the server's, and the template
// editor and the compose preview use it.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = await import('../../portal/recipient-fields.js');
const S = require('../../functions/outreach/recipient_fields.js');
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const outreach = read('../../portal/outreach.html'), send = read('../../functions/outreach/send_core.js'), render = read('../../functions/outreach/render.js');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

const names = ['Rita Costa', 'João Maria', 'Beatriz', 'Luca', 'Ariel Sousa', 'Zuleica', 'Aldemiro', 'Inês', 'Raquel Dias', 'Tomás', 'CLÁUDIA', '', '  ', 'X', 'Ana Cunha', 'Luís Pinho'];
const roles = ['', 'Administradora', 'Shareholder 60%', 'Contact', 'Company address', 'Gerente'];
const owners = [[], [{ name: 'Ana Cunha', gender: 'M' }, { name: 'Luís Pinho', gender: 'F' }], [{ name: 'Ariel Sousa', gender: 'F' }]];
const stores = [null, { gender: 'M', source: 'typed' }, { gender: 'F', source: 'guess' }, { gender: '', source: '' }];
let same = true, n = 0;
for (const name of names) for (const role of roles) for (const o of owners) for (const stored of stores) { n++; if (JSON.stringify(P.recipientContext({ name, role, owners: o, stored })) !== JSON.stringify(S.recipientContext({ name, role, owners: o, stored }))) same = false; }
ok(`page and server give the same fields on ${n} combinations`, same);
ok('same gender on every name', names.every((x) => P.genderOfFirstName(x) === S.genderOfFirstName(x)));
ok('the server context carries recipient.* and Send passes the role of a person', /recipient: recipientContext\(/.test(render) && /recipientRole: recipient\?\.kind !== "company"/.test(send));
ok('the compose preview and the template editor offer the fields', /import \{ recipientContext \} from '\.\/recipient-fields\.js'/.test(outreach) && /'recipient\.firstName\|Olá'/.test(outreach) && /'recipient\.isMale'/.test(outreach) && /recipient: \(\(\) => \{ const r = chosenRecipient\(\)/.test(outreach));
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exit(fail ? 1 : 0);
