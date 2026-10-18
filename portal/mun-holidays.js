// Generated from functions/outreach/places.js by tests/portal/gen_mun_holidays.py — do not edit.
// Municipal holidays for the Search CRM company page (search.html imports it when needed).
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(y, month - 1, day);
}
const munEaster = easter;

// ── Municipalities (14 Oct 2026 data round) — generated: begin. Same block in functions/outreach/places.js and portal/outreach.html.
// IN_CITY: the 308 municipalities with their preposition (em / no / na / nos / nas), checked by André (Arcos de Valdevez and Sobral de Monte Agraço: "em").
const IN_CITY = {
  "abrantes": "em Abrantes", "agueda": "em Águeda", "aguiar da beira": "em Aguiar da Beira",
  "alandroal": "no Alandroal", "albergaria a velha": "em Albergaria-a-Velha", "albufeira": "em Albufeira",
  "alcacer do sal": "em Alcácer do Sal", "alcanena": "em Alcanena", "alcobaca": "em Alcobaça",
  "alcochete": "em Alcochete", "alcoutim": "em Alcoutim", "alenquer": "em Alenquer",
  "alfandega da fe": "em Alfândega da Fé", "alijo": "em Alijó", "aljezur": "em Aljezur",
  "aljustrel": "em Aljustrel", "almada": "em Almada", "almeida": "em Almeida",
  "almeirim": "em Almeirim", "almodovar": "em Almodôvar", "alpiarca": "em Alpiarça",
  "alter do chao": "em Alter do Chão", "alvaiazere": "em Alvaiázere", "alvito": "em Alvito",
  "amadora": "na Amadora", "amarante": "em Amarante", "amares": "em Amares",
  "anadia": "em Anadia", "angra do heroismo": "em Angra do Heroísmo", "ansiao": "em Ansião",
  "arcos de valdevez": "em Arcos de Valdevez", "arganil": "em Arganil", "armamar": "em Armamar",
  "arouca": "em Arouca", "arraiolos": "em Arraiolos", "arronches": "em Arronches",
  "arruda dos vinhos": "em Arruda dos Vinhos", "aveiro": "em Aveiro", "avis": "em Avis",
  "azambuja": "na Azambuja", "baiao": "em Baião", "barcelos": "em Barcelos",
  "barrancos": "em Barrancos", "barreiro": "no Barreiro", "batalha": "na Batalha",
  "beja": "em Beja", "belmonte": "em Belmonte", "benavente": "em Benavente",
  "bombarral": "no Bombarral", "borba": "em Borba", "boticas": "em Boticas",
  "braga": "em Braga", "braganca": "em Bragança", "cabeceiras de basto": "em Cabeceiras de Basto",
  "cadaval": "no Cadaval", "caldas da rainha": "nas Caldas da Rainha", "calheta (acores)": "na Calheta",
  "calheta (madeira)": "na Calheta", "camara de lobos": "em Câmara de Lobos", "caminha": "em Caminha",
  "campo maior": "em Campo Maior", "cantanhede": "em Cantanhede", "carrazeda de ansiaes": "em Carrazeda de Ansiães",
  "carregal do sal": "no Carregal do Sal", "cartaxo": "no Cartaxo", "cascais": "em Cascais",
  "castanheira de pera": "em Castanheira de Pera", "castelo branco": "em Castelo Branco", "castelo de paiva": "em Castelo de Paiva",
  "castelo de vide": "em Castelo de Vide", "castro daire": "em Castro Daire", "castro marim": "em Castro Marim",
  "castro verde": "em Castro Verde", "celorico da beira": "em Celorico da Beira", "celorico de basto": "em Celorico de Basto",
  "chamusca": "na Chamusca", "chaves": "em Chaves", "cinfaes": "em Cinfães",
  "coimbra": "em Coimbra", "condeixa a nova": "em Condeixa-a-Nova", "constancia": "em Constância",
  "coruche": "em Coruche", "corvo": "no Corvo", "covilha": "na Covilhã",
  "crato": "no Crato", "cuba": "em Cuba", "elvas": "em Elvas",
  "entroncamento": "no Entroncamento", "espinho": "em Espinho", "esposende": "em Esposende",
  "estarreja": "em Estarreja", "estremoz": "em Estremoz", "evora": "em Évora",
  "fafe": "em Fafe", "faro": "em Faro", "felgueiras": "em Felgueiras",
  "ferreira do alentejo": "em Ferreira do Alentejo", "ferreira do zezere": "em Ferreira do Zêzere", "figueira da foz": "na Figueira da Foz",
  "figueira de castelo rodrigo": "em Figueira de Castelo Rodrigo", "figueiro dos vinhos": "em Figueiró dos Vinhos", "fornos de algodres": "em Fornos de Algodres",
  "freixo de espada a cinta": "em Freixo de Espada à Cinta", "fronteira": "em Fronteira", "funchal": "no Funchal",
  "fundao": "no Fundão", "gaviao": "no Gavião", "gois": "em Góis",
  "golega": "na Golegã", "gondomar": "em Gondomar", "gouveia": "em Gouveia",
  "grandola": "em Grândola", "guarda": "na Guarda", "guimaraes": "em Guimarães",
  "horta": "na Horta", "idanha a nova": "em Idanha-a-Nova", "ilhavo": "em Ílhavo",
  "lagoa (acores)": "na Lagoa", "lagoa (algarve)": "em Lagoa", "lagos": "em Lagos",
  "lajes das flores": "nas Lajes das Flores", "lajes do pico": "nas Lajes do Pico", "lamego": "em Lamego",
  "leiria": "em Leiria", "lisboa": "em Lisboa", "loule": "em Loulé",
  "loures": "em Loures", "lourinha": "na Lourinhã", "lousa": "na Lousã",
  "lousada": "em Lousada", "macao": "em Mação", "macedo de cavaleiros": "em Macedo de Cavaleiros",
  "machico": "em Machico", "madalena": "na Madalena", "mafra": "em Mafra",
  "maia": "na Maia", "mangualde": "em Mangualde", "manteigas": "em Manteigas",
  "marco de canaveses": "no Marco de Canaveses", "marinha grande": "na Marinha Grande", "marvao": "em Marvão",
  "matosinhos": "em Matosinhos", "mealhada": "na Mealhada", "meda": "na Mêda",
  "melgaco": "em Melgaço", "mertola": "em Mértola", "mesao frio": "em Mesão Frio",
  "mira": "em Mira", "miranda do corvo": "em Miranda do Corvo", "miranda do douro": "em Miranda do Douro",
  "mirandela": "em Mirandela", "mogadouro": "em Mogadouro", "moimenta da beira": "em Moimenta da Beira",
  "moita": "na Moita", "moncao": "em Monção", "monchique": "em Monchique",
  "mondim de basto": "em Mondim de Basto", "monforte": "em Monforte", "montalegre": "em Montalegre",
  "montemor o novo": "em Montemor-o-Novo", "montemor o velho": "em Montemor-o-Velho", "montijo": "no Montijo",
  "mora": "em Mora", "mortagua": "em Mortágua", "moura": "em Moura",
  "mourao": "em Mourão", "murca": "em Murça", "murtosa": "na Murtosa",
  "nazare": "na Nazaré", "nelas": "em Nelas", "nisa": "em Nisa",
  "nordeste": "no Nordeste", "obidos": "em Óbidos", "odemira": "em Odemira",
  "odivelas": "em Odivelas", "oeiras": "em Oeiras", "oleiros": "em Oleiros",
  "olhao": "em Olhão", "oliveira de azemeis": "em Oliveira de Azeméis", "oliveira de frades": "em Oliveira de Frades",
  "oliveira do bairro": "em Oliveira do Bairro", "oliveira do hospital": "em Oliveira do Hospital", "ourem": "em Ourém",
  "ourique": "em Ourique", "ovar": "em Ovar", "pacos de ferreira": "em Paços de Ferreira",
  "palmela": "em Palmela", "pampilhosa da serra": "na Pampilhosa da Serra", "paredes": "em Paredes",
  "paredes de coura": "em Paredes de Coura", "pedrogao grande": "em Pedrógão Grande", "penacova": "em Penacova",
  "penafiel": "em Penafiel", "penalva do castelo": "em Penalva do Castelo", "penamacor": "em Penamacor",
  "penedono": "em Penedono", "penela": "em Penela", "peniche": "em Peniche",
  "peso da regua": "no Peso da Régua", "pinhel": "em Pinhel", "pombal": "em Pombal",
  "ponta delgada": "em Ponta Delgada", "ponta do sol": "na Ponta do Sol", "ponte da barca": "em Ponte da Barca",
  "ponte de lima": "em Ponte de Lima", "ponte de sor": "em Ponte de Sor", "portalegre": "em Portalegre",
  "portel": "em Portel", "portimao": "em Portimão", "porto": "no Porto",
  "porto de mos": "em Porto de Mós", "porto moniz": "no Porto Moniz", "porto santo": "no Porto Santo",
  "povoa de lanhoso": "na Póvoa de Lanhoso", "povoa de varzim": "na Póvoa de Varzim", "povoacao": "na Povoação",
  "praia da vitoria": "na Praia da Vitória", "proenca a nova": "em Proença-a-Nova", "redondo": "no Redondo",
  "reguengos de monsaraz": "em Reguengos de Monsaraz", "resende": "em Resende", "ribeira brava": "na Ribeira Brava",
  "ribeira de pena": "em Ribeira de Pena", "ribeira grande": "na Ribeira Grande", "rio maior": "em Rio Maior",
  "sabrosa": "em Sabrosa", "sabugal": "no Sabugal", "salvaterra de magos": "em Salvaterra de Magos",
  "santa comba dao": "em Santa Comba Dão", "santa cruz": "em Santa Cruz", "santa cruz da graciosa": "em Santa Cruz da Graciosa",
  "santa cruz das flores": "em Santa Cruz das Flores", "santa maria da feira": "em Santa Maria da Feira", "santa marta de penaguiao": "em Santa Marta de Penaguião",
  "santana": "em Santana", "santarem": "em Santarém", "santiago do cacem": "em Santiago do Cacém",
  "santo tirso": "em Santo Tirso", "sao bras de alportel": "em São Brás de Alportel", "sao joao da madeira": "em São João da Madeira",
  "sao joao da pesqueira": "em São João da Pesqueira", "sao pedro do sul": "em São Pedro do Sul", "sao roque do pico": "em São Roque do Pico",
  "sao vicente": "em São Vicente", "sardoal": "no Sardoal", "satao": "em Sátão",
  "seia": "em Seia", "seixal": "no Seixal", "sernancelhe": "em Sernancelhe",
  "serpa": "em Serpa", "serta": "na Sertã", "sesimbra": "em Sesimbra",
  "setubal": "em Setúbal", "sever do vouga": "em Sever do Vouga", "silves": "em Silves",
  "sines": "em Sines", "sintra": "em Sintra", "sobral de monte agraco": "em Sobral de Monte Agraço",
  "soure": "em Soure", "sousel": "em Sousel", "tabua": "em Tábua",
  "tabuaco": "em Tabuaço", "tarouca": "em Tarouca", "tavira": "em Tavira",
  "terras de bouro": "em Terras de Bouro", "tomar": "em Tomar", "tondela": "em Tondela",
  "torre de moncorvo": "em Torre de Moncorvo", "torres novas": "em Torres Novas", "torres vedras": "em Torres Vedras",
  "trancoso": "em Trancoso", "trofa": "na Trofa", "vagos": "em Vagos",
  "vale de cambra": "em Vale de Cambra", "valenca": "em Valença", "valongo": "em Valongo",
  "valpacos": "em Valpaços", "velas": "nas Velas", "vendas novas": "em Vendas Novas",
  "viana do alentejo": "em Viana do Alentejo", "viana do castelo": "em Viana do Castelo", "vidigueira": "na Vidigueira",
  "vieira do minho": "em Vieira do Minho", "vila de rei": "em Vila de Rei", "vila do bispo": "em Vila do Bispo",
  "vila do conde": "em Vila do Conde", "vila do porto": "em Vila do Porto", "vila flor": "em Vila Flor",
  "vila franca de xira": "em Vila Franca de Xira", "vila franca do campo": "em Vila Franca do Campo", "vila nova da barquinha": "em Vila Nova da Barquinha",
  "vila nova de cerveira": "em Vila Nova de Cerveira", "vila nova de famalicao": "em Vila Nova de Famalicão", "vila nova de foz coa": "em Vila Nova de Foz Côa",
  "vila nova de gaia": "em Vila Nova de Gaia", "vila nova de paiva": "em Vila Nova de Paiva", "vila nova de poiares": "em Vila Nova de Poiares",
  "vila pouca de aguiar": "em Vila Pouca de Aguiar", "vila real": "em Vila Real", "vila real de santo antonio": "em Vila Real de Santo António",
  "vila velha de rodao": "em Vila Velha de Ródão", "vila verde": "em Vila Verde", "vila vicosa": "em Vila Viçosa",
  "vimioso": "em Vimioso", "vinhais": "em Vinhais", "viseu": "em Viseu",
  "vizela": "em Vizela", "vouzela": "em Vouzela",
};
// MUN_ALIAS: other spellings in the CRM's concelho field (no accents, Orbis forms, localities like Carnaxide → Oeiras).
const MUN_ALIAS = {
  "aboboda": "cascais", "adaufe": "braga", "agodim": "leiria",
  "alcabideche": "cascais", "alcanede": "santarem", "alcantarilha": "silves",
  "alcoitao": "cascais", "aldeia de joanes": "fundao", "alfena": "valongo",
  "alges": "oeiras", "algueirao": "sintra", "almancil": "loule",
  "alpendorada e matos": "marco de canaveses", "alumieira": "oliveira de azemeis", "amieirinha": "marinha grande",
  "antanhol": "coimbra", "arco da calheta": "calheta (madeira)", "arcozelo": "vila nova de gaia",
  "armacao de pera": "silves", "arrentela": "seixal", "azaruja": "evora",
  "azeitao": "setubal", "baleizao": "beja", "barrosas": "felgueiras",
  "batudes": "palmela", "bicesse": "cascais", "birre": "cascais",
  "bitaraes": "paredes", "bobadela": "loures", "boim": "lousada",
  "boliqueime": "loule", "braga palmeira": "braga", "brufe": "vila nova de famalicao",
  "buarcos": "figueira da foz", "bugalhos": "alcanena", "cabouco": "lagoa (acores)",
  "caldas das taipas": "guimaraes", "calheta (sao jorge)": "calheta (acores)", "camarate": "loures",
  "campo": "valongo", "canecas": "odivelas", "carapecos": "barcelos",
  "carcavelos": "cascais", "carnaxide": "oeiras", "casais de sao martinho": "sobral de monte agraco",
  "casalito": "leiria", "caxias": "oeiras", "charneca do carvalhal": "alcobaca",
  "cobre": "cascais", "comporta": "alcacer do sal", "constantim": "vila real",
  "corvite": "guimaraes", "cova da iria": "ourem", "cruz de pau": "seixal",
  "ericeira": "mafra", "ermesinde": "valongo", "ervosas": "ilhavo",
  "estela": "povoa de varzim", "estoril": "cascais", "fajozes": "vila do conde",
  "famoes": "odivelas", "fanzeres": "gondomar", "ferragudo": "lagoa (algarve)",
  "figueiro": "pacos de ferreira", "fontanheira": "oliveira de azemeis", "foros da catrapona": "seixal",
  "freixo espada a cinta": "freixo de espada a cinta", "frielas": "loures", "galegos (santa maria)": "barcelos",
  "gonca": "guimaraes", "grijo": "vila nova de gaia", "guidoes": "trofa",
  "guilhabreu": "vila do conde", "guincho": "cascais", "igreja nova": "mafra",
  "janas": "sintra", "jardoeira": "batalha", "junqueiro": "cascais",
  "lago": "amares", "lagoa (sao miguel)": "lagoa (acores)", "lanhelas": "caminha",
  "laundos": "povoa de varzim", "leca do balio": "matosinhos", "linda a velha": "oeiras",
  "linho": "sintra", "lisbon": "lisboa", "louro": "vila nova de famalicao",
  "lourosa": "santa maria da feira", "magrelos": "marco de canaveses", "martim": "barcelos",
  "mindelo": "vila do conde", "miraflores": "oeiras", "mitrena": "setubal",
  "monte da oripa": "ferreira do alentejo", "monte estoril": "cascais", "monte fonte frades": "beja",
  "montelavar": "sintra", "montijos": "leiria", "morelena": "sintra",
  "moscavide": "loures", "mozelos": "santa maria da feira", "murches": "cascais",
  "murtede": "cantanhede", "neiva": "viana do castelo", "olhos d'agua": "albufeira",
  "outeiro de polima": "cascais", "paco de arcos": "oeiras", "pacos de gaiolo": "marco de canaveses",
  "paio pires": "seixal", "palmeira": "braga", "parada de tibaes": "braga",
  "parede": "cascais", "pedrome": "leiria", "pedroso": "vila nova de gaia",
  "penha longa": "marco de canaveses", "perafita": "matosinhos", "perosinho": "vila nova de gaia",
  "ponte do rol": "torres vedras", "porto salvo": "oeiras", "povoa de santa iria": "vila franca de xira",
  "povoa de santo adriao": "odivelas", "quarteira": "loule", "queijas": "oeiras",
  "queluz": "sintra", "quinta do anjo": "palmela", "quinta grande": "camara de lobos",
  "quinta nova": "pombal", "ramada": "odivelas", "rebelva": "cascais",
  "recarei": "paredes", "ribeira dos palheiros": "lourinha", "ribeirao": "vila nova de famalicao",
  "rio tinto": "gondomar", "sacavem": "loures", "santa cristina couto": "santo tirso",
  "santa iria de azoia": "loures", "santo antao do tojal": "loures", "sao felix da marinha": "vila nova de gaia",
  "sao francisco": "alcochete", "sao joao das lampas": "sintra", "sao juliao do tojal": "loures",
  "sao lourenco": "loule", "sao mamede de infesta": "matosinhos", "sao marcos": "sintra",
  "sao martinho bougado": "trofa", "sao pedro do estoril": "cascais", "seixas": "caminha",
  "sendim": "felgueiras", "serem de cima": "agueda", "sesmarias": "albufeira",
  "sobral monte agraco": "sobral de monte agraco", "taveiro": "coimbra", "teloes": "amarante",
  "tires": "cascais", "tortosendo": "covilha", "travassos": "oliveira de frades",
  "vala do carregado": "vila franca de xira", "vale madeiros": "lousa", "valeirinha": "mira",
  "venda do pinheiro": "mafra", "verdizela": "seixal", "vermelha": "cadaval",
  "vidago": "chaves", "vila amelia": "palmela", "vila frescainha": "barcelos",
  "vilaca": "braga", "vilamoura": "loule", "zona industrial en 1 sul": "agueda",
};
// MUN_HOL: municipal holiday. "MM-DD" fixed; "easter+N" days after Easter Sunday; "jul:sun2+1" = 1 day after the 2nd Sunday of July (L = last).
// Source: Wikipedia "Feriados em Portugal"; Carrazeda de Ansiães, Lajes das Flores, Serpa from dirportugal.com (Serpa confirmed by ANMP).
const MUN_HOL = {
  "abrantes": "06-14", "agueda": "easter+50", "aguiar da beira": "02-10", "alandroal": "easter+8",
  "albergaria a velha": "aug:sun3+1", "albufeira": "08-20", "alcacer do sal": "06-24", "alcanena": "easter+39",
  "alcobaca": "08-20", "alcochete": "06-24", "alcoutim": "sep:fri2+0", "alenquer": "easter+39",
  "alfandega da fe": "06-29", "alijo": "11-11", "aljezur": "08-29", "aljustrel": "06-13",
  "almada": "06-24", "almeida": "07-02", "almeirim": "easter+39", "almodovar": "06-24",
  "alpiarca": "04-02", "alter do chao": "easter+39", "alvaiazere": "06-13", "alvito": "easter+39",
  "amadora": "09-11", "amarante": "07-08", "amares": "06-13", "anadia": "easter+39",
  "angra do heroismo": "06-24", "ansiao": "easter+39", "arcos de valdevez": "07-11", "arganil": "09-07",
  "armamar": "06-24", "arouca": "05-02", "arraiolos": "easter+39", "arronches": "06-24",
  "arruda dos vinhos": "easter+39", "aveiro": "05-12", "avis": "easter+1", "azambuja": "easter+39",
  "baiao": "08-24", "barcelos": "05-03", "barrancos": "08-28", "barreiro": "06-28",
  "batalha": "08-14", "beja": "easter+39", "belmonte": "04-26", "benavente": "easter+39",
  "bombarral": "06-29", "borba": "easter+1", "boticas": "11-06", "braga": "06-24",
  "braganca": "08-22", "cabeceiras de basto": "09-29", "cadaval": "01-13", "caldas da rainha": "05-15",
  "calheta (acores)": "11-25", "calheta (madeira)": "06-24", "camara de lobos": "10-04", "caminha": "easter+1",
  "campo maior": "easter+1", "cantanhede": "07-25", "carrazeda de ansiaes": "08-31", "carregal do sal": "jul:sun3+1",
  "cartaxo": "easter+39", "cascais": "06-13", "castanheira de pera": "07-04", "castelo branco": "easter+9",
  "castelo de paiva": "06-24", "castelo de vide": "easter+1", "castro daire": "06-29", "castro marim": "06-24",
  "castro verde": "06-29", "celorico da beira": "05-23", "celorico de basto": "07-25", "chamusca": "easter+39",
  "chaves": "07-08", "cinfaes": "06-24", "coimbra": "07-04", "condeixa a nova": "07-24",
  "constancia": "easter+1", "coruche": "08-17", "corvo": "06-20", "covilha": "10-20",
  "crato": "easter+1", "cuba": "easter+1", "elvas": "01-14", "entroncamento": "11-24",
  "espinho": "06-16", "esposende": "08-19", "estarreja": "06-13", "estremoz": "easter+39",
  "evora": "06-29", "fafe": "05-16", "faro": "09-07", "felgueiras": "06-29",
  "ferreira do alentejo": "03-05", "ferreira do zezere": "06-13", "figueira da foz": "06-24", "figueira de castelo rodrigo": "07-07",
  "figueiro dos vinhos": "06-24", "fornos de algodres": "09-29", "freixo de espada a cinta": "easter+1", "fronteira": "04-06",
  "funchal": "08-21", "fundao": "09-15", "gaviao": "11-23", "gois": "08-13",
  "golega": "easter+39", "gondomar": "oct:sun1+1", "gouveia": "aug:sun2+1", "grandola": "10-22",
  "guarda": "11-27", "guimaraes": "06-24", "horta": "06-24", "idanha a nova": "easter+15",
  "ilhavo": "easter+1", "lagoa (acores)": "04-11", "lagoa (algarve)": "09-08", "lagos": "10-27",
  "lajes das flores": "jul:sun3+1", "lajes do pico": "06-29", "lamego": "09-08", "leiria": "05-22",
  "lisboa": "06-13", "loule": "easter+39", "loures": "07-26", "lourinha": "06-24",
  "lousa": "06-24", "lousada": "jul:sunL+1", "macao": "easter+1", "macedo de cavaleiros": "06-29",
  "machico": "05-08", "madalena": "07-22", "mafra": "easter+39", "maia": "jul:sun2+1",
  "mangualde": "09-08", "manteigas": "03-04", "marco de canaveses": "09-08", "marinha grande": "easter+39",
  "marvao": "09-08", "matosinhos": "easter+51", "mealhada": "easter+39", "meda": "11-11",
  "melgaco": "easter+39", "mertola": "06-24", "mesao frio": "11-30", "mira": "07-25",
  "miranda do corvo": "06-01", "miranda do douro": "07-10", "mirandela": "05-25", "mogadouro": "10-15",
  "moimenta da beira": "06-24", "moita": "sep:sun2+2", "moncao": "03-12", "monchique": "easter+39",
  "mondim de basto": "07-25", "monforte": "easter+8", "montalegre": "06-09", "montemor o novo": "03-08",
  "montemor o velho": "09-08", "montijo": "06-29", "mora": "easter+1", "mortagua": "easter+39",
  "moura": "06-24", "mourao": "02-02", "murca": "05-08", "murtosa": "09-08",
  "nazare": "09-08", "nelas": "06-24", "nisa": "easter+1", "nordeste": "07-18",
  "obidos": "01-11", "odemira": "09-08", "odivelas": "11-19", "oeiras": "06-07",
  "oleiros": "aug:sun2+1", "olhao": "06-16", "oliveira de azemeis": "aug:sun2+1", "oliveira de frades": "10-07",
  "oliveira do bairro": "easter+39", "oliveira do hospital": "10-07", "ourem": "06-20", "ourique": "09-08",
  "ovar": "07-25", "pacos de ferreira": "11-06", "palmela": "06-01", "pampilhosa da serra": "04-10",
  "paredes": "jul:sun3+1", "paredes de coura": "08-10", "pedrogao grande": "07-24", "penacova": "07-17",
  "penafiel": "11-11", "penalva do castelo": "08-25", "penamacor": "easter+1", "penedono": "06-29",
  "penela": "09-29", "peniche": "aug:sun1+1", "peso da regua": "08-16", "pinhel": "08-25",
  "pombal": "11-11", "ponta delgada": "easter+36", "ponta do sol": "09-08", "ponte da barca": "08-24",
  "ponte de lima": "09-20", "ponte de sor": "easter+1", "portalegre": "05-23", "portel": "easter+1",
  "portimao": "12-11", "porto": "06-24", "porto de mos": "06-29", "porto moniz": "07-22",
  "porto santo": "06-24", "povoa de lanhoso": "03-19", "povoa de varzim": "06-29", "povoacao": "easter+61",
  "praia da vitoria": "06-20", "proenca a nova": "06-13", "redondo": "easter+1", "reguengos de monsaraz": "06-13",
  "resende": "09-29", "ribeira brava": "06-29", "ribeira de pena": "08-16", "ribeira grande": "06-29",
  "rio maior": "11-06", "sabrosa": "09-08", "sabugal": "easter+8", "salvaterra de magos": "easter+39",
  "santa comba dao": "easter+39", "santa cruz": "01-15", "santa cruz da graciosa": "aug:sun2+1", "santa cruz das flores": "06-24",
  "santa maria da feira": "01-20", "santa marta de penaguiao": "01-13", "santana": "05-25", "santarem": "03-19",
  "santiago do cacem": "07-25", "santo tirso": "07-11", "sao bras de alportel": "06-01", "sao joao da madeira": "10-11",
  "sao joao da pesqueira": "06-24", "sao pedro do sul": "06-29", "sao roque do pico": "08-16", "sao vicente": "01-22",
  "sardoal": "09-22", "satao": "08-20", "seia": "07-03", "seixal": "06-29",
  "sernancelhe": "05-03", "serpa": "easter+2", "serta": "06-24", "sesimbra": "05-04",
  "setubal": "09-15", "sever do vouga": "09-21", "silves": "09-03", "sines": "11-24",
  "sintra": "06-29", "sobral de monte agraco": "easter+39", "soure": "09-21", "sousel": "easter+1",
  "tabua": "04-10", "tabuaco": "06-24", "tarouca": "09-29", "tavira": "06-24",
  "terras de bouro": "10-20", "tomar": "03-01", "tondela": "09-16", "torre de moncorvo": "03-19",
  "torres novas": "easter+39", "torres vedras": "11-11", "trancoso": "05-29", "trofa": "11-19",
  "vagos": "easter+50", "vale de cambra": "06-13", "valenca": "02-18", "valongo": "06-24",
  "valpacos": "11-06", "velas": "04-23", "vendas novas": "09-07", "viana do alentejo": "01-13",
  "viana do castelo": "08-20", "vidigueira": "easter+39", "vieira do minho": "oct:sat1+2", "vila de rei": "09-19",
  "vila do bispo": "01-22", "vila do conde": "06-24", "vila do porto": "06-24", "vila flor": "08-24",
  "vila franca de xira": "easter+39", "vila franca do campo": "06-24", "vila nova da barquinha": "06-13", "vila nova de cerveira": "10-01",
  "vila nova de famalicao": "06-13", "vila nova de foz coa": "05-21", "vila nova de gaia": "06-24", "vila nova de paiva": "03-02",
  "vila nova de poiares": "01-13", "vila pouca de aguiar": "06-22", "vila real": "06-13", "vila real de santo antonio": "05-13",
  "vila velha de rodao": "aug:sun4+1", "vila verde": "06-13", "vila vicosa": "08-16", "vimioso": "08-10",
  "vinhais": "05-20", "viseu": "09-21", "vizela": "03-19", "vouzela": "05-14",
};
// ── Municipalities — generated: end
const placeKey = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[-–_]/g, ' ').replace(/\s+/g, ' ').trim();
// The company's municipality key: its concelho (any spelling), else its city; Calheta / Lagoa by district.
function municipalityOf(x) {
  const c = x && typeof x === 'object' ? x : { concelho: x };
  for (const [i, raw] of [c.concelho, c.city].entries()) {
    let k = placeKey(raw);
    if (i === 1) k = k.replace(/^[\d ]+/, '');
    if (!k) continue;
    k = MUN_ALIAS[k] || k;
    if (k === 'calheta' || k === 'lagoa') {
      const d = placeKey(c.distrito);
      k = d === 'madeira' && k === 'calheta' ? 'calheta (madeira)' : d === 'faro' && k === 'lagoa' ? 'lagoa (algarve)' : d.startsWith('acores') ? `${k} (acores)` : '';
    }
    if (IN_CITY[k]) return k;
  }
  return '';
}
function inCityOf(x) { return IN_CITY[municipalityOf(x)] || ''; }
// 13 Oct: the same place after a verb of movement — "deslocar-nos a Lisboa / ao Porto / à Maia / às Caldas".
function toCityOf(x) {
  const m = /^(em|no|na|nos|nas) (.+)$/.exec(inCityOf(x));
  return m ? `${({ em: 'a', no: 'ao', na: 'à', nos: 'aos', nas: 'às' })[m[1]]} ${m[2]}` : '';
}
// The municipal holiday of a municipality in year y, as "MM-DD" ('' = none known).
function munHolidayMD(key, y) {
  const r = MUN_HOL[key];
  if (!r) return '';
  if (/^\d\d-\d\d$/.test(r)) return r;
  const md = (ms) => new Date(ms).toISOString().slice(5, 10);
  let m = /^easter\+(\d+)$/.exec(r);
  if (m) return md(munEaster(y) + Number(m[1]) * 86400000);
  m = /^(\w{3}):(\w{3})(\d|L)\+(\d)$/.exec(r);
  if (!m) return '';
  const mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1]);
  const wd = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(m[2]);
  const d = m[3] === 'L' ? new Date(Date.UTC(y, mo + 1, 0)) : new Date(Date.UTC(y, mo, 1));
  while (d.getUTCDay() !== wd) d.setUTCDate(d.getUTCDate() + (m[3] === 'L' ? -1 : 1));
  if (m[3] !== 'L') d.setUTCDate(d.getUTCDate() + 7 * (Number(m[3]) - 1));
  d.setUTCDate(d.getUTCDate() + Number(m[4]));
  return md(d.getTime());
}
// Is this Lisbon calendar day (parts from lisbonParts) the company's municipal holiday?
function isMunicipalHoliday(company, parts) {
  const k = municipalityOf(company);
  return !!k && munHolidayMD(k, parts.y) === `${String(parts.m).padStart(2, "0")}-${String(parts.d).padStart(2, "0")}`;
}

// The municipality's name without its preposition: "na Covilhã" → "Covilhã"; the two Calhetas and Lagoas keep their region.
function munName(k) {
  const n = String(IN_CITY[k] || k).replace(/^(em|no|na|nos|nas) /, '');
  const r = /\((acores|madeira|algarve)\)/.exec(k);
  return r ? `${n} (${({ acores: 'Açores', madeira: 'Madeira', algarve: 'Algarve' })[r[1]]})` : n;
}
// Next date (YYYY-MM-DD) of the municipality's holiday, today included.
function nextMunHoliday(k, today) {
  const y = Number(today.slice(0, 4));
  for (const yy of [y, y + 1]) { const md = munHolidayMD(k, yy); if (md && `${yy}-${md}` >= today) return `${yy}-${md}`; }
  return '';
}

export { IN_CITY, MUN_HOL, municipalityOf, munHolidayMD, munName, nextMunHoliday };
