// Letters and call scripts (29 Oct 2026): the company figures fields give the same text on
// the page (portal/company-figures.js) and on the server (company_figures.js), the Letters
// screen is behind the switch outreach.letterTools (preview / edit, no printing while a
// field is missing, "Ao cuidado de" line), and the switch is in both catalogs.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../../functions/outreach/company_figures.js');
const P = await import('../../portal/company-figures.js');
const { FEATURES } = require('../../functions/features/catalog.js');
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const page = read('../../portal/outreach.html');
const feats = read('../../portal/features.js');
const search = read('../../portal/search.html');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

const samples = [
  { lastAvailYear: '2025', computedRevenue: 2340000, computedEBITDA: 412300, computedEBITDAMargin: 0.1762, computedEmployees: 42, computedGrowthRecent: 0.052, computedGrowthSustained: 0.031, letterIntro: ' Fundada em 1982. ' },
  { lastAvailYear: '2024', computedRevenue: 900000, computedEBITDA: -5, computedGrowthRecent: -0.02, computedGrowthSustained: 0.03 },
  { computedRevenue: 5e5, computedEmployees: 1, computedGrowthRecent: 0.1 },
  { lastAvailYear: '2025' }, {},
  { lastAvailYear: '2025', computedRevenue: 1000000, computedEBITDA: 999700, computedEBITDAMargin: 0.999 },
];
ok('page = server: every figure and sentence, 6 sample companies', samples.every((c) => JSON.stringify(P.figuresOf(c)) === JSON.stringify(S.figuresOf(c))));
ok('page = server: accounts two or more years old (pinned dates)', [new Date('2026-10-29'), new Date('2027-03-01')].every((d) => samples.every((c) => JSON.stringify(P.figuresOf(c, d)) === JSON.stringify(S.figuresOf(c, d)))));
ok('page = server: amounts and percentages', [0, 850, 999700, 1e6, 2340000, 12400000, null, -3].every((v) => P.eurPt(v) === S.eurPt(v)) && [0, 0.03, 0.1789, null].every((v) => P.pctPt(v) === S.pctPt(v)));

ok('both page contexts (tasks and compose preview) add the figures; the page imports the module', page.includes("import { figuresOf } from './company-figures.js'") && (page.match(/\.\.\.figuresOf\(c( \|\| \{\})?\)/g) || []).length === 2);
ok('the Letters screen only changes behind the switch (preview / edit column, missing check, no printing, care-of line)', page.includes("const LT = isOn('outreach.letterTools')") && page.includes('data-leted') && page.includes('missingFieldsOf(') && page.includes('Ao cuidado ${ctx.owner.of}') && page.includes('left out: a field is missing'));
ok('a letter with its own text prints that text; a missing field disables its checkbox', page.includes('t.letterText?.body') && /disabled title="A field is missing/.test(page));
ok('saving goes through updateTask with letterText; null goes back to the template', page.includes("action: 'updateTask', taskId: t.id, letterText: { subject, body }") && page.includes('letterText: null'));
ok('a [field] marker left in the text can\'t be saved', page.includes("Replace the [field] markers with text before saving."));
ok('Search CRM company form: a Letter intro box, shown only while the switch is on', /data-feature="outreach\.letterTools"[^>]*><label>Letter intro/.test(search) && search.includes('id="cLetterIntro"'));
ok('it is filled from the company and saved only while the switch is on (otherwise edits leave the field alone)', search.includes("set('cLetterIntro',c.letterIntro)") && search.includes("...(isOn('outreach.letterTools') ? { letterIntro: v('cLetterIntro')||null } : {})"));
ok('the company page shows it behind the switch; a new company starts with an empty box', search.includes("isOn('outreach.letterTools') ? `<div class=\"info-row\"><span class=\"k\">Letter intro") && /'cEmailOwners','cLetterIntro'/.test(search));
const sv = FEATURES.find((f) => f.key === 'outreach.letterTools');
ok('switch outreach.letterTools: release, in Outreach, in both catalogs with the same name', !!sv && sv.kind === 'release' && sv.area === 'Outreach' && feats.includes("'outreach.letterTools', 'Outreach', 'release', '" + sv.name + "'"));
ok('the server asks for the switch before a letter\'s own text', read('../../functions/outreach/campaigns.js').includes('data.action === "updateTask" && data.letterText !== undefined) await Feat.requireFeature(request, "outreach.letterTools")'));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
