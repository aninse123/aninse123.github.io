// Team & access → Claude (Admin only; switch claude.connector).
// One tab for the read-only Claude connector (Infrastructure build plan v2):
//   Access       who may connect (the per-person Claude access tick)
//   Connections  who is connected, from which Claude, Disconnect
//   Settings     sign-in days, limits for everyone, per role, per person
//   Log          calls per person per day (14 days) and the latest 100 calls
// Everything goes through the claudeConnect function: the claude* collections
// are closed to every browser (firestore.rules).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n) => new Intl.NumberFormat('en-GB').format(Math.round(n || 0));
const TZ = 'Europe/Lisbon';
const dt = (ms) => (ms ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(ms)) : '—');
const dayOnly = (ms) => (ms ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }).format(new Date(ms)) : '—');

// Limits as typed in the Settings form → the shape the server keeps.
export function limitsFromForm(rows) {
  const out = {};
  for (const r of rows || []) {
    const k = String(r.key || '').trim();
    if (!k) continue;
    const o = {};
    for (const f of ['hour', 'day', 'rows']) { const n = Math.round(Number(r[f])); if (Number.isFinite(n) && n > 0) o[f] = n; }
    if (Object.keys(o).length) out[k] = o;
  }
  return out;
}
// Settings check before saving: whole numbers in range, or a sentence saying what's wrong.
export function checkSettings(s) {
  const bad = [];
  const inRange = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  if (!inRange(s.signInDays, 1, 365)) bad.push('Sign-in days must be a whole number from 1 to 365.');
  const lim = (name, o) => {
    if (o.hour != null && !inRange(o.hour, 1, 100000)) bad.push(`${name}: calls an hour must be 1 to 100,000.`);
    if (o.day != null && !inRange(o.day, 1, 1000000)) bad.push(`${name}: calls a day must be 1 to 1,000,000.`);
    if (o.rows != null && !inRange(o.rows, 1, 100)) bad.push(`${name}: rows per answer must be 1 to 100.`);
  };
  lim('Everyone', s.defaults || {});
  Object.entries(s.roles || {}).forEach(([k, v]) => lim(`Role ${k}`, v));
  Object.entries(s.people || {}).forEach(([k, v]) => lim(k, v));
  return bad;
}
// Log: usage docs → { days: [...], keys: [...], cell(day, key) }.
export function usageGrid(usage) {
  const days = [...new Set((usage || []).map((u) => u.day))].sort().reverse();
  const keys = [...new Set((usage || []).map((u) => u.key).filter(Boolean))].sort();
  const map = new Map((usage || []).map((u) => [`${u.day}|${u.key}`, u]));
  return { days, keys, cell: (d, k) => map.get(`${d}|${k}`) || null };
}
// Connections: live first, then ended, newest use first.
export function sortConnections(list) {
  return (list || []).slice().sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0) || (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
}
const REASONS = { disconnect: 'Disconnected', refresh_reuse: 'Ended for safety (old token reused)', code_reuse: 'Ended for safety (code reused)', expired: 'Expired (unused)', access_removed: 'Claude access removed', client_revoked: 'Ended from Claude' };
const OUTCOME = { ok: 'badge--green', error: 'badge--amber', denied: 'badge--red', limit: 'badge--red' };

export function createClaudeTab({ root, call, toast, roles = () => [] }) {
  let data = null, section = 'access', busy = false;

  async function load() {
    root.innerHTML = '<div class="card"><p class="empty">Loading…</p></div>';
    try { data = (await call({ action: 'overview' })).data; draw(); }
    catch (e) { root.innerHTML = `<div class="card"><p class="empty">Couldn't load the Claude tab: ${esc(e?.message || e)}</p></div>`; }
  }
  const nameOf = (key) => data?.people?.find((p) => p.key === key)?.name || key || '—';
  async function act(payload, okMsg) {
    if (busy) return; busy = true;
    try { const r = (await call(payload)).data; if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); await load(); }
    catch (e) { toast(e?.message || String(e)); }
    finally { busy = false; }
  }

  function draw() {
    const sw = data.switch?.state || 'off';
    const swBadge = sw === 'on' ? '<span class="badge badge--green">On</span>' : sw === 'test' ? '<span class="badge badge--amber">Test</span>' : '<span class="badge badge--grey">Off</span>';
    const live = data.connections.filter((c) => c.live).length;
    const head = `<div class="u-grid">
      <div class="u-tile"><div class="n">${swBadge}</div><div class="l">Switch claude.connector (Features tab)${sw === 'test' ? ` · testers: ${esc((data.switch.testers || []).join(', ') || 'you')}` : ''}</div></div>
      <div class="u-tile"><div class="n">${data.people.filter((p) => p.claudeAccess).length}</div><div class="l">people with Claude access</div></div>
      <div class="u-tile"><div class="n">${live}</div><div class="l">live connections</div></div>
      <div class="u-tile"><div class="n">${data.index ? nf(data.index.companies) : '—'}</div><div class="l">${data.index ? `companies in the index · built ${dt(data.index.builtAt)}` : 'company index not built yet'}</div></div>
    </div>
    <p class="hint" style="margin-bottom:12px;">Connector address to add in Claude: <code>${esc(data.address)}</code></p>
    <div class="chips" role="tablist" aria-label="Claude sections">${[['access', 'Access'], ['connections', 'Connections'], ['settings', 'Settings'], ['log', 'Log']].map(([k, l]) => `<button class="u-chip${section === k ? ' on' : ''}" data-csec="${k}">${l}</button>`).join('')}</div>`;
    root.innerHTML = head + `<div id="claudeBody">${section === 'access' ? drawAccess() : section === 'connections' ? drawConnections() : section === 'settings' ? drawSettings() : drawLog()}</div>`;
    root.querySelectorAll('[data-csec]').forEach((b) => b.addEventListener('click', () => { section = b.dataset.csec; draw(); }));
    wire();
  }

  function drawAccess() {
    const rows = data.people.map((p) => {
      const blocked = p.status !== 'active' && p.status !== 'invited' ? 'not active' : (!p.ndaSigned && p.roleId !== 'admin') ? 'NDA not ticked' : '';
      return `<tr><td>${esc(p.name)}<div class="hint">${esc(p.email)}</div></td><td>${esc(p.roleId || '—')}</td><td>${blocked ? `<span class="badge badge--amber">${blocked}</span>` : '<span class="badge badge--green">ok</span>'}</td>
        <td class="c"><input type="checkbox" data-access="${esc(p.email)}" ${p.claudeAccess ? 'checked' : ''} aria-label="Claude access for ${esc(p.name)}"></td></tr>`;
    }).join('');
    return `<div class="card"><div class="toolbar"><h2>Who may connect Claude</h2><span class="hint">Off by default. Unticking ends that person's connections at once.</span></div>
      <div class="table-wrap"><table><thead><tr><th>Person</th><th>Role</th><th>Portal access</th><th class="c">Claude access</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">No team records.</td></tr>'}</tbody></table></div>
      <p class="u-note">Claude sees exactly what the person's role sees in the portal, checked on every call. Bank details, settings and keys, team records, logs, usage and the suppression list never leave, even for you.</p></div>`;
  }
  function drawConnections() {
    const rows = sortConnections(data.connections).map((c) => `<tr><td>${esc(nameOf(c.key))}<div class="hint">${esc(c.email)}</div></td><td>${esc(c.clientName)}<div class="hint">${esc(c.surface)}</div></td>
      <td>${dt(c.createdAt)}</td><td>${dt(c.lastUsedAt)}</td><td>${c.live ? `until ${dayOnly(c.expiresAt)}` : `<span class="badge badge--grey">${esc(REASONS[c.revokeReason] || 'Ended')}</span>`}</td>
      <td class="actions">${c.live ? `<button class="btn btn--danger btn--sm" data-disc="${esc(c.id)}">Disconnect</button>` : ''}</td></tr>`).join('');
    return `<div class="card"><div class="toolbar"><h2>Connections</h2><span class="hint">A connection ends when unused for ${data.settings.signInDays} days.</span><span style="flex:1"></span>${data.connections.some((c) => c.live) ? '<button class="btn btn--danger btn--sm" id="discAll">Disconnect everyone</button>' : ''}</div>
      <div class="table-wrap"><table><thead><tr><th>Person</th><th>Client</th><th>Connected</th><th>Last used</th><th>Status</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">Nobody has connected yet.</td></tr>'}</tbody></table></div></div>`;
  }
  function limRow(kind, key, label, o, d) {
    return `<tr data-lim="${kind}" data-key="${esc(key)}"><td>${esc(label)}</td>
      ${['hour', 'day', 'rows'].map((f) => `<td class="num"><input type="number" min="1" step="1" data-f="${f}" value="${o?.[f] ?? ''}" placeholder="${d[f]}" aria-label="${esc(label)} ${f}" style="width:90px;padding:6px 8px;border:1.5px solid var(--border);border-radius:6px;font:inherit;text-align:right;"></td>`).join('')}</tr>`;
  }
  function drawSettings() {
    const s = data.settings, d = s.defaults;
    const roleIds = [...new Set(['partner', 'analyst', 'intern', 'viewer', ...roles().map((r) => r.id)])].filter((r) => r !== 'admin');
    const keys = data.people.filter((p) => p.key).map((p) => p);
    return `<div class="card"><div class="toolbar"><h2>Settings</h2><span class="hint">Apply on the next call. Empty = the line above.</span></div>
      <div style="padding:14px 16px;"><div class="field" style="max-width:260px;"><label for="cSignIn">Sign-in days (unused, 1–365)</label><input type="number" id="cSignIn" min="1" max="365" step="1" value="${s.signInDays}"></div></div>
      <div class="table-wrap"><table class="u-table"><thead><tr><th>Applies to</th><th class="num">Calls an hour</th><th class="num">Calls a day</th><th class="num">Rows per answer (max 100)</th></tr></thead><tbody>
        <tr data-lim="defaults" data-key="defaults"><td><b>Everyone</b></td>${['hour', 'day', 'rows'].map((f) => `<td class="num"><input type="number" min="1" step="1" data-f="${f}" value="${d[f]}" aria-label="Everyone ${f}" style="width:90px;padding:6px 8px;border:1.5px solid var(--border);border-radius:6px;font:inherit;text-align:right;"></td>`).join('')}</tr>
        ${roleIds.map((r) => limRow('role', r, `Role: ${r}`, s.roles[r], d)).join('')}
        ${keys.map((p) => limRow('person', p.key, p.name, s.people[p.key], { ...d, ...(s.roles[p.roleId] || {}) })).join('')}
      </tbody></table></div>
      <p class="err" id="cErr" hidden style="margin:12px 16px;"></p>
      <div class="modal-actions" style="padding:0 16px 16px;"><button class="btn btn--ghost" id="cIndex">Rebuild company index now</button><button class="btn btn--primary" id="cSave">Save settings</button></div></div>`;
  }
  function drawLog() {
    const g = usageGrid(data.usage);
    const rows = g.days.map((d) => `<tr><td>${esc(d)}</td>${g.keys.map((k) => { const c = g.cell(d, k); return `<td class="num">${c ? `${nf(c.calls)}${c.limitHits ? ` <span class="badge badge--red" title="limit reached">${c.limitHits}</span>` : ''}${c.denied ? ` <span class="badge badge--amber" title="refused">${c.denied}</span>` : ''}` : '<span class="muted">—</span>'}</td>`; }).join('')}<td class="num">${nf(g.keys.reduce((s, k) => s + (g.cell(d, k)?.reads || 0), 0))}</td></tr>`).join('');
    const latest = data.latest.map((a) => `<tr><td>${dt(a.at)}</td><td>${esc(nameOf(a.key) || a.email || '—')}</td><td><code>${esc(a.tool || '—')}</code></td><td><span class="badge ${OUTCOME[a.outcome] || 'badge--grey'}">${esc(a.outcome)}</span>${a.reason ? `<div class="hint">${esc(a.reason)}</div>` : ''}</td><td class="num">${nf(a.rows)}</td><td class="num">${nf(a.reads)}</td><td class="hint" style="max-width:320px;white-space:normal;overflow-wrap:anywhere;">${esc(a.args || '')}</td></tr>`).join('');
    return `<div class="card"><div class="toolbar"><h2>Calls per person per day</h2><span class="hint">last 14 days · red = limit reached · amber = refused</span></div>
      <div class="table-wrap"><table class="u-table"><thead><tr><th>Day</th>${g.keys.map((k) => `<th class="num">${esc(nameOf(k))}</th>`).join('')}<th class="num">Reads</th></tr></thead><tbody>${rows || '<tr><td colspan="9" class="empty">No calls yet.</td></tr>'}</tbody></table></div></div>
      <div class="card u-sec"><div class="toolbar"><h2>Latest calls</h2><span class="hint">kept 90 days · filters and ids only, never content</span></div>
      <div class="table-wrap"><table class="u-table"><thead><tr><th>When</th><th>Who</th><th>Tool</th><th>Result</th><th class="num">Rows</th><th class="num">Reads</th><th>Asked for</th></tr></thead><tbody>${latest || '<tr><td colspan="7" class="empty">No calls yet.</td></tr>'}</tbody></table></div></div>`;
  }

  function readSettings() {
    const num = (v) => (v === '' || v == null ? null : Number(v));
    const rowVals = (tr) => Object.fromEntries([...tr.querySelectorAll('[data-f]')].map((i) => [i.dataset.f, num(i.value)]));
    const defaults = rowVals(root.querySelector('tr[data-lim="defaults"]'));
    const pick = (kind) => [...root.querySelectorAll(`tr[data-lim="${kind}"]`)].map((tr) => ({ key: tr.dataset.key, ...rowVals(tr) }));
    return { signInDays: num(root.querySelector('#cSignIn').value), defaults, roles: limitsFromForm(pick('role')), people: limitsFromForm(pick('person')) };
  }
  function wire() {
    root.querySelectorAll('[data-access]').forEach((cb) => cb.addEventListener('change', () => {
      const on = cb.checked;
      act({ action: 'setAccess', email: cb.dataset.access, on }, (r) => (on ? 'Claude access on.' : `Claude access off${r.ended ? `; ${r.ended} connection${r.ended === 1 ? '' : 's'} ended` : ''}.`));
    }));
    root.querySelectorAll('[data-disc]').forEach((b) => b.addEventListener('click', () => act({ action: 'disconnect', connectionId: b.dataset.disc }, 'Disconnected.')));
    const all = root.querySelector('#discAll');
    if (all) all.addEventListener('click', () => {
      if (all.dataset.sure) act({ action: 'disconnectAll' }, (r) => `${r.ended} connection${r.ended === 1 ? '' : 's'} ended.`);
      else { all.dataset.sure = '1'; all.textContent = 'Click again to disconnect everyone'; }
    });
    const save = root.querySelector('#cSave');
    if (save) save.addEventListener('click', () => {
      const s = readSettings();
      const bad = checkSettings(s);
      const err = root.querySelector('#cErr');
      if (bad.length) { err.textContent = bad.join(' '); err.hidden = false; return; }
      err.hidden = true;
      act({ action: 'saveSettings', settings: s }, 'Claude settings saved.');
    });
    const idx = root.querySelector('#cIndex');
    if (idx) idx.addEventListener('click', () => { idx.disabled = true; idx.textContent = 'Building… (about a minute)'; act({ action: 'buildIndex' }, (r) => `Company index rebuilt: ${nf(r.count)} companies.`); });
  }

  return { load };
}
