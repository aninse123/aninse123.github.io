// People merge, Stage 6 (21 Oct 2026, switch search.people): in the Inbox
// each address of a conversation says who it is (company address, a person and
// their role, or "not in the CRM" with "Add to company"); hard bounces mark the
// address on people's own lists. Wiring checks on the sources.
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const out = read('../../portal/outreach.html'), hook = read('../../functions/outreach/webhook.js');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

ok('switch on + a company: the header shows who each address is', out.includes("if (isOn('search.people') && t.companyId) return addrWho(t);") && out.includes("esc(w || 'not in the CRM')"));
ok('who: the company address, then a person (their emails), then an old contact', out.includes("return 'company address';") && out.includes('(peopleCache.get(t.companyId) || []).find(x => (x.emails || []).includes(a))') && out.includes('`contact: ${ct.name}`'));
ok('"Add to company" only for unknown addresses, with the permission, never on test conversations', out.includes('${ready && !w && canAdd && !t.isTest ?') && out.includes("window.pageAccess.can('search.reach') || window.pageAccess.can('search.editall')"));
ok('the form guesses the person from the From name; "Someone new" adds a contact person', out.includes('const guess = (fromName && people.find(p => key(p.name) === key(fromName))?.personId) ||') && out.includes('Someone new — add a contact person'));
ok('adding: one of the person\'s emails (no duplicate) or a contact person with a contact link', out.includes("throw new Error('It is already one of their emails.')") && out.includes("isContact: true, contactRole: role, contactCurrent: true, source: 'manual'"));
ok('the company finds them by the email, and an activity is logged', out.includes('const add = emailKeysFor([addr]).filter(k => !keys.has(k));') && out.includes('(from the inbox)'));
ok('webhook: a hard bounce and a provider block mark the address on people', hook.includes('await markPeopleBounced(recipient, isTest, "bounced");') && hook.includes('await markPeopleBounced(recipient, isTest, "blocked by the provider");'));
ok('webhook: follows the production switch (Test = test emails only), best effort', hook.includes('const st = await Feat.jobState("search.people");') && hook.includes('if (st === "on" || (st === "test" && isTest)) await store.markReachBounced(email, { why });'));

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
