// Inbox Reply / Reply all (12 Oct 2026): the page's own helpers between the
// "Reply recipients" markers in portal/outreach.html, run on the shape of the
// first real reply (a person, not the company address we wrote to, with a
// partner in Cc; the forwarding address in `to`, the real To in deliveredTo).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const a = page.indexOf('// ── Reply recipients (12 Oct) — begin ──'), b = page.indexOf('// ── Reply recipients — end ──');
if (a < 0 || b < 0) throw new Error('markers not found');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(page.slice(a, b) + '\nglobalThis.R = { isOurAddr, addrTokens, addrList, msgTo, msgCc, replyRecipients };', ctx);
const { R } = ctx;

let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
const J = (x) => JSON.stringify(x);
const OUT = { direction: 'out', status: 'delivered', to: ['geral@empresa.pt'], cc: [] };
const IN = { direction: 'in', status: 'received', from: '"Ana Oliveira" <ana@empresa.pt>', to: ['a.rocha@abc.resend.app'], cc: ['socio@outra.pt'], deliveredTo: 'a.rocha@mail.douropartners-team.pt' };

ok('our addresses: outreach domain and forwarding addresses', R.isOurAddr('a.rocha@mail.douropartners-team.pt') && R.isOurAddr('x@abc.resend.app') && !R.isOurAddr('ana@empresa.pt'));
ok('address lists: quotes with commas kept, invalid flagged', J(R.addrTokens('"Rocha, André" <a@x.pt>, b@y.pt; nope').map((t) => [t.email, t.ok])) === J([['a@x.pt', true], ['b@y.pt', true], ['nope', false]]));
ok('received email shows the real To, never the forwarding address', J(R.msgTo(IN).map((x) => x.email)) === J(['a.rocha@mail.douropartners-team.pt']) && J(R.msgCc(IN).map((x) => x.email)) === J(['socio@outra.pt']));
ok('Reply → only Ana (not the company address)', J(R.replyRecipients([OUT, IN], 'geral@empresa.pt', 'reply')) === J({ to: ['ana@empresa.pt'], cc: [] }));
ok('Reply all → Ana in To, the partner in Cc, our address dropped', J(R.replyRecipients([OUT, IN], 'geral@empresa.pt', 'all')) === J({ to: ['ana@empresa.pt'], cc: ['socio@outra.pt'] }));
const IN2 = { ...IN, deliveredTo: 'a.rocha@mail.douropartners-team.pt, "Rui" <rui@empresa.pt>', cc: [] };
ok('Reply all keeps other To recipients in To', J(R.replyRecipients([OUT, IN2], 'geral@empresa.pt', 'all')) === J({ to: ['ana@empresa.pt', 'rui@empresa.pt'], cc: [] }));
ok('nothing received yet → our last email\'s recipient', J(R.replyRecipients([OUT], 'geral@empresa.pt', 'reply')) === J({ to: ['geral@empresa.pt'], cc: [] }));
ok('drafts and failed emails are ignored', J(R.replyRecipients([OUT, IN, { direction: 'out', status: 'draft', to: ['z@z.pt'] }], 'geral@empresa.pt', 'reply')) === J({ to: ['ana@empresa.pt'], cc: [] }));
// 19 Oct (one inbox): our last email is newer than the last one received → Reply follows it.
const AUTO = { direction: 'in', status: 'received', from: 'Receção <geral@empresa.pt>', to: ['a.rocha@abc.resend.app'], cc: [], deliveredTo: 'a.rocha@mail.douropartners-team.pt' };
const TO_JOAO = { direction: 'out', status: 'delivered', to: ['joao@empresa.pt'], cc: [] };
ok('one inbox: after we wrote to João, Reply goes to João (not back to geral@)', J(R.replyRecipients([OUT, AUTO, TO_JOAO], 'geral@empresa.pt', 'reply', true)) === J({ to: ['joao@empresa.pt'], cc: [] }));
ok('…switch off: as before, the last person who wrote', J(R.replyRecipients([OUT, AUTO, TO_JOAO], 'geral@empresa.pt', 'reply', false)) === J({ to: ['geral@empresa.pt'], cc: [] }));
ok('…once João answers, Reply goes to whoever wrote last', J(R.replyRecipients([OUT, AUTO, TO_JOAO, { ...AUTO, from: 'João <joao@empresa.pt>' }], 'geral@empresa.pt', 'reply', true)) === J({ to: ['joao@empresa.pt'], cc: [] }));
ok('…Reply all unchanged', J(R.replyRecipients([OUT, AUTO, TO_JOAO], 'geral@empresa.pt', 'all', true)) === J({ to: ['geral@empresa.pt', 'a.rocha@mail.douropartners-team.pt'].filter((e) => !R.isOurAddr(e)), cc: [] }));
ok('page passes the switch to Reply', page.includes("replyRecipients(threadMessages, t.contactEmail, replyMode, isOn('outreach.oneInbox'))"));
ok('page sends replyTo / replyCc and shows To / Cc lines', page.includes('sendWithConfirm({ threadId: t.id, body, replyTo, replyCc,') && page.includes('${rcptLine(m)}'));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
