// {{company.inCity}} (9 Oct): the company's municipality (concelho) with the
// right preposition — "em Setúbal", "no Porto", "na Maia". Only municipalities
// André validated are listed; any other gives an empty field, so the template's
// fallback is used ({{company.inCity|nas vossas instalações}}). The portal keeps
// the same table (outreach.html IN_CITY) — tests check they match.
const IN_CITY = {
  "albufeira": "em Albufeira", "alenquer": "em Alenquer", "almeirim": "em Almeirim", "amarante": "em Amarante",
  "arruda dos vinhos": "em Arruda dos Vinhos", "aveiro": "em Aveiro", "barcelos": "em Barcelos", "barreiro": "no Barreiro",
  "braga": "em Braga", "cinfaes": "em Cinfães", "estarreja": "em Estarreja", "faro": "em Faro",
  "figueira da foz": "na Figueira da Foz", "funchal": "no Funchal", "gondomar": "em Gondomar", "leiria": "em Leiria",
  "lisboa": "em Lisboa", "loures": "em Loures", "machico": "em Machico", "mafra": "em Mafra",
  "maia": "na Maia", "matosinhos": "em Matosinhos", "moita": "na Moita", "odemira": "em Odemira",
  "odivelas": "em Odivelas", "ourem": "em Ourém", "palmela": "em Palmela", "portimao": "em Portimão",
  "porto": "no Porto", "santarem": "em Santarém", "santiago do cacem": "em Santiago do Cacém", "seixal": "no Seixal",
  "setubal": "em Setúbal", "sintra": "em Sintra", "tarouca": "em Tarouca", "vila franca de xira": "em Vila Franca de Xira",
  "vila nova de famalicao": "em Vila Nova de Famalicão", "vila nova de gaia": "em Vila Nova de Gaia", "vila do conde": "em Vila do Conde",
};
const placeKey = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
function inCityOf(concelho) { return IN_CITY[placeKey(concelho)] || ""; }

module.exports = { IN_CITY, placeKey, inCityOf };
