// Claude connector — the never-returned list: bank details, keys and settings,
// team and access records, logs, usage, suppression. Every tool and `query` on
// every collection name is called as the Admin; no planted value may come back.
const X = require("./claude_fixtures");
const T = require("../claude/tools");
const R = require("../claude/redact");
const { store } = X.F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const PLANTED = [X.IBAN, "0002 0123 1234 5678 9015", "4111 1111 1111 1111", "4111111111111111", X.SENDKEY, "blocked@example.com", "CGDIPTPL", "BCOMPTPL", "0123456789", "SECRET-DOWNLOAD-TOKEN", "SECRET-RECEIPT", "outreach/t1/i1", "outreach/files/f1", "documents/1700000000"];
const leaks = (text) => PLANTED.filter((p) => text.includes(p));

(async () => {
  X.seed();
  await X.buildIndex();
  const calls = [
    ["whoami", {}], ["find_companies", {}], ["find_companies", { text: "metal", fields: require("../claude/tools/search").ROW_FIELDS }], ["count_companies", { groupBy: ["district"] }],
    ["get_company", { id: "c1" }], ["related_companies", { companyId: "c1" }], ["find_people", { name: "joao silva" }], ["find_people", { email: "joao@metalnorte.pt" }],
    ["list_activities", { companyId: "c1" }], ["list_activities", {}], ["pipeline_stats", {}], ["list_campaigns", {}], ["campaign_results", { campaignId: "k1" }],
    ["get_conversations", { companyId: "c1", withMessages: true }], ["get_message", { messageId: "i1" }], ["get_message", { messageId: "o1" }], ["list_tasks", {}],
    ["list_files", { companyId: "c1" }], ["list_files", { messageId: "i1" }], ["list_files", { scope: "portal" }],
    ["read_file", { fileId: "att:i1:0" }], ["read_file", { fileId: "file:f1" }], ["read_file", { fileId: "file:f2" }], ["read_file", { fileId: "file:f3" }], ["read_file", { fileId: "file:f4" }], ["read_file", { fileId: "doc:d1" }],
    ["find_network", { withActivities: true }], ["find_investors", {}], ["get_investor", { id: "i1" }], ["list_portal_documents", {}], ["budget_summary", { groupBy: "category" }], ["find_budget_items", {}],
  ];
  let all = "";
  for (const [name, args] of calls) {
    const r = await X.tool(X.ANDRE, name, args);
    all += r.text;
    const l = leaks(r.text);
    ok(`${name} ${JSON.stringify(args).slice(0, 60)}: nothing from the never-returned list${l.length ? " — LEAK: " + l.join(", ") : ""}`, !l.length && !r.result?.error?.startsWith?.("Something went wrong"));
  }
  ok("the IBAN inside a company note, an email, a PDF and a CSV is replaced", (all.match(/\[bank detail removed\]/g) || []).length >= 4);

  // `query` on every collection name, the closed ones and made-up ones included.
  const tryColls = [...Object.keys(R.QUERY_COLLECTIONS), ...R.NEVER_COLLECTIONS, "budgetItems", "documents", "team", "../budgetAccounts", "budgetAccounts/a1", "searchCompanies", "Team", "claudeTokens", "usageAnything", "outreachSuppression"];
  for (const c of tryColls) {
    const r = await X.tool(X.ANDRE, "query", { collection: c, pageSize: 100 });
    const l = leaks(r.text);
    const shouldOpen = Object.prototype.hasOwnProperty.call(R.QUERY_COLLECTIONS, c);
    ok(`query "${c}": ${shouldOpen ? "allowed fields only" : "refused"}${l.length ? " — LEAK: " + l.join(", ") : ""}`, !l.length && (shouldOpen ? !r.isError : r.isError));
  }
  const fieldTry = await X.tool(X.ANDRE, "query", { collection: "people", select: ["iban", "name"] });
  ok("query: asking for a field outside the list is refused", fieldTry.isError && /can't be used/.test(fieldTry.result.error));
  const whereTry = await X.tool(X.ANDRE, "query", { collection: "investors", where: [["iban", "!=", null]] });
  ok("query: filtering on a field outside the list is refused", whereTry.isError);
  const msgTry = await X.tool(X.ANDRE, "query", { collection: "messages", select: ["html", "text"] });
  ok("query: email bodies are not reachable through query (only get_message, labelled)", msgTry.isError);

  // The scrub itself.
  ok("scrub: IBAN with spaces", R.scrubText(`pay ${X.IBAN_SPACED} now`) === "pay [bank detail removed] now");
  ok("scrub: card numbers (Luhn) removed, phone numbers and NIFs kept", R.scrubText("card 4111 1111 1111 1111, tel +351 912 345 678, NIF 508123456") === "card [bank detail removed], tel +351 912 345 678, NIF 508123456");
  ok("scrub: keys named iban / downloadURL / storagePath dropped wherever they are", JSON.stringify(R.scrub({ a: { iban: "x", deep: [{ downloadURL: "y", storagePath: "z", ok: 1 }] } })) === '{"a":{"deep":[{"ok":1}]}}');
  ok("the closed collections are not even in the allowlist", R.NEVER_COLLECTIONS.every((c) => !R.FIELDS[c]));

  // Nothing written about the people who asked leaves in any answer.
  ok("no team record, access log or usage counter in any answer", !/accessAudit|"byUser"|ndaSigned|claudeAccess|extraPerms/.test(all));

  console.log(fail ? `\n${fail} FAILED` : "\nall Claude never-returned tests passed");
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
