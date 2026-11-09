// Sector wording per company (9 Nov 2026, switch outreach.sectorWording). The template key is
// {{company.sectorWording|em que atua}}: the company's own wording, else the campaign's sector text,
// else the text after | in the template. {{campaign.sector}} keeps meaning the campaign's text only.
// Synthetic data only.
const R = require("../outreach/render.js");
let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

const tpl = "Chegámos à {{company.shortName}} ao analisar o setor {{company.sectorWording|em que atua}}.";
const tplOld = "Chegámos à {{company.shortName}} ao analisar o setor {{campaign.sector|em que atua}}.";
const base = { name: "ACME - EQUIPAMENTOS, LDA", emailName: "Acme" };
const ctx = (company, campaign) => R.buildContext({ company, campaign });
const rendered = (t, company, campaign) => R.renderTemplate(t, ctx(company, campaign)).text;

// the three levels of the key
ok("1. the company's own wording wins", ctx({ ...base, sectorWording: "da refrigeração doméstica e comercial" }, { sector: "dos eletrodomésticos" }).company.sectorWording === "da refrigeração doméstica e comercial");
ok("2. no company wording: the campaign's sector text", ctx(base, { sector: "dos eletrodomésticos" }).company.sectorWording === "dos eletrodomésticos");
ok("2b. blank or null company wording counts as none", ctx({ ...base, sectorWording: "   " }, { sector: "dos eletrodomésticos" }).company.sectorWording === "dos eletrodomésticos" && ctx({ ...base, sectorWording: null }, { sector: "x" }).company.sectorWording === "x");
ok("3. neither: empty, so the template's own fallback applies", ctx(base, {}).company.sectorWording === "");
ok("the company text is trimmed", ctx({ ...base, sectorWording: "  do frio  " }, {}).company.sectorWording === "do frio");
ok("{{campaign.sector}} stays the campaign's text only (not changed by the company's wording)", ctx({ ...base, sectorWording: "do frio" }, { sector: "dos eletrodomésticos" }).campaign.sector === "dos eletrodomésticos" && ctx({ ...base, sectorWording: "do frio" }, {}).campaign.sector === "");

// rendered
ok("rendered: company wording", /ao analisar o setor da refrigeração doméstica e comercial\./.test(rendered(tpl, { ...base, sectorWording: "da refrigeração doméstica e comercial" }, { sector: "dos eletrodomésticos" })));
ok("rendered: campaign wording when the company has none", /ao analisar o setor dos eletrodomésticos\./.test(rendered(tpl, base, { sector: "dos eletrodomésticos" })));
ok("rendered: \"em que atua\" when neither exists", /ao analisar o setor em que atua\./.test(rendered(tpl, base, {})));
ok("an older template with {{campaign.sector}} still works and uses the campaign's text", /ao analisar o setor dos eletrodomésticos\./.test(rendered(tplOld, { ...base, sectorWording: "do frio" }, { sector: "dos eletrodomésticos" })));
console.log(fail ? `\n${fail} FAILED` : "\nALL PASSED");
process.exit(fail ? 1 : 0);
