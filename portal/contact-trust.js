// How far a contact detail (email, phone, LinkedIn…) can be trusted (30 Oct 2026, switch contacts.trustLabels).
// Twin of functions/outreach/contact_trust.js: keep the two identical. One status at a time:
// confirmed / tool / unverified / bounced, worked out from three facts stored apart on the detail
// (searchPeople.reach[]): origin (team | person | database | enrichment), toolStatus (verified | unconfirmed)
// and confirmedAt / confirmedBy (a person checked it). "bounced" replaces every other status.

export const STATUS = {
  confirmed: 'Confirmed',
  tool: 'Tool-verified',
  unverified: 'Not verified',
  bounced: 'Bounced',
};

// entry: a reach entry, or { origin: 'database' | 'team', type } for a value that has no entry
// (Orbis values, the typed fields on a person, company contacts). No origin = an old detail typed by the team.
export function trustOf(entry) {
  const e = entry || {};
  if (e.status === 'bounced') return 'bounced';
  if (e.confirmedAt) return 'confirmed';
  const origin = e.origin || 'team';
  if (origin === 'team' || origin === 'person') return 'confirmed';
  if (origin === 'database') return 'tool';
  // enrichment: only an email can be tool-verified; LinkedIn and phones never are
  return e.type === 'email' && e.toolStatus === 'verified' ? 'tool' : 'unverified';
}

// The general address of a company (searchCompanies.companyEmail), 30 Oct: from the registry / Orbis (tool-verified),
// confirmed by a person (companyEmailConfirmedAt, for that address), bounced when that address hard-bounced
// (companyEmailBounce). Both facts belong to ONE address: change the address and they no longer apply.
const lc = (s) => String(s || '').trim().toLowerCase();
export function companyEmailEntry(c) {
  const e = lc(c && c.companyEmail);
  const bounced = !!(c && c.companyEmailBounce && lc(c.companyEmailBounce.email) === e);
  const confirmed = !!(c && c.companyEmailConfirmedAt && lc(c.companyEmailConfirmedFor) === e);
  return { origin: 'database', type: 'email', status: bounced ? 'bounced' : 'ok', confirmedAt: confirmed ? c.companyEmailConfirmedAt : null, confirmedBy: confirmed ? c.companyEmailConfirmedBy || null : null };
}
export const companyEmailTrust = (c) => trustOf(companyEmailEntry(c));
// `day` turns a stored date (ISO text or a Firestore timestamp) into text.
export function companyEmailTitle(c, day = (v) => String(v || '').slice(0, 10)) {
  const e = companyEmailEntry(c), bits = ['From the registry or the Orbis database'];
  if (e.status === 'bounced') { const b = c.companyEmailBounce || {}; bits.push('an email to it bounced' + (b.at ? ' on ' + day(b.at) : '') + (b.reason ? ' (' + b.reason + ')' : '')); }
  if (e.confirmedAt) bits.push(c.companyEmailConfirmedVia === 'reply' ? 'confirmed: they replied from it on ' + day(e.confirmedAt) : 'confirmed by ' + String(e.confirmedBy || '').split('@')[0] + ' on ' + day(e.confirmedAt));
  else bits.push('not confirmed by a person');
  return bits.join(' · ');
}

// Usable for sending: confirmed and tool-verified by default; not verified only when the campaign allows it.
export const usable = (key, includeUnverified = false) => key === 'confirmed' || key === 'tool' || (key === 'unverified' && !!includeUnverified);

// What hovering shows: where it came from, what the tool said, who confirmed it and when. Never the tool's name.
export function trustTitle(entry, day = (iso) => String(iso || '').slice(0, 10)) {
  const e = entry || {};
  const bits = [];
  const origin = e.origin || 'team';
  bits.push(origin === 'database' ? 'From the Orbis database' : origin === 'enrichment' ? 'Found by an enrichment tool' : origin === 'person' ? 'Given by the person or company' : 'Typed by the team');
  if (origin === 'enrichment') bits.push(e.type === 'email' ? (e.toolStatus === 'verified' ? 'the tool says it is valid' : 'the tool could not confirm it') : 'the tool does not check this kind of detail');
  if (e.status === 'bounced') bits.push('an email to it bounced');
  if (e.confirmedAt) bits.push(e.confirmedVia === 'reply' ? 'confirmed: they replied from it' + (e.confirmedAt ? ' on ' + day(e.confirmedAt) : '') : 'confirmed by ' + String(e.confirmedBy || '').split('@')[0] + (e.confirmedAt ? ' on ' + day(e.confirmedAt) : ''));
  else if (origin === 'enrichment' || origin === 'database') bits.push('not confirmed by a person'); // typed by the team counts as a person's work
  return bits.join(' · ');
}

// The pill, as html. `esc` is the page's escaper.
export function trustPillHtml(key, title, esc = (s) => s) {
  return `<span class="trust trust--${key}" title="${esc(title || '')}">${esc(STATUS[key])}</span>`;
}

export const TRUST_CSS = `
  .trust { display: inline-block; border-radius: 999px; padding: 1px 9px; font-size: 0.72rem; font-weight: 600; white-space: nowrap; }
  .trust--confirmed { background: #dff1e5; color: #1d7a43; }
  .trust--tool { background: #fbe9c4; color: #8f5300; }
  .trust--unverified { background: #e2e7ea; color: #4d5a63; }
  .trust--bounced { background: #f8dcd6; color: #a3321f; }
  .trust-text--bounced { text-decoration: line-through; }`;
