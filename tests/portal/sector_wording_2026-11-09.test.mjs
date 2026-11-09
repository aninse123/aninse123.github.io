// Sector wording per company (9 Nov 2026, switch outreach.sectorWording): the switch is in both
// catalogs, the field is on the company form and only saved while the switch is on, the company
// page shows it, and the Compose / tasks preview uses it before the campaign's wording.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { FEATURES } = require('../../functions/features/catalog.js');
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const search = read('../../portal/search.html');
const outreach = read('../../portal/outreach.html');
const feats = read('../../portal/features.js');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

const sw = FEATURES.find((f) => f.key === 'outreach.sectorWording');
ok('the switch is in the server catalog as a release switch', !!sw && sw.kind === 'release' && sw.area === 'Outreach');
ok('…and in the page catalog with the same name and text', feats.includes("['outreach.sectorWording', 'Outreach', 'release', 'Sector wording per company',") && feats.includes(sw.description.replace(/\\"/g, '"')));
ok('the form has the field, behind the switch', /data-feature="outreach\.sectorWording"[^>]*><label>Sector wording/.test(search) && search.includes('id="cSectorWording"'));
ok('it is cleared, filled and read with the other form fields', search.includes("'cLetterIntro','cSectorWording',") && search.includes("set('cSectorWording',c.sectorWording);") && search.includes("v('cSectorWording')||null"));
ok('it is only saved while the switch is on', /\.\.\.\(isOn\('outreach\.sectorWording'\) \? \{ sectorWording: v\('cSectorWording'\)\|\|null \} : \{\}\)/.test(search));
ok('the company page shows it only while the switch is on', search.includes("isOn('outreach.sectorWording') ? `<div class=\"info-row\"><span class=\"k\">Sector wording</span>"));
ok('the portal preview uses the company wording before the campaign one', outreach.includes("campaign: { sector: c?.sectorWording || camp?.sector || '' }"));
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
