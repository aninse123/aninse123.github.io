// Person page → company activities (12 Oct 2026): a change to a person's
// contact details or notes is written on every company where they are current
// (shareholder or manager, max 20), as automatic entries that aren't touches.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const lift = (name) => { const a = page.indexOf(`function ${name}(`); let d = 0, i = page.indexOf('{', a); for (; ; i++) { if (page[i] === '{') d++; else if (page[i] === '}' && --d === 0) break; } return page.slice(a, i + 1); };
const fieldsAt = page.indexOf('const PERSON_CONTACT_FIELDS = ['), fieldsEnd = page.indexOf('];', fieldsAt) + 2;
const ctx = {};
vm.createContext(ctx);
vm.runInContext(`${page.slice(fieldsAt, fieldsEnd)}\n${lift('personContactChanges')}\nfunction linkIsCurrent(l){ return l.shCurrent === true || l.mgmtCurrent === true; }\nconst linkCurrentAny = (l) => (l?.isContact ? l.contactCurrent !== false : linkIsCurrent(l));\n${lift('currentCompanyIdsOf')}\nglobalThis.T = { personContactChanges, currentCompanyIdsOf };`, ctx);
const { T } = ctx;
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
const J = (x) => JSON.stringify(x);

ok('only changed fields, old → new', J(T.personContactChanges({ email: null, phone: '+351 1' }, { email: 'ana@x.pt', phone: '+351 1', linkedin: '' })) === J(['email: — → ana@x.pt']));
ok('blank and missing are the same (no change)', T.personContactChanges({ fax: '' }, { fax: null }).length === 0);
ok('a cleared field shows → —', J(T.personContactChanges({ phone: '91' }, { phone: null })) === J(['phone: 91 → —']));
const links = [{ companyId: 'a', shCurrent: true }, { companyId: 'b', mgmtCurrent: true }, { companyId: 'c', shCurrent: false, mgmtCurrent: false }, { companyId: 'a', mgmtCurrent: true }];
ok('companies: current shareholder or manager, once each, previous left out', J(T.currentCompanyIdsOf(links)) === J(['a', 'b']));
ok('at most 20 companies', T.currentCompanyIdsOf(Array.from({ length: 30 }, (_, i) => ({ companyId: 'c' + i, shCurrent: true }))).length === 20);
ok('both new types are automatic (not a touch)', /const AUTO_TYPES = \[[^\]]*'person_contact_edited','person_note'[^\]]*\]/.test(page) && page.includes("person_contact_edited: { label:'Person contact updated'") && page.includes("person_note:      { label:'Note on a person'"));
ok('saving contact and notes writes them on the companies', page.includes("logOnPersonCompanies(p, links, 'person_contact_edited'") && page.includes("logOnPersonCompanies(p, links, 'person_note'"));
if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
