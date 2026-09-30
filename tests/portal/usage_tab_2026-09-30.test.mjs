// Usage tab (30 Sep): browser counters say who and which site; the Team page
// has a Usage tab (partners); the menu shows an alert strip past 80% of a free
// limit or when a sending address nears its cap; the rules keep usage
// partner-only and server-written.
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const cfg = read('portal/firebase-config.js'), team = read('portal/team.html'), nav = read('portal/nav.js'), rules = read('firestore.rules');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

ok('reads: shared counter also by person and by site', /count: increment\(n\), byUser: \{ \[usageWhoNow\(\)\]: increment\(n\) \}, bySite: \{ \[USAGE_SITE\]: increment\(n\) \}/.test(cfg));
ok('writes / deletes: by person and by site', /payload\.byUserW = \{ \[who\]: increment\(w\) \}; payload\.bySiteW = \{ \[USAGE_SITE\]: increment\(w\) \}/.test(cfg) && /payload\.byUserD = \{ \[who\]: increment\(d\) \}; payload\.bySiteD/.test(cfg));
ok('site: douropartners.pt (and www) = production, anything else = staging', /\['douropartners\.pt', 'www\.douropartners\.pt'\]\.includes\(String\(location\.hostname\)\.toLowerCase\(\)\)\) \? 'production' : 'staging'/.test(cfg));
ok('person: the team short name from the sign-in token, else the email\'s start', /usageWho = usageKey\(r\.claims\.key \|\| local\)/.test(cfg));

ok('Team page: a Usage tab (Admin: usage.view) that loads on open (and via #usage / #usage-db / #usage-email / #usage-activity)', /data-view="usage" data-perm="usage\.view">Usage<\/button>/.test(team) && /if \(b\.dataset\.view === 'usage'\) renderUsage\(\);/.test(team) && /location\.hash\.match\(\/\^#usage\(\?:-\(db\|email\|activity\)\)\?\$\/\)/.test(team));
ok('Usage: three views — Database, Emails, Activity — each loading only what it shows', /const USAGE_VIEWS = \[\['db', 'Database'\], \['email', 'Emails'\], \['activity', 'Activity'\]\];/.test(team) && /if \(view === 'db' && !c\.db\)/.test(team) && /if \(\(view === 'email' \|\| view === 'activity'\) && !c\.daily\)/.test(team) && /if \(view === 'email' && !c\.extra\)/.test(team));
ok('Alert strip links to the right view (database alerts → Database, senders → Emails)', /team\.html#usage-\$\{dbAlert \? 'db' : 'email'\}/.test(nav));
ok('Backfill: older days without exact figures are fetched once per session (up to 42 days back)', /const BACKFILL_DAYS = 42;/.test(team) && /function needsBackfill\(D\)/.test(team) && /usageCall\(\{ action: 'refresh', backfill: true \}\)/.test(team) && /sessionStorage\.setItem\('usageBackfilled', '1'\)/.test(team));
ok('Days Google has no data for fall back to the estimate', /!D\.exact\[d\]\.noData/.test(team));
ok('"Days over the free reads" says how many are exact and how many from estimates', /\$\{overExact\} exact\$\{overEst \? ` · \$\{overEst\} from estimates` : ''\}/.test(team));
ok('Usage: exact figures first, browser estimates as fallback', /const best = \(d, m\) => \(ex\(d\) \? ex\(d\)\[m\] : est\(d\)\[m\]\);/.test(team));
ok('Usage: the missing-permission note names the service account and the role', /20074053140-compute@developer\.gserviceaccount\.com/.test(team) && /Monitoring Viewer/.test(team));
ok('Usage: server refresh at most every 10 minutes unless Refresh is clicked', /Date\.now\(\) - last < 10 \* 60000/.test(team) && /renderUsage\(true\)/.test(team));
ok('Usage: sections for database, per person, emails, addresses, emails per person, activity', ['Database per day', 'Per person per day', 'Emails per day', 'Sending addresses', 'Emails per person', 'Activity per person', 'Activity per day'].every((h) => team.includes(`<h2>${h}</h2>`)));

ok('Alerts: the Admin only (by email, or the usage permission)', /if \(!isAdmin && !perms\.includes\('usage\.view'\)\) return;/.test(nav));
ok('Alerts: 80% of each free limit, and senders near their cap', /r >= 0\.8 \* FREE_TIER_DAILY_READS/.test(nav) && /w >= 0\.8 \* FREE_TIER_DAILY_WRITES/.test(nav) && /d >= 0\.8 \* FREE_TIER_DAILY_DELETES/.test(nav) && /usageSenders\.forEach/.test(nav));

ok('rules: usage records are Admin-only (only the Admin\'s catch-all reaches them; no other rule grants them)', ['usageDaily', 'usageFirestore', 'usageMonthly', 'usageAlerts'].every((c) => !new RegExp(`match /${c}/`).test(rules)) && /match \/\{document=\*\*\} \{\s*allow read, write: if isOwner\(\);/.test(rules));

ok('Account menu: only the email and Sign out; no quota ring on the avatar (usage lives in Team → Usage)', !/navReads|navWrites|navDeletes|navCost|conic-gradient/.test(nav) && /<span class="nav__email" id="navEmail"><\/span>\s*<button class="nav__signout"/.test(nav) && /export function refreshReads\(\) \{ renderUsageAlert\(\); \}/.test(nav));
console.log(fail ? `\n${fail} FAILED` : '\nall usage tab tests passed'); process.exit(fail ? 1 : 0);
