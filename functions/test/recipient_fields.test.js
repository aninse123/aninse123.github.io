// Fields for who an email goes to (30 Oct 2026, plan step 5): {{recipient.firstName / role / ligado / isPerson / isCompany}},
// gender by the owners list or the first name, and one template that reads differently for a person and a general address.
const R = require("../outreach/recipient_fields.js");
const { buildContext, renderTemplate } = require("../outreach/render.js");

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

ok("common feminine and masculine names", R.genderOfFirstName("Rita Costa") === "F" && R.genderOfFirstName("Beatriz") === "F" && R.genderOfFirstName("Inês") === "F" && R.genderOfFirstName("João Maria") === "M" && R.genderOfFirstName("Rui") === "M" && R.genderOfFirstName("José") === "M");
ok("names that break the ending rule are in the lists", R.genderOfFirstName("Luca") === "M" && R.genderOfFirstName("Raquel") === "F" && R.genderOfFirstName("Isabel") === "F" && R.genderOfFirstName("Carmen") === "F" && R.genderOfFirstName("Nuno") === "M");
ok("a name not in the lists: -a feminine, -o masculine, anything else unknown", R.genderOfFirstName("Zuleica") === "F" && R.genderOfFirstName("Aldemiro") === "M" && R.genderOfFirstName("Ariel") === "" && R.genderOfFirstName("") === "");
ok("accents and capitals do not matter", R.genderOfFirstName("CLÁUDIA") === "F" && R.genderOfFirstName("tomás") === "M");
ok("the owners list typed by the team wins over the name", R.genderOf("Ariel Sousa", [{ name: "Ariel Sousa", gender: "F" }]) === "F" && R.genderOf("Ana Sousa", [{ name: "Ana Sousa", gender: "M" }]) === "M" && R.genderOf("Ana Sousa", [{ name: "Luís Pinho", gender: "M" }]) === "F");

const p = R.recipientContext({ name: "Rita Costa", role: "Administradora" });
ok("a named person: first name, role, feminine form, isPerson", p.firstName === "Rita" && p.role === "Administradora" && p.ligado === "ligada" && p.isPerson === "1" && p.isCompany === "");
const m = R.recipientContext({ name: "Rui Pinho", role: "Shareholder 60%" });
ok("masculine form; a shareholder line is not a role", m.ligado === "ligado" && m.role === "");
const u = R.recipientContext({ name: "Ariel Sousa" });
ok("unknown gender: the neutral form", u.ligado === "ligado(a)");
const g = R.recipientContext({ name: "", role: "Company address" });
ok("a general address: no name, isCompany", g.firstName === "" && g.isPerson === "" && g.isCompany === "1" && g.role === "");

// The E1 wording both ways, rendered with the real engine
const E1 = "{{?recipient.isPerson|Bom dia, {{recipient.firstName}},\n\nDirigimo-nos diretamente a si por estar {{recipient.ligado}} à {{company.shortName}}. Se não for a pessoa mais indicada, agradecemos que reencaminhe esta mensagem ou nos indique com quem devemos falar.}}{{?recipient.isCompany|Agradecemos que façam chegar esta mensagem ao cuidado {{owner.of|da gerência}}.}}";
const GREET = "{{?recipient.isPerson|Bom dia, {{recipient.firstName}},}}{{?recipient.isCompany|{{owner.greeting|Exmos. Senhores}},}}";
const company = { name: "DIMEXA - DISTRIBUICAO, LDA", emailName: "Dimexa", emailOwners: [{ name: "Ana Cunha", gender: "F" }, { name: "Luís Pinho", gender: "M" }] };
const forPerson = buildContext({ company, contactName: "Rita Costa", recipientRole: "Administradora" });
const forCompany = buildContext({ company, contactName: "" });
const r1 = renderTemplate(E1, forPerson), r2 = renderTemplate(E1, forCompany);
ok("E1 for a named person", r1.text === "Bom dia, Rita,\n\nDirigimo-nos diretamente a si por estar ligada à Dimexa. Se não for a pessoa mais indicada, agradecemos que reencaminhe esta mensagem ou nos indique com quem devemos falar." && !r1.missing.length);
ok("E1 for a general address stays as it is", r2.text === "Agradecemos que façam chegar esta mensagem ao cuidado da Senhora Ana Cunha ou do Senhor Luís Pinho." && !r2.missing.length);
ok("the greeting in the other emails, both ways", renderTemplate(GREET, forPerson).text === "Bom dia, Rita," && renderTemplate(GREET, forCompany).text === "Exma. Senhora Ana Cunha e Exmo. Senhor Luís Pinho," && !renderTemplate(GREET, forPerson).missing.length);
ok("a person who is one of the owners takes the gender typed for them", renderTemplate("{{recipient.ligado}}", buildContext({ company, contactName: "Ana Cunha" })).text === "ligada" && renderTemplate("{{recipient.ligado}}", buildContext({ company, contactName: "Luís Pinho" })).text === "ligado");
ok("older templates without these fields are unaffected", renderTemplate("{{contact.firstName|Olá}}, {{company.shortName}}", forCompany).text === "Olá, Dimexa");

console.log(fail ? `\n${fail} FAILED` : "\nAll passed");
process.exit(fail ? 1 : 0);
