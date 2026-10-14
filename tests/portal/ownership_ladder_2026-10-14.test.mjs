// Ownership ladder, subsidiaries and group (14 Oct 2026, switch search.ownership):
// the ladder climbs through corporate shareholders that are CRM companies
// (personMatchedCompanyId), the subsidiaries descend through the same links the
// other way, a company met twice is shown once, and the group key prefers
// Orbis's BvD id (with country) over the bare number.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const lift = (start, end) => { const a = page.indexOf(start), b = page.indexOf(end, a); if (a < 0 || b < 0) throw new Error('lift: ' + start); return page.slice(a, b); };
const block = lift('// ── Ownership ladder, subsidiaries, group, people', '// ── Person link modal');
const controlTier = lift('function controlTier(pct){', '\n}\n') + '\n}\n';

let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
const sh = (personId, companyId, pct, extra = {}) => ({ id: `${personId}__${companyId}`, personId, companyId, personName: personId, companyName: companyId, shCurrent: true, shDirectPct: pct, personEntityType: 'person', ...extra });
const ent = (personId, companyId, pct, matched) => sh(personId, companyId, pct, { personEntityType: 'entity', personMatchedCompanyId: matched || null });
// A ← B (60%, CRM) ← C (100%, CRM) ← Xavier and D (5%); A ← Maria 40%; C holds 30% of D, so C → D → C is a loop.
const LINKS = [
  sh('Maria', 'A', 40), ent('pB', 'A', 60, 'B'),
  ent('pC', 'B', 100, 'C'),
  sh('Xavier', 'C', 100),
  ent('pC', 'D', 30, 'C'),
  ent('pD', 'C', 5, 'D'),            // D holds 5% of C: a loop C → D → C
  ent('pFOREIGN', 'B', 0.5, null),   // a holder outside the CRM
  sh('Old', 'A', 10, { shCurrent: false }),
];
let reads = 0;
const byCompany = (id) => LINKS.filter((l) => l.companyId === id);
const ctx = {
  console, Intl, Map, Set, Math, Number, String, Promise,
  companies: [{ id: 'A', name: 'A Lda', stage: 'universe', contactable: true, computedRevenue: 5e6 }, { id: 'B', name: 'B SGPS' }, { id: 'C', name: 'C Holding' }, { id: 'D', name: 'D Lda' }],
  PERSON_IN_CHUNK: 30, personDocCache: new Map([['pFOREIGN', { id: 'pFOREIGN', nif: '999', country: 'ES' }]]),
  fetchManyCompanyLinks: async (ids) => { reads++; return new Map(ids.map((id) => [id, byCompany(id)])); },
  restFetchWhereIn: async (coll, field, ids) => { reads++; return LINKS.filter((l) => ids.includes(l[field])); },
  restFetchByIdsIn: async () => [], computeFields: (x) => x,
  esc: (s) => String(s ?? ''), fmtPctOwn: (v) => v == null ? '—' : (Math.round(v * 100) / 100) + '%',
  fmtEurShort: (n) => n == null ? '—' : '€' + n, STAGES: { universe: { label: 'Universe' } },
  onlyDigits: (s) => String(s || '').replace(/\D/g, ''), nifFromAny: () => '', personNameKey: (s) => String(s).toLowerCase(),
  linkIsCurrent: (l) => l.shCurrent === true || l.mgmtCurrent === true, stagePill: (s) => s,
  document: { getElementById: () => ({ addEventListener() {} }) },
};
vm.createContext(ctx);
vm.runInContext(controlTier + block + '\nglobalThis.T = { ownLadderUp, ownSubsDown, ownTreeHtml, ownTreeIds, ownGroupKey, ownCurrentHolders };', ctx);
const { T } = ctx;

const up = await T.ownLadderUp({ id: 'A' }, byCompany('A'));
ok('level 1: current holders only, largest first (B 60%, Maria 40%; previous holder left out)', up.children.map((n) => n.link.personId).join() === 'pB,Maria');
const b = up.children[0];
ok('B is a CRM company and climbs to C', b.coId === 'B' && b.children.some((n) => n.coId === 'C'));
const c = b.children.find((n) => n.coId === 'C');
ok('C climbs to Xavier and to D (5%)', c.children.map((n) => n.link.personId).sort().join() === 'Xavier,pD');
const d = c.children.find((n) => n.coId === 'D');
ok('D is held by C, already above: shown once as a repeat, the loop stops', d && d.children.length === 1 && d.children[0].coId === 'C' && d.children[0].repeat === true && d.children[0].children.length === 0);
ok('holder outside the CRM stays a leaf', b.children.find((n) => n.link.personId === 'pFOREIGN').coId === null);

const html = T.ownTreeHtml(up, { mode: 'up', cos: new Map(ctx.companies.map((x) => [x.id, x])), people: ctx.personDocCache });
ok('through the chain: 60% × 100% = 60% of A for C, 60% × 100% × 100% for Xavier', /100%.*C Holding.*≈ 60% of this company through the chain/s.test(html) && /Xavier.*≈ 60% of this company/s.test(html));
ok('non-CRM corporate holder shows NIF and country', /pFOREIGN.*NIF 999 · ES/s.test(html));
ok('CRM company row shows its status (revenue, stage, contactable)', /€5000000 · Universe · contactable/.test(T.ownTreeHtml({ children: [{ link: ent('x', 'Z', 50, 'A'), coId: 'A', children: [] }] }, { mode: 'up', cos: new Map([['A', ctx.companies[0]]]), people: new Map() })));

const down = await T.ownSubsDown({ id: 'C' });
ok('C holds B (100%) and D (30%), largest first', down.children.map((n) => n.coId).join() === 'B,D');
ok('…B holds A (60%)', down.children[0].children.map((n) => n.coId).join() === 'A');
ok('…D holds C back: shown once, marked as a repeat, not followed', down.children[1].children.length === 1 && down.children[1].children[0].coId === 'C' && down.children[1].children[0].repeat === true);
ok('tree ids count the rows and the CRM companies', T.ownTreeIds(down).n === 4 && [...T.ownTreeIds(down).cos].sort().join() === 'A,B,C,D');
ok('subsidiary through the chain: C holds ≈ 60% of A', /A Lda.*≈ 60% held through the chain/s.test(T.ownTreeHtml(down, { mode: 'down', cos: new Map(ctx.companies.map((x) => [x.id, x])), people: new Map() })));

const many = { children: Array.from({ length: 45 }, (_, i) => ({ link: sh('p' + i, 'A', 1), children: [] })) };
ok('more than 40 rows: "and 5 more"', /and 5 more/.test(T.ownTreeHtml(many, { mode: 'up', cos: new Map(), people: new Map() })));

ok('group key: BvD id first (US owner\'s number would look like a NIF)', T.ownGroupKey({ ownershipMeta: { guoNif: '510354549', guoBvdId: 'US510354549' } }).field === 'ownershipMeta.guoBvdId');
ok('group key: number when there is no BvD id; none without an owner', T.ownGroupKey({ ownershipMeta: { guoNif: '5' } }).field === 'ownershipMeta.guoNif' && T.ownGroupKey({}) === null);

ok('the section is behind the switch (isOn + data-feature)', /const ownOn = isOn\('search\.ownership'\);/.test(page) && /<div id="ownLadderWrap" data-feature="search\.ownership"><\/div>/.test(page) && /if \(ownOn\) renderOwnershipLadder\(c, links\);/.test(page));
ok('people\'s other companies leave auditors out', /OWN_AUDITOR_RE = \/fiscal\|auditor\|revisor/.test(page));

// Search CRM filters, columns, export and the campaign spec (flat fields from the ownership-graph tool).
ok('filters: group size, subsidiaries / parent, owner has other companies, same group (all behind the switch)', ['groupFilter', 'subsFilter', 'ownerOtherFilter', 'groupKeyChip'].every((id) => new RegExp('id="' + id + '" data-feature="search\.ownership"').test(page)) && /'groupFilter','subsFilter','ownerOtherFilter','groupKeyFilter'\]/.test(page));
ok('list filter reads the stored fields; same group reads the ultimate owner itself', /c\.ownGroupSize >= Number\(grpF\)/.test(page) && /c\.ownSubs > 0/.test(page) && /c\.ownParents > 0/.test(page) && /ownGroupKey\(c\)\?\.value !== gkF/.test(page));
ok('campaign spec carries the same filters (the server matches flat fields)', /add\('ownGroupSize', 'gte'/.test(page) && /add\('ownOwnerOther'/.test(page) && /add\('ownGroupKey', 'eq'/.test(page));
ok('Group and Group revenue columns + export group', /data-col="ownGroupSize"/.test(page) && /data-col="ownGroupRevenue"/.test(page) && /title: 'Ownership \(groups\)'/.test(page));

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
