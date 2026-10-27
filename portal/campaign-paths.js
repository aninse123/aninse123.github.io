// Campaign paths (27 Oct 2026, switch outreach.paths): a different sequence per
// filter. Shared by Outreach (the editor, the tree, the campaign screens) and the
// Search CRM (the company's campaign card). Same rules as the server
// (functions/outreach/campaign_util.js): each step carries its pathId; the last
// path, "Everyone else", has id "main"; a campaign without paths is one path,
// "main"; an enrolment's currentStep counts within its path.

export const ELSE_PATH = 'main';
export const MAX_PATHS = 20, MAX_PATH_STEPS = 20;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const pathsOf = (c) => (Array.isArray(c?.paths) && c.paths.length ? c.paths : [{ id: ELSE_PATH, name: 'Everyone', filters: null }]);
export const hasPaths = (c) => pathsOf(c).length > 1;
export const stepsOfPath = (c, pathId) => (c?.steps || []).filter((s) => (s.pathId || ELSE_PATH) === (pathId || ELSE_PATH));
// Paths round 2 (27 Oct): a company's path — its own once started, the planned one
// (R11, worked out by the server) while it waits; null = not planned yet.
export const pathIdOf = (e) => e?.pathId || (e?.status === 'pending' ? e?.plannedPathId : null) || null;
// The steps one company runs through (its path; a campaign without paths = all).
export const stepsFor = (c, e) => stepsOfPath(c, pathIdOf(e));
export const isLeftOut = (e) => e?.status === 'completed' && /^Left out by the campaign's paths/.test(e?.stopReason || '');
const msOf = (t) => (t?.toMillis ? t.toMillis() : t?.seconds != null ? t.seconds * 1000 : t ? new Date(t).getTime() : 0);

// Who starts first (R10) — same rules as the server's splitShares / scheduler.
export const START_LABEL = { added: 'As added', order: 'Path order', split: 'Split by path' };
export function splitShares(c, perDay) {
  const live = pathsOf(c).filter((p) => stepsOfPath(c, p.id).length);
  const so = c?.startOrder || {};
  if (!live.length) return {};
  if (so.mode === 'split' && so.equal === false) return Object.fromEntries(live.map((p) => [p.id, Number(so.perPath?.[p.id]) || 0]));
  const base = Math.floor(perDay / live.length), extra = perDay - base * live.length;
  return Object.fromEntries(live.map((p, i) => [p.id, base + (i < extra ? 1 : 0)]));
}
// The order the waiting companies start in: as added (oldest first), path order, or
// split by path day by day (each path's share, then the unused room in path order).
// Companies planned for a path with no steps come last (they're left out).
export function startQueue(c, pending, perDay) {
  const sorted = [...pending].sort((a, b) => msOf(a.enrolledAt) - msOf(b.enrolledAt));
  const mode = hasPaths(c) ? (c.startOrder?.mode || 'added') : 'added';
  if (mode === 'added') return sorted;
  const order = pathsOf(c).map((p) => p.id);
  const live = order.filter((id) => stepsOfPath(c, id).length);
  const groups = new Map(order.map((id) => [id, []]));
  for (const e of sorted) (groups.get(pathIdOf(e)) || groups.get(ELSE_PATH)).push(e);
  const rest = order.filter((id) => !live.includes(id)).flatMap((id) => groups.get(id));
  if (mode === 'order') return [...live.flatMap((id) => groups.get(id)), ...rest];
  const shares = splitShares(c, perDay), out = [];
  while (live.some((id) => groups.get(id).length)) {
    let room = perDay;
    for (const id of live) { const take = groups.get(id).splice(0, Math.min(shares[id] || 0, room)); out.push(...take); room -= take.length; }
    for (const id of live) { if (room <= 0) break; const take = groups.get(id).splice(0, room); out.push(...take); room -= take.length; }
    if (room === perDay) break;
  }
  return [...out, ...rest];
}
// R2: the campaign's results per path (Overview "By path"): companies, waiting, in
// the sequence, contacted, replied, positive (from the conversations) and left out.
const IN_SEQ = ['active', 'awaiting_approval', 'awaiting_task', 'paused'];
export function pathResults(c, enrols, threads = [], positive = []) {
  const rows = new Map(pathsOf(c).map((p) => [p.id, { id: p.id, name: p.id === ELSE_PATH ? 'Everyone else' : p.name, total: 0, waiting: 0, inSeq: 0, contacted: 0, replied: 0, positive: 0, leftOut: 0 }]));
  const byEnrol = new Map();
  let unplanned = 0;
  for (const e of enrols) {
    if (['removed', 'moved'].includes(e.status)) continue;
    const id = pathIdOf(e);
    if (!id || !rows.has(id)) { if (e.status === 'pending') unplanned++; continue; }
    byEnrol.set(e.id, id);
    const r = rows.get(id); r.total++;
    if (e.status === 'pending') r.waiting++; else if (IN_SEQ.includes(e.status)) r.inSeq++;
    if ((e.history || []).length || e.status === 'replied') r.contacted++;
    if (e.status === 'replied') r.replied++;
    if (isLeftOut(e)) r.leftOut++;
  }
  for (const t of threads) { const id = byEnrol.get(t.enrolmentId) || t.pathId; if (id && rows.has(id) && positive.includes(t.responseCategory)) rows.get(id).positive++; }
  return { rows: [...rows.values()], unplanned };
}

// What a condition can use: the Search CRM filters.
export const PATH_FIELDS = [
  ['fitScore', 'Fit score', 'num', ''], ['computedRevenue', 'Revenue', 'num', '€'], ['computedEBITDA', 'EBITDA', 'num', '€'],
  ['computedEBITDAMargin', 'EBITDA margin', 'num', '%'], ['computedGrowthRecent', 'Growth', 'num', '%'], ['ownGroupSize', 'Group size', 'num', ''],
  ['targetTier', 'Tier', 'tier', ''], ['contactable', 'Contactable', 'bool', ''], ['sector', 'Sector', 'text', ''], ['subSector', 'Sub-sector', 'text', ''],
  ['caeCode', 'CAE', 'prefix', ''], ['naceCode', 'NACE', 'prefix', ''], ['nuts2', 'Region (NUTS II)', 'text', ''], ['nuts3', 'Region (NUTS III)', 'text', ''],
  ['stage', 'Stage', 'text', ''], ['owner', 'Owner', 'text', ''], ['website', 'Website', 'exists', ''], ['lastTouchAt', 'Last touch', 'days', ''],
].map(([key, label, type, unit]) => ({ key, label, type, unit }));
export const fieldOf = (key) => PATH_FIELDS.find((f) => f.key === key) || PATH_FIELDS[0];
export const OPS = {
  num: [['gte', 'at least'], ['lt', 'below'], ['range', 'from … to under']],
  tier: [['in', 'is']], bool: [['bool', 'is']], text: [['in', 'is any of'], ['eq', 'is']], prefix: [['prefix', 'starts with']],
  exists: [['exists', '']], days: [['within_days', 'in the last … days'], ['exists', 'ever / never']],
};
// A sensible first condition for a new path / a changed field.
export function defaultFilter(key = 'fitScore') {
  const f = fieldOf(key);
  if (f.type === 'num') return { field: f.key, op: 'gte', value: f.key === 'fitScore' ? 75 : null }; // empty, so the example shows (27 Oct)
  if (f.type === 'tier') return { field: f.key, op: 'in', value: ['A'] };
  if (f.type === 'bool') return { field: f.key, op: 'bool', value: true };
  if (f.type === 'exists') return { field: f.key, op: 'exists', value: true };
  if (f.type === 'days') return { field: f.key, op: 'within_days', value: 90 };
  if (f.type === 'prefix') return { field: f.key, op: 'prefix', value: '' };
  return { field: f.key, op: 'in', value: [] }; // text: any of several (picked from the list)
}

// A path's companies (pathsPreview): total, then to start / in progress / closed (left out inside closed).
export const pathTotal = (n) => (n ? (n.waiting || 0) + (n.active || 0) + (n.closed || 0) : 0);
export function pathCountText(n) {
  if (!n) return '';
  const t = pathTotal(n), num = (x) => x.toLocaleString('en');
  const parts = [n.waiting ? `${num(n.waiting)} to start` : '', n.active ? `${num(n.active)} in progress` : '',
    n.closed ? `${num(n.closed)} closed${n.leftOut ? ` (${n.leftOut === n.closed ? 'all' : num(n.leftOut)} left out)` : ''}` : ''].filter(Boolean);
  // Placed under earlier conditions (or older data): they keep this path, but these conditions wouldn't put them here (27 Oct, T4b).
  const away = n.elsewhere ? ` — ${n.elsewhere === n.active + n.closed ? (n.elsewhere === 1 ? 'it' : 'all of them') : `${num(n.elsewhere)} of them`} wouldn't be placed here now` : '';
  return `${num(t)} compan${t === 1 ? 'y' : 'ies'}${parts.length ? `: ${parts.join(' · ')}` : ''}${away}`;
}
// The example shown inside each box, and the unit after it (27 Oct, André: one way for all).
export function placeholderOf(key) {
  return { fitScore: 'e.g. 75', computedRevenue: 'e.g. 2M', computedEBITDA: 'e.g. 500k', computedEBITDAMargin: 'e.g. 10', computedGrowthRecent: 'e.g. 5', ownGroupSize: 'e.g. 2', caeCode: 'e.g. 4621', naceCode: 'e.g. 46.21', lastTouchAt: 'e.g. 90' }[key] || '';
}
// "= €2,000,000" next to a money box, so what was typed is never in doubt.
export const amountReadback = (n) => (n == null || !isFinite(n) ? '' : `= €${Math.round(n).toLocaleString('en')}`);
// "2M" / "500k" / "1,5M" / "2 000 000" → a number (money and other amounts).
export function parseAmount(s) {
  const t = String(s ?? '').trim().replace(/\s/g, '').replace(',', '.').toLowerCase();
  const m = t.match(/^(-?\d+(?:\.\d+)?)(k|m)?$/);
  if (!m) return NaN;
  return Number(m[1]) * (m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1);
}
export function amountText(n, unit) {
  if (n == null || !isFinite(n)) return '';
  if (unit === '€') return Math.abs(n) >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(n);
  return String(n);
}
const money = (n, f) => (n == null || !isFinite(n) ? '…' : f.unit === '€' ? `€${amountText(n, '€')}` : f.unit === '%' ? `${n}%` : String(n));

// "Fit score at least 75", "Revenue from €2M to under €10M", "Tier is A or B".
export function condText(flt, labels = {}) {
  const f = fieldOf(flt.field);
  const v = flt.value;
  switch (flt.op) {
    case 'gte': return `${f.label} at least ${money(v, f)}`;
    case 'lt': return `${f.label} below ${money(v, f)}`;
    case 'range': return `${f.label} from ${money(v?.[0], f)} to under ${money(v?.[1], f)}`;
    case 'in': return `${f.label} is ${(v || []).map((x) => labels[flt.field]?.[x] || x).join(' or ') || '…'}`;
    case 'bool': return v ? f.label : `Not ${f.label.toLowerCase()}`;
    case 'eq': return `${f.label} is ${labels[flt.field]?.[v] || v}`;
    case 'prefix': return `${f.label} starts with ${v}`;
    case 'exists': return f.type === 'days' ? (v ? 'Touched before' : 'Never touched') : `${v ? 'Has' : 'No'} ${f.label.toLowerCase()}`;
    case 'within_days': return `${f.label} in the last ${v} days`;
    default: return f.label;
  }
}
export const pathCondText = (p, labels) => (p.id === ELSE_PATH || !p.filters ? 'Any company the paths above don’t take' : p.filters.map((f) => condText(f, labels)).join(' and '));

// Colours for path 1, 2, 3… ("Everyone else" is grey); readable on the portal's light ground.
const COLORS = [['#2F6B4F', '#E6F2EB'], ['#3A5570', '#E8F0F8'], ['#8A5A00', '#FDF3DC'], ['#7A3E7A', '#F4E9F4'], ['#9C2F2F', '#FBEDED'], ['#2E6E7A', '#E4F2F4']];
export const pathColor = (p, i) => (p.id === ELSE_PATH ? ['#6B7280', '#EEF0F2'] : COLORS[i % COLORS.length]);

const CH = { email: '📧', linkedin: '💼', call: '📞', whatsapp: '💬', letter: '✉️', visit: '🏢', other: '📌' };
// The tree: one column per path (top to bottom = the order they are checked).
// Boxes carry data-tree-path / data-tree-step for "click to edit in the list".
export function pathsTreeHtml({ paths, steps, counts = null, outcomeLabel = (ch, k) => k, labels = {} }) {
  const cols = paths.map((p, i) => {
    const [ink, bg] = pathColor(p, i);
    const ps = steps.map((s, gi) => ({ s, gi })).filter(({ s }) => (s.pathId || ELSE_PATH) === p.id);
    const n = counts?.[p.id];
    const countTxt = n ? ` · ${pathTotal(n)}` : '';
    const nodes = ps.map(({ s, gi }, k) => {
      const wait = k === 0 ? (Number(s.wait?.days) ? `${s.wait.days} ${s.wait?.unit === 'calendar' ? 'days' : 'sending days'} after the start` : '') : `${Number(s.wait?.days) || 0} ${s.wait?.unit === 'calendar' ? 'days' : 'sending days'}`;
      const rules = (s.branches || []).map((b) => `${outcomeLabel(s.channel || 'email', b.outcome)} → ${b.action === 'end' ? 'end' : `step ${ps.findIndex((x) => x.s.id === b.stepId) + 1}`}`);
      return `${wait ? `<div class="pt-wait">${esc(wait)}</div>` : '<div class="pt-line"></div>'}
        <button type="button" class="pt-node" data-tree-step="${gi}" title="Edit this step">${CH[s.channel || 'email'] || '•'} ${k + 1}. ${esc(s.name || '')}</button>
        ${rules.map((r) => `<div class="pt-rule" style="color:${ink}">${esc(r)}</div>`).join('')}`;
    }).join('');
    return `<div class="pt-col">
      <button type="button" class="pt-gate" data-tree-path="${esc(p.id)}" style="border-color:${ink};background:${bg};color:${ink}" title="Edit this path">${esc(p.name || (p.id === ELSE_PATH ? 'Everyone else' : 'Path'))}<small>${esc(p.id === ELSE_PATH ? (paths.length > 1 ? 'the rest' : 'every company') : pathCondText(p, labels))}${esc(countTxt)}</small></button>
      ${nodes}
      <div class="pt-end">${ps.length ? 'end' : (paths.length > 1 ? 'leave out — not contacted' : 'no steps yet')}</div>
    </div>`;
  }).join('');
  return `<div class="pt"><div class="pt-root">Company starts the campaign</div>
    ${paths.length > 1 ? '<div class="pt-split">checked against the paths left to right — the first that matches takes it</div>' : ''}
    <div class="pt-cols" style="grid-template-columns:repeat(${paths.length}, minmax(150px, 1fr));">${cols}</div></div>`;
}
export const TREE_CSS = `
  .step-fold { display: flex; gap: 6px; align-items: baseline; width: 100%; text-align: left; border: 1px solid #E5E0D5; border-radius: 8px; background: #fff; padding: 7px 10px; margin: 0 0 6px; font: inherit; font-size: 0.84rem; cursor: pointer; color: inherit; }
  .step-fold:hover { border-color: #B9C7D6; }
  .step-fold .open { margin-left: auto; }
  .path-row td { background: #FAF8F4; font-weight: 600; }
  .pt { overflow-x: auto; padding-bottom: 6px; }
  .pt-root { margin: 0 auto 6px; width: max-content; background: #E8F0F8; color: #3A5570; border-radius: 10px; padding: 6px 14px; font-weight: 600; font-size: 0.85rem; }
  .pt-split { margin: 0 auto 6px; width: max-content; max-width: 100%; text-align: center; font-size: 0.74rem; color: #6B7280; }
  .pt-cols { display: grid; gap: 10px; border-top: 2px solid #D8D3C8; padding-top: 14px; min-width: min-content; }
  .pt-col { display: flex; flex-direction: column; align-items: stretch; gap: 3px; position: relative; min-width: 150px; }
  .pt-col::before { content: ""; position: absolute; top: -14px; left: 50%; width: 2px; height: 14px; background: #D8D3C8; }
  .pt-gate { font: inherit; text-align: center; border: 2px solid; border-radius: 10px; padding: 5px 6px; font-size: 0.78rem; font-weight: 600; cursor: pointer; }
  .pt-gate small { display: block; font-weight: 400; color: #5C6570; }
  .pt-node { font: inherit; text-align: center; background: #fff; border: 1px solid #D8D3C8; border-radius: 8px; padding: 5px 6px; font-size: 0.78rem; cursor: pointer; }
  .pt-node:hover, .pt-gate:hover { box-shadow: 0 0 0 2px rgba(74,107,138,0.25); }
  .pt-wait { text-align: center; font-size: 0.7rem; color: #6B7280; }
  .pt-line { width: 2px; height: 8px; background: #D8D3C8; margin: 0 auto; }
  .pt-rule { text-align: center; font-size: 0.7rem; }
  .pt-end { text-align: center; font-size: 0.72rem; color: #6B7280; border: 1px dashed #D8D3C8; border-radius: 8px; padding: 3px 6px; margin-top: 4px; }
  .path-card { border: 1px solid #D8D3C8; border-left: 4px solid var(--pc); border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; background: #FDFCFA; }
  .path-card.flash, .step.flash { box-shadow: 0 0 0 3px rgba(74,107,138,0.35); }
  .path-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .path-head .pname { font-weight: 700; color: var(--pc); }
  .path-conds { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
  .path-cond { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 0.85rem; }
  .path-cond select, .path-cond input { width: auto; }
  .msel { position: relative; display: inline-block; }
  .msel > summary { list-style: none; cursor: pointer; border: 1px solid #D8D3C8; border-radius: 6px; padding: 4px 26px 4px 8px; background: #fff; font-size: 0.85rem; max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; position: relative; }
  .msel > summary::-webkit-details-marker { display: none; }
  .msel > summary::after { content: "▾"; position: absolute; right: 8px; color: #6B7280; }
  .msel-list { position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; min-width: 260px; max-width: min(420px, 90vw); max-height: 280px; overflow: auto; background: #fff; border: 1px solid #D8D3C8; border-radius: 8px; padding: 6px 8px; box-shadow: 0 6px 18px rgba(0,0,0,0.12); }
  .msel-list label { display: flex; gap: 6px; align-items: baseline; padding: 2px 0; font-size: 0.82rem; cursor: pointer; text-transform: none; letter-spacing: normal; font-weight: 400; }
  .msel-list input[type="search"] { width: 100%; margin-bottom: 4px; }
  .paths-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
  .paths-side { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 16px; align-items: start; }
  .paths-side > .pt-wrap { position: sticky; top: 12px; }
  @media (max-width: 1100px) { .paths-side { grid-template-columns: 1fr; } .paths-side > .pt-wrap { position: static; } }
`;
