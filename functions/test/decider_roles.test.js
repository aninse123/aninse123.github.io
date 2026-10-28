// Who counts as a decision-maker (28 Oct 2026, plan "Decision-Maker Roles"):
// one list of roles that never make someone a decision-maker (roles.js), used by
// the same-owner rule (related.deciderRank) and the best-person ladder
// (recipients.rankPerson); a "Sócio" with no recorded stake holds a share.
// Role names taken from the data (sample of 4,000 current management links).
const { NOT_DECIDER_RE, deciderRoles } = require("../outreach/roles.js");
const { rankPerson } = require("../outreach/recipients.js");
const { deciderRank, isDecider } = require("../outreach/related.js");

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
// shCurrent left out = Orbis has no shareholding record for them (51 of 507 sócios in the sample).
const link = (roles, extra = {}) => ({ personEntityType: "person", mgmtCurrent: true, mgmtRoles: roles, ...extra });

const OUT = ["Insolvency Administrator", "Administrador da Insolvência", "Liquidatário", "Member of the Audit Board", "Chairman (Audit Committee)", "Presidente do Conselho Fiscal",
  "Voter of the General and Supervisory Board", "Vogal do Conselho Geral e de Supervisão", "Member of the General Council", "Vice Chairman of the General Board", "Member (Supervisory Board)",
  "Vogal do Conselho de Curadores", "Member of Board of Trustees", "Member of the Board of the Foundation", "Provedor", "Vogal do Conselho Consultivo", "Voter of the Advisory Board",
  "Member of the Technical Board", "Vogal da Comissão de Vencimentos", "Member of the Remunerations Committee", "Representative", "Representante", "Procurador", "Attorney", "General Contact", "None",
  "Revisor Oficial de Contas", "Presidente da Mesa da Assembleia Geral", "General Meeting Vice President", "Secretário", "No specific function"];
const KEEP = ["Manager-Partner", "Sócio Gerente", "Gerente", "Manager", "Voter of the Board of Directors", "Vogal do Conselho de Administração", "Chairman of the Board of Directors",
  "Presidente do Conselho de Administração", "Director General", "Director Geral", "General Manager", "Administrador Unico", "Delegate Administrator", "Chief Executive Officer",
  "President of the Executive Committee", "Member of the Board of Managers", "Financial Director", "Commercial Director", "Non-Executive Director (Board of Directors)", "Founder", "Sócio", "Partner"];
ok(`left out (${OUT.length}): insolvency, audit / fiscal (PT and EN), supervisory and general councils, trustees, advisory / technical / remuneration, representatives, attorneys, assembly, secretary`, OUT.every((r) => NOT_DECIDER_RE.test(r)));
ok(`still decision-makers (${KEEP.length}): board of directors, executive committee, gerentes, director-geral, CEO, directors, sócio`, KEEP.every((r) => !NOT_DECIDER_RE.test(r)) && deciderRoles(["Gerente", "Insolvency Administrator"]).join() === "Gerente");

// Best-person ladder (who receives the email)
ok("best person: an insolvency administrator is never picked (was ranked like a hired gerente)", rankPerson(link(["Administrador da Insolvência", "Insolvency Administrator"])) === 0);
ok("best person: the chairman of the audit board / fiscal council is never picked (was ranked like a president)", rankPerson(link(["Presidente do Conselho Fiscal"])) === 0 && rankPerson(link(["Chairman of the Audit Board"])) === 0);
ok("best person: a representative or attorney is never picked", rankPerson(link(["Representante", "Representative"])) === 0 && rankPerson(link(["Procurador"])) === 0);
ok("best person unchanged for real roles: gerente 100, board member 60, majority owner who manages 180", rankPerson(link(["Gerente"])) === 100 && rankPerson(link(["Voter of the Board of Directors"])) === 60 && Math.floor(rankPerson(link(["Gerente"], { shCurrent: true, shDirectPct: 60 }))) === 180);
ok("R7: a Sócio with no recorded stake is a shareholder (120); with a management role an owner-manager (140)", Math.floor(rankPerson(link(["Sócio", "Partner"]))) === 120 && Math.floor(rankPerson(link(["Sócio", "Financial Director"]))) === 140);
ok("…a Sócio role that is no longer current, or a former shareholder, doesn't count", rankPerson(link(["Sócio"], { mgmtCurrent: false })) === 0 && rankPerson(link(["Sócio"], { shCurrent: false })) < 60);

// Same-owner rule
ok("same owner: an insolvency administrator / supervisory board voter no longer relates two companies (the 28 Oct example)", !isDecider(link(["Insolvency Administrator", "Administrador da Insolvência"])) && !isDecider(link(["Voter of the General and Supervisory Board", "Vogal do Conselho Geral e de Supervisão"])) && !isDecider(link(["No specific function"])));
ok("same owner: a sócio, a gerente and a board member still do", isDecider(link(["Sócio"])) && isDecider(link(["Gerente"])) && isDecider(link(["Vogal do Conselho de Administração"])) && deciderRank(link([], { shCurrent: true })) >= 120);

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log("\nall decision-maker role tests passed");
