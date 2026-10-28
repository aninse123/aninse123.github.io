// Owner-aware outreach, Stage 3 (22 Oct 2026, switch outreach.ownerAware): the
// "Related companies" panel shown before adding companies to a campaign, in the
// Search CRM and in Outreach (one module, same panel). The server's preview
// lists only the flagged companies, each with its flags, related companies,
// suggested lead and default choice (Skip for now when a related company said
// no or is "do not contact", else Proceed). Nothing is decided until Add.
// "Proceed and mention" (D5, 22 Oct): you tick which related companies the email
// may name (up to 3, none ticked for you; the suggested ones are marked).

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = (t) => (t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const KIND_ICON = { said_no: '🚫', in_conversation: '💬', group_contacted: '✉', other_campaign: '📣', same_batch: '➕' };
export const MAX_MENTION = 3;
const PLAIN = 'text-transform:none;letter-spacing:normal;font-weight:400;color:inherit;'; // the pages' label style is uppercase

// D3 (22 Oct): a person relates two companies when they rank as an owner or a
// manager on the best-person ladder; the roles in functions/outreach/roles.js
// (auditors, fiscal / audit board, insolvency administrators, supervisory and
// advisory bodies, representatives… — 28 Oct) and "any other role" don't; a
// "Sócio" with no recorded stake is a shareholder. Same rule as related.js
// deciderRank (a test checks the two lists agree).
export const EXCLUDED_ROLE = /fiscal|auditor|revisor|\bROC\b|statutory|\baudit\b|assembl|general meeting|secret[aá]ri|secretary|no specific function|sem fun[cç][aã]o|insolv|liquidat|administrador judicial|judicial administrator|supervis|conselho geral|general (and supervisory )?(board|council)|curador|trustee|conselho fundador|board of the foundation|provedor|\bprovider\b|consultiv|advisory|conselho t[eé]cnico|technical board|vencimentos|remunera|representative|representante|procurador|attorney|general contact|^none$/i;
const SOCIO_RE = /^\s*(s[óo]cio|partner)\s*$/i;
const GUO_ROLE_RE = /ultimate owner|benefici[áa]rio efetivo|beneficial owner/i;
const TOP_ROLE_RE = /(s[óo]cio[- ]?gerente|gerente|administrador|presidente|ceo|chief executive|managing director|director[- ]geral|diretor[- ]geral|general manager|owner|propriet[áa]rio|founder|fundador)/i;
const MANAGER_RE = /(director|diretor|manager|board|conselho|administra)/i;
export function relatedRank(l) {
  if (!l || l.personEntityType === 'entity') return 0;
  const all = l.mgmtCurrent === true ? (l.mgmtRoles || []).filter((r) => !EXCLUDED_ROLE.test(r)) : [];
  const socio = all.some((r) => SOCIO_RE.test(r));
  const roles = all.filter((r) => !GUO_ROLE_RE.test(r) && !/^shareholder/i.test(r) && !SOCIO_RE.test(r)).join(' ');
  const manages = l.mgmtCurrent === true && roles.trim().length > 0;
  const share = l.shCurrent === true ? (Number(l.shTotalPct ?? l.shDirectPct) || 0) : 0;
  const holds = share > 0 || (socio && l.shCurrent !== false); // a former shareholder doesn't
  const s = Math.min(share, 100) / 1000;
  let r = 0;
  if (GUO_ROLE_RE.test(all.join(' '))) r = 200 + s;
  else if (share >= 50 && manages) r = 180 + s;
  else if (share >= 50) r = 160 + s;
  else if (holds && manages) r = 140 + s;
  else if (holds) r = 120 + s;
  else if (manages && TOP_ROLE_RE.test(roles)) r = 100;
  else if (manages && MANAGER_RE.test(roles)) r = 60;
  else if (manages) r = 40;
  return l.shCurrent === true ? Math.max(r, 120) : r;
}
export const isRelatedDecider = (l) => relatedRank(l) >= 60;

// "Suggested lead company: X (the parent)" / "(José Silva: majority owner, manages)".
export function leadText(lead) {
  if (!lead) return '';
  const why = lead.why === 'parent' ? 'the parent' : lead.why === 'owner' ? [lead.person, lead.level].filter(Boolean).join(': ') : lead.why === 'largest' ? 'the largest' : '';
  return `${esc(lead.name)}${why ? ` <span style="color:#64748B;">(${esc(why)})</span>` : ''}`;
}

// One related company: name, why, and what is happening with it.
export function relatedLine(r) {
  const status = [
    r.doNotContact ? 'do not contact' : '', r.saidNo ? 'said no' : '',
    r.lastReplyAt ? `replied ${day(r.lastReplyAt)}` : (r.lastOutreachAt ? `contacted ${day(r.lastOutreachAt)}` : ''),
    r.campaignName ? `campaign “${r.campaignName}”` : '',
  ].filter(Boolean).join(' · ');
  return `${esc(r.name)} <span style="color:#64748B;">(${esc((r.why || []).join('; '))})</span>${status ? ` — ${esc(status)}` : ''}`;
}

export function ownerPanelHtml(owner) {
  if (!owner?.count) return '';
  const rows = owner.flagged.map((f) => {
    const ch = (v, label) => `<label style="display:inline-flex;gap:5px;align-items:center;margin-right:12px;font-size:0.8rem;cursor:pointer;${PLAIN}"><input type="radio" name="op_${esc(f.companyId)}" value="${v}"${f.choice === v ? ' checked' : ''}> <span>${label}</span></label>`;
    const suggested = new Set((f.mention || []).map((m) => m.companyId));
    const related = f.related || [];
    const picks = related.length ? `<div class="op-mention" style="margin:4px 0 0 20px;font-size:0.8rem;"${f.choice === 'mention' ? '' : ' hidden'}>
        <div style="color:#64748B;margin-bottom:2px;">Which companies may the email name? Tick up to ${MAX_MENTION} — none ticked = Proceed.</div>
        ${related.map((r) => `<label style="display:flex;gap:6px;align-items:baseline;cursor:pointer;padding:1px 0;${PLAIN}"><input type="checkbox" data-opmention="${esc(r.companyId)}"> <span>${relatedLine(r)}${suggested.has(r.companyId) ? ' <span style="font-size:0.72rem;color:#1D4ED8;">suggested</span>' : ''}</span></label>`).join('')}
      </div>` : '';
    return `<div class="op-row" data-opid="${esc(f.companyId)}" style="padding:8px 0;border-top:1px solid #E2E8F0;">
      <div style="font-size:0.85rem;"><b>${esc(f.companyName || f.companyId)}</b></div>
      <ul style="margin:3px 0 4px;padding-left:18px;font-size:0.8rem;">${f.flags.map((x) => `<li>${KIND_ICON[x.kind] || '•'} ${esc(x.text)}</li>`).join('')}</ul>
      ${related.length ? `<details style="font-size:0.78rem;margin-bottom:4px;"><summary style="cursor:pointer;color:#475569;">Related companies (${related.length})${f.lead ? ` · suggested lead: ${leadText(f.lead)}` : ''}</summary><ul style="margin:4px 0 0;padding-left:18px;">${related.map((r) => `<li>${relatedLine(r)}</li>`).join('')}</ul></details>` : ''}
      <div>${ch('proceed', 'Proceed')}${ch('skip', 'Skip for now')}${related.length ? ch('mention', 'Proceed and mention…') : ''}</div>
      ${picks}
    </div>`;
  }).join('');
  return `<div class="owner-panel" style="border:1px solid #CBD5E1;border-radius:8px;padding:10px 12px;margin:10px 0;background:rgba(148,163,184,0.06);">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
      <b style="font-size:0.88rem;">Related companies (${owner.count})</b>
      <span style="display:inline-flex;gap:6px;"><button type="button" class="btn btn--ghost btn--sm" data-opall="proceed">Proceed with all</button><button type="button" class="btn btn--ghost btn--sm" data-opall="skip">Skip all</button></span>
    </div>
    <div style="font-size:0.78rem;color:#64748B;margin-top:2px;">Companies whose owner or group is already in outreach, or is being added together. Each starts on its suggested choice; “Proceed and mention” lets you tick which related companies the email may name ({{owner.otherCompanies}}). Every choice is kept in the company's Activities.</div>
    ${rows}${owner.flagged.length < owner.count ? `<div style="font-size:0.78rem;color:#64748B;margin-top:6px;">Showing ${owner.flagged.length} of ${owner.count}; the others go ahead (Proceed).</div>` : ''}
  </div>`;
}

// The bulk buttons, the mention ticks shown only for "Proceed and mention", at most MAX_MENTION.
export function wireOwnerPanel(root) {
  if (!root) return;
  const sync = (row) => {
    const box = row.querySelector('.op-mention'); if (!box) return;
    box.hidden = row.querySelector('input[type="radio"]:checked')?.value !== 'mention';
    const ticks = [...box.querySelectorAll('[data-opmention]')], n = ticks.filter((t) => t.checked).length;
    ticks.forEach((t) => { t.disabled = !t.checked && n >= MAX_MENTION; });
  };
  root.querySelectorAll('[data-opall]').forEach((b) => b.addEventListener('click', () => {
    root.querySelectorAll('.op-row input[type="radio"]').forEach((r) => { if (r.value === b.dataset.opall) r.checked = true; });
    root.querySelectorAll('.op-row').forEach(sync);
  }));
  root.querySelectorAll('.op-row').forEach((row) => { row.addEventListener('change', () => sync(row)); sync(row); });
}

// { companyId: 'proceed' | 'skip' | 'mention' } for every flagged company shown;
// "mention" with nothing ticked is sent as "proceed".
export function readOwnerChoices(root) {
  const out = {};
  root?.querySelectorAll('.op-row').forEach((row) => {
    let v = row.querySelector('input[type="radio"]:checked')?.value;
    if (v === 'mention' && !row.querySelector('[data-opmention]:checked')) v = 'proceed';
    if (v) out[row.dataset.opid] = v;
  });
  return out;
}
// { companyId: [ticked related companyIds] } for the companies on "Proceed and mention".
export function readOwnerMentions(root) {
  const out = {};
  root?.querySelectorAll('.op-row').forEach((row) => {
    if (row.querySelector('input[type="radio"]:checked')?.value !== 'mention') return;
    const ids = [...row.querySelectorAll('[data-opmention]:checked')].map((t) => t.dataset.opmention).slice(0, MAX_MENTION);
    if (ids.length) out[row.dataset.opid] = ids;
  });
  return out;
}
