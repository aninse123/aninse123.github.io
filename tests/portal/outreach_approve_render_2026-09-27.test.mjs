// Outreach → Tasks → To approve: renderApprove() runs without throwing for a
// campaign draft and a manual draft ("written by …", Phase 2b), in a tiny
// fake DOM. Catches runtime errors syntax checks miss (e.g. a helper hidden
// by a local variable of the same name — which broke the queue on 27 Sep).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const page = readFileSync(new URL('../../portal/outreach.html', import.meta.url), 'utf8');
function lift(name) {
  const i = page.indexOf(`    function ${name}(`); if (i < 0) throw new Error(name);
  const m = /\r?\n    \}\r?\n/.exec(page.slice(i)); return page.slice(i, i + m.index + m[0].length);
}
const line = (a) => { const i = page.indexOf(a); if (i < 0) throw new Error(a); return page.slice(i, page.indexOf('\n', i)); };

// Minimal elements: innerHTML is kept; queries return inert stubs.
const el = () => { const e = { hidden: false, innerHTML: '', textContent: '', value: '', disabled: false, dataset: {}, style: {}, addEventListener() {}, querySelector: () => el(), querySelectorAll: () => [], closest: () => null }; return e; };
const els = {};
const ctx = {
  document: { activeElement: null, querySelectorAll: () => [] },
  $: (id) => (els[id] ||= el()),
  campaigns: [{ id: 'c1', name: 'Campanha', steps: [{ id: 's1', name: 'Email 1' }] },
    { id: 'c2', name: 'Metalurgia Norte', status: 'draft', steps: [{ id: 's1' }], stats: { enrolled: 12 }, startRequest: { by: 'maria@douropartners.pt', at: null, note: 'Pronta' } },
    { id: 'c3', name: 'Devolvida', status: 'draft', steps: [], startReturn: { by: 'andre.rocha@douropartners.pt', at: { toMillis: () => Date.now() }, note: 'Muda o assunto', requestedBy: 'andre.rocha@douropartners.pt' } }],
  drafts: [
    { id: 'd1', source: 'campaign', campaignId: 'c1', stepId: 's1', companyName: 'Empresa A', to: ['a@a.pt'], senderId: 'an.rocha@mail.douropartners-team.pt', subject: 'Olá', draftBody: 'x' },
    { id: 'd2', source: 'manual', companyName: 'Empresa B', to: ['b@b.pt'], senderId: 'an.rocha@mail.douropartners-team.pt', subject: 'Olá B', draftBody: 'y', writtenBy: 'maria@douropartners.pt', writtenByKey: 'maria', recipient: { name: 'Rui' } },
  ],
  window: { teamDir: [{ key: 'maria', label: 'Maria', active: true }] },
  me: 'andre.rocha@douropartners.pt', settings: null,
  showTab() {}, openCampaign() {}, campCall() {}, callSend() {}, toast() {}, errText: (e) => String(e), confirm: () => true, prompt: () => null,
};
vm.createContext(ctx);
vm.runInContext([
  line('    const OWNER_BY_EMAIL ='), line('    const personName ='), line('    const OWNER_LABEL ='), line('    const DAY_NAMES ='), line('    function esc(s)'), line('    function tsMs(t)'), line('const dayFmt ='), line('const timeFmt ='), line('const dtFmt ='), lift('when'), line('const num ='), line('    function localPart(e)'), lift('windowText'),
  "let approveFilter = 'all'; const draftEdits = new Map(); let returnedMine = []; const coCache = new Map(); let taskView = 'approve'; async function loadCompaniesFor() {}",
  lift('approvalContext'), "let approveCtxLoading = false;",
  lift('renderApprove'),
  'globalThis.run = () => { renderApprove(); return $("approveView").innerHTML; };',
].join('\n'), ctx);

let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
let html = '', err = null;
try { html = ctx.run(); } catch (e) { err = e; }
ok(`renderApprove runs with a campaign and a manual draft${err ? ' — ' + err.message : ''}`, !err);
ok('manual draft shows who wrote it and the approve / return buttons', /written by Maria/.test(html) && /Approve and send now/.test(html) && /Return with a note/.test(html));
ok('campaign draft keeps its campaign / step and Approve', /Campanha/.test(html) && /Email 1/.test(html) && /data-dact="approve"/.test(html));
ok('campaign waiting for a partner: listed with who asked, the note and Start / Return', /Campaigns waiting for a partner/.test(html) && /Metalurgia Norte/.test(html) && /asked by maria/.test(html) && /Pronta/.test(html) && /data-sstart="c2"/.test(html) && /data-sreturn="c2"/.test(html));
ok('campaign returned to me: shown with the note', /Campaigns returned to you/.test(html) && /Muda o assunto/.test(html) && /returned .* by André/.test(html));
console.log(fail ? `\n${fail} FAILED` : '\nall approve render tests passed'); process.exit(fail ? 1 : 0);
