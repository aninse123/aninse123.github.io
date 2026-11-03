// A company's own email, phone, LinkedIn, website and address (3 Nov 2026, contacts.trustLabels). The first of each kind is a single field on
// the company (companyEmail …), from the registry / Orbis; more are added to searchCompanies.reach. The ★ on an added one makes it the
// company's own value: the old one moves into the list, and the field is marked as chosen by the team, so an Orbis import never writes over it.

import { trustOf, companyEmailTrust } from './contact-trust.js';

export const PRIMARY_FIELDS = { email: 'companyEmail', phone: 'companyPhone', linkedin: 'linkedinUrl', website: 'website', address: 'hqAddress' };
const lc = (s) => String(s || '').trim().toLowerCase();

// entry: the reach entry that becomes the company's own. Returns { patch, list } (patch = fields to write on the company), or null.
export function swapCompanyPrimary(c, entry, { by = '', at = '', newId = () => 'old' + Math.random().toString(36).slice(2, 10) } = {}) {
  const field = entry && PRIMARY_FIELDS[entry.type];
  if (!field) return null;
  const old = c[field], isMail = entry.type === 'email';
  const list = (c.reach || []).filter((e) => e && e.id !== entry.id);
  if (old && lc(old) !== lc(entry.value)) {
    const bounced = isMail && c.companyEmailBounce && lc(c.companyEmailBounce.email) === lc(old);
    const confirmed = isMail && c.companyEmailConfirmedAt && lc(c.companyEmailConfirmedFor) === lc(old);
    list.push({
      id: newId(), type: entry.type, value: old, source: 'orbis', origin: 'database', primary: false, addedBy: by, addedAt: at,
      note: bounced ? (c.companyEmailBounce.kind === 'no_mx' ? 'no mail servers' : 'bounced') : 'previous main (registry / Orbis)',
      status: bounced ? 'bounced' : 'ok',
      ...(confirmed ? { confirmedAt: c.companyEmailConfirmedAt, confirmedBy: c.companyEmailConfirmedBy || null } : {}),
    });
  }
  const patch = { [field]: entry.value, reach: list, companyPrimaryChosen: { ...(c.companyPrimaryChosen || {}), [field]: { by, at } } };
  if (isMail) {
    // The confirmation and the bounce belong to one address: the new one has its own. Typed by the team = confirmed by the team.
    const typed = (entry.origin || 'team') === 'team' || entry.origin === 'person';
    const confirmedAt = entry.confirmedAt || (typed ? entry.addedAt || at : null);
    Object.assign(patch, confirmedAt
      ? { companyEmailConfirmedAt: confirmedAt, companyEmailConfirmedBy: entry.confirmedBy || entry.addedBy || by || null, companyEmailConfirmedFor: lc(entry.value), companyEmailConfirmedVia: entry.confirmedVia || null }
      : { companyEmailConfirmedAt: null, companyEmailConfirmedBy: null, companyEmailConfirmedFor: null, companyEmailConfirmedVia: null });
    if (c.companyEmailBounce && lc(c.companyEmailBounce.email) !== lc(entry.value)) patch.companyEmailBounce = null; // it moved to the old entry's status
  }
  return { patch, list };
}

// The company's emails in the order they are used (3 Nov): the registry / chosen one first while it works; when it bounced or its domain has
// no mail servers, the next usable one comes first (an added email, in order) and the dead one goes last. Outreach already skips it; this
// is what the screens show and offer first.
export function companyEmailsInOrder(c) {
  const main = c && c.companyEmail, dead = !!main && companyEmailTrust(c) === 'bounced';
  const extra = ((c && c.reach) || []).filter((e) => e && e.type === 'email' && (e.status || 'ok') === 'ok' && trustOf(e) !== 'bounced' && lc(e.value) !== lc(main));
  return { usable: [...(main && !dead ? [{ value: main, entry: null }] : []), ...extra.map((e) => ({ value: e.value, entry: e }))], dead: dead ? main : null };
}
// The one the Overview shows first when the company's own email is dead; null when the own email works (or nothing else is usable).
export const firstUsableCompanyEmail = (c) => { const o = companyEmailsInOrder(c); return o.dead && o.usable[0] ? o.usable[0].entry : null; };

// The company's address as a person would write it, and as Google Maps can find it (3 Nov): the street line, then the postcode and the
// municipality — "Rua da Industria, 7, 2860-706 Moita" — not just the street name from the registry. The stored fields are not changed.
// Orbis writes the street line in capitals: those are turned into words (accents cannot be restored: "Industria" stays "Industria").
const SMALL = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'na', 'no']);
export function niceCase(s) {
  const t = String(s || '').trim();
  if (!t || /[a-zà-ÿ]/.test(t)) return t; // already mixed case: leave it
  return t.toLowerCase().split(/(\s+)/).map((w, i) => {
    const raw = t.split(/(\s+)/)[i];
    if (/^\s*$/.test(w)) return raw;
    if (SMALL.has(w)) return w;
    if (/[\d/]/.test(raw) || raw.replace(/[^A-ZÀ-Ý]/g, '').length <= 2) return raw; // numbers, C/V, EN, N.º stay as written
    return w.replace(/(^|[-(])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
  }).join('').replace(/^./, (m) => m.toUpperCase());
}
export function fullAddress(c) {
  if (!c) return '';
  const street = niceCase(c.hqAddress), pc = String(c.postcode || '').trim();
  const place = niceCase(c.concelho || c.city);
  const tail = [pc && !street.includes(pc) ? pc : '', place && !street.toLowerCase().includes(place.toLowerCase()) ? place : ''].filter(Boolean).join(' ');
  return [street, tail].filter(Boolean).join(', ');
}

// An import row's fields, without the ones the team chose (companyPrimaryChosen) on that company.
export function withoutChosen(match, payload) {
  const chosen = (match && match.companyPrimaryChosen) || {}, out = { ...payload };
  for (const f of Object.values(PRIMARY_FIELDS)) if (chosen[f]) delete out[f];
  return out;
}

// The company form saved a different value for one of these fields: it is the team's choice from now on.
export function chosenAfterEdit(prev, changed, by = '', at = '') {
  const out = { ...((prev && prev.companyPrimaryChosen) || {}) };
  let any = false;
  for (const f of Object.values(PRIMARY_FIELDS)) if (f in changed && changed[f]) { out[f] = { by, at }; any = true; }
  return any ? out : null;
}
