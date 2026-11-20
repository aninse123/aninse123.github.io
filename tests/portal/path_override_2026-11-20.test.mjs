// 20 Nov 2026 (switch outreach.pathOverride): Change… in the Path column of a company that has not started, the "set by hand" tag with
// who and why, and the line on the company page's campaign card. canChangePath and handTag are run from the page's source text.
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const search = fs.readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8');
const feats = fs.readFileSync(new URL('../../portal/features.js', import.meta.url), 'utf8');
let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); };
const NL = String.fromCharCode(10);
const lines = html.split(NL);
const canLine = lines.find(l => l.startsWith('    const canChangePath = '));
const i = lines.findIndex(l => l.startsWith('    function handTag(e) {'));
const tagFn = lines.slice(i, i + 4).join(NL);
ok('canChangePath and handTag are found', !!canLine && tagFn.endsWith('    }'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const hasPaths = (c) => (c.paths || []).length > 1;
const make = (on) => new Function('isOn', 'hasPaths', 'esc', 'localPart', canLine + NL + tagFn + NL + 'return { canChangePath, handTag };')((k) => on.includes(k), hasPaths, esc, (e) => String(e || '').split('@')[0]);
const { canChangePath, handTag } = make(['outreach.pathOverride', 'outreach.paths']);
const off = make(['outreach.paths']);
const camp = { status: 'active', paths: [{ id: 'hi' }, { id: 'main' }] };
const waiting = { id: 'k_co1', companyId: 'co1', status: 'pending', currentStep: 0 };

ok('a company not started, in a campaign with paths: Change… shown', canChangePath(camp, waiting) === true);
ok('started (active / email 1 sent): not shown', !canChangePath(camp, { ...waiting, status: 'active' }) && !canChangePath(camp, { ...waiting, threadId: 't1' }));
ok('an extra address row: not shown', !canChangePath(camp, { ...waiting, trackOf: 'k_co1' }));
ok('one path only: not shown', !canChangePath({ ...camp, paths: [{ id: 'main' }] }, waiting));
ok('a finished campaign: not shown', !canChangePath({ ...camp, status: 'finished' }, waiting));
ok('switch off: not shown', !off.canChangePath(camp, waiting));
const tag = handTag({ pathOverride: { pathId: 'hi', reason: 'o dono é cliente', by: 'andre.rocha@douropartners.pt', from: 'Everyone else' } });
ok('"set by hand" with who and why on hover', tag.includes('>set by hand</span>') && tag.includes('Set by hand by andre.rocha: o dono é cliente (the filters chose Everyone else)'));
ok('no override: no tag; switch off: no tag', handTag({}) === '' && off.handTag({ pathOverride: { pathId: 'hi' } }) === '');
ok('the Path column carries the tag and the button', html.includes('${esc(pathTxt)}${left ? \'\' : handTag(root)}${canChangePath(c, root) ?') && html.includes('data-eop="path"'));
ok('the click opens the dialog and saves through setPath with a reason', html.includes("if (op === 'path') { openChangePath(e); return; }") && html.includes("action: 'setPath', enrolmentId: e.id, pathId: $('cpPath').value, reason"));
ok('the dialog refuses a reason under 3 characters and allows "Back to the filters"', html.includes("if (reason.length < 3) { modalError('Write why (at least 3 characters).'); return false; }") && html.includes('<option value="auto">Back to the filters</option>'));
ok('the company page campaign card says set by hand, by whom and why', search.includes("const po = e.pathOverride && isOn('outreach.pathOverride')") && search.includes('<span class="badge badge-blue">set by hand</span> by'));
ok('the switch is in the portal list', feats.includes("['outreach.pathOverride', 'Outreach', 'release', 'Change a company" + String.fromCharCode(92) + "'s path by hand'"));

console.log(fail ? `${NL}${fail} FAILED` : `${NL}All passed`);
process.exit(fail ? 1 : 0);
