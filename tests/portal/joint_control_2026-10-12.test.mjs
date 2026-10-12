// Joint control (12 Oct 2026): two holders with exactly 50% each. Orbis names
// an ultimate owner only above 50%, so it lists such a company as its own
// ultimate owner (type "Corporate") — the Ownership note now says "Joint
// control" with the holders' own kind, on the desktop page and the phone app
// (same resolveOwnership, generated into portal/m/crm-helpers.js).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const strip = (src) => src.replace(/\r\n/g, '\n').replace(/^import .*$/gm, '').replace(/^export \{[^}]*\};?$/gm, '').replace(/^export /gm, '');
const helpersSrc = strip(readFileSync(new URL('../../portal/m/crm-helpers.js', import.meta.url), 'utf8'));
const ctx = { console, Intl };
vm.createContext(ctx);
vm.runInContext(helpersSrc + '\nglobalThis.H = { resolveOwnership };', ctx);
const { H } = ctx;
const page = readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
const person = (id, pct, extra = {}) => ({ personId: id, personName: id, shCurrent: true, shDirectPct: pct, ...extra });
const GUO = { nif: '500000000', ownershipMeta: { entityType: 'GUO', guoName: 'ACCELERATED CONTACT CONSULTING', guoNif: '500000000', guoType: 'Corporate' } };

let o = H.resolveOwnership(GUO, [person('Alfredo', 50), person('Ana', 50)]);
ok('own GUO + 2 people at 50% → joint control, Individuals', o.joint === true && o.guoType === 'Individuals' && /^Joint control: 2 people hold 50% each/.test(o.note) && /its own ultimate owner/.test(o.note));
ok('…still Orbis-sourced, no crowned owner', o.source === 'orbis' && o.independent === true && o.ownerIds.size === 0);

o = H.resolveOwnership({ ownershipMeta: { entityType: 'Independent co' } }, [person('A', 50), person('B', 50, { personEntityType: 'entity' })]);
ok('independent + person and company at 50% → "2 holders", Individual + corporate', o.joint === true && o.guoType === 'Individual + corporate' && /2 holders/.test(o.note) && /independent company/.test(o.note));

o = H.resolveOwnership(GUO, [person('A', 50), person('B', 50), person('C', 50, { shCurrent: false })]);
ok('a previous 50% holder doesn\'t count', o.joint === true);

// Shared control (12 Oct, EUROTORF): no holder above half, any split other than 2 × 50%.
o = H.resolveOwnership(GUO, [person('A', 33.33), person('B', 33.33), person('C', 33.33)]);
ok('3 × 33.33% (own GUO) → shared control, Individuals, equal, percentages listed', !o.joint && o.shared?.n === 3 && o.shared.equal === true && o.guoType === 'Individuals'
  && o.note === 'Shared control: no one holds more than half — 3 people: 33.33% · 33.33% · 33.33% (Orbis lists the company as its own ultimate owner)');
o = H.resolveOwnership({ ownershipMeta: { entityType: 'Independent co' } }, [person('A', 40), person('B', 35, { personEntityType: 'entity' })]);
ok('40 / 35 (independent), a person and a holding → "2 holders", unequal, 75% recorded, Individual + corporate', o.shared?.n === 2 && o.shared.equal === false && o.shared.largest === 40 && o.guoType === 'Individual + corporate'
  && /2 holders: 40% · 35% \(75% recorded\) \(Orbis: independent company\)$/.test(o.note));
o = H.resolveOwnership(GUO, ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => person(n, 16.66, { personEntityType: 'entity' })));
ok('6 holdings → Corporate, first 4 percentages "and 2 more"', o.guoType === 'Corporate' && /6 holders: 16.66% · 16.66% · 16.66% · 16.66% and 2 more/.test(o.note));
o = H.resolveOwnership({ ownershipMeta: { entityType: 'GUO', cshKeys: ['x'], cshNames: ['Family'] } }, [person('A', 33), person('B', 33), person('C', 33)]);
ok('a controlling shareholder named by Orbis wins over shared control', !o.shared && /^Controlling shareholder per Orbis/.test(o.note));

o = H.resolveOwnership(GUO, [person('A', 50)]);
ok('one 50% holder alone is not joint control', !o.joint);

o = H.resolveOwnership({ ownershipMeta: { entityType: 'Independent co' } }, [person('A', 60), person('B', 40)]);
ok('a holder above 50% is never joint', !o.joint && /^Independent company/.test(o.note));

ok('header pill can be corrected once the links load (joint / shared)', /data-own-pill title="Orbis records no controlling shareholder"/.test(page) && /🤝 Joint control · 2 × 50%/.test(page) && page.includes('🤝 Shared control · ${own.shared.equal'));
ok('"It is its own ultimate owner" hidden for joint / shared control', page.includes("${own.guoName && !own.joint && !own.shared ? (own.guoNif"));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
