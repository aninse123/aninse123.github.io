// Read state per person (3 Nov 2026). A conversation has `unread: true` from the moment an email comes in. Who has seen it is kept per
// person: thread.readBy[<key>] = when that person opened it, or answered it (the portal's send writes the answerer's own key).
// Unread for me = unread, and I have not opened or answered it since the last email came in (lastInboundAt; older conversations:
// lastMessageAt). So when one partner opens or answers a conversation the other still sees it as unread, and a new email makes it unread
// for both again. (An answer sent from Gmail cannot be tied to a person: it marks the conversation read for everyone, as before.)

export const readKeyOf = (email) => String(email || '').split('@')[0].replace(/[^A-Za-z0-9_]/g, '_') || 'user';
const ms = (v) => (v && v.toMillis ? v.toMillis() : v && v.seconds != null ? v.seconds * 1000 : v ? new Date(v).getTime() : 0);

export function isUnreadFor(thread, email) {
  if (!thread || !thread.unread) return false;
  const seen = ms(thread.readBy && thread.readBy[readKeyOf(email)]);
  return !(seen && seen >= (ms(thread.lastInboundAt) || ms(thread.lastMessageAt)));
}
