// This team's identity for the pages — who the admin and founders are, who to
// contact, which hostnames are the live site. One file per team: Phase 0 keeps
// Douro's here; the deploy script (WP8) builds it from instances/<alias>/
// instance.json. It must say the same as that file (tests/portal checks).
//
// The pages decide who is Admin from the sign-in token (role === 'admin'); this
// file only supplies the lists that need to exist before a token does (the
// login screen) and the names shown next to people.
export const INSTANCE = {
  orgName: 'Douro Partners',
  productionHosts: ['douropartners.pt', 'www.douropartners.pt'],
  adminEmails: ['andre.rocha@douropartners.pt'],
  // email, short key (owner / sender), first name for badges and labels
  founders: [
    { email: 'andre.rocha@douropartners.pt', key: 'andre', name: 'André Rocha', shortName: 'André' },
    { email: 'antonio.carvalho@douropartners.pt', key: 'antonio', name: 'António Carvalho', shortName: 'António' },
  ],
  // Who to write to when someone has no access
  contacts: [
    { name: 'André', email: 'andre.rocha@douropartners.pt' },
    { name: 'António', email: 'antonio.carvalho@douropartners.pt' },
  ],
};
export const founderByEmail = (email) => INSTANCE.founders.find((f) => f.email === String(email || '').trim().toLowerCase()) || null;
export const isAdminEmail = (email) => INSTANCE.adminEmails.includes(String(email || '').trim().toLowerCase());
