// 20 Nov 2026 (switch outreach.campaignSearch): find a company in every campaign — what the box understands (name, NIF, email, phone
// with the Search CRM's phoneKey), one row per company and campaign, live first, and the queries it makes (synthetic Firestore stand-in).
// campaignSearchKind, findCampaignCompanies and campaignSearchRows are run from the page's own source text.
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const feats = fs.readFileSync(new URL('../../portal/features.js', import.meta.url), 'utf8');
let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); };
const NL = String.fromCharCode(10);
const fnText = (sig) => { const i = html.indexOf(sig); if (i < 0) return null; const j = html.indexOf(NL + '    }' + NL, i); return html.slice(i, j + 6); };
const pk = fnText('    function phoneKey(v) {'), kind = fnText('    function campaignSearchKind(raw) {'), find = fnText('    async function findCampaignCompanies(raw) {'), rows = fnText('    function campaignSearchRows(enrols, campaignsById) {');
const skey = fnText('    function searchKeyOf(s) {');
ok('the functions are found', [pk, kind, find, rows, skey].every(Boolean));

// a tiny stand-in for the Firestore calls the search makes
const DATA = {
  searchCompanies: [
    { id: 'co1', nif: '509111222', emailKeys: ['geral@flama.pt', 'flama.pt'], phoneKeys: ['222000111'], namePrefixes: ['fla', 'flam', 'flama'], nameKey: 'flama' },
    { id: 'co2', nif: '509333444', emailKeys: [], phoneKeys: [], namePrefixes: ['xdo', 'xdom', 'xdome'], nameKey: 'xdome' },
  ],
  searchPeople: [{ id: 'p1', name: 'Paula Ribeiro', reachPhones: ['912345678'] }],
  searchPersonLinks: [{ id: 'l1', personId: 'p1', companyId: 'co2' }],
};
const log = [];
const where = (f, op, v) => ({ f, op, v });
const env = {
  searchKeyOf: (s) => ({ nameKey: String(s).toUpperCase(), tokens: String(s).toLowerCase().split(' ').filter(Boolean) }), orderBy: () => ({}), // the page's own (accents, legal forms) is tested elsewhere
  LIVE_ENROL: ['pending', 'active', 'awaiting_approval', 'awaiting_task', 'paused'], tsMs: (t) => (t?.toMillis ? t.toMillis() : 0),
  db: {}, collection: (db, name) => name, limit: (n) => ({ limit: n }), where,
  query: (col, ...cl) => ({ col, cl: cl.filter(c => c.f) }),
  getDocs: async (q) => {
    log.push(q.col + ':' + q.cl.map(c => c.f).join(','));
    const docs = (DATA[q.col] || []).filter(d => q.cl.every(c => c.op === '==' ? d[c.f] === c.v : c.op === 'in' ? c.v.includes(d[c.f]) : (d[c.f] || []).includes(c.v)));
    return { size: docs.length, docs: docs.map(d => ({ id: d.id, data: () => d })) };
  },
};
const lib = new Function(...Object.keys(env), [pk, kind, find, rows].join(NL) + NL + 'return { campaignSearchKind, findCampaignCompanies, campaignSearchRows };')(...Object.values(env));

const K = lib.campaignSearchKind;
ok('kinds: email, NIF, phone (+351 / spaces), name; too short or a partial number: nothing', K('geral@flama.pt').kind === 'email' && K('509 111 222').kind === 'nif' && K('+351 912 345 678').kind === 'phone' && K('+351 912 345 678').key === '912345678' && K('Flama').kind === 'name' && K('ab') === null && K('1234') === null);
ok('a 9-digit number is a NIF first, and keeps its phone key for a second try', K('912345678').kind === 'nif' && K('912345678').phone === '912345678');

const f = await lib.findCampaignCompanies('geral@flama.pt');
ok('by email: emailKeys', f.ids.join() === 'co1' && f.why.get('co1') === 'email');
ok('by NIF', (await lib.findCampaignCompanies('509333444')).ids.join() === 'co2');
log.length = 0;
const ph = await lib.findCampaignCompanies('912 345 678');
ok('a 9-digit mobile: no NIF, then the phone — a person\'s phone finds their company', ph.ids.join() === 'co2' && ph.why.get('co2') === 'phone of Paula Ribeiro' && log.join(' ') === 'searchCompanies:nif searchCompanies:phoneKeys searchPeople:reachPhones searchPersonLinks:personId');
ok('a company phone', (await lib.findCampaignCompanies('222 000 111')).why.get('co1') === 'company phone');
const nm = await lib.findCampaignCompanies('flama');
ok('by name: namePrefixes, every word must match', nm.ids.join() === 'co1' && (await lib.findCampaignCompanies('flama xdome')).ids.length === 0);
ok('reads stay small (one query per step)', nm.reads === 1 && ph.reads === 4);
// 20 Nov (staging): FERNANDO fills a page of 25, so FERNANDO QUEIROZ is found through its other word
DATA.searchCompanies.push(...Array.from({ length: 25 }, (_, n) => ({ id: 'f' + n, namePrefixes: ['fernando'], nameKey: 'fernando ' + n })), { id: 'fq', namePrefixes: ['fernando', 'queiroz'], nameKey: 'fernando queiroz' });
ok('a common first name: the next word finds the company', (await lib.findCampaignCompanies('fernando queiroz')).ids.join() === 'fq');

const C = new Map([['k1', { id: 'k1', name: 'Primavera' }], ['k2', { id: 'k2', name: 'Outono' }]]);
const ts = (ms) => ({ toMillis: () => ms });
const out = lib.campaignSearchRows.call(null, [
  { id: 'k1_co1', companyId: 'co1', campaignId: 'k1', status: 'replied', companyName: 'FLAMA', enrolledAt: ts(1) },
  { id: 'k2_co1', companyId: 'co1', campaignId: 'k2', status: 'active', companyName: 'FLAMA', enrolledAt: ts(2), nextActionAt: ts(50) },
  { id: 'k2_co1__t1', companyId: 'co1', campaignId: 'k2', status: 'stopped', trackOf: 'k2_co1', enrolledAt: ts(2) },
  { id: 'old_co1', companyId: 'co1', campaignId: 'gone', campaignName: 'Antiga', status: 'completed', enrolledAt: ts(0) },
], C);
ok('one row per company and campaign, live first, then the newest', out.length === 3 && out[0].campaignName === 'Outono' && out[0].live && out[0].n === 2 && out[1].campaignName === 'Primavera');
ok('a campaign no longer in the list keeps the name stored on the enrolment', out[2].campaignName === 'Antiga' && out[2].c === null);

ok('a click opens the campaign on its Companies, filtered on the company', html.includes("openCampaign(id, 'audience'); audSearch = tr.dataset.coname || '';"));
ok('the box sits on top of the Campaigns list behind the switch', html.includes('<div data-feature="outreach.campaignSearch"') && html.includes('id="campCoFind"'));
ok('the switch is in the portal list', feats.includes("['outreach.campaignSearch', 'Outreach', 'release', 'Find a company in all campaigns'"));

console.log(fail ? `${NL}${fail} FAILED` : `${NL}All passed`);
process.exit(fail ? 1 : 0);
