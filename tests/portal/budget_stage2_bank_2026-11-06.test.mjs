// Budget v2, Stage 2 (6 Nov 2026): the bank file reader in portal/budget-bank.js — Santander "Tabulado" files, duplicates, gaps, recognisers.
// The sample below is made up in the real file's layout (no real names or amounts).
import { parseTabulado, decodeBank, fingerprint, planImport, recognise, cleanDescription, matchPartner, findSupplier, matchCandidates, investorMatch, findInvestor, unlinkedForInvestor } from '../../portal/budget-bank.js';
let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };

const pad = (n) => (n < 0 ? '-' : '+') + String(Math.abs(n).toFixed(2)).replace('.', ',').padStart(22, '0');
const blank = ' '.repeat(21);
const line = (date, value, desc, amount, bal, c2 = '08', c3 = 'YBO', sep = ';') => ['000111111111111', date, value, desc.padEnd(50), '00000000', amount < 0 ? pad(amount) : blank, amount > 0 ? pad(amount) : blank, pad(bal), c2, c3, '000000000000000'].join(sep);
const L = [
  line('02-11-2026', '31-10-2026', 'JUROS ULTRAP. CREDITO', -0.07, 1000.00, '  ', '   '),
  line('02-11-2026', '02-11-2026', 'COMPRA *1234 CAFE EXEMPLO', -4.5, 995.50),
  line('02-11-2026', '02-11-2026', 'COMPRA *1234 CAFE EXEMPLO', -4.5, 991.00),
  line('02-11-2026', '02-11-2026', 'TRF CRED SEPA+ DE FUNDO ALFA F.C.-44100001', 5000, 5991.00, '09', 'UWT'),
  line('03-11-2026', '03-11-2026', 'COMPRA ESTRANG*1234 FLIX', -8.98, 5982.02, '08', 'YAE'),
  line('03-11-2026', '03-11-2026', 'Devolucao Maria-E1', -100, 5882.02, '  ', '4T3'),
  line('03-11-2026', '03-11-2026', 'TRF.IMED.   P/ JOAO MIGUEL SILVA PEREIRA-E2', -50, 5832.02, '  ', '4T3'),
  line('04-11-2026', '04-11-2026', 'TRF.CRÉD.N.SEPA+RECEBIDA 0018311069600202582', 76980, 82812.02, '  ', ' SC'),
].join('\r\n');

const p = parseTabulado(L);
ok('parses every line: date, value date, signed amount, balance, card', p.rows.length === 8 && p.errors.length === 0 && p.rows[1].posted === '2026-11-02' && p.rows[0].value === '2026-10-31' && p.rows[0].amount === -0.07 && p.rows[3].amount === 5000 && p.rows[4].balance === 5982.02 && p.rows[1].cardLast4 === '1234' && p.rows[3].cardLast4 === '');
ok('descriptions are trimmed, the account number is read, the balance chain holds', p.rows[0].description === 'JUROS ULTRAP. CREDITO' && p.accountNo === '000111111111111' && p.chainOk);
ok('the tab-separated "Folha de Cálculo" layout reads the same', (() => { const t = parseTabulado(L.replace(/;/g, '\t')); return t.rows.length === 8 && t.rows[7].amount === 76980 && t.chainOk; })());
ok('a broken balance chain is reported with the line', (() => { const bad = parseTabulado(L.split('\r\n').map((x, i) => (i === 4 ? x.replace('5982,02', '5900,00') : x)).join('\r\n')); return !bad.chainOk && bad.chainBreak === 4; })());
ok('rubbish lines are reported, not guessed; blank lines are ignored', (() => { const r = parseTabulado(`${L}\r\n\r\nhello;world\r\n000;99-99-9999;x;y;z;1;2;3`); return r.rows.length === 8 && r.errors.length === 2; })());
ok('accented text decodes from the bank\'s ISO-8859-1 bytes', decodeBank(new Uint8Array([0x43, 0x4f, 0x4d, 0x49, 0x53, 0x53, 0xc3, 0x4f]).buffer) === 'COMISSÃO' && decodeBank(Uint8Array.from([0x6e, 0xe3, 0x6f]).buffer) === 'não');

// ── Fingerprints and duplicates ──
const ids = await Promise.all(p.rows.map((r) => fingerprint(r, p.accountNo)));
ok('every line gets its own id, even two identical purchases on one day (the balance differs)', new Set(ids).size === 8 && p.rows[1].description === p.rows[2].description && ids[1] !== ids[2]);
ok('the same line always gets the same id; another account does not', (await fingerprint(p.rows[0], p.accountNo)) === ids[0] && (await fingerprint(p.rows[0], '000222')) !== ids[0] && /^[0-9a-f]{40}$/.test(ids[0]));
const first = planImport({ rows: p.rows, ids, existing: new Set(), last: null, opening: null });
ok('first import: all new, totals and balances for the preview', first.fresh.length === 8 && first.dups === 0 && first.warnings.length === 0 && first.from === '2026-11-02' && first.to === '2026-11-04' && first.openingBalance === 1000.07 && first.closingBalance === 82812.02 && Math.round(first.sumIn) === 81980 && first.sumOut < 0);
const again = planImport({ rows: p.rows, ids, existing: new Set(ids), last: { balance: 82812.02, posted: '2026-11-04' }, opening: null });
ok('importing the same file again adds nothing and warns about nothing', again.fresh.length === 0 && again.dups === 8 && again.warnings.length === 0);
const part = planImport({ rows: p.rows, ids, existing: new Set(ids.slice(0, 4)), last: { balance: p.rows[3].balance, posted: '2026-11-02' }, opening: null });
ok('an overlapping file adds only the lines after the overlap, with no gap warning', part.fresh.length === 4 && part.dups === 4 && part.warnings.length === 0);
const late = planImport({ rows: p.rows.slice(5), ids: ids.slice(5), existing: new Set(), last: { balance: p.rows[2].balance, posted: '2026-11-02' }, opening: null });
ok('a file that starts after a hole warns that days are probably missing', late.warnings.length === 1 && late.warnings[0].code === 'gap');
ok('with nothing stored yet, a different opening balance on the account is flagged; the same one is not', planImport({ rows: p.rows, ids, existing: new Set(), last: null, opening: 5 }).warnings[0]?.code === 'opening' && planImport({ rows: p.rows, ids, existing: new Set(), last: null, opening: 1000.07 }).warnings.length === 0);

// ── Reading a line ──
const ctx = { partners: [{ key: 'andre', name: 'André Rocha' }, { key: 'maria', name: 'Maria Costa' }], suppliers: [{ id: 's1', name: 'Flix', aliases: ['FLIX'], defaultCategoryId: 'transport', defaultPurposeId: 'field-visit' }, { id: 's2', name: 'Contabilista Ltda', aliases: ['JOAO MIGUEL SILVA'], defaultCategoryId: 'professional-services' }], cards: [{ id: 'c1', last4: '1234' }], accountId: 'a1' };
const rec = p.rows.map((r) => recognise(r, ctx));
ok('interest, stamp duty, fees and commissions are bank charges: no document needed, safe to accept at once', rec[0].kind === 'expense' && rec[0].categoryId === 'bank-taxes' && rec[0].autoAccept && rec[0].docWaived && recognise({ description: 'IMP.DE SELO 0018', amount: -0.7 }, ctx).autoAccept && recognise({ description: 'COMISSÃO DE GESTÃO', amount: -11.9 }, ctx).autoAccept && recognise({ description: 'TRF.CRÉD.N.SEPA+(DESP.BEN) 0018311069600202582', amount: -17.5 }, ctx).name === 'Transfer fee (DESP.BEN)');
ok('a card purchase takes the card from the line and asks for a category', rec[1].kind === 'expense' && rec[1].paidWith === 'card:c1' && !rec[1].autoAccept && !rec[1].categoryId && rec[1].name === 'CAFE EXEMPLO');
ok('a known supplier name in the line fills its defaults', rec[4].supplierId === 's1' && rec[4].categoryId === 'transport' && rec[4].purposeId === 'field-visit' && rec[4].paidWith === 'card:c1' && rec[4].sure);
ok('money in is a probable capital call from the named sender, never accepted without a click', rec[3].kind === 'income' && rec[3].incomeType === 'capital_call' && rec[3].counterparty === 'FUNDO ALFA F.C.' && !rec[3].autoAccept && rec[3].paidWith === 'account:a1');
ok('money in with only a reference number has no sender name', rec[7].counterparty === '' && /ref 0018311069600202582/.test(rec[7].name));
ok('a transfer to a partner is a reimbursement (settlement), by first name or by full name', rec[5].kind === 'settlement' && rec[5].partnerKey === 'maria' && recognise({ description: 'TRF.IMED.   P/ ANDRE FILIPE NOGUEIRA DA ROCHA-E190', amount: -1000 }, ctx).partnerKey === 'andre' && !rec[5].autoAccept);
ok('a partner is not guessed from one shared word', matchPartner('TRF P/ ANDRE SILVA', ctx.partners) === '' && matchPartner('Devolucao Zeca', ctx.partners) === '');
ok('a transfer to a supplier alias is that supplier\'s expense', rec[6].kind === 'expense' && rec[6].supplierId === 's2' && rec[6].categoryId === 'professional-services');
ok('supplier names match without accents or case, and archived suppliers are skipped', findSupplier('compra flix lisboa', ctx.suppliers)?.id === 's1' && findSupplier('FLIX', [{ ...ctx.suppliers[0], archived: true }]) === null && findSupplier('x', ctx.suppliers) === null);
ok('descriptions are cleaned for item names', cleanDescription('COMPRA ESTRANG*0435 FLIX') === 'FLIX' && cleanDescription('TRF CRED SEPA+ DE ISTRIA CAPITAL III F.C.-44241813') === 'ISTRIA CAPITAL III F.C.' && cleanDescription('TRF.IMED.   DE Helena Ahlstrom-R25891242') === 'Helena Ahlstrom');

// ── Matching to an expense entered by hand ──
const items = [{ id: 'i1', kind: 'expense', amount: 8.98, date: '2026-11-03' }, { id: 'i2', kind: 'expense', amount: 8.98, date: '2026-10-01' }, { id: 'i3', kind: 'expense', amount: 8.98, date: '2026-11-04', movementId: 'm9' }, { id: 'i4', kind: 'expense', amount: 8.98, date: '2026-11-04', paidPersonallyBy: 'andre' }, { id: 'i5', kind: 'income', amount: 8.98, date: '2026-11-03' }, { id: 'i6', kind: 'expense', amount: 8.98, date: '2026-11-04', archived: true }, { id: 'i7', kind: 'expense', amount: 9.01, date: '2026-11-03' }];
ok('candidates: same amount, within 10 days, not already linked, not paid personally, not archived; nearest first', matchCandidates(p.rows[4], items).map((i) => i.id).join() === 'i1');
ok('candidates: money in never matches an expense', matchCandidates(p.rows[3], items).length === 0);


// ── Investors (step 2.8) ──
const invs = [{ id: 'v1', name: 'Alfa Capital', bankNames: [] }, { id: 'v2', name: 'Beta Fund I', bankNames: ['BETA HOLDING SARL'] }, { id: 'v3', name: 'Gama Partners', bankNames: [] }, { id: 'v4', name: 'Gama Capital', bankNames: [] }, { id: 'v5', name: 'One to One Great Search', bankNames: [] }, { id: 'v6', name: 'Ana', bankNames: [] }];
ok('investor name: the distinctive words of the investor are in the sender ("Alfa Capital" ~ "FUNDO ALFA F.C.")', investorMatch('FUNDO ALFA F.C.', invs[0]) === 'name' && investorMatch('ALFA CAPITAL III F.C.', invs[0]) === 'name' && investorMatch('BETA FUND II', invs[1]) === 'name');
ok('investor name: accents and case do not matter; a different name does not match', investorMatch('álfa capital', invs[0]) === 'name' && investorMatch('DELTA FUND', invs[0]) === '');
ok('investor name: several distinctive words must all be there ("One to One Great Search")', investorMatch('ONE TO ONE GREAT SEARCH', invs[4]) === 'name' && investorMatch('ONE SOMETHING', invs[4]) === '');
ok('a single short word (3 letters) never matches on its own', investorMatch('ANA PEREIRA', invs[5]) === '');
ok('a remembered bank name wins ("BETA HOLDING SARL" is investor Beta)', investorMatch('TRANSF BETA HOLDING SARL LUX', invs[1]) === 'alias');
ok('findInvestor: one clear match; two investors matching the same way is never guessed', findInvestor('ALFA CAPITAL III', invs)?.investor.id === 'v1' && findInvestor('GAMA PARTNERS CAPITAL', invs) === null && findInvestor('NOBODY LTD', invs) === null);
ok('findInvestor: a remembered name beats a looser name match', findInvestor('BETA HOLDING SARL', [...invs, { id: 'v9', name: 'Beta Holding', bankNames: [] }])?.investor.id === 'v2');
ok('a money-in bank line from a known investor is suggested for that investor (remembered sender = sure)', (() => {
  const a = recognise({ description: 'TRF CRED SEPA+ DE FUNDO ALFA F.C.-44100001', amount: 5000 }, { ...ctx, investors: invs });
  const b = recognise({ description: 'TRF CRED SEPA+ DE BETA HOLDING SARL-441', amount: 100 }, { ...ctx, investors: invs });
  return a.investorId === 'v1' && a.investorName === 'Alfa Capital' && a.sure === false && /name matches/.test(a.reason) && b.investorId === 'v2' && b.sure === true && !a.autoAccept && !b.autoAccept && a.counterparty === 'FUNDO ALFA F.C.';
})());
ok('without investors in the context money in is still just a probable capital call', recognise({ description: 'TRF CRED SEPA+ DE FUNDO ALFA F.C.-44100001', amount: 5000 }, ctx).investorId === undefined);
ok('unlinked capital calls that look like an investor are offered; linked, archived, other types and expenses are not', (() => {
  const items = [{ id: 'a', kind: 'income', incomeType: 'capital_call', counterparty: 'ALFA CAPITAL II' }, { id: 'b', kind: 'income', incomeType: 'capital_call', counterparty: 'ALFA CAPITAL', investorId: 'v1' }, { id: 'c', kind: 'income', incomeType: 'capital_call', counterparty: 'ALFA CAPITAL', archived: true }, { id: 'd', kind: 'income', incomeType: 'interest', counterparty: 'ALFA CAPITAL' }, { id: 'e', kind: 'expense', name: 'ALFA CAPITAL' }, { id: 'f', kind: 'income', incomeType: 'capital_call', counterparty: 'OTHER FUND' }];
  return unlinkedForInvestor(items, invs[0]).map((i) => i.id).join() === 'a';
})());

console.log(fail ? `\n${fail} FAILED` : '\nall budget stage 2 bank tests passed'); process.exit(fail ? 1 : 0);
