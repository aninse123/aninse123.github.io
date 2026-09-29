// Round 2 test feedback (29 Sep): F1 the sign-in refusal is shown on the form,
// B3 creating a company doesn't load the whole database, B5 everyone sees the
// tier (only "flags" changes it), F5 every text-like box is styled.
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../../portal/' + p, import.meta.url), 'utf8');
const login = read('login.html'), search = read('search.html');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

const catchBlock = login.slice(login.indexOf('signInWithEmailLink(auth, email'), login.indexOf('// SHA-256'));
ok('F1: a refused sign-in link shows its message on the form (errorMsg, after showForm)', /showForm\(\);\s*const msg = document\.getElementById\('errorMsg'\);\s*msg\.textContent\s*= signInError\(err\);\s*msg\.style\.display = 'block';/.test(catchBlock) && !/processMsg/.test(catchBlock));

const create = search.slice(search.indexOf("await logAuto(ref.id, 'company_created'"), search.indexOf('cacheCompanies();', search.indexOf("await logAuto(ref.id, 'company_created'")));
ok('B3: creating a company keeps it in view instead of loading every company', /keepInView\.add\(ref\.id\)/.test(create) && !/loadCompaniesWithProgress/.test(create));
ok('B3: the live list keeps companies created in this tab', /const kept = companies\.filter\(c => keepInView\.has\(c\.id\)\);/.test(search) && /kept\.forEach\(c => \{ if \(!inWindow\.has\(c\.id\)\) companies\.push\(c\); \}\);/.test(search));

ok('B5: the tier selector is shown to everyone (no permission tag) and disabled without "flags"', /<select class="btn btn--action" id="tierSel" title=/.test(search) && /tSel\.disabled = !canFlag;/.test(search));
ok('B5: bulk "Set tier…" still needs "flags"', /id="selBarTier" data-perm="search\.flags"/.test(search));

const styled = (page, re) => re.test(read(page));
ok('F5: Team styles phone / number / time boxes', styled('team.html', /\.field input\[type=tel\], \.field input\[type=number\]/));
ok('F5: Outreach styles date / time / phone / number boxes', styled('outreach.html', /input\[type="tel"\], input\[type="number"\], input\[type="url"\], input\[type="date"\], input\[type="time"\], select, textarea \{/));
ok('F5: Admin has a fallback style for any text-like box', styled('admin.html', /:where\(input\[type="text"\], input\[type="email"\], input\[type="tel"\]/));
ok('F5: the "View the portal as" picker is styled', styled('investor.html', /id="viewAsSel" style="[^"]*border-radius:6px/));

console.log(fail ? `\n${fail} FAILED` : '\nall round 2 fix tests passed'); process.exit(fail ? 1 : 0);
