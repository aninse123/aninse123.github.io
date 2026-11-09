// Sector wording per company (9 Nov 2026, switch outreach.sectorWording): a company with its own
// wording uses it for {{campaign.sector}} and {{company.sectorWording}}; without one, the campaign's
// wording is used as before. Synthetic data only.
const R = require("../outreach/render.js");
let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

const tpl = "Chegámos à {{company.shortName}} ao analisar o setor {{campaign.sector|em que atua}}.";
const base = { name: "ACME - EQUIPAMENTOS, LDA", emailName: "Acme" };
const ctx = (company, campaign) => R.buildContext({ company, campaign });
const rendered = (company, campaign) => { const r = R.renderTemplate(tpl, ctx(company, campaign)); return typeof r === "string" ? r : (r.text ?? r.body ?? ""); };

ok("campaign wording only: unchanged", ctx(base, { sector: "dos eletrodomésticos" }).campaign.sector === "dos eletrodomésticos");
ok("company wording replaces the campaign's one", ctx({ ...base, sectorWording: "da refrigeração doméstica e comercial" }, { sector: "dos eletrodomésticos" }).campaign.sector === "da refrigeração doméstica e comercial");
ok("company wording alone (campaign has none) is used", ctx({ ...base, sectorWording: "do aquecimento de águas" }, {}).campaign.sector === "do aquecimento de águas");
ok("empty or blank company wording falls back to the campaign", ctx({ ...base, sectorWording: "   " }, { sector: "dos eletrodomésticos" }).campaign.sector === "dos eletrodomésticos" && ctx({ ...base, sectorWording: null }, { sector: "x" }).campaign.sector === "x");
ok("{{company.sectorWording}} holds the trimmed company text", ctx({ ...base, sectorWording: "  do frio  " }, {}).company.sectorWording === "do frio" && ctx(base, {}).company.sectorWording === "");
ok("neither: the template's own fallback text applies (empty value)", ctx(base, {}).campaign.sector === "");
{
  ok("rendered: the company's wording shows in the sentence", /ao analisar o setor da refrigeração doméstica e comercial\./.test(rendered({ ...base, sectorWording: "da refrigeração doméstica e comercial" }, { sector: "dos eletrodomésticos" })));
  ok("rendered: without it, the campaign's", /ao analisar o setor dos eletrodomésticos\./.test(rendered(base, { sector: "dos eletrodomésticos" })));
  ok("rendered: with neither, \"em que atua\"", /ao analisar o setor em que atua\./.test(rendered(base, {})));
}
console.log(fail ? `\n${fail} FAILED` : "\nALL PASSED");
process.exit(fail ? 1 : 0);
