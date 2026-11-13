// Claude connector (13 Nov, switch claude.connector): the Claude tab in Team &
// access (Admin only, through the claudeConnect function), its helpers, and the
// sign-in page (email link, Allow / Deny, only Claude's return addresses).
import { readFileSync } from 'node:fs';
import { limitsFromForm, checkSettings, usageGrid, sortConnections } from '../../portal/claude-tab.js';
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const team = read('portal/team.html'), page = read('portal/claude-connect.html'), tab = read('portal/claude-tab.js'), rules = read('firestore.rules');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

// ── Team & access → Claude ──
ok('Team page: a Claude tab for the Admin, behind the switch', /data-view="claude" data-perm="access\.manage" data-feature="claude\.connector">Claude<\/button>/.test(team) && /<section id="v-claude" hidden><\/section>/.test(team));
ok('the tab loads when opened, through claudeConnect', /if \(b\.dataset\.view === 'claude'\) claudeTab\.load\(\);/.test(team) && /httpsCallable\(getFunctions\(auth\.app, 'us-central1'\), 'claudeConnect'/.test(team));
ok('the tab reads nothing from the database directly (claude* collections are closed)', !/collection\(|getDoc|onSnapshot/.test(tab));
ok('four sections: Access, Connections, Settings, Log', /\['access', 'Access'\], \['connections', 'Connections'\], \['settings', 'Settings'\], \['log', 'Log'\]/.test(tab));
ok('Disconnect everyone asks for a second click', /Click again to disconnect everyone/.test(tab));
ok('Usage tab shows the Claude reads next to prod / staging', /r\.bySite\?\.claude \? ` \/ \$\{nf\(r\.bySite\.claude\)\} Claude` : ''/.test(team));
ok('rules: the Admin catch-all stops short of claude* collections', /match \/\{coll\}\/\{document=\*\*\} \{\s*allow read, write: if isOwner\(\) && !coll\.matches\('claude\.\*'\);/.test(rules));

ok('limits form: empty lines and empty cells dropped, numbers kept', JSON.stringify(limitsFromForm([{ key: 'intern', hour: '50', day: '', rows: null }, { key: 'analyst', hour: '', day: '', rows: '' }, { key: '', hour: 5 }])) === '{"intern":{"hour":50}}');
ok('settings check: good values pass', checkSettings({ signInDays: 90, defaults: { hour: 300, day: 3000, rows: 100 }, roles: { intern: { hour: 50 } }, people: {} }).length === 0);
const bad = checkSettings({ signInDays: 400, defaults: { hour: 300, day: 3000, rows: 150 }, roles: { intern: { hour: 0 } }, people: { maria: { day: 2.5 } } });
ok('settings check: says what is wrong (days, rows, hour, day)', bad.length === 4 && /1 to 365/.test(bad[0]) && /rows per answer/.test(bad[1]) && /Role intern/.test(bad[2]) && /maria/.test(bad[3]));
const g = usageGrid([{ day: '2026-11-12', key: 'maria', calls: 3 }, { day: '2026-11-13', key: 'andre', calls: 9 }, { day: '2026-11-13', key: 'maria', calls: 1 }]);
ok('log grid: newest day first, people sorted, cells found', g.days[0] === '2026-11-13' && g.keys.join() === 'andre,maria' && g.cell('2026-11-12', 'maria').calls === 3 && g.cell('2026-11-12', 'andre') === null);
const sc = sortConnections([{ id: 'a', live: false, lastUsedAt: 9 }, { id: 'b', live: true, lastUsedAt: 1 }, { id: 'c', live: true, lastUsedAt: 5 }]);
ok('connections: live first, newest use first', sc.map((c) => c.id).join() === 'c,b,a');

// ── Sign-in page ──
ok('sign-in page: email link back to this page with the same request', /sendSignInLinkToEmail\(auth, email, \{ url: PAGE, handleCodeInApp: true \}\)/.test(page) && /const PAGE = location\.origin \+ location\.pathname \+ '\?r=' \+ encodeURIComponent\(R\);/.test(page));
ok('sign-in page: checks the email is on the team before sending', /if \(!\(await onTeam\(email\)\)\)/.test(page) && /config', 'teamEmailHashes'/.test(page));
ok('sign-in page: Allow and Deny through claudeConnect', /call\(\{ action: 'describe', r: R \}\)/.test(page) && /call\(\{ action, r: R \}\)/.test(page) && /answer\('allow'\)/.test(page) && /answer\('deny'\)/.test(page));
ok('sign-in page: the extra warning for Claude Code (localhost)', /Press Allow only if you just started this from Claude Code on your own computer\./.test(page) && /\$\('askLoopback'\)\.hidden = !data\.loopback;/.test(page));
ok('sign-in page: not indexed by search engines', /<meta name="robots" content="noindex">/.test(page));
const safeSrc = page.match(/const safeReturn = \(u\) => (.+);\r?\n/)[1];
const safeReturn = new Function('u', 'return ' + safeSrc);
ok('only Claude return addresses are followed: claude.ai, claude.com, localhost', safeReturn('https://claude.ai/api/mcp/auth_callback?code=x') && safeReturn('https://claude.com/api/mcp/auth_callback?code=x') && safeReturn('http://localhost:3118/callback?code=x') && safeReturn('http://127.0.0.1/callback?error=access_denied'));
ok('anything else is not followed', !safeReturn('https://evil.example/api/mcp/auth_callback?code=x') && !safeReturn('https://claude.ai.evil.example/api/mcp/auth_callback?x') && !safeReturn('javascript:alert(1)') && !safeReturn('http://localhost.evil.example/callback?x'));
ok('a malformed request id stops the page before anything else', /if \(!\/\^\[A-Za-z0-9_-\]\{20,100\}\$\/\.test\(R\)\) no\(/.test(page));

console.log(fail ? `\n${fail} FAILED` : '\nall Claude tab tests passed');
process.exit(fail ? 1 : 0);
