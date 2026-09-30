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

ok('Team page: a Usage tab that loads on open (and via #usage)', /data-view="usage">Usage<\/button>/.test(team) && /if \(b\.dataset\.view === 'usage'\) renderUsage\(\);/.test(team) && /location\.hash === '#usage'/.test(team));
ok('Usage: exact figures first, browser estimates as fallback', /const best = \(d, m\) => \(ex\(d\) \? ex\(d\)\[m\] : est\(d\)\[m\]\);/.test(team));
ok('Usage: the missing-permission note names the service account and the role', /20074053140-compute@developer\.gserviceaccount\.com/.test(team) && /Monitoring Viewer/.test(team));
ok('Usage: server refresh at most every 10 minutes unless Refresh is clicked', /Date\.now\(\) - last < 10 \* 60000/.test(team) && /renderUsage\(true\)/.test(team));
ok('Usage: sections for database, per person, emails, addresses, emails per person, activity', ['Database per day', 'Per person per day', 'Emails per day', 'Sending addresses', 'Emails per person', 'Activity per person'].every((h) => team.includes(`<h2>${h}</h2>`)));

ok('Alerts: only for people who manage access (partners for now)', /if \(!perms\.includes\('access\.manage'\)\) return;/.test(nav));
ok('Alerts: 80% of each free limit, and senders near their cap', /r >= 0\.8 \* FREE_TIER_DAILY_READS/.test(nav) && /w >= 0\.8 \* FREE_TIER_DAILY_WRITES/.test(nav) && /d >= 0\.8 \* FREE_TIER_DAILY_DELETES/.test(nav) && /usageSenders\.forEach/.test(nav));

for (const c of ['usageDaily', 'usageFirestore', 'usageMonthly', 'usageAlerts']) {
  ok(`rules: ${c} readable by partners only, written by the server`, new RegExp(`match /${c}/\\{[a-z]+\\} \\{ allow read: if can\\('access\\.manage'\\); \\}`).test(rules));
}

console.log(fail ? `\n${fail} FAILED` : '\nall usage tab tests passed'); process.exit(fail ? 1 : 0);
