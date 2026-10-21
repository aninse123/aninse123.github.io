// Owner-aware outreach, Stage 3 (22 Oct 2026, switch outreach.ownerAware): the
// "Related companies" panel shown before adding companies to a campaign, in the
// Search CRM and in Outreach (one module, same panel). The server's preview
// lists only the flagged companies, each with its flags, related companies,
// suggested lead and default choice (Skip for now when a related company said
// no or is "do not contact", else Proceed). Nothing is decided until Add.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = (t) => (t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const KIND_ICON = { said_no: '🚫', in_conversation: '💬', group_contacted: '✉', other_campaign: '📣', same_batch: '➕' };

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
    const ch = (v, label, extra = '') => `<label style="display:inline-flex;gap:5px;align-items:center;margin-right:12px;font-size:0.8rem;cursor:pointer;"><input type="radio" name="op_${esc(f.companyId)}" value="${v}"${f.choice === v ? ' checked' : ''}> <span>${label}${extra}</span></label>`;
    const mention = (f.mention || []).map((m) => m.name).join(' and ');
    return `<div class="op-row" data-opid="${esc(f.companyId)}" style="padding:8px 0;border-top:1px solid #E2E8F0;">
      <div style="font-size:0.85rem;"><b>${esc(f.companyName || f.companyId)}</b></div>
      <ul style="margin:3px 0 4px;padding-left:18px;font-size:0.8rem;">${f.flags.map((x) => `<li>${KIND_ICON[x.kind] || '•'} ${esc(x.text)}</li>`).join('')}</ul>
      ${(f.related || []).length ? `<details style="font-size:0.78rem;margin-bottom:4px;"><summary style="cursor:pointer;color:#475569;">Related companies (${f.related.length})${f.lead ? ` · suggested lead: ${esc(f.lead.name)}` : ''}</summary><ul style="margin:4px 0 0;padding-left:18px;">${f.related.map((r) => `<li>${relatedLine(r)}</li>`).join('')}</ul></details>` : ''}
      <div>${ch('proceed', 'Proceed')}${ch('skip', 'Skip for now')}${mention ? ch('mention', 'Proceed and mention', ` <span style="color:#64748B;">(${esc(mention)})</span>`) : ''}</div>
    </div>`;
  }).join('');
  return `<div class="owner-panel" style="border:1px solid #CBD5E1;border-radius:8px;padding:10px 12px;margin:10px 0;background:rgba(148,163,184,0.06);">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
      <b style="font-size:0.88rem;">Related companies (${owner.count})</b>
      <span style="display:inline-flex;gap:6px;"><button type="button" class="btn btn--ghost btn--sm" data-opall="proceed">Proceed with all</button><button type="button" class="btn btn--ghost btn--sm" data-opall="skip">Skip all</button></span>
    </div>
    <div style="font-size:0.78rem;color:#64748B;margin-top:2px;">Companies whose owner or group is already in outreach, or is being added together. Each starts on its suggested choice; “Proceed and mention” lets templates name the related companies ({{owner.otherCompanies}}). Every choice is kept in the company's Activities.</div>
    ${rows}${owner.flagged.length < owner.count ? `<div style="font-size:0.78rem;color:#64748B;margin-top:6px;">Showing ${owner.flagged.length} of ${owner.count}; the others go ahead (Proceed).</div>` : ''}
  </div>`;
}

// The bulk buttons.
export function wireOwnerPanel(root) {
  root?.querySelectorAll('[data-opall]').forEach((b) => b.addEventListener('click', () => {
    root.querySelectorAll('.op-row input[type="radio"]').forEach((r) => { if (r.value === b.dataset.opall) r.checked = true; });
  }));
}

// { companyId: 'proceed' | 'skip' | 'mention' } for every flagged company shown.
export function readOwnerChoices(root) {
  const out = {};
  root?.querySelectorAll('.op-row').forEach((row) => { const v = row.querySelector('input[type="radio"]:checked')?.value; if (v) out[row.dataset.opid] = v; });
  return out;
}
