// F1: tasks of people campaigns on the page — the person's details come from
// their Network contact (then its firm, the Investor CRM contact, the broker
// contact); scripts / letters fill {{contact.firstName}} and {{company.*}}
// (= their organisation); the letter address is theirs or their firm's.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8');
function lift(name) {
  const i = page.indexOf(`    function ${name}(`); if (i < 0) throw new Error(name);
  const m = /\r?\n    \}\r?\n/.exec(page.slice(i)); return page.slice(i, i + m.index + m[0].length);
}
const line = (a) => { const i = page.indexOf(a); if (i < 0) throw new Error(a); return page.slice(i, page.indexOf('\n', i)); };

const ctx = { window: { teamDir: [{ key: 'andre', name: 'André Rocha', active: true, contactPhone: '+351 1' }, { key: 'antonio', name: 'António Carvalho', active: true }] }, campaigns: [{ id: 'k1', signer: 'owner' }], coCache: new Map() };
vm.createContext(ctx);
vm.runInContext([
  line('    const OWNER_FULL ='), line('    const PT_SMALL_WORDS ='), lift('titleCasePt'), lift('shortName'), lift('emailNameOf'),
  lift('scanTemplate'), lift('signerFor'), lift('coCtx'), lift('fillText'),
  "const esc = (s) => String(s ?? '').replace(/[&<>\"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]));",
  line('    const telHref ='), 'const isMobilePt = () => false;',
  line('    const personCache ='), lift('personOf'), lift('personAsCo'), line('    const taskCo ='), lift('personContactBox'),
  'globalThis.api = { personCache, personOf, taskCo, personContactBox, coCtx, fillText, signerFor };',
].join('\n'), ctx);
const { personCache, personOf, taskCo, personContactBox, coCtx, fillText, signerFor } = ctx.api;

personCache.set('network:n1', { name: 'Rui Broker', role: 'Partner', phone: '+351 912 000 000', linkedin: 'linkedin.com/in/rui', firmId: 'f1', owner: 'antonio' });
personCache.set('firm:f1', { name: 'Firm Lda', postalAddress: 'Rua A, 1\n4000-000 Porto' });
personCache.set('crm:i1', { name: 'Fundo X', owner: 'andre', contacts: [{ name: 'Ana', email: 'ana@fundo.pt', phone: '+351 913 000 000' }] });

const t1 = { channel: 'letter', campaignId: 'k1', companyId: null, personEmail: 'rui@firm.pt', personName: 'Rui Broker', org: '', refs: [{ source: 'network', id: 'n1' }] };
const p = personOf(t1);
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
ok('Network contact: phone, LinkedIn, role, owner; organisation and address from the firm', p.phone === '+351 912 000 000' && p.role === 'Partner' && p.owner === 'antonio' && p.org === 'Firm Lda' && p.address === 'Rua A, 1\n4000-000 Porto' && p.link === '/portal/network.html?contact=n1');
const c = taskCo(t1);
ok('seen as a company: name = organisation, one contact, flat address', c._person && c.name === 'Firm Lda' && c.contacts[0].phone === '+351 912 000 000' && c.hqAddress === 'Rua A, 1, 4000-000 Porto');
ok('letter signed by the contact\'s owner (António)', signerFor(t1, c) === 'antonio');
ok('script / letter fields: {{contact.firstName}} = the person, {{company.shortName}} = the organisation', fillText('Caro {{contact.firstName}}, a {{company.shortName}}', coCtx(c, 'antonio')) === 'Caro Rui, a Firm Lda');
ok('letter box shows the address; call box shows the phone', /Rua A, 1<br>4000-000 Porto/.test(personContactBox(t1, p)) && /tel:\+351912000000/.test(personContactBox({ ...t1, channel: 'call' }, p)));
const t2 = { channel: 'letter', campaignId: 'k1', personEmail: 'ana@fundo.pt', personName: 'Ana', refs: [{ source: 'crm', id: 'i1' }] };
const p2 = personOf(t2);
ok('Investor CRM only: phone from its contact, organisation = the investor, link to it; no address → flagged', p2.phone === '+351 913 000 000' && p2.org === 'Fundo X' && p2.link === '/portal/crm.html?investor=i1' && /no address/.test(personContactBox(t2, p2)));
ok('a company task is unchanged (company cache)', (ctx.coCache.set('c1', { name: 'EMPRESA' }), taskCo({ companyId: 'c1' }).name === 'EMPRESA'));
console.log(fail ? `\n${fail} FAILED` : '\nall person-task page tests passed'); process.exit(fail ? 1 : 0);
