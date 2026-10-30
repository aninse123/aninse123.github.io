// Fields for who an email goes to (30 Oct 2026, plan step 5, switch outreach.multiRecipient):
//   {{recipient.firstName}}  the person's first name; empty for a general company address
//   {{recipient.role}}       their role at the company, when it is a real role (not "Shareholder 60%")
//   {{recipient.isMale}} / {{recipient.isFemale}} / {{recipient.isUnknown}}   "1" for the one that applies, the others empty
//                            any word that agrees with gender: {{?recipient.isMale|ligado}}{{?recipient.isFemale|ligada}}{{?recipient.isUnknown|ligado(a)}}
//   {{recipient.isPerson}}   "1" for a named person, empty for a general address
//   {{recipient.isCompany}}  "1" for a general address, empty for a named person
// With {{?recipient.isPerson| … }} and {{?recipient.isCompany| … }} one template carries both wordings.
// Gender comes from the company's own list of owners when the person is one of them (typed by the team), else from the
// first name: a list of common Portuguese names, then the ending (-a feminine, -o masculine); anything else is unknown
// and the neutral "(a)" form is used. Same logic as portal/recipient-fields.js (parity test).

const strip = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const set = (s) => new Set(s.split(/\s+/).filter(Boolean));

const FEMALE = set(`ana maria joana catarina beatriz ines sofia mariana rita marta carolina filipa patricia sara sandra susana teresa
paula helena isabel raquel cristina claudia sonia vera vanessa diana andreia liliana carla carmen fatima gabriela leonor madalena
margarida matilde mafalda monica natalia olga rosa rute ruth salome silvia tania telma ursula vitoria alice amelia angela anabela
aurora barbara bianca bruna camila celia clara constanca daniela debora dulce elisa elsa emilia eva fernanda flavia francisca graca
irene iris jessica judite julia juliana lara laura lia lidia lourdes lucia luisa luiza manuela marcia marisa marlene micaela nadia
nelia noemia odete paloma rafaela regina renata sabrina stella tatiana valentina veronica yara zita zulmira albertina alexandra
alzira amalia antonia arminda augusta benedita berta brigida carlota carminda celeste cidalia conceicao deolinda dora edite eduarda
elena estela ester etelvina felismina gloria guiomar herminia idalina ilda isaura ivone joaquina lena lilia lurdes mara mirian
miriam nazare nidia noelia olivia ondina orlanda palmira piedade quiteria ramona rosalia rosana rosalina sandrina selma serafina
sheila shirley soraia suzana tereza vilma violeta virginia yolanda zelia lisete lucilia odila ofelia otilia yasmin cecilia
elisabete amelie anna anne annette birgit brigitte carole caroline catherine charlotte christine christina claire corinne danielle dominique elisabeth elke emilie eva francoise gabrielle gisela heidi helga ingrid isabelle jacqueline jane jennifer jeanne julie karin katharina katrin laetitia laura lisa louise margaret margarete marie marianne martina michele monique nathalie nicole petra renate sabine sandrine sophie stephanie susanne sylvie ursula valerie veronique yvonne bibiana`);
const MALE = set(`joao jose antonio manuel francisco carlos paulo pedro luis miguel rui nuno tiago diogo goncalo ricardo bruno andre
fernando jorge sergio fabio hugo rafael daniel david eduardo filipe henrique vasco vitor victor tomas tome simao samuel ruben rodrigo
ramiro mario marco marcelo mauricio lucas leonardo leandro julio joaquim jaime igor helder gustavo gabriel fernao emanuel duarte
domingos dinis cesar claudio cristiano bernardo benjamim augusto armando artur arthur anibal alvaro alexandre alberto adriano afonso
alfredo americo amadeu aurelio baltasar belmiro camilo celso damiao delfim edgar edmundo elias emilio ernesto estevao eurico
evaristo fausto felix flavio florentino gaspar gil gilberto guilherme heitor horacio humberto ivo jacinto januario jeronimo jonas
josue lauro lino lourenco luciano ludgero marcos martim matias mateus maximino nelson nicolau norberto octavio otavio orlando oscar
osvaldo patricio placido raul reinaldo renato roberto rogerio romeu salvador saulo sebastiao severino silvio silvestre tadeu
teodoro timoteo valdemar valentim vicente vladimir wilson xavier zacarias luca joshua nicola bautista baptista
christian olivier stefan stephan thomas raphael didier matthias juan simon juergen jurgen patrick hans axel franck frank jean francois jacques georges john stephen peter christoph richard martin norbert dieter javier klaus davide jesus pascal eric roman edward cedric laurent yan karlheinz jean-luc jean-louis stephane yohann joachim hannes antoine sebastien florent karim gerard valter hernani asdrubal valtencir serafim jonatas gilson michael michel andreas alexander alex max paul peter marc mark marcus lars jens kai uwe wolfgang helmut gerhard herbert rainer ralf robert ronald rolf sven tim tobias tom ulrich walter werner william james david jose pierre philippe alain bernard christophe daniel dominique emmanuel fabrice guillaume hugues ivan jan jorge juan lucien luc marcel mathieu maurice nicolas olaf oliver oskar pablo pedro rene roger roland sergei serge vincent xavier yves kohei bo`);

function genderOfFirstName(name) {
  const first = strip(String(name || "").trim().split(/\s+/)[0]).replace(/[^a-z]/g, "");
  if (!first) return "";
  if (FEMALE.has(first)) return "F";
  if (MALE.has(first)) return "M";
  if (first.length > 2 && first.endsWith("a")) return "F";
  if (first.length > 2 && first.endsWith("o")) return "M";
  return "";
}

const fullKey = (s) => strip(s).replace(/\s+/g, " ");
// owners: company.emailOwners = [{ name, gender: "M" | "F" | "" }]
// stored: { gender, source } kept on the person (searchPeople.gender / genderSource). Typed by the team wins over everything;
// then the company's owners list; then a stored guess; then a fresh guess from the first name.
function genderOf(name, owners = [], stored = null) {
  const k = fullKey(name); // the full name must match: the same first name can be someone else (and some names are unisex)
  const o = (Array.isArray(owners) ? owners : []).find((x) => x && (x.gender === "M" || x.gender === "F") && fullKey(x.name) === k);
  const st = stored && (stored.gender === "M" || stored.gender === "F") ? stored : null;
  if (st && st.source === "typed") return st.gender;
  return o ? o.gender : st ? st.gender : genderOfFirstName(name);
}

function cleanRole(role) {
  const r = String(role || "").trim();
  return !r || /shareholder|^contact$|company address|%/i.test(r) ? "" : r;
}

function recipientContext({ name = "", role = "", owners = [], stored = null } = {}) {
  const full = String(name || "").replace(/\s+/g, " ").trim();
  const first = full.split(" ")[0] || "";
  const g = first ? genderOf(full, owners, stored) : "";
  return {
    firstName: first, role: first ? cleanRole(role) : "",
    gender: g, isMale: g === "M" ? "1" : "", isFemale: g === "F" ? "1" : "", isUnknown: first && !g ? "1" : "",
    isPerson: first ? "1" : "", isCompany: first ? "" : "1",
  };
}

module.exports = { genderOfFirstName, genderOf, cleanRole, recipientContext };
