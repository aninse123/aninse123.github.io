// Fields for who an email goes to (30 Oct 2026, plan step 5): {{recipient.firstName / role / ligado / isPerson / isCompany}},
// gender by the owners list or the first name, and one template that reads differently for a person and a general address.
const F = require("./fake_firebase.js");
const R = require("../outreach/recipient_fields.js");
const { genderCheckOnDraft } = require("../outreach/scheduler.js");
const { buildContext, renderTemplate } = require("../outreach/render.js");

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

ok("common feminine and masculine names", R.genderOfFirstName("Rita Costa") === "F" && R.genderOfFirstName("Beatriz") === "F" && R.genderOfFirstName("Inês") === "F" && R.genderOfFirstName("João Maria") === "M" && R.genderOfFirstName("Rui") === "M" && R.genderOfFirstName("José") === "M");
ok("names that break the ending rule are in the lists", R.genderOfFirstName("Luca") === "M" && R.genderOfFirstName("Raquel") === "F" && R.genderOfFirstName("Isabel") === "F" && R.genderOfFirstName("Carmen") === "F" && R.genderOfFirstName("Nuno") === "M");
ok("a name not in the lists: -a feminine, -o masculine, anything else unknown", R.genderOfFirstName("Zuleica") === "F" && R.genderOfFirstName("Aldemiro") === "M" && R.genderOfFirstName("Ariel") === "" && R.genderOfFirstName("") === "");
ok("accents and capitals do not matter", R.genderOfFirstName("CLÁUDIA") === "F" && R.genderOfFirstName("tomás") === "M");
ok("the owners list typed by the team wins over the name", R.genderOf("Ariel Sousa", [{ name: "Ariel Sousa", gender: "F" }]) === "F" && R.genderOf("Ana Sousa", [{ name: "Ana Sousa", gender: "M" }]) === "M" && R.genderOf("Ana Sousa", [{ name: "Luís Pinho", gender: "M" }]) === "F");

const p = R.recipientContext({ name: "Rita Costa", role: "Administradora" });
ok("a named person: first name, role, feminine, isPerson", p.firstName === "Rita" && p.role === "Administradora" && p.isFemale === "1" && p.isMale === "" && p.isUnknown === "" && p.isPerson === "1" && p.isCompany === "");
const m = R.recipientContext({ name: "Rui Pinho", role: "Shareholder 60%" });
ok("masculine; a shareholder line is not a role", m.isMale === "1" && m.isFemale === "" && m.role === "");
const u = R.recipientContext({ name: "Ariel Sousa" });
ok("unknown gender: only isUnknown is set", u.isUnknown === "1" && u.isMale === "" && u.isFemale === "");
const g = R.recipientContext({ name: "", role: "Company address" });
ok("a general address: no name, no gender flags, isCompany", g.firstName === "" && g.isPerson === "" && g.isCompany === "1" && g.role === "" && g.isUnknown === "" && g.isMale === "" && g.isFemale === "");

// The E1 wording both ways, rendered with the real engine
const E1 = "{{?recipient.isPerson|Bom dia, {{recipient.firstName}},\n\nDirigimo-nos diretamente a si por estar {{?recipient.isMale|ligado}}{{?recipient.isFemale|ligada}}{{?recipient.isUnknown|ligado(a)}} à {{company.shortName}}. Se não for a pessoa mais indicada, agradecemos que reencaminhe esta mensagem ou nos indique com quem devemos falar.}}{{?recipient.isCompany|Agradecemos que façam chegar esta mensagem ao cuidado {{owner.of|da gerência}}.}}";
const GREET = "{{?recipient.isPerson|Bom dia, {{recipient.firstName}},}}{{?recipient.isCompany|{{owner.greeting|Exmos. Senhores}},}}";
const company = { name: "DIMEXA - DISTRIBUICAO, LDA", emailName: "Dimexa", emailOwners: [{ name: "Ana Cunha", gender: "F" }, { name: "Luís Pinho", gender: "M" }] };
const forPerson = buildContext({ company, contactName: "Rita Costa", recipientRole: "Administradora" });
const forCompany = buildContext({ company, contactName: "" });
const r1 = renderTemplate(E1, forPerson), r2 = renderTemplate(E1, forCompany);
ok("E1 for a named person", r1.text === "Bom dia, Rita,\n\nDirigimo-nos diretamente a si por estar ligada à Dimexa. Se não for a pessoa mais indicada, agradecemos que reencaminhe esta mensagem ou nos indique com quem devemos falar." && !r1.missing.length);
ok("E1 for a general address stays as it is", r2.text === "Agradecemos que façam chegar esta mensagem ao cuidado da Senhora Ana Cunha ou do Senhor Luís Pinho." && !r2.missing.length);
ok("the greeting in the other emails, both ways", renderTemplate(GREET, forPerson).text === "Bom dia, Rita," && renderTemplate(GREET, forCompany).text === "Exma. Senhora Ana Cunha e Exmo. Senhor Luís Pinho," && !renderTemplate(GREET, forPerson).missing.length);
const W = "{{?recipient.isMale|ligado}}{{?recipient.isFemale|ligada}}{{?recipient.isUnknown|ligado(a)}}";
  ok("any word agrees: feminine, masculine, unknown", renderTemplate(W, buildContext({ company, contactName: "Rita Costa" })).text === "ligada" && renderTemplate(W, buildContext({ company, contactName: "Rui Pinho" })).text === "ligado" && renderTemplate(W, buildContext({ company, contactName: "Ariel Sousa" })).text === "ligado(a)");
  ok("a person who is one of the owners takes the gender typed for them", renderTemplate(W, buildContext({ company: { ...company, emailOwners: [{ name: "Ariel Sousa", gender: "F" }] }, contactName: "Ariel Sousa" })).text === "ligada");
ok("older templates without these fields are unaffected", renderTemplate("{{contact.firstName|Olá}}, {{company.shortName}}", forCompany).text === "Olá, Dimexa");

ok("a gender typed on the person wins over the owners list and the name", R.genderOf("Ana Sousa", [{ name: "Ana Sousa", gender: "F" }], { gender: "M", source: "typed" }) === "M" && R.genderOf("Ariel Costa", [], { gender: "F", source: "typed" }) === "F");
ok("a stored guess does not beat the owners list, but beats a fresh guess", R.genderOf("Ana Sousa", [{ name: "Ana Sousa", gender: "M" }], { gender: "F", source: "guess" }) === "M" && R.genderOf("Ariel Costa", [], { gender: "F", source: "guess" }) === "F");
ok("a stored value that is not M or F is ignored", R.genderOf("Rita Costa", [], { gender: "", source: "typed" }) === "F" && R.recipientContext({ name: "Ariel Costa", stored: { gender: "M", source: "typed" } }).isMale === "1");

(async () => {
  F.store.clear();
  F.store.set("searchCompanies/co1", { name: "X", emailOwners: [{ name: "Ariel Sousa", gender: "F" }] });
  const body = "por estar {{?recipient.isMale|ligado}}{{?recipient.isFemale|ligada}}{{?recipient.isUnknown|ligado(a)}}";
  const draft = async (name, kind, text = body) => { F.store.set("outreachMessages/m", { status: "draft" }); await genderCheckOnDraft({ update: async (u) => F.store.set("outreachMessages/m", { ...F.store.get("outreachMessages/m"), ...u }) }, { companyId: "co1" }, { name, kind }, text); return F.store.get("outreachMessages/m").genderCheck; };
  ok("a draft to a person whose gender we cannot tell is flagged", (await draft("Ariel Costa", "person"))?.name === "Ariel Costa");
  ok("no flag when the gender is known (name list, ending, or the owners list)", !(await draft("Rita Costa", "person")) && !(await draft("Ariel Sousa", "person")));
  ok("no flag for a general address, or when the template does not use gender", !(await draft("", "company")) && !(await draft("Ariel Costa", "person", "Bom dia, {{recipient.firstName}},")));
  F.store.set("searchPeople/p9", { name: "Ariel Costa", gender: "F", genderSource: "typed" });
  const draftP = async (rec) => { F.store.set("outreachMessages/m", { status: "draft" }); await genderCheckOnDraft({ update: async (u) => F.store.set("outreachMessages/m", { ...F.store.get("outreachMessages/m"), ...u }) }, { companyId: "co1" }, rec, body); return F.store.get("outreachMessages/m").genderCheck; };
  ok("a gender typed on the person (personId on the recipient) clears the flag", !(await draftP({ name: "Ariel Costa", kind: "person", personId: "p9" })) && !!(await draftP({ name: "Ariel Costa", kind: "person" })));
  const { companyRecipients } = require("../outreach/recipients.js");
  F.store.set("searchPersonLinks/p9__co1", { personId: "p9", companyId: "co1", personName: "Ariel Costa", personEntityType: "person", shCurrent: true, shDirectPct: 50 });
  F.store.set("searchPeople/p9", { name: "Ariel Costa", email: "ariel@x.pt", gender: "F", genderSource: "typed" });
  const rcp = (await companyRecipients("co1", { name: "X" }, { usePeople: true })).find((r) => r.personId === "p9");
  ok("a person's recipient carries the stored gender to the email", rcp && rcp.gender === "F" && rcp.genderSource === "typed");
  // 2 Nov 2026: Orbis names without accents ("Jose" → "José"), André on JOBASI
  {
    const { accentName, recipientContext: rc } = require("../outreach/recipient_fields.js");
    ok("accents are restored on the given name: Jose → José, Joao → João, Luis → Luís, Ines → Inês (always)", accentName("Jose Eurico Baptista da Silva") === "José Eurico Baptista da Silva" && accentName("Joao") === "João" && accentName("Luis Miguel Pereira Jorge") === "Luís Miguel Pereira Jorge" && accentName("Luis Fernandez") === "Luís Fernandez" && accentName("Ines Costa") === "Inês Costa");
    ok("António, André, Mário, Natália… always get the accent, whatever the surname (2 Nov)", accentName("Antonio Manuel Sampaio") === "António Manuel Sampaio" && accentName("Antonio Zacarias") === "António Zacarias" && accentName("Andre Silva") === "André Silva" && accentName("Natalia Sequeira") === "Natália Sequeira" && accentName("Mario Rossi") === "Mário Rossi" && accentName("ANTONIO PESTANA") === "ANTÓNIO PESTANA" && accentName("Antonio Pestana") === "António Pestana");
    ok("the second given name too after Maria, Ana, José, João, António, Luís (Maria José, José Luís); capitals stay capitals", accentName("Maria Jose Costa") === "Maria José Costa" && accentName("Jose Luis Mesquita de Araujo") === "José Luís Mesquita de Araujo" && accentName("JOSE LUIS PINTO") === "JOSÉ LUÍS PINTO" && accentName("Carlos Andre Lopes") === "Carlos Andre Lopes");
    ok("a name that already has its accent, or that is not on the list, is left alone", accentName("José Pedro") === "José Pedro" && accentName("Rui Pereira") === "Rui Pereira" && accentName("") === "");
    ok("recipient.firstName and contact.firstName come out accented", rc({ name: "Jose Eurico Baptista da Silva" }).firstName === "José" && renderTemplate("Bom dia, {{contact.firstName}},", buildContext({ company: {}, contactName: "Joao Silva" })).text === "Bom dia, João,");
    ok("the owners' names in owner.greeting / owner.of are accented too", buildContext({ company: { emailOwners: [{ name: "Jose Peres", gender: "M" }] } }).owner.greeting === "Exmo. Senhor José Peres" && buildContext({ company: { emailOwners: [{ name: "Jose Peres", gender: "M" }] } }).owner.of === "do Senhor José Peres");
  }
  console.log(fail ? `\n${fail} FAILED` : "\nAll passed");
  process.exit(fail ? 1 : 0);
})();
