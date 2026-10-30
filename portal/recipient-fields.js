// Page twin of functions/outreach/recipient_fields.js (same logic, parity test): fields for who an email goes to
// ({{recipient.firstName}}, .role, .ligado, .isPerson, .isCompany), for the template preview in Outreach.
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
sheila shirley soraia suzana tereza vilma violeta virginia yolanda zelia lisete lucilia odila ofelia otilia yasmin cecilia`);
const MALE = set(`joao jose antonio manuel francisco carlos paulo pedro luis miguel rui nuno tiago diogo goncalo ricardo bruno andre
fernando jorge sergio fabio hugo rafael daniel david eduardo filipe henrique vasco vitor victor tomas tome simao samuel ruben rodrigo
ramiro mario marco marcelo mauricio lucas leonardo leandro julio joaquim jaime igor helder gustavo gabriel fernao emanuel duarte
domingos dinis cesar claudio cristiano bernardo benjamim augusto armando artur arthur anibal alvaro alexandre alberto adriano afonso
alfredo americo amadeu aurelio baltasar belmiro camilo celso damiao delfim edgar edmundo elias emilio ernesto estevao eurico
evaristo fausto felix flavio florentino gaspar gil gilberto guilherme heitor horacio humberto ivo jacinto januario jeronimo jonas
josue lauro lino lourenco luciano ludgero marcos martim matias mateus maximino nelson nicolau norberto octavio otavio orlando oscar
osvaldo patricio placido raul reinaldo renato roberto rogerio romeu salvador saulo sebastiao severino silvio silvestre tadeu
teodoro timoteo valdemar valentim vicente vladimir wilson xavier zacarias luca joshua nicola bautista baptista`);

export function genderOfFirstName(name) {
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
export function genderOf(name, owners = []) {
  const k = fullKey(name), f = fullKey(String(name || "").trim().split(/\s+/)[0]);
  const o = (Array.isArray(owners) ? owners : []).find((x) => x && (x.gender === "M" || x.gender === "F") && (fullKey(x.name) === k || (f && fullKey(x.name).split(" ")[0] === f)));
  return o ? o.gender : genderOfFirstName(name);
}

export function cleanRole(role) {
  const r = String(role || "").trim();
  return !r || /shareholder|^contact$|company address|%/i.test(r) ? "" : r;
}

export function recipientContext({ name = "", role = "", owners = [] } = {}) {
  const full = String(name || "").replace(/\s+/g, " ").trim();
  const first = full.split(" ")[0] || "";
  const g = first ? genderOf(full, owners) : "";
  return {
    firstName: first, role: first ? cleanRole(role) : "",
    ligado: g === "M" ? "ligado" : g === "F" ? "ligada" : "ligado(a)",
    gender: g, isPerson: first ? "1" : "", isCompany: first ? "" : "1",
  };
}


