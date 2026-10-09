// T4: who signs a letter / call script, and the {{sender.*}} fields printed
// in it — the task's choice, else the campaign's, else the company's owner,
// else André; name, phone and email come from the team directory.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8');
function lift(name) {
  const i = page.indexOf(`    function ${name}(`); if (i < 0) throw new Error(name);
  const m = /\r?\n    \}\r?\n/.exec(page.slice(i)); return page.slice(i, i + m.index + m[0].length);
}
const line = (a) => { const i = page.indexOf(a); if (i < 0) throw new Error(a); return page.slice(i, page.indexOf('\n', i)); };

const ctx = {
  window: { teamDir: [
    { key: 'andre', name: 'André Rocha', active: true, contactPhone: '+351 912 000 001', contactEmail: 'andre.rocha@douropartners.pt' },
    { key: 'antonio', name: 'António Carvalho', active: true, contactPhone: '+351 912 000 002', contactEmail: 'antonio.carvalho@douropartners.pt' },
    { key: 'maria', name: 'Maria Silva', active: true, contactPhone: '', contactEmail: null },
    { key: 'rui', name: 'Rui Left', active: false, contactPhone: '+351 1', contactEmail: null },
  ] },
  campaigns: [{ id: 'k1', signer: 'owner' }, { id: 'k2', signer: 'antonio' }],
};
vm.createContext(ctx);
vm.runInContext([
  line('    const OWNER_FULL ='), line('    const PT_SMALL_WORDS ='), lift('titleCasePt'), lift('shortName'), lift('emailNameOf'),
  lift('scanTemplate'), lift('signerFor'), lift('joinPt'), lift('teamContext'), page.slice(page.indexOf('function joinOu('), page.indexOf('// Same as the server (render.js teamContext).')), lift('coCtx'), lift('fillText'),
  'globalThis.api = { signerFor, coCtx, fillText };',
].join('\n'), ctx);
const { signerFor, coCtx, fillText } = ctx.api;

let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
ok('campaign "owner": the company owner signs', signerFor({ campaignId: 'k1' }, { owner: 'antonio' }) === 'antonio');
ok('no owner: André signs', signerFor({ campaignId: 'k1' }, {}) === 'andre');
ok('campaign names someone: they sign, whoever owns the company', signerFor({ campaignId: 'k2' }, { owner: 'andre' }) === 'antonio');
ok('a call: whoever makes it introduces themselves (then the owner)', signerFor({ campaignId: 'k1', channel: 'call', assignee: 'maria' }, { owner: 'andre' }) === 'maria' && signerFor({ campaignId: 'k1', channel: 'call' }, { owner: 'antonio' }) === 'antonio');
ok('a letter: the owner, even when someone else prints it', signerFor({ campaignId: 'k1', channel: 'letter', assignee: 'maria' }, { owner: 'andre' }) === 'andre');
ok('the task\'s own choice wins', signerFor({ campaignId: 'k2', signer: 'maria' }, { owner: 'andre' }) === 'maria');
ok('someone no longer on the team: André', signerFor({ campaignId: 'k1' }, { owner: 'ghost' }) === 'andre' && signerFor({ campaignId: 'k1' }, { owner: 'rui' }) === 'andre');
const letter = 'Contacte-me: {{sender.phone}} · {{sender.email}}\n{{sender.name}}';
ok('letter text: owner\'s phone, email and name', fillText(letter, coCtx({ name: 'X, LDA' }, 'antonio')) === 'Contacte-me: +351 912 000 002 · antonio.carvalho@douropartners.pt\nAntónio Carvalho');
ok('missing phone shows as [sender.phone] so it\'s seen before printing', /\[sender\.phone\]/.test(fillText(letter, coCtx({}, 'maria'))));
console.log(fail ? `\n${fail} FAILED` : '\nall signer tests passed'); process.exit(fail ? 1 : 0);
