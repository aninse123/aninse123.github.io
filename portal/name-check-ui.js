// Email name check (26 Oct 2026, switch search.emailNameCheck): the pieces the
// Search CRM and Outreach show when a company's name in emails looks wrong —
// the "Check the email name" section in Add companies, the line on a draft to
// approve and the note on the company's Overview. The rule itself lives in
// email-name-check.js (generated from the server's email_name_check.js).
// Every fix goes through the outreachCampaign action "emailName" (logged on the company).

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SOURCE = { typed: 'typed in the CRM', trade: 'from the Orbis trade name', legal: 'from the legal name' };
const PLAIN = 'text-transform:none;letter-spacing:normal;font-weight:400;';

// One company's controls: the suggestion in a box you can edit, Save, and Keep.
function controls(nc, canEdit) {
  if (!canEdit) return '';
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:4px;">
      <input type="text" data-ncname value="${esc(nc.suggestion || nc.emailName)}" aria-label="New email name for ${esc(nc.companyName)}" style="font:inherit;font-size:0.8rem;padding:3px 7px;border:1px solid #CBD5E1;border-radius:6px;min-width:180px;max-width:100%;">
      <button type="button" class="btn btn--ghost btn--sm" data-ncop="save">Use this name</button>
      <button type="button" class="btn btn--ghost btn--sm" data-ncop="keep">Keep “${esc(nc.emailName)}”</button>
      <span data-ncstate style="font-size:0.76rem;color:#64748B;"></span>
    </div>`;
}

// "Add companies": the flagged companies, to fix before Email 1.
export function nameCheckPanelHtml(list, canEdit = true) {
  if (!Array.isArray(list) || !list.length) return '';
  return `<div class="name-check" style="border:1px solid #F0D9A8;border-left:4px solid #F59E0B;border-radius:8px;padding:10px 12px;margin:10px 0;background:rgba(245,158,11,0.06);">
    <b style="font-size:0.88rem;">Check the email name (${list.length})</b>
    <div style="font-size:0.78rem;color:#64748B;margin-top:2px;">The name each company gets inside the emails ({{company.shortName}}) looks wrong for these. Fix it now, or keep it if it's right — every choice is kept in the company's Activities.</div>
    ${list.map((nc) => `<div class="nc-row" data-ncid="${esc(nc.companyId)}" data-ncsug="${esc(nc.suggestion || '')}" style="padding:7px 0;border-top:1px solid #F0E3C4;font-size:0.82rem;${PLAIN}">
      <div><b>${esc(nc.companyName)}</b></div>
      <div>In emails: “${esc(nc.emailName)}” <span style="color:#64748B;">(${esc(SOURCE[nc.source] || nc.source)})</span> — ${esc(nc.issues.join('; '))}</div>
      ${controls(nc, canEdit)}
    </div>`).join('')}
  </div>`;
}

// The line above a draft to approve. The draft already uses the name: fixing it
// helps the next emails; for this one, edit the text or skip it.
export function nameCheckLine(nc, companyId, canEdit = true) {
  if (!nc) return '';
  return `<div class="nc-row" data-ncid="${esc(companyId)}" data-ncsug="${esc(nc.suggestion || '')}" style="margin:0 0 6px;padding:6px 10px;border-radius:6px;background:#FDF3DC;color:#6B4700;font-size:0.8rem;${PLAIN}">
    ⚠ <b>Email name may be wrong:</b> “${esc(nc.emailName)}” — ${esc(nc.issues.join('; '))}. This draft already uses it: edit the text, or Skip so the next draft uses the fixed name.
    ${controls({ ...nc, companyName: '' }, canEdit)}
  </div>`;
}

// Overview: the note next to the email name (warnings amber, a long name grey).
export function nameCheckNote(issues, nc, companyId, canEdit = true) {
  if (!issues?.length) return '';
  const warn = issues.some((i) => i.level === 'warn');
  return `<div class="nc-row" data-ncid="${esc(companyId)}" data-ncsug="${esc(nc?.suggestion || '')}" style="margin-top:4px;padding:5px 8px;border-radius:6px;font-size:0.78rem;${warn ? 'background:#FDF3DC;color:#6B4700;' : 'background:rgba(148,163,184,0.12);color:#475569;'}">
    ${warn ? '⚠ ' : ''}${esc(issues.map((i) => i.text).join('; '))}
    ${warn && nc ? controls(nc, canEdit) : ''}
  </div>`;
}

// The buttons: call(payload) → the action's result ({ emailName }).
export function wireNameCheck(root, call, onChanged) {
  root?.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-ncop]'); if (!b) return;
    const row = b.closest('.nc-row'); if (!row) return;
    const state = row.querySelector('[data-ncstate]');
    const typed = (row.querySelector('[data-ncname]')?.value || '').replace(/\s+/g, ' ').trim();
    const sug = row.dataset.ncsug || '';
    const payload = b.dataset.ncop === 'keep' ? { action: 'emailName', companyId: row.dataset.ncid, op: 'keep' }
      : typed && typed === sug ? { action: 'emailName', companyId: row.dataset.ncid, op: 'use' }
      : { action: 'emailName', companyId: row.dataset.ncid, op: 'set', name: typed };
    if (payload.op === 'set' && !typed) { if (state) state.textContent = 'Type the name first.'; return; }
    row.querySelectorAll('button,input').forEach((x) => { x.disabled = true; });
    if (state) state.textContent = 'Saving…';
    try {
      const r = (await call(payload))?.data || {};
      if (state) state.textContent = r.kept ? `✓ Kept “${r.emailName}”` : `✓ Now “${r.emailName}”`;
      onChanged?.(row.dataset.ncid, r);
    } catch (e) {
      row.querySelectorAll('button,input').forEach((x) => { x.disabled = false; });
      if (state) state.textContent = String(e?.message || e).replace(/^(FirebaseError:\s*)?/, '');
    }
  });
}
