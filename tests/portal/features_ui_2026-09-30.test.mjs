// Round 4 feedback (30 Sep): testers are picked from the team in a panel (B3),
// every kill switch explains what happens while Off and when back On (E1),
// and only the chosen Off / Test / On button is highlighted.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { FEATURES } = require('../../functions/features/catalog.js');
const team = readFileSync(new URL('../../portal/team.html', import.meta.url), 'utf8');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

const kills = FEATURES.filter((f) => f.kind === 'kill').map((f) => f.key);
const help = team.slice(team.indexOf('const KILL_HELP = {'), team.indexOf('};', team.indexOf('const KILL_HELP = {')));
ok(`E1: every kill switch (${kills.length}) has a "While Off / Back On" explanation`, kills.every((k) => help.includes(`'${k}': 'While Off:`) && help.includes('Back On')));
ok('E1: the explanation is shown under the kill switch rows', /KILL_HELP\[f\.key\] \? `<div class="feat-desc feat-kill">/.test(team));
ok('E1: the hint says kill switches don\'t pause campaigns', /they don't pause campaigns, and turning one back On needs nothing else/.test(team));

ok('B3: Testers opens a panel (no browser pop-up)', /data-testers\]'\)\.forEach\(\(b\) => b\.addEventListener\('click', \(\) => openTesters\(b\.dataset\.testers\)\)\)/.test(team) && !/prompt\('Extra testers/.test(team));
ok('B3: the panel lists the team with tick boxes; partners / permission holders ticked and locked', /function openTesters\(key\)/.test(team) && /data-tester="\$\{esc\(p\.id\)\}"\$\{always \|\| cur\.has\(p\.id\) \? ' checked' : ''\}\$\{always \? ' disabled' : ''\}/.test(team));
ok('B3: people outside the team can be added by email; saved through setTesters', /id="tOthers"/.test(team) && /featureCall\(\{ action: 'setTesters', key, testers: \[\.\.\.new Set\(\[\.\.\.picked, \.\.\.extra\]\)\] \}\)/.test(team));
ok('B3: the button names the testers', /\$\{esc\(testerLabel\(x\.testers \|\| \[\]\)\)\}/.test(team));

ok('Only the chosen state is highlighted ("sel", not "on")', /class="\$\{s\}\$\{st === s \? ' sel' : ''\}"/.test(team) && /\.seg button\.sel\.on \{/.test(team) && !/\.seg button\.on\.on/.test(team));

console.log(fail ? `\n${fail} FAILED` : '\nall features UI tests passed'); process.exit(fail ? 1 : 0);
