// Claude connector — who may use it and which tools: team record, dates, NDA,
// Claude access tick, the switch, and every tool refusing the wrong permission.
const X = require("./claude_fixtures");
const T = require("../claude/tools");
const G = require("../claude/gate");
const P = require("../access/perms");
const { store, Timestamp } = X.F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const names = async (email) => T.allowedTools(await G.personFor(email)).map((t) => t.name).sort();

(async () => {
  X.seed();
  await X.buildIndex();

  // ── The person ──
  ok("Admin (by email) may connect", (await G.personFor(X.ANDRE)).ok);
  ok("Partner with NDA and Claude access may connect", (await G.personFor(X.ANT)).ok);
  const sus = await G.personFor(X.SUS);
  ok("suspended person refused", !sus.ok && sus.reason === "inactive");
  store.get(`team/${X.RITA}`).endsAt = Timestamp.fromMillis(Date.now() - 1000);
  ok("person past their end date refused", (await G.personFor(X.RITA)).reason === "inactive");
  store.get(`team/${X.RITA}`).endsAt = null;
  store.get(`team/${X.RITA}`).startsAt = Timestamp.fromMillis(Date.now() + 86400000);
  ok("person before their start date refused", (await G.personFor(X.RITA)).reason === "inactive");
  store.get(`team/${X.RITA}`).startsAt = null;
  ok("person without the NDA tick refused", (await G.personFor(X.NONDA)).reason === "nda");
  ok("person without the Claude access tick refused (off by default)", (await G.personFor(X.NOCLAUDE)).reason === "no_claude_access");
  store.set("team/new@douropartners.pt", { email: "new@douropartners.pt", name: "New", key: "new", roleId: "analyst", status: "active", ndaSigned: true });
  ok("a team record without the tick is off (default)", (await G.personFor("new@douropartners.pt")).reason === "no_claude_access");
  ok("someone not on the team refused", (await G.personFor("stranger@example.com")).reason === "not_on_team");
  store.get(`team/${X.ANDRE}`).claudeAccess = false;
  ok("even the Admin needs the tick", (await G.personFor(X.ANDRE)).reason === "no_claude_access");
  store.get(`team/${X.ANDRE}`).claudeAccess = true;

  // ── The switch ──
  X.setSwitch("off");
  ok("switch Off: the Admin is refused too", (await G.personFor(X.ANDRE)).reason === "switch_off");
  X.setSwitch("test");
  ok("switch Test: the Admin is in", (await G.personFor(X.ANDRE)).ok);
  ok("switch Test: a partner who isn't a tester is out", (await G.personFor(X.ANT)).reason === "not_tester");
  X.setSwitch("test", [X.ANT]);
  ok("switch Test: a listed tester is in", (await G.personFor(X.ANT)).ok);
  X.setSwitch("on");
  store.delete("config/features"); require("../features")._reset();
  ok("no switch stored: Off in production (the default) refuses", (await G.personFor(X.ANDRE)).reason === "switch_off");
  X.setSwitch("on");

  // ── Tools by role (D3: the role as it is now) ──
  const admin = await names(X.ANDRE), partner = await names(X.ANT), analyst = await names(X.RITA), intern = await names(X.MARIA);
  ok("Admin gets every tool", admin.length === T.ALL.length);
  ok("Partner gets every tool, query and budget included", partner.length === T.ALL.length);
  ok("Analyst: Search with stats, Outreach, files, Network, investors (role has icrm.view, B11)", ["pipeline_stats", "find_companies", "list_campaigns", "read_file", "find_network", "find_investors"].every((n) => analyst.includes(n)));
  ok("Analyst: no budget, portal documents or query", ["budget_summary", "find_budget_items", "list_portal_documents", "query"].every((n) => !analyst.includes(n)));
  ok("Intern: Search, Outreach, files, Network", ["find_companies", "get_company", "get_conversations", "read_file", "find_network"].every((n) => intern.includes(n)));
  ok("Intern: no stats, investors, budget, portal or query", ["pipeline_stats", "find_investors", "get_investor", "budget_summary", "list_portal_documents", "query"].every((n) => !intern.includes(n)));

  // Every tool refuses a person without its permission (called directly, not only hidden).
  const needs = { find_companies: "search.view", count_companies: "search.view", get_company: "search.view", related_companies: "search.view", find_people: "search.view", list_activities: "search.view", pipeline_stats: "search.stats", list_campaigns: "out.view", campaign_results: "out.view", get_conversations: "out.view", get_message: "out.view", list_tasks: "out.view", find_network: "net.view", find_investors: "icrm.view", get_investor: "icrm.view", list_portal_documents: "portal.admin", budget_summary: "budget.view", find_budget_items: "budget.view" };
  store.set("roles/empty", { name: "Empty", perms: [] });
  store.set("team/empty@douropartners.pt", { email: "empty@douropartners.pt", name: "Empty", key: "empty", roleId: "empty", status: "active", ndaSigned: true, claudeAccess: true });
  for (const [tool, perm] of Object.entries(needs)) {
    const w = await G.personFor("empty@douropartners.pt");
    const r = await T.callTool(w, tool, {});
    // A role with only that permission may call it.
    store.set("roles/one", { name: "One", perms: [perm] });
    store.set("team/one@douropartners.pt", { email: "one@douropartners.pt", name: "One", key: "one", roleId: "one", status: "active", ndaSigned: true, claudeAccess: true });
    const w1 = await G.personFor("one@douropartners.pt");
    const allowed = T.mayUse(w1, T.BY_NAME.get(tool));
    ok(`${tool}: refused without ${perm}, allowed with it`, r.isError && /role doesn't include/.test(r.result.error) && allowed);
  }
  const wEmpty = await G.personFor("empty@douropartners.pt");
  ok("files: refused without any view permission", (await T.callTool(wEmpty, "read_file", { fileId: "file:f1" })).isError && (await T.callTool(wEmpty, "list_files", { companyId: "c1" })).isError);
  ok("whoami: always available to a connected person", !(await T.callTool(wEmpty, "whoami", {})).isError);
  const wRita = await G.personFor(X.RITA);
  ok("query: refused to an analyst", (await T.callTool(wRita, "query", { collection: "companies" })).isError);
  const wNet = await G.personFor(X.MARIA);
  const pdoc = await T.callTool(wNet, "read_file", { fileId: "doc:d1" });
  ok("read_file: investor portal documents refused without portal.admin", pdoc.isError || /investor portal permission/.test(JSON.stringify(pdoc.result)));
  store.set("roles/outonly", { name: "Out", perms: ["out.view"] });
  store.set("team/out@douropartners.pt", { email: "out@douropartners.pt", name: "Out", key: "out", roleId: "outonly", status: "active", ndaSigned: true, claudeAccess: true });
  const wOut = await G.personFor("out@douropartners.pt");
  ok("read_file: email attachments allowed with out.view", !(await T.callTool(wOut, "read_file", { fileId: "att:i1:0" })).isError);
  store.set("roles/searchonly", { name: "S", perms: ["search.view"] });
  store.set("team/s@douropartners.pt", { email: "s@douropartners.pt", name: "S", key: "s", roleId: "searchonly", status: "active", ndaSigned: true, claudeAccess: true });
  const wS = await G.personFor("s@douropartners.pt");
  ok("read_file: email attachments refused with search.view only", JSON.stringify((await T.callTool(wS, "read_file", { fileId: "att:i1:0" })).result).includes("Outreach view permission"));

  // A role change applies on the next call.
  ok("before: the analyst has pipeline_stats", (await names(X.RITA)).includes("pipeline_stats"));
  store.set("roles/analyst", { name: "Analyst", perms: P.DEFAULT_ROLES.analyst.perms.filter((p) => p !== "search.stats") });
  ok("after removing search.stats from the role: gone on the next call", !(await names(X.RITA)).includes("pipeline_stats"));
  store.get(`team/${X.RITA}`).removedPerms = ["net.view"];
  ok("a person's removed permission applies (no find_network)", !(await names(X.RITA)).includes("find_network"));
  store.get(`team/${X.RITA}`).extraPerms = ["budget.view"];
  ok("a person's extra permission applies (budget tools)", (await names(X.RITA)).includes("budget_summary"));
  store.get(`team/${X.RITA}`).extraPerms = ["usage.view"];
  ok("Admin-only permissions never reach anyone else", (await G.personFor(X.RITA)).perms.includes("usage.view") === false);

  // Refusals are logged.
  const before = [...store.keys()].filter((k) => k.startsWith("claudeAudit/")).length;
  await T.callTool(await G.personFor(X.NOCLAUDE), "find_companies", {});
  const audits = [...store.entries()].filter(([k]) => k.startsWith("claudeAudit/")).map(([, v]) => v);
  ok("a refused call is in the log with its reason", audits.length === before + 1 && audits.some((a) => a.outcome === "denied" && a.reason === "no_claude_access"));

  console.log(fail ? `\n${fail} FAILED` : "\nall Claude access tests passed");
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
