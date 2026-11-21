// Database search with one magnifier (21 Nov 2026, switch search.serverFilters): which condition goes to the server,
// how each step reads the database (synthetic stand-ins for the REST calls), the Database results mode in getFiltered,
// and the wiring (only 🔍 reaches the database, Back to list, Add to campaign, Export results, switch Off unchanged).
// The page's own functions are run from its source text.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const page = read('../../portal/search.html'), catalog = read('../../functions/features/catalog.js'), feats = read('../../portal/features.js');
const grab = (start, end = '\n}\n') => { const i = page.indexOf(start); if (i < 0) throw new Error(start); const j = page.indexOf(end, i); return page.slice(i, j + end.length); };
const ONE = String.fromCharCode(10); // one-line functions end at the line end
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

// ── the page's functions, in a sandbox with stand-ins for what they call ──
const log = [];
const DB = { // what the stand-in database answers, per query
  range: { 'caeCode:2830': 25, 'naceCode:28.30': 24, 'naceCode:2830': 1, 'caeCode:4': 2100 },
  eq: { 'nuts3:PT11A - Area Metropolitana do Porto': 40, 'nationalLegalForm:Foundation': 3, 'legalForm:Foundation': 2, 'stage:universe': 2101 },
  count: { 'caeCode:4': 17228, 'stage:universe': 36000 },
};
const mk = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix} ${i}`, nameTokens: [prefix.toLowerCase()], nameKey: prefix.toLowerCase() + ' ' + i }));
const ctx = {
  console, Map, Set, JSON, String, Number, Math,
  isOn: (k) => ctx.SWITCHES.has(k), SWITCHES: new Set(['search.serverFilters', 'search.phoneSearch']),
  companySearchFields: (t) => { const toks = String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(w => w.length > 1); return { nameKey: toks.join(' '), nameTokens: toks }; },
  restRange: (f, p) => ({ t: 'range', f, p }), restEq: (f, v) => ({ t: 'eq', f, v }), restArrayContains: (f, v) => ({ t: 'ac', f, v }),
  restQueryRangeAll: async (col, f, p, max) => { log.push(`range ${f} ${p} max ${max}`); return mk(`${f}-${p}-`, Math.min(DB.range[`${f}:${p}`] || 0, max)); },
  restQueryAll: async (col, w, { max }) => { log.push(`all ${w.t} ${w.f} ${w.v} max ${max}`); const n = w.t === 'eq' ? DB.eq[`${w.f}:${w.v}`] || 0 : w.v === 'geral@flama.pt' ? 1 : 0; return mk(`${w.f}-${w.v}-`, Math.min(n, max)); },
  restQueryDocs: async (col, q) => {
    const w = q.where; log.push(`docs ${w.t || 'nameKey'} ${w.f || ''} ${w.v || ''} limit ${q.limit}`);
    if (w.t === 'ac' && w.f === 'namePrefixes') return w.v === 'construcoes' ? mk('Construcoes', 300) : w.v === 'silva' ? mk('Silva', 120).map(c => ({ ...c, nameTokens: ['construcoes', 'silva'] })) : w.v === 'flama' ? mk('Flama', 2) : [];
    if (w.t === 'range' && w.f === 'nif') return [{ id: 'nif1', nif: '509111222' }];
    return [];
  },
  restFetchArrayContains: async (col, f, v) => { log.push(`ac ${col} ${f} ${v}`); return f === 'phoneKeys' && v === '917995784' ? [{ id: 'ph1' }] : []; },
  companiesViaPeople: async (f, v, what) => { log.push(`people ${f} ${v}`); return new Map(v === 'manuel@flama.pt' ? [['co-flama', `${what} of Manuel Eira`]] : v === '917995784' ? [['co-paula', `${what} of Paula Ribeiro`]] : []); },
  restCount: async (col, w) => { log.push(`count ${w.f}`); return DB.count[`${w.f}:${w.p ?? w.v}`] || 0; },
};
vm.createContext(ctx);
vm.runInContext([
  'const SERVER_SEARCH_MAX = 2000, SERVER_NAME_MAX = 300;',
  grab('function naceForms('), grab('function codeStarts('), grab('function searchTextKind('), grab('function serverSearchPlan('),
  grab('function nameHasTokens(', ONE), grab('async function runServerStep('),
  'globalThis.S = { naceForms, codeStarts, searchTextKind, serverSearchPlan, nameHasTokens, runServerStep };',
].join('\n'), ctx);
const S = ctx.S;

// ── NACE in two formats, codes ignoring dots ──
ok('NACE typed either way searches both stored forms', JSON.stringify(S.naceForms('2830')) === '["28.30","2830"]' && JSON.stringify(S.naceForms('28.30')) === '["28.30","2830"]' && JSON.stringify(S.naceForms('28')) === '["28"]' && S.naceForms('').length === 0);
ok('the browser NACE filter ignores dots', S.codeStarts('28.30', '2830') && S.codeStarts('2830', '28.3') && S.codeStarts('28.30', '28') && !S.codeStarts('28.30', '2831') && !S.codeStarts(null, '28') && S.codeStarts('x', ''));

// ── what the text is ──
const K = S.searchTextKind;
ok('text kinds: email, NIF (+ phone for 9 digits), foreign tax id, phone, name; nothing for empty or one letter',
  K('Geral@Flama.pt').kind === 'email' && K('Geral@Flama.pt').value === 'geral@flama.pt' && K('geral@flama.pt').full && !K('@flama').full && K('@flama').kind === 'email'
  && K('509111222', '509111222').kind === 'nif' && K('509111222', '509111222').phone === '509111222' && K('5091').field === 'nif' && K('12345678901234').field === 'foreignTaxId'
  && K('+351 91 799 57 84', '917995784').kind === 'phone' && K('Flama Lda').kind === 'name' && K('') === null && K('a') === null);

// ── which condition goes to the server (D2 order) ──
const plan = (f) => S.serverSearchPlan(f).map(s => s.kind + ':' + s.label);
ok('the text goes first (NIF / phone / email, then name)', plan({ text: 'geral@flama.pt', cae: '2830', nuts3: 'X' })[0] === 'email:Email geral@flama.pt' && plan({ text: 'Flama', cae: '2830' })[0] === 'name:Name "Flama"');
ok('then CAE, NACE, sub-sector, NUTS III, legal form, sector, NUTS II, source, stage, owner',
  JSON.stringify(plan({ owner: 'andre', ownerLabel: 'André', stage: 'universe', stageLabel: 'Universe', source: 'database', sourceLabel: 'Database', nuts2: 'N2', sector: 'Manufacturing', legalForm: 'Foundation', nuts3: 'N3', subSector: 'Sub', nace: '28.30', cae: '2830' }))
  === JSON.stringify(['range:CAE 2830*', 'range:NACE 28.30*', 'eq:Sub', 'eq:N3', 'eq:Foundation', 'eq:Manufacturing', 'eq:N2', 'eq:Source Database', 'eq:Stage Universe', 'eq:Owner André']));
ok('legal form asks both stored fields; NACE both forms', JSON.stringify(S.serverSearchPlan({ legalForm: 'Foundation' })[0].eq) === '[["nationalLegalForm","Foundation"],["legalForm","Foundation"]]' && S.serverSearchPlan({ nace: '2830' })[0].ranges.length === 2);
ok('only filters the database cannot search: no plan (🔍 asks for one, 0 reads)', S.serverSearchPlan({ text: '' }).length === 0);

// ── each step against the stand-in database ──
const run = async (f) => { log.length = 0; return S.runServerStep(S.serverSearchPlan(f)[0]); };
let r = await run({ cae: '2830' });
ok('CAE 2830: one range query, 25 companies, not capped', r.docs.length === 25 && !r.capped && log.join('|') === 'range caeCode 2830 max 2001');
r = await run({ nace: '2830' });
ok('NACE 2830: both forms, merged (24 + 1)', r.docs.length === 25 && log.join('|') === 'range naceCode 28.30 max 2001|range naceCode 2830 max 2001');
r = await run({ cae: '4' });
ok('CAE 4: stops at 2,000 and counts the real total (17,228)', r.docs.length === 2000 && r.capped && r.total === 17228 && log.includes('count caeCode'));
r = await run({ stage: 'universe' });
ok('an equality condition pages up to 2,000 too, with the count', r.docs.length === 2000 && r.capped && r.total === 36000);
r = await run({ legalForm: 'Foundation' });
ok('legal form: both fields (3 + 2)', r.docs.length === 5 && log.join('|') === 'all eq nationalLegalForm Foundation max 2001|all eq legalForm Foundation max 2001');
r = await run({ text: 'geral@flama.pt' });
ok('a full email: company emailKeys and people emails', r.docs.length === 1 && log.join('|') === 'all ac emailKeys geral@flama.pt max 2001|people reachEmails geral@flama.pt');
r = await run({ text: 'manuel@flama.pt' });
ok('a person\'s email leads to the company, saying whose', r.hitIds.get('co-flama') === 'Email of Manuel Eira');
r = await run({ text: '@flama.pt' });
ok('part of an email (@domain): only the company keys, no people look-up', log.join('|') === 'all ac emailKeys @flama.pt max 2001');
r = await run({ text: '917995784', phoneKey: '917995784' });
r = await run({ text: '917 995 784', phoneKey: '917995784' });
ok('the same number with spaces is only a phone (as today): company phones, people phones', !r.hitIds.has('nif1') && r.hitIds.get('ph1') === 'Company phone' && log.length === 2);
r = await run({ text: '917995784', phoneKey: '917995784' });
ok('9 digits: NIF range, company phones, people phones', r.hitIds.has('nif1') && r.hitIds.get('ph1') === 'Company phone' && r.hitIds.get('co-paula') === 'Phone of Paula Ribeiro' && log.length === 3);
r = await run({ text: 'Flama' });
ok('a name: namePrefixes, up to 300', r.docs.length === 2 && !r.capped && log.join('|') === 'docs ac namePrefixes flama limit 300');
r = await run({ text: 'Construções Silva' });
ok('a common first word that fills 300: the longest other word answers, every word must match', r.docs.length === 120 && !r.capped && log.join('|') === 'docs ac namePrefixes construcoes limit 300|docs ac namePrefixes silva limit 300');
r = await run({ text: 'Construções' });
ok('a name that fills 300 on its own is capped (runDatabaseSearch then asks the next condition)', r.capped && r.docs.length === 300);
ok('…and runDatabaseSearch hands a capped name to steps[1], matching the name in the browser', page.includes("if (step.kind === 'name' && res.capped && steps[1]) {") && page.includes("textBy = 'tokens';"));

// ── Database results mode in getFiltered ──
const ids = ['searchInput','stageFilter','ownerFilter','fitMin','fitMax','sectorFilter','subSectorFilter','nuts2Filter','nuts3Filter','sourceFilter','legalFormFilter','naceFilter','caeFilter','revMin','revMax','ebitdaMin','ebitdaMax','marginMin','marginMax','cagrMin','cagrMax','lastTouchFilter','websiteFilter','tierFilter','contactableFilter','groupFilter','subsFilter','ownerOtherFilter','groupKeyFilter','sameEmailFilter','emailNameFilter','followUpFilter'];
const vals = Object.fromEntries(ids.map(i => [i, '']));
const g = {
  console, Map, Set, Date, isNaN, parseFloat, Number, String,
  document: { getElementById: (id) => ({ value: vals[id] ?? '' }) },
  isOn: (k) => g.ON.has(k), ON: new Set(['search.serverFilters']),
  deburr: (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(),
  currentPhoneKey: () => null, phoneHits: new Map(), extraFilters: () => ({ seF: '', seMap: null, enF: '' }),
  legalFormOf: (c) => c.nationalLegalForm || c.legalForm || '', tsToDate: () => null, followUpMs: () => 0,
  companies: [], dbResults: null,
};
vm.createContext(g);
vm.runInContext([grab('function serverFiltersOn(', ONE), grab('function activeDbResults(', ONE), grab('function codeStarts('), grab('function nameHasTokens(', ONE), grab('function getFiltered('), 'globalThis.F = getFiltered;'].join('\n'), g);
g.companies = [
  { id: 'r1', name: 'Alfa Metal', naceCode: '28.30', caeCode: '28300', nuts2: 'Norte', stage: 'universe', nameTokens: ['alfa', 'metal'], nameKey: 'alfa metal' },
  { id: 'r2', name: 'Beta Metal', naceCode: '2830', caeCode: '28300', nuts2: 'Centro', stage: 'universe', nameTokens: ['beta', 'metal'], nameKey: 'beta metal' },
  { id: 'x1', name: 'Recent One', naceCode: '47.11', caeCode: '47111', nuts2: 'Norte', stage: 'screened', nameTokens: ['recent'], nameKey: 'recent one' },
];
const names = (l) => l.map(c => c.id).join(',');
vals.naceFilter = '2830';
ok('switch On, no results: NACE 2830 finds both stored forms among the loaded', names(g.F()) === 'r1,r2');
g.ON.delete('search.serverFilters');
ok('switch Off: NACE filter exactly as before (only the dotless one)', names(g.F()) === 'r2');
g.ON.add('search.serverFilters'); vals.naceFilter = '';
g.dbResults = { ids: new Set(['r1', 'r2']), text: '', textBy: null, sig: '' };
ok('results mode: the table holds only the results', names(g.F()) === 'r1,r2');
vals.nuts2Filter = 'Norte';
ok('changing a filter filters within the results, no reads', names(g.F()) === 'r1');
ok('the general Export / Add to campaign after Load all ignore the results', names(g.F({ ignoreResults: true })) === 'r1,x1');
vals.nuts2Filter = '';
g.dbResults = { ids: new Set(['r1']), text: 'geral@alfa.pt', textBy: 'server', sig: '' }; vals.searchInput = 'geral@alfa.pt';
ok('text the database matched (an email) is not matched again by name', names(g.F()) === 'r1');
vals.searchInput = 'beta';
ok('typing other text filters within the results by name', names(g.F()) === '');
g.dbResults = { ids: new Set(['r1', 'r2']), text: 'metal alfa', textBy: 'tokens', tokens: ['metal', 'alfa'], sig: '' }; vals.searchInput = 'metal alfa';
ok('a name that fell back to a filter is matched by its words', names(g.F()) === 'r1');
g.ON.delete('search.serverFilters'); vals.searchInput = '';
ok('switch Off: results are ignored even if set', names(g.F()) === 'r1,r2,x1');

// ── wiring ──
ok('only 🔍 reaches the database when the switch is On; Enter only when Off',
  page.includes("document.getElementById('nifSearchBtn').addEventListener('click', () => { if (isOn('search.serverFilters')) runDatabaseSearch(); else triggerCompanySearch(); });")
  && page.includes("if (e.key === 'Enter' && !isOn('search.serverFilters')) triggerCompanySearch();"));
ok('the results bar: label, Export results, ✕ Back to list (no "keep")', page.includes('id="dbResultsBar"') && page.includes('>⬇ Export results</button>') && page.includes('>✕ Back to list</button>') && page.includes("addEventListener('click', leaveDbResults)"));
ok('found companies stay loaded after Back to list (the live window keeps them)', page.includes('if (!res.local) ids.forEach(id => keepInView.add(id));') && grab('function leaveDbResults(').includes('dbResults = null'));
ok('scope hint next to the count, and "Filters changed · 🔍 to refresh"', page.includes('🔍 searches the whole database`') && page.includes("' · Filters changed · 🔍 to refresh'"));
ok('Pipeline Overview counts the results (D9)', page.includes('const pool = dbr ? getFiltered() : companies;') && page.includes('`Database results: ${dbr.label}'));
ok('Add to campaign: the results on show, else the database search, else Load all as before', page.includes('if (dbResults && serverFilterSig() === dbResults.sig) { viaDb = dbResults;') && page.includes('const r = await runDatabaseSearch();') && page.includes('ids = getFiltered({ ignoreResults: !viaDb }).map(c => c.id);'));
ok('Export results without Load all; general Export unchanged', page.includes('if (!resultsOnly) await loadCompaniesWithProgress(onProgress);') && page.includes("{ resultsOnly: exportResultsOnly && !!activeDbResults() }") && page.includes("document.getElementById('exportBtn').addEventListener('click', () => { exportResultsOnly = false; openExportFields(); });"));
ok('filter lists include the whole base\'s values only with the switch On', page.includes("const base = isOn('search.serverFilters') ? BASE_FILTER_VALUES : {};") && /nuts3: \[[^\]]*"PT11A - Area Metropolitana do Porto"/.test(page));
ok('everything loaded: 🔍 uses what is loaded (0 reads), except people emails and phones', page.includes('if (fullyLoaded && !needsPeople) {'));
ok('the old name / NIF / phone look-ups are still there for the switch Off', page.includes('async function searchNameSupplement(text){') && page.includes('function triggerCompanySearch(){'));
ok('release switch in the catalog and the portal', catalog.includes('"search.serverFilters"') && feats.includes("'search.serverFilters'"));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); } else console.log('\nAll passed');
