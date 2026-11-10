// Search CRM reads that open a company, a person or the lists go over REST (10 Nov 2026): the SDK's persistentLocalCache made even a
// one-document answer take many seconds (see restFetchAllDocs in portal/search.html). Checks the wiring; the query shapes were
// run against the real database the same day. Writes, listeners and single-document reads stay on the SDK.
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const page = read('../../portal/search.html');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
const fn = (start, end) => { const i = page.indexOf(start); if (i < 0) throw new Error(start); return page.slice(i, page.indexOf(end, i)); };

ok('helpers: restQueryAll pages by id (300 at a time), restEq builds an equality, restQueryDocs takes any structured query',
  page.includes('async function restQueryAll(') && page.includes("orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: REST_PAGE_SIZE") && page.includes("startAt: { values: [{ referenceValue:") && page.includes('const restEq = (field, value)') && page.includes('async function restQueryDocs('));
ok('a company\'s activities, and the links of a company and of a person, over REST',
  page.includes("activities = await restQueryAll('searchActivities', restEq('companyId', companyId))") && page.includes("await restQueryAll('searchPersonLinks', restEq('companyId', companyId))") && page.includes("await restQueryAll('searchPersonLinks', restEq('personId', personId))"));
ok('a person\'s activities, the same-email companies, the group of a company, the Files tab and the Contacted hover over REST',
  page.includes("restQueryAll('searchActivities', restEq('contactPersonId', p.id), { max: 50 })") && page.includes("restQueryAll('searchCompanies', restEq('companyEmail', e), { max: 11 })") && page.includes("restQueryAll('searchCompanies', restEq(k.field, k.value))") && page.includes("restQueryAll('outreachFiles', restEq('companyId', id), { max: 100 })") && page.includes("restQueryAll('outreachEnrolments', restEq('companyId', c.id), { max: 20 })"));
const people = fn('      // 10 Nov: over REST (restQueryDocs): the SDK', "      // Refine client-side so multi-word searches");
ok('the people search: name prefixes, then name words, then the name-key range, all over REST, 200 at most; recent people the same', people.includes("arr('namePrefixes', tokens[0])") && people.includes("arr('nameTokens', tokens[0])") && people.includes("fieldPath: 'nameKey' }, op: 'GREATER_THAN_OR_EQUAL'") && !people.includes('getDocs(') && page.includes("restQueryDocs('searchPeople', { orderBy: [{ field: { fieldPath: 'updatedAt' }, direction: 'DESCENDING' }], limit: 100 })"));
ok('the "email already used" check over REST (people and companies), skipping the person or company itself', page.includes("restFetchArrayContains('searchPeople', 'reachEmails', e, 6)") && page.includes("restFetchArrayContains('searchCompanies', 'emailKeys', e, 6)") && page.includes('pp.filter(d => d.id !== selfPersonId)') && page.includes('cc.filter(d => d.id !== selfCompanyId)') && page.includes('${x.name || x.id} (a company)'));
const reach = fn('async function fetchReachCompanyIds(){', 'function computeStats(');
ok('Statistics: people with contact details in one REST answer (an SDK fallback when it fills the 300 page), the links in parallel', reach.includes("op: 'NOT_EQUAL'") && reach.includes('people.length >= 300') && reach.includes("where('reach', '!=', [])") && reach.includes('await mapPool(chunks') && reach.includes("restFetchWhereIn('searchPersonLinks', 'personId', chunk)"));
ok('writes keep the SDK (the activity delete and the person-name rename need document references)', page.includes("const acts = await getDocs(query(collection(db,'searchActivities'), where('companyId','==',c.id)));") && page.includes("const all = await getDocs(query(collection(db,'searchPersonLinks'), where('personId', '==', link.personId)));"));
// Outreach: the reads behind the task cards
const out = read('../../portal/outreach.html');
const lc = out.slice(out.indexOf('async function loadCompaniesFor(ids) {'), out.indexOf('// T4: who signs a letter'));
ok('Outreach: companies for the task cards over REST, the 30-id chunks in parallel', out.includes("FIRESTORE_PROJECT_ID } from './firebase-config.js'") && out.includes('async function restRun(structuredQuery)') && lc.includes("restByIds('searchCompanies', chunk)") && lc.includes('await Promise.all(chunks.map(') && !lc.includes('getDocs('));
const lp = out.slice(out.indexOf('async function loadPeopleFor(companyIds) {'), out.indexOf('// Everyone who can receive an email for a company'));
ok('Outreach: the people of each task company over REST (links, then people by id), 6 companies at a time, a failure leaves that company empty', lp.includes("restEqDocs('searchPersonLinks', 'companyId', id, 60)") && lp.includes("restByIds('searchPeople'") && lp.includes('Math.min(6, todo.length)') && lp.includes('peopleCache.set(id, [])') && !lp.includes('getDocs('));
ok('Outreach REST values: timestamps stay text (tsMs reads them), maps and arrays convert', out.includes("if ('timestampValue' in v) return v.timestampValue; // tsMs() reads the text") && out.includes("if ('mapValue' in v) return restFields(v.mapValue.fields || {});") && out.includes("if ('arrayValue' in v) return (v.arrayValue.values || []).map(restVal);"));
if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); } else console.log('\nAll passed');
