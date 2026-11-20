// 20 Nov 2026 (switch outreach.inboxTurns): Inbox filters say whose turn it is — Needs our reply (the company wrote last), Waiting for
// company (the company replied at some point and we wrote last), Company replied (every conversation it replied in). The filter lines
// are lifted from the page's source and run on synthetic conversations.
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const feats = fs.readFileSync(new URL('../../portal/features.js', import.meta.url), 'utf8');
let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); };

const cr = html.match(/    const companyReplied = [^\n]*\n/);
const all = html.split(String.fromCharCode(10));
const lines = ['replied', 'theirs', 'needs'].map(k => all.find(l => l.startsWith(`        if (stateFilter === '${k}' `)));
ok('the lines are found', !!cr && lines.every(Boolean));
const make = (turns) => (stateFilter, t) => new Function('stateFilter', 't', 'turns', cr[0] + lines.join('\n') + '\nreturn true;')(stateFilter, t, turns);
const on = make(true), off = make(false);

const ours = { status: 'replied', lastDirection: 'in', repliedAt: 1 };             // they wrote last
const theirs = { status: 'waiting', lastDirection: 'out', repliedAt: 1 };          // they replied, we answered
const cold = { status: 'open', lastDirection: 'out', repliedAt: null };            // only our emails
const auto = { status: 'open', lastDirection: 'in', lastInboundAuto: true, repliedAt: null }; // an out-of-office only
const closed = { status: 'closed', lastDirection: 'out', repliedAt: 1 };

ok('Needs our reply: the company wrote last', on('needs', ours) && !on('needs', theirs) && !on('needs', cold));
ok('Waiting for company: they replied and we wrote last', on('theirs', theirs) && !on('theirs', ours) && !on('theirs', cold));
ok('…an auto-reply alone is not a reply', !on('theirs', { ...auto, lastDirection: 'out' }) && !on('replied', auto));
ok('…closed conversations are not waiting', !on('theirs', closed));
ok('Company replied: also after we answered', on('replied', ours) && on('replied', theirs) && !on('replied', cold) && !on('replied', closed));
ok('switch off: Replied is as before (status replied only)', off('replied', ours) && !off('replied', theirs));
ok('the chips carry André\'s names', html.includes("['needs', 'Needs our reply'], ['theirs', 'Waiting for company'], ['replied', 'Company replied']"));
ok('the old chips stay with the switch off', html.includes("['needs', 'Needs reply'], ['replied', 'Replied']"));
ok('a remembered filter that no longer exists falls back to All', html.includes("if (!states.some(([k]) => k === stateFilter)) stateFilter = 'all';"));
ok('the switch is in the portal list', feats.includes("['outreach.inboxTurns', 'Outreach', 'release', 'Inbox: whose turn it is'"));

console.log(fail ? `\n${fail} FAILED` : '\nAll passed');
process.exit(fail ? 1 : 0);
