// B3: activities / logs are never edited or deleted (only closed once, or
// marked when their record is deleted), and A4: the Search CRM edit split
// (own vs any company, deal, flags) — checked on the rules text and the pages,
// since the Firestore rules can't be run locally.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const rules = read('../../firestore.rules');
const pages = { search: read('../../portal/search.html'), crm: read('../../portal/crm.html'), network: read('../../portal/network.html') };

let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
function block(name) {
  const i = rules.indexOf(`match /${name}/{`);
  if (i < 0) return '';
  let d = 0, j = rules.indexOf('{', rules.indexOf('}', i) + 1);
  const s = j; do { if (rules[j] === '{') d++; else if (rules[j] === '}') d--; j++; } while (d > 0);
  return rules.slice(s, j);
}
const LOGS = ['searchActivities', 'networkActivities', 'networkFirmActivities', 'crmActivities'];
for (const c of LOGS) {
  const b = block(c);
  ok(`${c}: rules found, no delete allowed`, b.length > 0 && !/allow\s+[a-z, ]*\bdelete\s*:/.test(b));
  ok(`${c}: updates only close it once or mark the record deleted`, /allow update:/.test(b) && /closeOnly\(\)/.test(b) && /recordDeletedOnly\(\)/.test(b) && !/allow update: if (can\('[^']+'\)|canAny\([^)]*\))\s*;/.test(b));
}
ok('closeOnly: only an open activity, only the outcome fields', /function closeOnly\(\) \{ return resource\.data\.get\('status', ''\) == 'open' && onlyFields\(\['status', 'closedNotes', 'closedAt', 'closedBy'\]\)/.test(rules));
for (const [page, src] of Object.entries(pages)) {
  ok(`${page}: no activity is deleted from the page`, !/deleteDoc\([^)]*Activities/.test(src) && !/Activities'[^;]*\n?[^;]*deleteDoc\(d\.ref\)/.test(src));
  ok(`${page}: deleting a record marks its activities (history kept, with the name)`, /recordDeleted: true, recordName:/.test(src));
}

// A4: rules for companies
const co = block('searchCompanies');
ok('companies: own (search.edit + owner = key) or any (search.editall)', /function companyEditor\(owner\) \{ return can\('search\.editall'\) \|\| \(can\('search\.edit'\) && owner != null && owner == request\.auth\.token\.get\('key', '~'\)\)/.test(rules) && /companyEditor\(resource\.data\.get\('owner', null\)\)/.test(co));
ok('companies: deal fields need search.deal, flags need search.flags, owner needs editall', /!changes\(dealFields\(\)\) \|\| can\('search\.deal'\)/.test(co) && /!changes\(flagFields\(\)\) \|\| can\('search\.flags'\)/.test(co) && /!changes\(\['owner'\]\) \|\| can\('search\.editall'\)/.test(co));
ok('companies: logging an activity may touch the bookkeeping fields only', /can\('search\.activity'\) && activityTouch\(\)/.test(co));
ok('F1: the tier (priority) is a flag field', /function flagFields\(\) \{ return \['priority',/.test(rules));
ok('Network categories need net.categories', /match \/networkConfig\/\{id\} \{[^}]*allow write: if can\('net\.categories'\)/.test(rules));

// A4 on the page: canEditCompany + the company form writes only what changed
const s = pages.search;
function liftFn(name) {
  const start = s.indexOf(`function ${name}(`); let p = s.indexOf('(', start), pd = 0;
  do { if (s[p] === '(') pd++; else if (s[p] === ')') pd--; p++; } while (pd > 0);
  const b = s.indexOf('{', p); let d = 0, j = b;
  do { if (s[j] === '{') d++; else if (s[j] === '}') d--; j++; } while (d > 0);
  return s.slice(start, j);
}
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(liftFn('canEditCompany') + '; globalThis.canEditCompany = canEditCompany;', ctx);
const acc = (perms, key) => ({ key, can: (p) => perms.includes(p) });
ctx.window.pageAccess = acc(['search.edit'], 'maria');
const own = ctx.canEditCompany({ owner: 'maria' }), other = ctx.canEditCompany({ owner: 'andre' }), none = ctx.canEditCompany({});
ctx.window.pageAccess = acc(['search.editall'], 'rui');
ok('page: an intern edits only companies she owns; an analyst edits any', own && !other && !none && ctx.canEditCompany({ owner: 'andre' }));
ok('page: company edit controls carry data-coedit and hide on companies they can\'t edit', /html\[data-coedit="0"\] \[data-coedit\] \{ display: none !important; \}/.test(s) && /id="editCompanyBtn" data-perm="search\.edit" data-coedit/.test(s));
ok('page: activities need search.activity, deal needs search.deal, flags need search.flags, stats need search.stats', /id="addActivityBtn" data-perm="search\.activity"/.test(s) && /id="editDealBtn" data-perm="search\.deal"/.test(s) && /id="dncBtn" data-perm="search\.flags"/.test(s) && /id="companyStatsBtn" data-perm="search\.stats"/.test(s));
ok('page: the company form writes only the fields that changed (so unchanged deal / tier fields never need those permissions)', /const changed = Object\.fromEntries\(Object\.entries\(data\)\.filter\(\(\[k, val\]\) => k === 'updatedAt' \|\| !same\(prev\[k\], val\)\)\)/.test(s) && /\.\.\.changed,\s*\n\s*nameKey/.test(s));
ok('Network: category settings need net.categories', /id="categorySettingsBtn" data-perm="net\.categories"/.test(pages.network));

console.log(fail ? `\n${fail} FAILED` : '\nall log / edit-split tests passed'); process.exit(fail ? 1 : 0);
