// Company files (4 Nov 2026, switch search.companyFiles): a Files tab on the company page. Files live in outreachFiles (source "company") and
// Storage outreach/files/<id>/<name>, the same store as the Outreach attachments. Source-level checks, as for the other Search CRM suites.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { FEATURES } = require('../../functions/features/catalog.js');
const search = readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8');
const fsRules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const stRules = readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8');
const webFeatures = readFileSync(new URL('../../portal/features.js', import.meta.url), 'utf8');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

const f = FEATURES.find((x) => x.key === 'search.companyFiles');
ok('switch exists: a release switch in the Search CRM area (Off in production by default)', !!f && f.kind === 'release' && f.area === 'Search CRM' && f.defaults.production === 'off' && f.defaults.staging === 'on');
ok('switch is also in portal/features.js (parity)', webFeatures.includes("'search.companyFiles'"));

ok('Files tab and panel are hidden while the switch is Off (data-feature)', /<button class="tab" data-tab="files" data-feature="search.companyFiles">Files<\/button>/.test(search) && /id="panel-files" data-feature="search.companyFiles"/.test(search));
ok('the tab loads only when opened (no read with the company)', /if \(name === 'files'\) companyFilesShow\(\);/.test(search) && !/companyFilesShow\(\)[^;]*renderDeal/.test(search));
ok('the list is the outreachFiles of this company, capped', /collection\(db, 'outreachFiles'\), where\('companyId', '==', id\), limit\(100\)/.test(search));
ok('the list is reset when another company opens', /companyFilesReset\(c\);\s*\}/.test(search));
ok('uploads go through the attachment rules (type, 10 MB) and the same Storage path as Outreach', /fileProblem\(file, \[\]\)/.test(search) && /`outreach\/files\/\$\{id\}\/\$\{filename\}`/.test(search));
ok('the record is a company file, kept out of the Outreach library, in the uploader\'s name', /library: false, source: 'company', companyId: c\.id, createdAt: serverTimestamp\(\), createdBy: currentUser/.test(search));
ok('uploads and removals are logged in Activities and are not touches', /logAuto\(c\.id, 'file_added'/.test(search) && /logAuto\(c\.id, 'file_removed'/.test(search) && /AUTO_TYPES = \['company_created','company_edited','stage_changed','file_added','file_removed'/.test(search));
ok('removing asks first, deletes the Storage object (a missing one is fine) and the record', /confirm\(`Remove \$\{f\.name/.test(search) && /deleteObject\(stRef\(storage, f\.storagePath\)\)/.test(search) && /object-not-found/.test(search) && /deleteDoc\(doc\(db, 'outreachFiles', fileId\)\)/.test(search));
ok('buttons follow permissions: upload = search.activity, remove = search.edit', /data-perm="search\.activity"[^>]*>＋ Upload files/.test(search) && /data-fdel="[^"]*" data-perm="search\.edit"/.test(search));

ok('Firestore: anyone who sees the CRM reads the files', /match \/outreachFiles\/\{id\} \{\s*allow read: if canAny\(\['out\.view', 'search\.view'\]\)/.test(fsRules));
ok('Firestore: CRM editors create only company files, in their own name', /canAny\(\['search\.activity', 'search\.edit', 'search\.editall'\]\) && request\.resource\.data\.get\('source', ''\) == 'company'\)\s*\)\s*&& createsAsMe\(\)/.test(fsRules));
ok('Firestore: CRM editors remove only company files', /canAny\(\['search\.edit', 'search\.editall'\]\) && resource\.data\.get\('source', ''\) == 'company'/.test(fsRules));
ok('Storage: the files rule lets CRM editors upload and remove, and the CRM reads', /can\('search\.activity'\) \|\| can\('search\.edit'\) \|\| can\('search\.editall'\)/.test(stRules) && /can\('out\.view'\) \|\| can\('search\.view'\)/.test(stRules) && /can\('out\.templates'\) \|\| can\('search\.edit'\) \|\| can\('search\.editall'\)/.test(stRules));

console.log(fail ? `\n${fail} FAILED` : '\nall company files tests passed'); process.exit(fail ? 1 : 0);
