// Ownership tab (9 Nov 2026): a company with people but no shareholder on file says so, and says why for an SA;
// nothing changes for a company that has a shareholder, a note from Orbis or treasury shares.
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const search = read('../../portal/search.html');
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

// the two conditions, lifted from the page and run on sample data
const m1 = /const noHolders = (.*);\n/.exec(search), m2 = /const noHoldersSA = (.*);\n/.exec(search);
ok('the page defines the two conditions', !!m1 && !!m2);
const legalFormOf = (co) => co.nationalLegalForm || co.legalForm || '';
const run = (own, links, c) => new Function('own', 'links', 'c', 'legalFormOf', `const noHolders = ${m1[1]}; const noHoldersSA = ${m2[1]}; return { noHolders, noHoldersSA };`)(own, links, c, legalFormOf);
const mgr = { shCurrent: undefined, mgmtCurrent: true };
const holder = { shCurrent: true, shDirectPct: 50 };
ok('people but no shareholder, no Orbis note: the note shows', run({ note: '', treasuryPct: null }, [mgr], { name: 'ACME, LDA' }).noHolders === true);
ok('no people at all: no note (the card already says there is nobody)', run({ note: '', treasuryPct: null }, [], { name: 'ACME, LDA' }).noHolders === false);
ok('a current shareholder with a percentage: no note', run({ note: '', treasuryPct: null }, [mgr, holder], { name: 'ACME, LDA' }).noHolders === false);
ok('an Orbis note or treasury shares: the existing line is used, no second note', run({ note: 'Independent company', treasuryPct: null }, [mgr], { name: 'X' }).noHolders === false && run({ note: '', treasuryPct: 3 }, [mgr], { name: 'X' }).noHolders === false);
ok('a previous shareholder only does not count as one', run({ note: '', treasuryPct: null }, [{ shCurrent: false, shDirectPct: 60 }], { name: 'X' }).noHolders === true);
ok('SA is recognised by the legal form or by the name', run({}, [mgr], { name: 'FLAMA - FABRICA, S.A.' }).noHoldersSA === true && run({}, [mgr], { name: 'X', nationalLegalForm: 'Public limited company - SA' }).noHoldersSA === true && run({}, [mgr], { name: 'ACME, LDA' }).noHoldersSA === false);
ok('the note is the only new element and has the wording', search.includes('ℹ️ No shareholders on file${noHoldersSA ? \' (the shareholders of a public limited company (SA) are not public)\' : \'\'}'));
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
