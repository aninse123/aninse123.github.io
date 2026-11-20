// 20 Nov 2026: "Check who it reaches" answers first — "4 companies · 8 first emails (5 to people, 3 to general addresses, 0 to
// nobody)" — and every count below says companies for companies and emails for addresses. Checks on the page's source.
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8');
let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); };
const start = html.indexOf("$('csRecipCheck')?.addEventListener"), block = html.slice(start, html.indexOf('// R10 (27 Oct)', start));

const cos = new Function('num', "return (n) => `${num(n)} compan${n === 1 ? 'y' : 'ies'}`;")(String);
ok('the handler is found', start > 0 && block.length > 200);
ok('company and email words', block.includes("const cos = (n) => `${num(n)} compan${n === 1 ? 'y' : 'ies'}`, ems = (n) => `${num(n)} first email${n === 1 ? '' : 's'}`;") && cos(1) === '1 company' && cos(4) === '4 companies');
ok('the first line: companies · first emails (to people, to general addresses, to nobody)', block.includes('<b>${cos(rc.companies)} · ${ems(rc.emails)}</b>') && block.includes('${num(rc.people)} to people, ${num(rc.general)} to general addresses'));
ok('the lines per option count companies', block.includes('`${cos(x.person)} to a person`') && block.includes('`${cos(x.company)} to the company address`') && !/\$\{num\(x\.(person|contact|company|none)\)\}/.test(block));
ok('addresses per company: companies and first emails, each with its word', block.includes('of ${cos(r.addresses.companies)} would get 2 or more addresses, ${ems(r.addresses.emails)} in all.'));
ok('already received / chosen by hand are companies', block.includes('${cos(r.sent)} already received email 1') && block.includes('${cos(r.byHand)} with addresses you chose by hand'));

console.log(fail ? `\n${fail} FAILED` : '\nAll passed');
process.exit(fail ? 1 : 0);
