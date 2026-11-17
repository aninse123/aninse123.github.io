// 17 Nov 2026: "Try another address…" (switch outreach.bounceRetry) on a company whose email bounced and that has nothing left
// running in the campaign. canRetryAddress is run from the page's own source text. Synthetic data only.
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const feats = fs.readFileSync(new URL('../../portal/features.js', import.meta.url), 'utf8');
let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); };

const re = html.match(/const BOUNCED_RE = [^\n]*\n/);
const fn = html.match(/function canRetryAddress\(c, g\) \{[\s\S]*?\n    \}\n/);
ok('canRetryAddress found in the page', !!re && !!fn);
const LIVE_ENROL = ['pending', 'active', 'awaiting_approval', 'awaiting_task', 'paused'];
const make = (on) => new Function('isOn', 'LIVE_ENROL', re[0] + fn[0] + '; return canRetryAddress;')((k) => on.includes(k), LIVE_ENROL);
const ALL = ['outreach.bounceRetry', 'outreach.multiRecipient', 'contacts.trustLabels'];
const can = make(ALL), off = make(['outreach.multiRecipient', 'contacts.trustLabels']);
const camp = { status: 'active', audienceType: 'companies' };
const bounced = { id: 'en1', companyId: 'co1', status: 'stopped', stopReason: 'Email bounced' };

ok('a company stopped by a bounce, nothing running: shown', can(camp, [bounced]) === true);
ok('switch off: not shown', off(camp, [bounced]) === false);
ok('a bounce that already handed over to an address waiting in To approve: not shown', can(camp, [{ ...bounced, stopReason: 'Email bounced; geral@x.pt (company address) waits in To approve' }, { id: 'en1__t1', companyId: 'co1', status: 'active' }]) === false);
ok('a domain with no mail servers counts as a bounce', can(camp, [{ ...bounced, stopReason: "x.pt can't receive email (no mail servers found)." }]) === true);
ok('stopped for another reason: not shown', can(camp, [{ ...bounced, stopReason: 'Stopped by andre' }]) === false);
ok('replied: not shown (Restart company is for that)', can(camp, [{ ...bounced, status: 'replied' }]) === false);
ok('a finished campaign: not shown', can({ ...camp, status: 'finished' }, [bounced]) === false);
ok('a paused campaign: shown', can({ ...camp, status: 'paused' }, [bounced]) === true);
ok('a people campaign: not shown', can({ ...camp, audienceType: 'people' }, [bounced]) === false);

ok('both views carry the button', (html.match(/canRetryAddress\(c, /g) || []).length === 3);
ok('the click opens the picker', html.includes("if (op === 'retry') { openRetryAddress(e); return; }"));
ok('the picker saves through retryAddress, one address', html.includes("action: 'retryAddress', enrolmentId: e.id, email: pick"));
ok('the switch is in the portal list', feats.includes("['outreach.bounceRetry', 'Outreach', 'release', 'Another address after a bounce'"));

console.log(fail ? `\n${fail} FAILED` : '\nAll passed');
process.exit(fail ? 1 : 0);
