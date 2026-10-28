// "Send approved emails all at once" on the pages (28 Oct 2026, switch outreach.sendAllNow).
import { readFileSync } from 'node:fs';
const out = readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const feat = readFileSync(new URL('../../portal/features.js', import.meta.url), 'utf8'), cat = readFileSync(new URL('../../functions/features/catalog.js', import.meta.url), 'utf8');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
ok('switch outreach.sendAllNow in both catalogs', feat.includes("['outreach.sendAllNow', 'Outreach', 'release'") && cat.includes('key: "outreach.sendAllNow"'));
ok('campaign Settings: the tick (behind the switch), saved with the settings', out.includes('id="csSendAll"') && out.includes("...($('csSendAll') ? { sendAllAtOnce: $('csSendAll').checked } : {}),"));
ok('campaign header: "⚡ Send approved now" for an active campaign with the tick (approvers only), asks first, calls sendNow', out.includes("acts.unshift(['sendnow', '⚡ Send approved now', 'primary'])") && out.includes("'runnow', 'sendnow'].includes(a) ? 'out.approve'") && out.includes("action: 'sendNow', campaignId: c.id"));
ok('Cc on every email: switch in both catalogs, the Settings box (behind the switch), saved, shown on the draft card', feat.includes("['outreach.campaignCc', 'Outreach', 'release'") && cat.includes('key: "outreach.campaignCc"') && out.includes('id="csCc"') && out.includes("...($('csCc') ? { cc:") && out.includes("const ccTxt = (d.cc || []).length ? ` · Cc: ${esc(d.cc.join(', '))}` : '';"));
if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
