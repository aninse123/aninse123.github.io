// 20 Nov 2026 (switch outreach.taskRelated): related companies on task cards — one line per related company with its latest contact and
// date ("SOMOBILIS — call answered 13 Nov"), red / amber like a draft in To approve, open when there is a signal, read again when opened.
import fs from 'node:fs';
import { relatedActLine, relatedRisk } from '../../portal/owner-panel.js';
const html = fs.readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const feats = fs.readFileSync(new URL('../../portal/features.js', import.meta.url), 'utf8');
let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); };
const NL = String.fromCharCode(10);
const d = (s) => Date.parse(s + 'T12:00:00Z');

ok('a call answered: "SOMOBILIS — call answered 13 Nov"', relatedActLine({ name: 'SOMOBILIS', why: ['Joaquim Rocha, 60%'], answeredAt: d('2026-11-13'), answeredVia: 'call' }).startsWith('<b>SOMOBILIS</b> — call answered 13 Nov'));
ok('an email sent with no reply, in a campaign', relatedActLine({ name: 'TERMOBRASA', why: [], lastOutreachAt: d('2026-11-10'), campaignName: '2751' }).includes('— emailed 10 Nov, no reply · campaign “2751”'));
ok('a reply newer than the call wins', relatedActLine({ name: 'X', why: [], answeredAt: d('2026-11-01'), answeredVia: 'call', lastReplyAt: d('2026-11-05') }).includes('— replied 5 Nov'));
ok('said no / do not contact are said', relatedActLine({ name: 'Y', why: [], doNotContact: true, saidNo: true }).includes('— not contacted · do not contact · said no'));
ok('why it is related, at the end', relatedActLine({ name: 'Z', why: ['parent 51%'] }).endsWith('(parent 51%)</span>'));
ok('red when one said no; amber in conversation or a follow-up; else plain', relatedRisk([{ kind: 'in_conversation' }, { kind: 'said_no' }]) === 'red' && relatedRisk([{ kind: 'follow_up' }]) === 'amber' && relatedRisk([{ kind: 'group_contacted' }]) === '' && relatedRisk(null) === '');

const i = html.indexOf('    function taskRelatedHtml(t, c) {'), j = html.indexOf(NL + '    }' + NL, i);
const mh = html.split(NL).find(l => l.startsWith('    const mayHaveRelatedCo = '));
const esc = (s) => String(s == null ? '' : s);
const make = (on, fresh = new Map()) => new Function('isOn', 'taskRelatedFresh', 'esc', 'relatedActLine', 'relatedRisk', 'leadText', mh + NL + html.slice(i, j + 6) + NL + 'return taskRelatedHtml;')((k) => on.includes(k), fresh, esc, relatedActLine, relatedRisk, (l) => l.name);
const box = make(['outreach.taskRelated', 'outreach.ownerAware']);
const t = { id: 'tk', companyId: 'otj', related: { related: [{ companyId: 'so', name: 'SOMOBILIS', why: [], answeredAt: d('2026-11-13'), answeredVia: 'call' }], flags: [{ kind: 'in_conversation' }] } };
const h = box(t, {});
ok('amber box, open, with the line and a link to the company', h.includes('owner-box--amber') && h.includes('data-trel open') && h.includes('SOMOBILIS</b> — call answered 13 Nov') && h.includes('search.html?company=so'));
ok('no signal: a plain box, closed', !box({ ...t, related: { related: t.related.related, flags: [] } }, {}).includes(' open'));
ok('no stored list and nothing that could be related: no box', box({ id: 'x', companyId: 'c' }, { ownGraphAt: 1, ownGroupSize: 1 }) === '');
ok('no stored list but the company may have related ones: a closed box to open and check', box({ id: 'x', companyId: 'c' }, { ownGraphAt: 1, ownOwnerOther: 2 }).includes('open to check'));
ok('switch off: nothing', make(['outreach.ownerAware'])(t, {}) === '');
ok('a list read again this session replaces the stored one', make(['outreach.taskRelated', 'outreach.ownerAware'], new Map([['tk', { related: [], flags: [] }]]))(t, {}) === '');
ok('opening the box reads it again (the related lookup)', html.includes("relBox.addEventListener('toggle', () => { if (relBox.open) refreshTaskRelated(t, el); })") && html.includes("callCampaign({ action: 'related', companyId: t.companyId })"));
ok('the box sits on the card, above Contact / Script', html.includes('          ${taskRelatedHtml(t, c)}' + NL + '          <div class="task__grid">'));
ok('the switch is in the portal list', feats.includes("['outreach.taskRelated', 'Outreach', 'release', 'Related companies on task cards'"));

console.log(fail ? `${NL}${fail} FAILED` : `${NL}All passed`);
process.exit(fail ? 1 : 0);
