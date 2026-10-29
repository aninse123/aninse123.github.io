// Company figures for letters and call scripts (29 Oct 2026): the last-year numbers from
// the Search CRM, written in Portuguese so a letter can state them — {{company.finYear}},
// {{company.revenue}} ("2,3 milhões de euros"), {{company.ebitda}}, {{company.ebitdaMargin}},
// {{company.employees}}, {{company.financialsSentence}}, {{company.growthSentence}} (revenue
// growth, only positive periods) and {{company.letterIntro}}. Twin of
// functions/outreach/company_figures.js (same text — a test checks they agree).

const num = (x) => (x === null || x === undefined || x === '' || Number.isNaN(Number(x)) ? null : Number(x));
const dec = (x, digits) => x.toFixed(digits).replace('.', ',').replace(/,0+$/, '');

export function eurPt(value) {
  const v = num(value);
  if (v === null || v <= 0) return '';
  if (v >= 1e6) {
    const m = Math.round((v / 1e6) * 10) / 10;
    return m === 1 ? '1 milhão de euros' : `${dec(m, 1)} milhões de euros`;
  }
  if (v >= 1000) {
    const k = Math.round(v / 1000);
    return k >= 1000 ? '1 milhão de euros' : `${k} mil euros`;
  }
  return `${Math.round(v)} euros`;
}
export function pctPt(ratio) {
  const r = num(ratio);
  if (r === null) return '';
  return `${dec(r * 100, 1)}%`;
}

export function figuresOf(company = {}) {
  const year = num(String(company.lastAvailYear || '').slice(0, 4));
  const revenue = num(company.computedRevenue), ebitda = num(company.computedEBITDA);
  const margin = num(company.computedEBITDAMargin), employees = num(company.computedEmployees);
  const out = {
    finYear: year ? String(year) : '',
    revenue: eurPt(revenue),
    ebitda: ebitda > 0 ? eurPt(ebitda) : '',
    ebitdaMargin: ebitda > 0 && margin > 0 && margin < 1 ? pctPt(margin) : '',
    employees: employees > 0 ? String(Math.round(employees)) : '',
    financialsSentence: '',
    growthSentence: '',
    letterIntro: String(company.letterIntro || '').trim(),
  };
  if (out.revenue) {
    let s = `Estudámos as contas mais recentes da empresa: ${year ? `em ${year}` : 'no último ano'}, registou um volume de negócios de ${out.revenue}`;
    if (out.ebitda) s += ` e um EBITDA de ${out.ebitda}${out.ebitdaMargin ? ` (uma margem de ${out.ebitdaMargin})` : ''}`;
    if (out.employees) s += `, com ${out.employees} ${out.employees === '1' ? 'colaborador' : 'colaboradores'}`;
    out.financialsSentence = s + '.';
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
