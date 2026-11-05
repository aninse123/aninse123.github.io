// Calendar invites as objects (5 Nov 2026, switch outreach.inviteManage). An invite is an .ics file attached to an email (portal/attachments.js builds
// it). When such an email is sent, the invite is registered here (outreachInvites/<uid>): who it went to, the guests and their answers, the visit
// task it booked. From it the portal can send an UPDATE (the same UID, SEQUENCE + 1, so each calendar replaces the event) or a CANCEL
// (METHOD:CANCEL), and a calendar answer (Accepted / Declined / Tentative, an iTIP REPLY) that comes back by email updates the guest's line
// instead of counting as a reply from the company.

const { getStorage } = require("firebase-admin/storage");
const store = require("./store");
const Feat = require("../features");

const { db, FieldValue, Timestamp } = store;

const idOf = (uid) => String(uid || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
const lc = (s) => String(s || "").trim().toLowerCase();

// ── Reading an .ics ─────────────────────────────────────────────────────────
const unfold = (t) => String(t || "").replace(/\r?\n[ \t]/g, "");
const unesc = (s) => String(s || "").replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
function icsDate(v) {
  const m = String(v || "").trim().match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}
function parseIcs(text) {
  const lines = unfold(text).split(/\r?\n/);
  const val = (name) => { const l = lines.find((x) => new RegExp(`^${name}[;:]`, "i").test(x)); return l ? l.slice(l.indexOf(":") + 1).trim() : ""; };
  const person = (l) => ({ email: lc((l.match(/mailto:([^;\s]+)/i) || [])[1]), name: unesc(((l.match(/CN=("([^"]*)"|[^;:]*)/i) || [])[2] ?? (l.match(/CN=([^;:]*)/i) || [])[1] ?? "")), status: String((l.match(/PARTSTAT=([A-Za-z-]+)/i) || [])[1] || "NEEDS-ACTION").toUpperCase() });
  const attendees = lines.filter((l) => /^ATTENDEE[;:]/i.test(l)).map(person).filter((a) => a.email);
  const orgLine = lines.find((l) => /^ORGANIZER[;:]/i.test(l));
  return {
    method: val("METHOD").toUpperCase(), uid: val("UID"), sequence: Number(val("SEQUENCE")) || 0,
    start: icsDate(val("DTSTART")), end: icsDate(val("DTEND")),
    summary: unesc(val("SUMMARY")), location: unesc(val("LOCATION")), description: unesc(val("DESCRIPTION")), url: val("URL"),
    organizer: orgLine ? person(orgLine) : null, attendees,
  };
}

// ── Writing an .ics (the same shape as portal/attachments.js buildIcs, with METHOD and SEQUENCE) ──
const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function fold(line) {
  const out = []; let cur = "", bytes = 0;
  for (const ch of line) { const b = Buffer.byteLength(ch); if (bytes + b > 74) { out.push(cur); cur = " " + ch; bytes = 1 + b; } else { cur += ch; bytes += b; } }
  out.push(cur);
  return out.join("\r\n");
}
function buildIcs({ method = "REQUEST", uid, sequence = 0, title, start, end, location = "", description = "", link = "", organizer, attendees = [], now = new Date() }) {
  const where = location || link, text = [link ? `Ligação para a reunião: ${link}` : "", description].filter(Boolean).join("\n\n");
  const cn = (n, e) => `CN=${esc(n || e).replace(/:/g, "")}`;
  const cancelled = method === "CANCEL";
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Outreach//Invite 1.0//EN", "CALSCALE:GREGORIAN", `METHOD:${method}`, "BEGIN:VEVENT",
    `UID:${uid}`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SEQUENCE:${sequence}`, `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`, "TRANSP:OPAQUE",
    `SUMMARY:${esc(title)}`, ...(where ? [`LOCATION:${esc(where)}`] : []), ...(text ? [`DESCRIPTION:${esc(text)}`] : []),
    ...(link ? [`URL:${link}`] : []), ...(/^https:\/\/meet\.google\.com\//i.test(link) ? [`X-GOOGLE-CONFERENCE:${link}`] : []),
    `ORGANIZER;${cn(organizer.name, organizer.email)}:mailto:${organizer.email}`,
    ...attendees.map((a) => `ATTENDEE;${cn(a.name, a.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`),
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

const isIcsFile = (a) => a && (/calendar/i.test(a.contentType || "") || /\.ics$/i.test(a.filename || ""));
const readText = async (path) => { const [buf] = await getStorage().bucket().file(path).download(); return buf.toString("utf8"); };
const switchOn = async () => (await Feat.jobState("outreach.inviteManage")) !== "off";

// ── Registering an invite when its email is sent (best effort: the email has already gone) ──
// p: the prepared email (attachments resolved, recipients), res: what deliverEmail returned.
async function registerSent({ p, res, callerEmail }) {
  try {
    if (!(await switchOn())) return 0;
    let n = 0;
    for (const a of p.attachments || []) {
      if (!isIcsFile(a) || !a.storagePath) continue;
      const ics = parseIcs(await readText(a.storagePath));
      if (ics.method !== "REQUEST" || !ics.uid || !ics.start) continue;
      const end = ics.end || new Date(ics.start.getTime() + 30 * 60000);
      const to = (p.toList || [p.to]).filter(Boolean), cc = p.ccList || [];
      const ref = db().doc(`outreachInvites/${idOf(ics.uid)}`);
      if ((await ref.get()).exists) continue; // an update of an invite that is already registered: the update action keeps the record
      await ref.set({
        uid: ics.uid, sequence: ics.sequence, status: "active",
        title: ics.summary, start: Timestamp.fromDate(ics.start), end: Timestamp.fromDate(end), location: ics.location, notes: ics.description.replace(/^Ligação para a reunião: \S+\n*/, "").trim(), link: ics.url || "",
        organizer: ics.organizer || null,
        guests: ics.attendees.map((g) => ({ email: g.email, name: g.name || "", status: "NEEDS-ACTION" })),
        to, cc, senderId: p.senderId || null, threadId: res.threadId, messageId: res.messageId, companyId: p.companyId || null, companyName: p.company?.name || p.thread?.companyName || null,
        taskId: null, meetingActivityId: null, isTest: !!res.isTest,
        createdAt: FieldValue.serverTimestamp(), createdBy: callerEmail || null,
      });
      n++;
    }
    return n;
  } catch (e) { console.warn("invites: could not register", e.message); return 0; }
}

// ── A calendar answer that arrived by email: update the guest's line. Returns the invite id, or null when it is not one of ours. ──
const STATUS_OF = { ACCEPTED: "ACCEPTED", DECLINED: "DECLINED", TENTATIVE: "TENTATIVE" };
async function applyReply(attachments) {
  try {
    if (!(await switchOn())) return null;
    for (const a of attachments || []) {
      if (!isIcsFile(a) || !a.storagePath) continue;
      const ics = parseIcs(await readText(a.storagePath));
      if (ics.method !== "REPLY" || !ics.uid) continue;
      const ref = db().doc(`outreachInvites/${idOf(ics.uid)}`);
      const snap = await ref.get();
      if (!snap.exists) continue;
      const guests = (snap.data().guests || []).map((g) => ({ ...g }));
      let changed = false;
      for (const att of ics.attendees) {
        const status = STATUS_OF[att.status]; if (!status) continue;
        const g = guests.find((x) => lc(x.email) === att.email);
        if (g) { g.status = status; g.answeredAt = Timestamp.now(); changed = true; }
        else { guests.push({ email: att.email, name: att.name || "", status, answeredAt: Timestamp.now(), extra: true }); changed = true; }
      }
      if (changed) await ref.update({ guests, updatedAt: FieldValue.serverTimestamp() });
      return { id: ref.id, uid: ics.uid, answers: ics.attendees.map((x) => ({ email: x.email, status: x.status })) };
    }
  } catch (e) { console.warn("invites: could not apply a calendar answer", e.message); }
  return null;
}

module.exports = { parseIcs, buildIcs, idOf, registerSent, applyReply, isIcsFile, switchOn };
