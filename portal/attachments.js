// Files on outgoing email and calendar invites (3 Nov 2026, switch outreach.attachments). Same limits as functions/outreach/files.js: documents,
// spreadsheets, slides, images and calendar invites; at most 5 files, 10 MB each, 20 MB together. Pure helpers: the page does the uploading.

export const MAX_FILES = 5, MAX_EACH = 10 * 1024 * 1024, MAX_TOTAL = 20 * 1024 * 1024;
export const TYPES = {
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', ics: 'text/calendar',
};
export const extOf = (name) => String(name || '').toLowerCase().split('.').pop();
export const allowedName = (name) => Object.prototype.hasOwnProperty.call(TYPES, extOf(name)) && String(name).includes('.');
export const contentTypeFor = (name) => TYPES[extOf(name)] || 'application/octet-stream';
export const safeName = (name) => String(name || 'file').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120);
export const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((Number(n) || 0) / 1024)) + ' KB');

// Is this file OK to add to what is already attached? Returns '' or the reason.
export function fileProblem(file, already = []) {
  if (!allowedName(file.name)) return `${file.name}: not an allowed type (documents, spreadsheets, slides, images, calendar invites).`;
  if (file.size > MAX_EACH) return `${file.name}: larger than ${MAX_EACH / 1048576} MB.`;
  if (already.length >= MAX_FILES) return `At most ${MAX_FILES} files per email.`;
  if (already.reduce((a, f) => a + (Number(f.size) || 0), 0) + file.size > MAX_TOTAL) return `The files would add up to more than ${MAX_TOTAL / 1048576} MB.`;
  return '';
}

// ── Calendar invite (.ics) ──
// Lisbon wall-clock time → the instant (handles summer time), so the invite is written in UTC and shows right in any calendar.
export function lisbonToUtc(dateStr, timeStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number), [hh, mm] = String(timeStr).split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off = (t) => {
    const g = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
    return Date.UTC(+g.year, +g.month - 1, +g.day, +g.hour, +g.minute) - t;
  };
  let t = guess - off(guess); t = guess - off(t);
  return new Date(t);
}
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// Lines longer than 75 bytes are folded (RFC 5545): a CRLF and a space.
function fold(line) {
  const enc = new TextEncoder(), out = []; let cur = '', bytes = 0;
  for (const ch of line) { const b = enc.encode(ch).length; if (bytes + b > 74) { out.push(cur); cur = ' ' + ch; bytes = 1 + b; } else { cur += ch; bytes += b; } }
  out.push(cur);
  return out.join('\r\n');
}
// link: the meeting link (Google Meet, Teams, Zoom…). It goes where each calendar looks for it: the location (when none is given), the description,
// the event URL, and, for Google Meet, Google's own conference property (Gmail then shows its Join button).
export function buildIcs({ uid, title, start, minutes = 30, location = '', description = '', link = '', organizer, attendees = [], now = new Date() }) {
  const end = new Date(start.getTime() + minutes * 60000);
  const where = location || link, text = [link ? `Ligação para a reunião: ${link}` : '', description].filter(Boolean).join('\n\n');
  const cn = (n, e) => `CN=${esc(n || e).replace(/:/g, '')}`;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Outreach//Invite 1.0//EN', 'CALSCALE:GREGORIAN', 'METHOD:REQUEST', 'BEGIN:VEVENT',
    `UID:${uid}`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, 'SEQUENCE:0', 'STATUS:CONFIRMED', 'TRANSP:OPAQUE',
    `SUMMARY:${esc(title)}`, ...(where ? [`LOCATION:${esc(where)}`] : []), ...(text ? [`DESCRIPTION:${esc(text)}`] : []),
    ...(link ? [`URL:${link}`] : []), ...(/^https:\/\/meet\.google\.com\//i.test(link) ? [`X-GOOGLE-CONFERENCE:${link}`] : []),
    `ORGANIZER;${cn(organizer.name, organizer.email)}:mailto:${organizer.email}`,
    ...attendees.map((a) => `ATTENDEE;${cn(a.name, a.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`),
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
