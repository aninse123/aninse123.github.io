// 20 Nov 2026: Remove takes the whole company (switch outreach.removeCompany). The page sends one Remove per company (the server ends
// every address of it in the campaign); Stop on one address and "Move" send onlyAddress. Synthetic checks on the page's source.
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8');
const search = fs.readFileSync(new URL('../../portal/search.html', import.meta.url), 'utf8');
const feats = fs.readFileSync(new URL('../../portal/features.js', import.meta.url), 'utf8');
let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); };

ok('company Remove: one call when the switch is on', html.includes("op === 'remove' && isOn('outreach.removeCompany') ? liveG.slice(0, 1) : liveG"));
ok('Stop on one address sends onlyAddress', html.includes("...(b.dataset.addr ? { onlyAddress: true } : {})"));
ok('Move ends the other addresses one by one (onlyAddress)', html.includes("op: 'remove', onlyAddress: true, reason: 'Moved with the company'"));
ok('the company history knows "Campaign change" and it is never a touch', search.includes("outreach_campaign: { label:'Campaign change'") && search.includes("'outreach_owner','outreach_group','outreach_campaign']"));
ok('the switch is in the portal list', feats.includes("['outreach.removeCompany', 'Outreach', 'release', 'Remove takes the whole company'"));

console.log(fail ? `\n${fail} FAILED` : '\nAll passed');
process.exit(fail ? 1 : 0);
