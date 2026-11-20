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


// Names Orbis writes without accents: "Jose" → "José" (2 Nov 2026, André: JOBASI, Luís; same day: every name on the list, António included,
// always — we write to Portuguese companies, so a foreign Antonio or Mario is rare and harmless). Only the given name at the start (and the
// word after Maria, Ana, José, João, António, Luís), only when it has no accent already — anything the team typed with an accent stays.
const ACCENT_SAFE = "José João Luís Inês Gonçalo Conceição Jerónimo Lourenço Estêvão Fernão Simão Sebastião Salomão Rúben Hélder Fátima Graça Hernâni".split(/\s+/);
const ACCENT_OTHERS = "António Sérgio Fábio Mário Júlio André César Álvaro Emílio Maurício Vítor Márcio Ângelo Aníbal Cláudio Óscar Natália Nádia Mónica Patrícia Bárbara Ângela Cláudia Verónica Vânia Tânia Cecília Sílvia Sónia Márcia Cátia Amélia Aurélio Valério Hélio Lídia Lívia Júlia Luísa Nélia Noémia Olívia Vitória Zélia Brígida Cândida Eugénia Glória Valéria Núria Rosália Tomás Tomé Cândido Emídio Horácio Patrício Teodósio Ágata Fabíola Letícia Ludovina Hermínia Paulina Rosário".split(/\s+/);
const ACCENT_MAP = new Map([...ACCENT_SAFE, ...ACCENT_OTHERS].map((w) => [strip(w), w]));
function accentWord(w) {
  const key = strip(w), f = ACCENT_MAP.get(key);
  if (!f || key !== w.toLowerCase()) return w;                         // unknown, or it already carries an accent
  return w === w.toUpperCase() ? f.toUpperCase() : f;                   // JOSE → JOSÉ, Jose → José
}
export function accentName(name) {
  const t = String(name || "").trim().split(/(\s+)/);
  if (!t.length || !t[0]) return String(name || "");
  const first = strip(t[0]);
  t[0] = accentWord(t[0]);
  if (["maria", "ana", "jose", "joao", "antonio", "luis"].includes(first) && t[2]) t[2] = accentWord(t[2]); // Maria José, José Luís, António Manuel…
  return t.join("");
}

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
// stored: { gender, source } kept on the person (searchPeople.gender / genderSource). Typed by the team wins over everything;
// then the company's owners list; then a stored guess; then a fresh guess from the first name.
export function genderOf(name, owners = [], stored = null) {
  const k = fullKey(name); // the full name must match: the same first name can be someone else (and some names are unisex)
  const o = (Array.isArray(owners) ? owners : []).find((x) => x && (x.gender === "M" || x.gender === "F") && fullKey(x.name) === k);
  const st = stored && (stored.gender === "M" || stored.gender === "F") ? stored : null;
  if (st && st.source === "typed") return st.gender;
  return o ? o.gender : st ? st.gender : genderOfFirstName(name);
}

export function cleanRole(role) {
  const r = String(role || "").trim();
  return !r || /shareholder|^contact$|company address|%/i.test(r) ? "" : r;
}

// 20 Nov (switch outreach.recipientGreeting): {{recipient.greeting}} = "Exmo. Senhor José Silva" / "Exma. Senhora Maria José Santos" —
// the formal opening of a first email to a person. The name as used in emails: the company's "Owners in emails" entry when the person
// is one of them; else the first given name and the last surname of the CRM name (Maria and Ana keep their second given name — "Maria
// José"; a compound surname is never cut — "Castelo Branco", "Silva e Costa", "Sousa-Tavares"). Empty when the gender is unknown (the
// template's fallback is used) or when the switch is off for this send.
const PARTICLE = new Set(["da", "de", "do", "das", "dos", "e", "d'"]);
const COMPOUND_SURNAME = ["castelo branco", "corte real", "espirito santo", "vila nova", "monte real", "sa carneiro", "vaz pinto", "costa cabral", "pinto basto", "sousa coutinho", "mota amaral"];
function properCase(w) {
  const lower = String(w || "").toLowerCase();
  if (PARTICLE.has(lower)) return lower;
  return lower.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("-");
}
function ownerMatch(full, owners) {
  const words = (s) => strip(s).replace(/[^a-z\s-]/g, " ").split(/\s+/).filter((x) => x && !PARTICLE.has(x));
  const me = words(full);
  if (!me.length) return null;
  return (Array.isArray(owners) ? owners : []).find((o) => {
    const ow = words(o?.name);
    return ow.length >= 2 && ow[0] === me[0] && ow[ow.length - 1] === me[me.length - 1] && ow.every((x) => me.includes(x)); // "José Silva" is "JOSE MANUEL DA SILVA"
  }) || null;
}
export function greetingName(name, owners = []) {
  const clean = String(name || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const own = ownerMatch(clean, owners);
  if (own && String(own.name || "").trim()) return accentName(String(own.name).replace(/\s+/g, " ").trim());
  const raw = clean.split(" ");
  const cased = raw.map((w) => (w === w.toUpperCase() || w === w.toLowerCase() ? properCase(w) : w)); // ALL CAPS / all lower from Orbis; typed names stay
  if (cased.length < 2) return accentName(cased.join(" "));
  const first = [cased[0]];
  let i = 1;
  if (["maria", "ana"].includes(strip(cased[0])) && cased.length >= 3 && !PARTICLE.has(cased[1].toLowerCase())) { first.push(cased[1]); i = 2; }
  else if (["maria", "ana"].includes(strip(cased[0])) && cased.length >= 4 && ["de", "da", "do", "das", "dos"].includes(cased[1].toLowerCase())) { first.push(cased[1], cased[2]); i = 3; } // Maria de Fátima, Maria do Céu
  // the last surname, kept whole when it is compound
  let j = cased.length - 1;
  const two = strip(cased.slice(-2).join(" "));
  if (cased.length - 2 >= i && COMPOUND_SURNAME.includes(two)) j = cased.length - 2;
  else if (cased.length - 3 >= i && cased[cased.length - 2].toLowerCase() === "e") j = cased.length - 3; // "Silva e Costa"
  return [...first.map((w) => accentName(w)), ...cased.slice(j)].join(" ");
}
export function greetingOf({ name = "", owners = [], stored = null } = {}) {
  const shown = greetingName(name, owners);
  if (!shown) return "";
  const own = ownerMatch(name, owners);
  const g = own && (own.gender === "M" || own.gender === "F") && !(stored && stored.source === "typed") ? own.gender : genderOf(String(name).replace(/\s+/g, " ").trim(), owners, stored);
  return g === "M" ? `Exmo. Senhor ${shown}` : g === "F" ? `Exma. Senhora ${shown}` : "";
}

export function recipientContext({ name = "", role = "", owners = [], stored = null, greeting = false } = {}) {
  const full = accentName(String(name || "").replace(/\s+/g, " ").trim());
  const first = full.split(" ")[0] || "";
  const g = first ? genderOf(full, owners, stored) : "";
  return {
    firstName: first, role: first ? cleanRole(role) : "",
    gender: g, isMale: g === "M" ? "1" : "", isFemale: g === "F" ? "1" : "", isUnknown: first && !g ? "1" : "",
    isPerson: first ? "1" : "", isCompany: first ? "" : "1",
    greeting: greeting && first ? greetingOf({ name, owners, stored }) : "",
  };
}


