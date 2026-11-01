// WP8 + WP9: the per-team build, the deploy guard and the new-team setup.
//  - Douro's committed portal files are exactly what the build produces
//  - a second team's staged portal carries its own identity and Firebase config
//  - an alias, its project and .firebaserc must agree before anything can deploy
//  - new-team creates valid files and refuses to overwrite
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const root = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const B = require(join(root, 'scripts/lib/instance-build.cjs'));
const N = require(join(root, 'scripts/lib/new-team.cjs'));
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
const lf = (t) => t.split('\r\n').join('\n');
const read = (p) => lf(readFileSync(join(root, p), 'utf8'));

// ── Douro builds to what is committed ──
const douro = B.loadInstance('douro', root);
ok('Douro: portal/instance-config.js is exactly what the build produces', read('portal/instance-config.js') === lf(B.renderInstanceConfig(douro.cfg)));
ok('Douro: portal/firebase-config.js is exactly what the build produces', read('portal/firebase-config.js') === lf(B.renderFirebaseConfig(read('portal/firebase-config.js'), douro.web)));
ok('Douro: the alias, project and .firebaserc agree and the settings validate', B.checkAlias('douro', root).length === 0);
const cli = spawnSync(process.execPath, [join(root, 'scripts/build-instance.cjs'), 'douro', '--check'], { encoding: 'utf8' });
ok('Douro: build-instance --check passes', cli.status === 0);
const plan = spawnSync(process.execPath, [join(root, 'scripts/deploy.cjs'), 'douro', '--only', 'rules'], { encoding: 'utf8' });
ok('deploy without --go only prints the plan, with the project from the instance file', plan.status === 0 && /--project douro-partners --only firestore:rules,storage/.test(plan.stdout) && /Plan only/.test(plan.stdout));
const wrong = spawnSync(process.execPath, [join(root, 'scripts/deploy.cjs'), 'douro', '--only', 'rules', '--go', '--project', 'someone-else'], { encoding: 'utf8' });
ok('deploy --go with the wrong project id is refused before any check or deploy runs', wrong.status !== 0 && /Refusing/.test(wrong.stderr) && !/^> /m.test(wrong.stdout));
const host = spawnSync(process.execPath, [join(root, 'scripts/deploy.cjs'), 'douro', '--only', 'hosting'], { encoding: 'utf8' });
ok('hosting is not deployable from this script', host.status !== 0);

// ── A second team, in a scratch copy of the repo ──
const tmp = mkdtempSync(join(tmpdir(), 'newteam_'));
mkdirSync(join(tmp, 'instances'), { recursive: true });
cpSync(join(root, 'portal'), join(tmp, 'portal'), { recursive: true });
writeFileSync(join(tmp, '.firebaserc'), JSON.stringify({ projects: { default: 'douro-partners', douro: 'douro-partners' } }));
const answers = {
  alias: 'pilot', orgName: 'Example Fund', projectId: 'example-pilot', productionHost: 'portal.example.test', relationshipDomain: 'example.test', senderDomain: 'mail.example.test',
  people: [{ name: 'Ana Admin', email: 'ana@example.test' }, { name: 'Bo Partner', email: 'bo@example.test' }], testRecipients: 'ana@example.test, tester@example.test',
  web: { apiKey: 'KEY', messagingSenderId: '1', appId: '1:1:web:1' },
};
const made = N.createInstanceFiles(answers, tmp);
ok('new-team: files created and the alias passes every check', made.problems.length === 0 && existsSync(join(tmp, 'instances/pilot/instance.json')));
ok('new-team: .firebaserc maps the alias to their project and keeps Douro\'s', JSON.parse(readFileSync(join(tmp, '.firebaserc'), 'utf8')).projects.pilot === 'example-pilot' && JSON.parse(readFileSync(join(tmp, '.firebaserc'), 'utf8')).projects.douro === 'douro-partners');
ok('new-team: refuses to overwrite, and refuses the Douro alias', (() => { try { N.createInstanceFiles(answers, tmp); return false; } catch (e) { return /already exists/.test(e.message); } })() && (() => { try { N.createInstanceFiles({ ...answers, alias: 'douro' }, tmp); return false; } catch (e) { return /taken/.test(e.message); } })());
ok('new-team: the first person is the admin; the sender seeds start paused; test mode has only the approved addresses', made.cfg.settings.adminEmails.join() === 'ana@example.test' && made.cfg.settings.outreach.seedSenders.every((s) => s.status === 'paused') && made.cfg.settings.outreach.testRecipients.length === 2);
const staged = B.stagePortal('pilot', join(tmp, 'build/pilot/portal'), tmp);
const inst = readFileSync(join(staged, 'instance-config.js'), 'utf8'), fb = readFileSync(join(staged, 'firebase-config.js'), 'utf8');
ok('staged portal: their identity, their Firebase project, none of Douro\'s', /Example Fund/.test(inst) && /portal\.example\.test/.test(inst) && /noreplyEmail: 'noreply@example\.test'/.test(inst) && /"example-pilot"/.test(fb) && !/douro/i.test(inst + fb));
ok('staged portal: everything else is the same page code', readFileSync(join(staged, 'login.html'), 'utf8') === readFileSync(join(root, 'portal/login.html'), 'utf8'));
const half = N.createInstanceFiles({ ...answers, alias: 'half', projectId: 'half-pilot', web: undefined }, tmp);
ok('an alias without its Firebase web config is not ready to deploy', half.problems.some((p) => /apiKey/.test(p)));
const odd = N.createInstanceFiles({ ...answers, alias: 'odd', projectId: 'Bad ID; rm' }, tmp);
ok('a project id that is not a Firebase project id is not ready (it ends up in a shell command)', odd.problems.some((p) => /projectId/.test(p)));
writeFileSync(join(tmp, '.firebaserc'), JSON.stringify({ projects: { default: 'douro-partners', douro: 'douro-partners' } }));
ok('an alias that .firebaserc does not map to the same project is not ready', B.checkAlias('pilot', tmp).some((p) => /\.firebaserc/.test(p)));
ok('the checklist names their project, domains and every manual step', (() => { const c = N.checklist('pilot', made.cfg).join('\n'); return /example-pilot/.test(c) && /mail\.example\.test/.test(c) && /Blaze/.test(c) && /RESEND_SEND_KEY/.test(c) && /seed-instance/.test(c) && /deploy\.cjs/.test(c); })());

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
