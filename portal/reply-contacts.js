// Contact details found in a reply (3 Nov 2026). The signature of a reply carries phone numbers, other emails, the website, often a postal
// address and the company's NIPC. This finds them (plain patterns, no AI: Portuguese signatures are regular) and compares them with what the
// CRM already has, so the Inbox can show "already on file" or "new — add". Nothing is saved here; the page adds one detail per click.

const lc = (s) => String(s || '').trim().toLowerCase();
const digits = (s) => String(s || '').replace(/\D/g, '');

// What the sender wrote of their own: cut at the first quoted / forwarded block, so the old message's signature is never read.
export function ownText(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n'), out = [];
  let cut = lines.length;
  for (const [n, l] of lines.entries()) {
    if (/^\s*(?:de|from|enviad[ao]|sent|para|to|assunto|subject)\s*:/i.test(l) && out.some((x) => x.trim())) { cut = n; break; }
    if (/^\s*-{2,}\s*(?:original|mensagem|forwarded|message)/i.test(l) || /^\s*_{5,}\s*$/.test(l) || /^\s*>/.test(l)) { cut = n; break; }
    if (/^\s*(?:em|on)\s.+(?:escreveu|wrote)\s*:?\s*$/i.test(l)) { cut = n; break; }
    out.push(l);
  }
  // Some mail programs (Gmail, plain text) put the signature after the quoted message: a "-- " line below the quote starts it
  const sig = lines.slice(cut).findLastIndex((l) => /^--\s*$/.test(l));
  if (sig >= 0) out.push(...lines.slice(cut + sig, cut + sig + 12));
  return out.join('\n');
}

// Portuguese numbers: 9 digits starting 2 (landline) or 9 (mobile), with or without +351, in any grouping (232 448 531, 91 460 52 02, 21 950 3600)
export function phoneKind(n9) { return /^9[1236]/.test(n9) ? 'mobile' : /^2\d/.test(n9) ? 'landline' : 'other'; }
export function findPhones(text) {
  const out = [], seen = new Set();
  const re = /(?:(?:\+|00)\s*\(?351\)?[\s.-]*)?\b[29](?:[\s.-]?\d){8}\b/g;
  for (const line of String(text || '').split('\n')) {
    if (/\b(?:nipc|nif|contribuinte|fax)(?![a-z])/i.test(line) && !/\b(?:tel|m[oó]vel|tlm|tm)(?![a-z])/i.test(line)) continue; // a tax number or a fax is not a phone
    let m; re.lastIndex = 0;
    while ((m = re.exec(line))) {
      let d = digits(m[0]);
      if (d.startsWith('00351')) d = d.slice(5); else if (d.startsWith('351') && d.length === 12) d = d.slice(3);
      if (d.length !== 9 || seen.has(d)) continue;
      const kind = phoneKind(d); if (kind === 'other') continue;
      seen.add(d);
      out.push({ norm: d, kind, display: `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` });
    }
  }
  return out;
}

export function findEmails(text, { ignore = () => false } = {}) {
  const out = [], seen = new Set();
  for (const m of String(text || '').matchAll(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) {
    const e = lc(m[0]).replace(/[.,;:)]+$/, '');
    if (seen.has(e) || ignore(e) || /^(?:no-?reply|noreply|mailer-daemon)@/.test(e)) continue;
    seen.add(e); out.push(e);
  }
  return out;
}

export function findUrls(text) {
  const out = [], seen = new Set();
  for (const m of String(text || '').matchAll(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:pt|com|eu|org|net|es|info|biz)(?:\/[^\s<>")]*)?/gi)) {
    const raw = m[0].replace(/[.,;:)]+$/, '');
    const before = m.input.slice(Math.max(0, m.index - 1), m.index);
    if (before === '@' || before === '.' || raw.includes('@')) continue; // the domain of an email address is not a website
    const host = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
    if (!host.includes('.') || seen.has(host)) continue;
    seen.add(host);
    out.push({ host, url: /^https?:/i.test(raw) ? raw : 'https://' + raw, linkedin: /linkedin\.com/.test(host) });
  }
  return out;
}

export function findNipc(text) {
  const m = String(text || '').match(/\b(?:nipc|nif|contribuinte)(?![a-z])[^0-9]{0,14}(\d{3}[\s.]?\d{3}[\s.]?\d{3})\b/i);
  return m ? digits(m[1]) : '';
}

// "Rua da Quinta da Serra Nº4 / Paradinha / 3510-107 Viseu - Portugal" → { street, postcode, place }. The street is the line that looks like
// one (Rua, Avenida, Estrada, Zona Industrial, Lote…), with the locality lines between it and the postcode; a line that does not look like
// an address (a name, a greeting, a phone) is never taken, and nothing is guessed.
const STREET = /^(?:r\.?|rua|av\.?|avenida|tv\.?|travessa|largo|lg\.?|pra[cç]a|p[cç]a\.?|estrada|e\.?n\.?|zona|z\.?i\.?|lote|lt\.?|urb\.?|urbaniza[cç][aã]o|parque|edif[ií]cio|beco|caminho|cam\.?|alameda|p[oó]lo|quinta|lugar|apartado|bairro|cal[cç]ada|campo|rotunda|sitio)(?![a-z])/i;
export function findAddress(text) {
  const lines = String(text || '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/(?:^|\s)(\d{4}-\d{3})\s+([^,\n–-]+?)\s*(?:[-–,].*)?$/);
    if (!m || !/[A-Za-zÀ-ÿ]/.test(m[2])) continue;
    // the street and the postcode on the same line: "Av Brasil 17, 11º 2005-136 Santarém - Portugal"
    const before = lines[i].slice(0, lines[i].indexOf(m[1])).replace(/[,\s-]+$/, '').trim();
    if (before && STREET.test(before)) return { street: before, postcode: m[1], place: m[2].trim() };
    const prev = [];
    for (let j = i - 1; j >= 0 && prev.length < 3; j--) {
      const l = lines[j]; if (!l) continue;
      if (/@|https?:|www\.|\b(?:tel|tlm|tlf|m[oó]vel|fax|nipc|nif|chamada)(?![a-z])|\(\+?\d{2,3}\)|\b\d{3}\s?\d{3}\s?\d{3}\b/i.test(l)) break;
      prev.unshift(l);
    }
    const k = prev.findIndex((l) => STREET.test(l)); // the first street-like line: "Av. José Saramago - Majapoas" then "Apartado 14" are both the address
    if (k < 0) continue;
    return { street: prev.slice(k).filter((l) => l.split(' ').length <= 8).join(', ').replace(/[,;]+$/, ''), postcode: m[1], place: m[2].trim() };
  }
  return null;
}

export function extractContacts(text, { ignoreEmail = () => false } = {}) {
  const t = ownText(text);
  return { phones: findPhones(t), emails: findEmails(t, { ignore: ignoreEmail }), urls: findUrls(t), nipc: findNipc(t), address: findAddress(t) };
}

// What the CRM has, to compare with. company: the searchCompanies doc; peopleEmails / peoplePhones: those of the people at the company.
export function compareContacts(found, { company = {}, peopleEmails = [], peoplePhones = [], senderEmail = '', senderPhones = [], known = [], people = [], senderName = '' } = {}) {
  const reachOf = (t) => (company.reach || []).filter((e) => e && e.type === t).map((e) => e.value);
  const hostOf = (u) => lc(u).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const pcOf = (v) => (String(v || '').match(/\d{4}-\d{3}/) || [])[0];
  const have = {
    phones: new Set([company.companyPhone, ...reachOf('phone'), ...peoplePhones, ...senderPhones].map((p) => digits(p).slice(-9)).filter(Boolean)),
    emails: new Set([company.companyEmail, ...reachOf('email'), ...(company.contacts || []).map((c) => c.email), ...peopleEmails, ...known].map(lc).filter(Boolean)),
    hosts: new Set([company.website, ...reachOf('website')].map(hostOf).filter(Boolean)),
    postcodes: new Set([company.postcode, pcOf(company.hqAddress), ...reachOf('address').map(pcOf)].filter(Boolean)),
  };
  // Where it is on file, to say so: "the company", or the person's name
  const phoneWhere = (n) => [company.companyPhone, ...reachOf('phone')].some((p) => digits(p).slice(-9) === n) ? 'the company' : senderPhones.some((p) => digits(p).slice(-9) === n) ? (senderName || 'the sender') : peoplePhones.some((p) => digits(p).slice(-9) === n) ? 'a person' : '';
  const emailWhere = (e) => [company.companyEmail, ...reachOf('email'), ...(company.contacts || []).map((c) => c.email)].map(lc).includes(e) ? 'the company' : ((p) => p ? p.name + (p.role ? ` (${String(p.role).split(/,\s*/)[0]})` : '') : '')(people.find((p) => (p.emails || []).map(lc).includes(e))) || (peopleEmails.map(lc).includes(e) ? 'a person' : known.map(lc).includes(e) ? 'this conversation' : '');
  const items = [];
  for (const p of found.phones) items.push({ type: 'phone', kind: p.kind, value: p.display, norm: p.norm, have: have.phones.has(p.norm), where: phoneWhere(p.norm), target: p.kind === 'mobile' ? 'person' : 'company' });
  // The address that wrote: offered first when no record of the company has it (the conversation knowing it is not the CRM knowing it)
  const from = lc(senderEmail);
  const inCrm = new Set([company.companyEmail, ...reachOf('email'), ...(company.contacts || []).map((c) => c.email), ...peopleEmails].map(lc).filter(Boolean));
  const senderNew = !!from && !inCrm.has(from);
  if (senderNew) items.push({ type: 'email', value: from, have: false, target: 'person', sender: true });
  for (const e of found.emails) if (!(senderNew && e === from)) items.push({ type: 'email', value: e, have: have.emails.has(e), where: emailWhere(e), target: 'company' });
  for (const u of found.urls) items.push({ type: u.linkedin ? 'linkedin' : 'website', value: u.url, host: u.host, have: u.linkedin ? false : have.hosts.has(u.host), where: 'the company', target: 'company' });
  if (found.address) {
    const a = found.address;
    items.push({ type: 'address', value: `${a.street}, ${a.postcode} ${a.place}`, address: a, have: have.postcodes.has(a.postcode), where: 'the company', target: 'company' });
  }
  const nif = digits(company.nif || company.vatNumber || '').slice(-9);
  const nipc = found.nipc ? { value: found.nipc, matches: nif ? nif === found.nipc : null } : null;
  return { items, nipc };
}

// Who in the company wrote? The sender's name as it is in the email header, against the people of the company: the same name, or the sender's
// words all inside one person's full name ("Raul Abraão" is "Raul Jorge Marques Abraao"), accepting only a single such person. A sender with
// no name or a single word is matched on the email instead: first initial + surname ("rabraao@…" = Raul … Abraao). Returns the person or null.
const deburr = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const nameWords = (v) => deburr(v).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter((w) => w.length > 1 && !['de', 'da', 'do', 'dos', 'das', 'e', 'sr', 'sra', 'dr', 'dra', 'eng'].includes(w));
export function guessPerson(people, fromName, fromEmail) {
  const list = (people || []).filter((p) => p && p.name), f = nameWords(fromName);
  const exact = f.length ? list.filter((p) => nameWords(p.name).join(' ') === f.join(' ')) : [];
  if (exact.length === 1) return exact[0];
  if (f.length >= 2) {
    const sub = list.filter((p) => { const t = nameWords(p.name); return f.every((w) => t.includes(w)); });
    if (sub.length === 1) return sub[0];
    if (sub.length > 1) return null;
  }
  const local = deburr(String(fromEmail || '').split('@')[0]).replace(/[^a-z]/g, '');
  if (local.length >= 4) {
    const hits = list.filter((p) => { const t = nameWords(p.name); return t.length >= 2 && (local === t[0][0] + t[t.length - 1] || local === t[0] + t[t.length - 1] || local === t[0][0] + t[t.length - 2] + t[t.length - 1]); });
    if (hits.length === 1) return hits[0];
  }
  return null;
}
