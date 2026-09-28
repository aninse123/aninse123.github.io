// Mobile app — mobileSearch: companies and people by name (every word, partial
// words), or by NIF when the query is a number; short rows; Search CRM access.
const F = require("./fake_firebase.js");
const fns = require("../index.js");
const { _internal: M } = require("../mobile/search.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const PARTNER = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const INTERN = { auth: { token: { email: "maria@douropartners.pt", perms: ["search.view", "out.view"] } } };
const NOSEARCH = { auth: { token: { email: "v@douropartners.pt", perms: ["out.view"] } } };
const call = async (q, who = PARTNER) => { try { return await fns.mobileSearch({ ...who, data: { q } }); } catch (e) { return { err: e }; } };

// Index fields as search.html writes them.
function company(id, name, extra = {}) {
  const f = M.companySearchFields(name);
  const prefixes = new Set(); for (const t of f.nameTokens) for (let i = 2; i <= t.length; i++) prefixes.add(t.slice(0, i));
  store.set(`searchCompanies/${id}`, { name, nameKey: f.nameKey, nameTokens: f.nameTokens, namePrefixes: [...prefixes], orbisFinancials: { 2024: { ebitda: 1 } }, ...extra });
}
function person(id, name, extra = {}) {
  const key = M.personNameKey(name), tokens = M.personNameTokens(key);
  const prefixes = new Set(); for (const t of tokens) for (let i = 2; i <= t.length; i++) prefixes.add(t.slice(0, i));
  store.set(`searchPeople/${id}`, { name, nameKey: key, nameTokens: tokens, namePrefixes: [...prefixes], ...extra });
}

(async () => {
  company("c1", "METALURGICA DO NORTE, LDA", { nif: "508123456", concelho: "Braga", sector: "Metals", stage: "screened", contactable: false });
  company("c2", "NORTE TRANSPORTES SA", { nif: "509000111" });
  company("c3", "TRANSPORTES DO SUL, LDA", { nif: "509000222", doNotContact: { on: true } });
  person("p1", "Luís Carlos da Silva", { linkCount: 3, currentLinkCount: 2 });
  person("p2", "Maria Silva Santos", { linkCount: 1, currentLinkCount: 0 });
  person("e1", "HOLDING XPTO SGPS", { entityType: "entity", nif: "508999888", matchedCompanyId: "c9" });

  ok("NIF detection: digits, spaces, PT prefix; text is not a NIF", M.nifQuery("508 123 456") === "508123456" && M.nifQuery("PT508123456") === "508123456" && M.nifQuery("508") === "508" && M.nifQuery("norte 2") === null && M.nifQuery("12") === null);

  const r1 = await call("norte");
  ok("name: both companies with 'norte', no people", r1.mode === "name" && r1.companies.map((c) => c.id).sort().join() === "c1,c2" && r1.people.length === 0);
  const c1 = r1.companies.find((c) => c.id === "c1");
  ok("short rows: town, sector, stage, flags; no financials", c1.town === "Braga" && c1.sector === "Metals" && c1.stage === "screened" && c1.contactable === false && !("orbisFinancials" in c1));
  const r2 = await call("transp sul");
  ok("every word, partial words: 'transp sul' → only Transportes do Sul", r2.companies.map((c) => c.id).join() === "c3" && r2.companies[0].doNotContact === true);
  const r3 = await call("silva");
  ok("people: both Silvas, the one with current positions first", r3.people.map((p) => p.id).join() === "p1,p2" && r3.people[0].currentLinkCount === 2);
  ok("people ignore accents and 'da': 'luis silva' → Luís Carlos da Silva", (await call("luis silva")).people.map((p) => p.id).join() === "p1");
  const r4 = await call("508");
  ok("NIF prefix: company 508123456 and the corporate holder 508999888", r4.mode === "nif" && r4.companies.map((c) => c.id).join() === "c1" && r4.people.map((p) => p.id).join() === "e1" && r4.people[0].matchedCompanyId === "c9");
  ok("exact NIF", (await call("509000222")).companies.map((c) => c.id).join() === "c3");
  ok("too short: nothing searched", (await call("n")).mode === "short");
  ok("2 letters: nothing searched either (0 reads); 3 letters search", (await call("no")).mode === "short" && (await call("nor")).mode === "name");
  ok("a 3-digit NIF still searches", (await call("508")).mode === "nif");
  ok("most selective word = the longest", M.mostSelective(["DO", "NORTE", "SUL"]) === "NORTE" && M.mostSelective(["ANA", "RUI"]) === "ANA");
  ok("small result: marked complete (the phone may narrow it itself)", r1.companiesComplete === true && r1.peopleComplete === true && !r1.moreCompanies);
  for (let i = 0; i < 30; i++) company(`z${i}`, `ALFA EMPRESA ${i}`);
  const rz = await call("alfa");
  ok("many matches: at most 25 shown, reads capped at 26, marked incomplete with 'more'", rz.companies.length === 25 && M.LIMIT === 26 && rz.moreCompanies === true && rz.companiesComplete === false);
  const rz2 = await call("alfa empresa 7");
  ok("several words: scanned by the most selective word, refined by every word", rz2.companies.every((c) => /ALFA EMPRESA/.test(c.name)));
  ok("intern with Search CRM access can search", !(await call("norte", INTERN)).err);
  ok("without Search CRM access: refused", (await call("norte", NOSEARCH)).err?.details?.reason === "no_permission");
  ok("signed out: refused", (await call("norte", {})).err?.details?.reason === "unauthenticated");

  console.log(fail ? `\n${fail} FAILED` : "\nall mobile search tests passed");
  process.exit(fail ? 1 : 0);
})();
