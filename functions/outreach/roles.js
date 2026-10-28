// Who counts as a decision-maker (28 Oct 2026, André — plan "Decision-Maker
// Roles", R1–R4, R7). One list for the whole portal: the same-owner rule
// (related.js), the best-person ladder (recipients.rankPerson), the approval box
// and the Search CRM (portal/owner-panel.js, search.html — same pattern, a test
// checks they agree) and the ownership tool (Tools/ownership-graph).
//
// Never a decision-maker: professionals appointed to many companies, and bodies
// that supervise, advise or represent rather than run the company —
//   auditors, fiscal / Audit Board (PT and EN), statutory, assembly, secretary,
//   "no specific function"; insolvency administrators, liquidators, judicial
//   administrators; General Council, General and Supervisory Board, Supervisory
//   Board; trustees and foundation boards (Curadores, Conselho Fundador,
//   Provedor); advisory, technical and remuneration bodies; representatives,
//   attorneys (procurador), "General Contact", "None".
// Still decision-makers: the Board of Directors (chairman, vogais), executive
// committee, administrador único / delegado, gerente, director-geral, CEO and
// functional directors.
const NOT_DECIDER_RE = new RegExp([
  "fiscal", "auditor", "revisor", "\\bROC\\b", "statutory", "\\baudit\\b",
  "assembl", "general meeting", "secret[aá]ri", "secretary", "no specific function", "sem fun[cç][aã]o",
  "insolv", "liquidat", "administrador judicial", "judicial administrator",
  "supervis", "conselho geral", "general (and supervisory )?(board|council)",
  "curador", "trustee", "conselho fundador", "board of the foundation", "provedor", "\\bprovider\\b",
  "consultiv", "advisory", "conselho t[eé]cnico", "technical board", "vencimentos", "remunera",
  "representative", "representante", "procurador", "attorney", "general contact", "^none$",
].join("|"), "i");
// R7 (28 Oct): "Sócio" / "Partner" with no recorded stake still holds a share.
const SOCIO_RE = /^\s*(s[óo]cio|partner)\s*$/i;

const deciderRoles = (roles) => (roles || []).filter((r) => !NOT_DECIDER_RE.test(r));

module.exports = { NOT_DECIDER_RE, SOCIO_RE, deciderRoles };
