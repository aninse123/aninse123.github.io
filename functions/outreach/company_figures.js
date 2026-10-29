// Company figures for letters and call scripts (29 Oct 2026, switch outreach.letterTools
// for the Letters screen; the fields themselves are always available): the last-year
// numbers from the Search CRM, written in Portuguese so a letter can state them —
//   {{company.finYear}}              2025
//   {{company.revenue}}              "2,3 milhões de euros" · "412 mil euros"
//   {{company.ebitda}}               same style (empty when not positive)
//   {{company.ebitdaMargin}}         "17,9%"
//   {{company.employees}}            42
//   {{company.financialsSentence}}   the whole "Estudámos as contas mais recentes…" sentence
//   {{company.growthSentence}}       revenue growth, only the positive periods, else empty
//   {{company.letterIntro}}          the hand-researched opening line of a letter
// Revenue growth is revenue, not EBITDA: computedGrowthRecent = Y1→Y3 (two years of
// change, e.g. 2023→2025), computedGrowthSustained = Y1→Y5 (2021→2025); both are empty
// unless every year in the window had positive revenue. Twin of
// portal/company-figures.js (same text — a test checks they agree).

const num = (x) => (x === null || x === undefined || x === "" || Number.isNaN(Number(x)) ? null : Number(x));
const dec = (x, digits) => x.toFixed(digits).replace(".", ",").replace(/,0+$/, "");

// 2 300 000 → "2,3 milhões de euros" · 412 000 → "412 mil euros" · 850 → "850 euros".
function eurPt(value) {
  const v = num(value);
  if (v === null || v <= 0) return "";
  if (v >= 1e6) {
    const m = Math.round((v / 1e6) * 10) / 10;
    return m === 1 ? "1 milhão de euros" : `${dec(m, 1)} milhões de euros`;
  }
  if (v >= 1000) {
    const k = Math.round(v / 1000);
    return k >= 1000 ? "1 milhão de euros" : `${k} mil euros`;
  }
  return `${Math.round(v)} euros`;
}
// A ratio (0.179) → "17,9%".
function pctPt(ratio) {
  const r = num(ratio);
  if (r === null) return "";
  return `${dec(r * 100, 1)}%`;
}

function figuresOf(company = {}, now = new Date()) {
  const year = num(String(company.lastAvailYear || "").slice(0, 4));
  const revenue = num(company.computedRevenue), ebitda = num(company.computedEBITDA);
  const margin = num(company.computedEBITDAMargin), employees = num(company.computedEmployees);
  const out = {
    finYear: year ? String(year) : "",
    revenue: eurPt(revenue),
    ebitda: ebitda > 0 ? eurPt(ebitda) : "",
    ebitdaMargin: ebitda > 0 && margin > 0 && margin < 1 ? pctPt(margin) : "",
    employees: employees > 0 ? String(Math.round(employees)) : "",
    financialsSentence: "",
    growthSentence: "",
    letterIntro: String(company.letterIntro || "").trim(),
  };
  if (out.revenue) {
    // Accounts two or more years old (2024 or older in 2026) are named as such, with the year.
    const stale = year && year <= now.getFullYear() - 2;
    let s = stale
      ? `Estudámos as últimas contas disponíveis da empresa (${year}): registou um volume de negócios de ${out.revenue}`
      : `Estudámos as contas mais recentes da empresa: ${year ? `em ${year}` : "no último ano"}, registou um volume de negócios de ${out.revenue}`;
    if (out.ebitda) s += ` e um EBITDA de ${out.ebitda}${out.ebitdaMargin ? ` (uma margem de ${out.ebitdaMargin})` : ""}`;
    if (out.employees) s += `, com ${out.employees} ${out.employees === "1" ? "colaborador" : "colaboradores"}`;
    out.financialsSentence = s + ".";
  }
  const g3 = num(company.computedGrowthRecent), g5 = num(company.computedGrowthSustained);
  if (year && ((g3 !== null && g3 > 0) || (g5 !== null && g5 > 0))) {
    const rec = g3 !== null && g3 > 0, sus = g5 !== null && g5 > 0;
    if (rec && sus) out.growthSentence = `Entre ${year - 2} e ${year}, o volume de negócios cresceu, em média, ${pctPt(g3)} ao ano, e ${pctPt(g5)} ao ano entre ${year - 4} e ${year}.`;
    else if (rec) out.growthSentence = `Entre ${year - 2} e ${year}, o volume de negócios cresceu, em média, ${pctPt(g3)} ao ano.`;
    else out.growthSentence = `Entre ${year - 4} e ${year}, o volume de negócios cresceu, em média, ${pctPt(g5)} ao ano.`;
  }
  return out;
}

module.exports = { eurPt, pctPt, figuresOf };
