// "Who changed a record": firebase-config.js stampEdit() adds updatedBy /
// updatedByAt to real edits of companies, investors and Network contacts /
// firms — not to housekeeping writes (last-touch, follow-ups, derived sector,
// people counts, campaign badges) and not to other collections.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const src = readFileSync(new URL('../../portal/firebase-config.js', import.meta.url), 'utf8');
const start = src.indexOf('const STAMPED =');
const end = src.indexOf('export async function addDoc');
if (start < 0 || end < 0) throw new Error('stampEdit not found');
const ctx = { auth: { currentUser: { email: 'Maria@DouroPartners.pt' } }, _serverTimestamp: () => 'TS' };
vm.createContext(ctx);
vm.runInContext(src.slice(start, end).replace('export function stampEdit', 'function stampEdit') + '\nglobalThis.stampEdit = stampEdit;', ctx);
const { stampEdit } = ctx;
const ref = (path) => ({ path });

let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
const e1 = stampEdit(ref('searchCompanies/c1'), { name: 'X', updatedAt: 'now' });
ok('company edit: stamped with the signed-in email (lower-case) and a time', e1.updatedBy === 'maria@douropartners.pt' && e1.updatedByAt === 'TS' && e1.name === 'X');
ok('investor and Network edits are stamped too', !!stampEdit(ref('crmInvestors/i1'), { stage: 'engaged' }).updatedBy && !!stampEdit(ref('networkContacts/n1'), { role: 'x' }).updatedBy && !!stampEdit(ref('networkFirms/f1'), { name: 'y' }).updatedBy);
ok('housekeeping only (last touch, follow-up, people counts, sector backfill) is not an edit', !stampEdit(ref('searchCompanies/c1'), { lastTouchAt: 1, updatedAt: 2 }).updatedBy && !stampEdit(ref('crmInvestors/i1'), { nextContactAt: 1, hasOverdue: false }).updatedBy && !stampEdit(ref('searchCompanies/c1'), { peopleCounts: {} }).updatedBy && !stampEdit(ref('searchCompanies/c1'), { sector: 'a', subSector: 'b' }).updatedBy);
ok('other collections are left alone', !stampEdit(ref('outreachThreads/t1'), { unread: false }).updatedBy && !stampEdit(ref('searchActivities/a1'), { title: 'x' }).updatedBy);
ctx.auth.currentUser = null;
ok('nobody signed in: nothing added', !stampEdit(ref('searchCompanies/c1'), { name: 'X' }).updatedBy);
console.log(fail ? `\n${fail} FAILED` : '\nall stamp tests passed'); process.exit(fail ? 1 : 0);
