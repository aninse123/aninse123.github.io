// Contacted + Flags columns (27 Oct 2026, switch search.contactColumns): how a
// company was contacted, one icon per channel, and what limits contacting it.
// The summary rule is the twin of functions/outreach/contact_summary.js (a test
// checks they agree): touches.<channel> = { n, at, by, outcome, inAt }.
// 📣 shows only while the company is in a running campaign; once it's over, what
// happened stays in the channel icons (green = answered, red = bounced /
// unsubscribed) and in the hover, which also lists the campaigns it was in.

export const CHANNELS = ['email', 'call', 'letter', 'linkedin', 'whatsapp', 'visit', 'meeting', 'intro'];
const TYPE_CHANNEL = {
  email: 'email', email_received: 'email', letter: 'letter', call_attempted: 'call', call_connected: 'call',
  whatsapp: 'whatsapp', linkedin: 'linkedin', in_person: 'visit', meeting_scheduled: 'meeting', meeting_done: 'meeting', warm_intro: 'intro',
};
const ANSWER_TYPES = ['email_received'];
const ANSWERED_TYPES = ['call_connected', 'meeting_done'];
export const ANSWER_OUTCOMES = ['replied', 'accepted', 'connected', 'met'];
const ms = (t) => (t?.toMillis ? t.toMillis() : t?.seconds != null ? t.seconds * 1000 : t?._seconds != null ? t._seconds * 1000 : t ? new Date(t).getTime() : 0);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The whole summary from a company's activities.
export function summaryOf(activities, now = Date.now()) {
  const out = {};
  for (const a of activities || []) {
    if (!a || a.isTest || a.recordDeleted) continue;
    const ch = TYPE_CHANNEL[a.type];
    if (!ch) continue;
    const t = ms(a.date || a.createdAt);
    if (!t || t > now) continue;
    const s = out[ch] || (out[ch] = { n: 0, at: null, by: null, outcome: null, inAt: null });
    const answered = ANSWER_TYPES.includes(a.type) || ANSWERED_TYPES.includes(a.type) || ANSWER_OUTCOMES.includes(a.outcome);
    if (answered && t > ms(s.inAt)) s.inAt = a.date || a.createdAt;
    if (ANSWER_TYPES.includes(a.type)) continue;
    s.n++;
    if (t >= ms(s.at)) { s.at = a.date || a.createdAt; s.by = a.createdBy || null; s.outcome = a.outcome || (a.type === 'call_attempted' ? 'no_answer' : a.type === 'call_connected' ? 'connected' : null); }
  }
  return out;
}

export const CH_ICON = { email: '✉', call: '📞', letter: '📮', linkedin: 'in', whatsapp: '💬', visit: '🏢', meeting: '🗓', intro: '🤝' };
export const CH_LABEL = { email: 'Email', call: 'Call', letter: 'Letter', linkedin: 'LinkedIn', whatsapp: 'WhatsApp', visit: 'Visit', meeting: 'Meeting', intro: 'Warm intro' };
const OUTCOME = { no_answer: 'no answer', connected: 'connected', voicemail: 'voicemail', wrong_number: 'wrong number', callback: 'call back', posted: 'posted', returned: 'returned', sent: 'sent', not_on_whatsapp: 'not on WhatsApp', replied: 'replied', request_sent: 'request sent', accepted: 'accepted', messaged: 'messaged', viewed: 'viewed', not_found: 'not found', met: 'met', not_there: 'nobody there', reschedule: 'to reschedule', done: 'done' };
const day = (t) => (ms(t) ? new Date(ms(t)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');

// A channel's state: 'bad' (email bounced / unsubscribed), 'ok' (answered), '' (contacted).
export function stateOf(c, ch) {
  const s = c?.touches?.[ch];
  if (ch === 'email' && ['bounced', 'unsubscribed'].includes(c?.outreachStatus)) return 'bad';
  if (s?.inAt || (ch === 'email' && c?.outreachStatus === 'replied')) return 'ok';
  return '';
}
// The channels to show, in a fixed order; email also when only the old status says so.
export function channelsOf(c) {
  const t = c?.touches || {};
  return CHANNELS.filter((ch) => t[ch]?.n || t[ch]?.inAt || (ch === 'email' && ['contacted', 'replied', 'bounced', 'unsubscribed'].includes(c?.outreachStatus)));
}
// One line per channel for the hover: "Email · 3 sent · last 14 Oct by André · replied 16 Oct".
export function channelLine(c, ch, nameOf = (x) => x) {
  const s = c?.touches?.[ch] || {};
  const verb = ch === 'email' || ch === 'letter' ? 'sent' : '';
  const who = s.by && !/^(scheduler|system|resend-webhook|gmail)$/.test(s.by) ? ` by ${nameOf(s.by)}` : '';
  const parts = [CH_LABEL[ch]];
  if (s.n) parts.push(`${s.n}${verb ? ' ' + verb : '×'}`);
  if (s.at) parts.push(`last ${day(s.at)}${who}${s.outcome && OUTCOME[s.outcome] ? ' — ' + OUTCOME[s.outcome] : ''}`);
  if (ch === 'email' && c?.outreachStatus === 'bounced') parts.push('bounced');
  else if (ch === 'email' && c?.outreachStatus === 'unsubscribed') parts.push('unsubscribed');
  else if (s.inAt) parts.push(`${ch === 'email' || ch === 'linkedin' || ch === 'whatsapp' ? 'replied' : 'answered'} ${day(s.inAt)}`);
  return parts.join(' · ');
}
export function contactedHtml(c) {
  const icons = channelsOf(c).map((ch) => `<span class="ct ct--${stateOf(c, ch) || 'plain'}${ch === 'linkedin' ? ' ct--txt' : ''}" data-ct="${ch}">${CH_ICON[ch]}</span>`).join('');
  const camp = c?.activeCampaignName ? '<span class="ct ct--camp" data-ct="campaign">📣</span>' : '';
  return camp + icons || '<span class="ct-none">—</span>';
}

// Flags: do not contact, not contactable, excluded sector — with the why.
export function flagsOf(c) {
  const out = [];
  if (c?.doNotContact?.on) out.push({ key: 'dnc', icon: '🚫', text: `Do not contact${c.doNotContact.at ? ` — since ${day(c.doNotContact.at)}` : ''}${c.doNotContact.by ? ` by ${String(c.doNotContact.by).split('@')[0]}` : ''}${c.doNotContact.reason ? `: ${c.doNotContact.reason}` : ''}` });
  if (c?.contactable === false) out.push({ key: 'nc', icon: '⛔', text: `Not contactable${c.contactableSource === 'rules' ? ' — from the contactable rules' : ' — set by hand'}${c.contactableNote ? `: ${c.contactableNote}` : ''}` });
  if (c?.stage === 'pass' && c?.reasonExcluded === 'outside_sector') out.push({ key: 'excl', icon: '⊘', text: `Excluded sector${c.caeCode ? ` — CAE ${c.caeCode}` : ''}${c.sector ? ` (${c.sector})` : ''}` });
  return out;
}
export const flagsHtml = (c) => flagsOf(c).map((f) => `<span class="ct ct--flag" data-flag="${f.key}" title="${esc(f.text)}">${f.icon}</span>`).join('') || '';

// The hover card: every channel, the campaign now, the campaigns before (loaded on hover).
export function tipHtml(c, { nameOf = (x) => x, enrolments = null } = {}) {
  const lines = channelsOf(c).map((ch) => `<div class="ct-line ct-line--${stateOf(c, ch) || 'plain'}">${CH_ICON[ch]} ${esc(channelLine(c, ch, nameOf))}</div>`);
  if (c?.activeCampaignName) lines.unshift(`<div class="ct-line">📣 In <b>${esc(c.activeCampaignName)}</b> now</div>`);
  const past = (enrolments || []).filter((e) => !['pending', 'active', 'awaiting_approval', 'awaiting_task', 'paused'].includes(e.status));
  if (enrolments === null && (c?.activeCampaignName || channelsOf(c).length)) lines.push('<div class="ct-line ct-dim">Campaigns: loading…</div>');
  else if (past.length) lines.push(`<div class="ct-line ct-dim">Campaigns before: ${past.slice(0, 6).map((e) => esc(`${e.campaignName || 'Campaign'} (${enrolEnd(e)})`)).join('; ')}</div>`);
  return lines.join('') || '<div class="ct-line ct-dim">Not contacted yet.</div>';
}
export function enrolEnd(e) {
  if (/^Left out by the campaign's paths/.test(e.stopReason || '')) return 'left out by paths';
  const when = day(e.endedAt);
  return ({ replied: 'replied', completed: 'finished, no reply', stopped: 'stopped', removed: 'removed', moved: 'moved' }[e.status] || e.status) + (when ? ' ' + when : '') + (e.status === 'stopped' && e.stopReason ? ` — ${e.stopReason}` : '');
}

export const CT_CSS = `
  .ct-cell { white-space: nowrap; }
  .ct { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 3px; margin-right: 2px; border-radius: 5px; font-size: 0.8rem; line-height: 1; background: #F1EEE7; color: #4B5563; cursor: default; }
  .ct--txt { font-weight: 700; font-size: 0.68rem; font-family: Arial, sans-serif; }
  .ct--ok { background: #E6F2EB; color: #2F6B4F; box-shadow: inset 0 0 0 1px #A8D5B9; }
  .ct--bad { background: #FBEDED; color: #9C2F2F; box-shadow: inset 0 0 0 1px #E8B4B4; }
  .ct--camp { background: #E8F0F8; }
  .ct--flag { background: transparent; }
  .ct-none { color: #9CA3AF; }
  #ctTip { position: fixed; z-index: 9999; max-width: 380px; background: #fff; border: 1px solid #D8D3C8; border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,0.14); padding: 8px 10px; font-size: 0.8rem; line-height: 1.45; pointer-events: none; }
  .ct-line--ok { color: #2F6B4F; } .ct-line--bad { color: #9C2F2F; } .ct-dim { color: #6B7280; margin-top: 3px; }
`;
