// Team directory (team access, Phase 2) — who can own a company / investor /
// contact and be given tasks: everyone on the team, not only André and
// António. Read from teamDirectory (key, name, active; kept by the server),
// with the two partners as a fallback until team access is set up.
import { db, addReads } from './firebase-config.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const FALLBACK = [
  { key: 'andre', name: 'André Rocha', partner: true, active: true },
  { key: 'antonio', name: 'António Carvalho', partner: true, active: true },
];
let cache = null;

// [{ key, name, label, partner, active }] — partners first, then by name.
export async function loadDirectory() {
  if (cache) return cache;
  let list = FALLBACK;
  try {
    const snap = await getDocs(collection(db, 'teamDirectory'));
    addReads(snap.size || 1);
    if (!snap.empty) list = snap.docs.map(d => d.data());
  } catch (e) { list = FALLBACK; }
  // Short label = first name, unless two people share it.
  const first = (n) => String(n || '').trim().split(/\s+/)[0] || n;
  const count = {};
  list.forEach(m => { const f = first(m.name); count[f] = (count[f] || 0) + 1; });
  cache = list.map(m => ({ ...m, label: count[first(m.name)] > 1 ? m.name : first(m.name) }))
    .sort((a, b) => (b.partner ? 1 : 0) - (a.partner ? 1 : 0) || (a.key === 'andre' ? -1 : b.key === 'andre' ? 1 : 0) || a.label.localeCompare(b.label));
  return cache;
}

// Options for an owner / assignee select: active people (+ the current value
// even if that person has left, so the record still shows who owned it).
export function ownerOptionsHtml(dir, selected = '') {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return dir.filter(m => m.active || m.key === selected)
    .map(m => `<option value="${esc(m.key)}"${m.key === selected ? ' selected' : ''}>${esc(m.label)}${m.active ? '' : ' (left)'}</option>`).join('');
}

// Fill the page's label map (OWNER_LABELS[key] = "Maria") and rebuild every
// <select data-owner-select> in place, keeping its non-person options
// ("All owners", "—", "Unassigned"…) and its current value.
export async function applyDirectory(labels) {
  const dir = await loadDirectory();
  dir.forEach(m => { labels[m.key] = m.label; });
  const people = new Set([...dir.map(m => m.key), 'andre', 'antonio']);
  document.querySelectorAll('select[data-owner-select]').forEach(sel => {
    const cur = sel.value;
    const keep = [...sel.options].filter(o => !people.has(o.value)).map(o => o.outerHTML).join('');
    sel.innerHTML = keep + ownerOptionsHtml(dir, cur);
    sel.value = cur;
  });
  return dir;
}

// Is this a person on the team (for imports that carry an owner column)?
export function isTeamKey(dir, key) { return dir.some(m => m.key === key); }
