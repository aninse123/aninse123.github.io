// Letters and call scripts (29 Oct 2026): the company figures fields — last-year revenue,
// EBITDA, margin, employees and revenue growth written in Portuguese — and (switch
// outreach.letterTools) a letter's own text: edit anything on one letter, back to the
// template with null. Synthetic data only.
const F = require("./fake_firebase.js");
const fns = require("../index.js");
const Feat = require("../features");
const R = require("../outreach/render.js");
const Fig = require("../outreach/company_figures.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const ADMIN = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const camp = async (data) => { try { return await fns.outreachCampaign({ ...ADMIN, data }); } catch (e) { return { err: e }; } };
function flags(state) { store.set("config/features", { flags: { "outreach.letterTools": { staging: state, production: state } } }); Feat._reset(); }

(async () => {
  // Number style: "2,3 milhões de euros", "412 mil euros"
  ok("millions: 2 340 000 → 2,3 milhões de euros; 12 400 000 → 12,4; exact millions drop the ,0", Fig.eurPt(2340000) === "2,3 milhões de euros" && Fig.eurPt(12400000) === "12,4 milhões de euros" && Fig.eurPt(3000000) === "3 milhões de euros");
  ok("one million is singular, also when thousands round up to it", Fig.eurPt(1000000) === "1 milhão de euros" && Fig.eurPt(999700) === "1 milhão de euros");
  ok("thousands: 412 300 → 412 mil euros; small amounts in euros; nothing for zero / negative / missing", Fig.eurPt(412300) === "412 mil euros" && Fig.eurPt(850) === "850 euros" && Fig.eurPt(0) === "" && Fig.eurPt(-5) === "" && Fig.eurPt(null) === "");
  ok("a ratio is a percentage with a comma", Fig.pctPt(0.1789) === "17,9%" && Fig.pctPt(0.03) === "3%" && Fig.pctPt(null) === "");

  const full = { lastAvailYear: "2025", computedRevenue: 2340000, computedEBITDA: 412300, computedEBITDAMargin: 0.1762, computedEmployees: 42, computedGrowthRecent: 0.052, computedGrowthSustained: 0.031, letterIntro: "  Fundada em 1982.  " };
  const f = Fig.figuresOf(full);
  ok("fields: year, revenue, EBITDA, margin, employees, intro (trimmed)", f.finYear === "2025" && f.revenue === "2,3 milhões de euros" && f.ebitda === "412 mil euros" && f.ebitdaMargin === "17,6%" && f.employees === "42" && f.letterIntro === "Fundada em 1982.");
  ok("financials sentence names the year and all figures", f.financialsSentence === "Estudámos as contas mais recentes da empresa: em 2025, registou um volume de negócios de 2,3 milhões de euros e um EBITDA de 412 mil euros (uma margem de 17,6%), com 42 colaboradores.");
  ok("growth sentence: both periods, with their years (Y1→Y3 = 2023→2025, Y1→Y5 = 2021→2025)", f.growthSentence === "Entre 2023 e 2025, o volume de negócios cresceu, em média, 5,2% ao ano, e 3,1% ao ano entre 2021 e 2025.");
  const g = Fig.figuresOf({ lastAvailYear: "2025", computedRevenue: 900000, computedEBITDA: -5, computedGrowthRecent: -0.02, computedGrowthSustained: 0.03 });
  ok("negative EBITDA is left out; a negative recent growth is dropped, the positive sustained one stays", g.ebitda === "" && g.financialsSentence === "Estudámos as contas mais recentes da empresa: em 2025, registou um volume de negócios de 900 mil euros." && g.growthSentence === "Entre 2021 e 2025, o volume de negócios cresceu, em média, 3% ao ano.");
  ok("no positive growth → empty sentence; no revenue → no financials sentence; one employee is singular", Fig.figuresOf({ lastAvailYear: "2025", computedRevenue: 5e5, computedGrowthRecent: -0.1 }).growthSentence === "" && Fig.figuresOf({ computedGrowthRecent: 0.1 }).financialsSentence === "" && /com 1 colaborador\./.test(Fig.figuresOf({ computedRevenue: 5e5, computedEmployees: 1 }).financialsSentence));
  ok("no year → \"no último ano\", and no growth sentence (its years would be a guess)", /no último ano, registou/.test(Fig.figuresOf({ computedRevenue: 5e5, computedGrowthRecent: 0.1 }).financialsSentence) && Fig.figuresOf({ computedRevenue: 5e5, computedGrowthRecent: 0.1 }).growthSentence === "");

  // In a template
  const ctx = R.buildContext({ company: { name: "AC CONSULTING, LDA", emailName: "AC Consulting", ...full } });
  const t = R.renderTemplate("{{company.letterIntro}} {{company.financialsSentence|}} {{company.growthSentence|}}", ctx);
  ok("the fields work in a template and nothing is reported missing", t.missing.length === 0 && /^Fundada em 1982\. Estudámos as contas/.test(t.text) && /Entre 2023 e 2025/.test(t.text));
  const empty = R.renderTemplate("A {{company.letterIntro}} B {{company.growthSentence|}}", R.buildContext({ company: { name: "X" } }));
  ok("an empty intro without a fallback is reported missing (a letter can't be printed without it); an empty sentence with a fallback is not", empty.missing.join() === "company.letterIntro" && /B $/.test(empty.text));

  // A letter's own text
  store.set("outreachTasks/L1", { channel: "letter", status: "open", companyId: "c1", templateId: "v04_L1_same" });
  store.set("outreachTasks/C1", { channel: "call", status: "open", companyId: "c1" });
  flags("off");
  ok("switch Off: a letter's own text is refused", (await camp({ action: "updateTask", taskId: "L1", letterText: { subject: "S", body: "B" } })).err?.details?.reason === "feature_off" || !!(await camp({ action: "updateTask", taskId: "L1", letterText: { subject: "S", body: "B" } })).err);
  ok("…and nothing was saved", store.get("outreachTasks/L1").letterText === undefined);
  flags("on");
  const r1 = await camp({ action: "updateTask", taskId: "L1", letterText: { subject: " Assunto novo ", body: " Texto editado. " } });
  const lt = store.get("outreachTasks/L1").letterText;
  ok("switch On: saved for this letter (trimmed), with who and when", !r1.err && lt?.subject === "Assunto novo" && lt?.body === "Texto editado." && lt?.editedBy === "andre.rocha@douropartners.pt" && lt?.editedAt);
  ok("an empty letter is refused", (await camp({ action: "updateTask", taskId: "L1", letterText: { subject: "S", body: "  " } })).err?.details?.reason === "empty_letter");
  ok("a too long letter is refused", (await camp({ action: "updateTask", taskId: "L1", letterText: { subject: "S", body: "x".repeat(20001) } })).err?.details?.reason === "letter_too_long");
  ok("only a letter task can have its own text", (await camp({ action: "updateTask", taskId: "C1", letterText: { subject: "S", body: "B" } })).err?.details?.reason === "not_a_letter");
  ok("null goes back to the template", !(await camp({ action: "updateTask", taskId: "L1", letterText: null })).err && store.get("outreachTasks/L1").letterText === undefined);
  ok("other task updates don't touch the letter text", (await camp({ action: "updateTask", taskId: "L1", letterText: { subject: "S", body: "B" } }), !(await camp({ action: "updateTask", taskId: "L1", notes: "n" })).err && store.get("outreachTasks/L1").letterText?.body === "B"));

  if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
  console.log("\nALL PASSED");
})();
