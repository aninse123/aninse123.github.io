// Claude connector — sign-in (OAuth 2.1): discovery, registration, PKCE, codes,
// refresh rotation, expiry, Disconnect, and one full MCP exchange over HTTP.
const X = require("./claude_fixtures");
const http = require("http");
const crypto = require("crypto");
const O = require("../claude/oauth");
const U = require("../claude/util");
const Conn = require("../claude/connect");
const S = require("../claude/server");
const { store, Timestamp } = X.F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const pkce = () => { const v = b64url(crypto.randomBytes(40)); return { verifier: v, challenge: b64url(crypto.createHash("sha256").update(v).digest()) }; };
const CB = "https://claude.ai/api/mcp/auth_callback";

async function signIn(email, { redirect = CB, client = null } = {}) {
  const reg = client || (await O.registerClient({ redirect_uris: [redirect], client_name: "Claude" })).body;
  const p = pkce();
  const a = await O.authorize({ response_type: "code", client_id: reg.client_id, redirect_uri: redirect, code_challenge: p.challenge, code_challenge_method: "S256", state: "st-1", resource: U.BASE }, { switchState: "on" });
  const r = new URL(a.redirect).searchParams.get("r");
  const allow = await Conn.forPage("allow", { r }, email);
  const code = new URL(allow.redirect).searchParams.get("code");
  return { reg, p, code, allow, r };
}

(async () => {
  X.seed();
  await X.buildIndex();

  // ── Discovery ──
  const prm = O.protectedResourceMetadata();
  ok("resource metadata names the exact connector address", prm.resource === "https://us-central1-douro-partners.cloudfunctions.net/claudeMcp");
  ok("resource metadata lists the sign-in server first", prm.authorization_servers[0] === U.BASE);
  const asm = O.authServerMetadata();
  ok("sign-in metadata: S256 PKCE advertised", JSON.stringify(asm.code_challenge_methods_supported) === '["S256"]');
  ok("sign-in metadata: public clients (none) and CIMD advertised", asm.token_endpoint_auth_methods_supported.includes("none") && asm.client_id_metadata_document_supported === true);
  ok("sign-in metadata: registration endpoint", asm.registration_endpoint === U.BASE + "/register");
  ok("401 header points at the resource metadata", /resource_metadata="https:\/\/us-central1-douro-partners\.cloudfunctions\.net\/claudeMcp\/\.well-known\/oauth-protected-resource"/.test(O.wwwAuthenticate()));

  // ── Return addresses ──
  ok("claude.ai callback allowed", O.isAllowedRedirect(CB));
  ok("claude.com callback allowed", O.isAllowedRedirect("https://claude.com/api/mcp/auth_callback"));
  ok("Claude Code localhost on any port allowed", O.isAllowedRedirect("http://localhost:3118/callback") && O.isAllowedRedirect("http://127.0.0.1:50000/callback"));
  ok("other sites refused", !O.isAllowedRedirect("https://evil.example/api/mcp/auth_callback") && !O.isAllowedRedirect("https://claude.ai.evil.example/api/mcp/auth_callback"));
  ok("localhost with another path refused", !O.isAllowedRedirect("http://localhost:3118/steal") && !O.isAllowedRedirect("http://localhost:3118/callback?x=1"));
  ok("https localhost / other loopback names refused", !O.isAllowedRedirect("https://localhost/callback") && !O.isAllowedRedirect("http://localhost.evil.example/callback"));
  ok("registered localhost matches any port (RFC 8252)", O.redirectMatches("http://localhost:4444/callback", ["http://localhost/callback"]));
  ok("registered localhost does not match 127.0.0.1", !O.redirectMatches("http://127.0.0.1:4444/callback", ["http://localhost/callback"]));

  // ── Registration ──
  const bad = await O.registerClient({ redirect_uris: ["https://evil.example/cb"] });
  ok("registration with a foreign return address refused", bad.status === 400 && bad.body.error === "invalid_redirect_uri");
  const mixed = await O.registerClient({ redirect_uris: [CB, "https://evil.example/cb"] });
  ok("registration with one foreign address among Claude's refused", mixed.status === 400);
  const conf = await O.registerClient({ redirect_uris: [CB], token_endpoint_auth_method: "client_secret_post" });
  ok("confidential clients refused (public only)", conf.status === 400);
  const good = await O.registerClient({ redirect_uris: [CB], client_name: "Claude" });
  ok("registration for claude.ai accepted", good.status === 201 && /^dcr_/.test(good.body.client_id) && store.has(`claudeClients/${good.body.client_id}`));

  // ── Client ID Metadata Documents: claude.ai / claude.com only, never fetched elsewhere ──
  const fetched = [];
  const fakeFetch = async (url) => { fetched.push(url); return { ok: true, text: async () => JSON.stringify({ client_id: url, client_name: "Claude Code", redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"] }) }; };
  const cc = await O.loadClient("https://claude.ai/oauth/claude-code-client-metadata", { fetchImpl: fakeFetch });
  ok("Claude Code's metadata document accepted", cc && cc.clientName === "Claude Code" && cc.redirectUris.length === 2);
  const evil = await O.loadClient("https://evil.example/client.json", { fetchImpl: fakeFetch });
  ok("a metadata document on another site is refused without fetching it", evil === null && !fetched.includes("https://evil.example/client.json"));
  ok("metadata documents on internal addresses never fetched", (await O.loadClient("https://169.254.169.254/x", { fetchImpl: fakeFetch })) === null && fetched.length === 1);
  const liar = await O.loadClient("https://claude.ai/oauth/other", { fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify({ client_id: "https://claude.ai/oauth/different", redirect_uris: [CB] }) }) });
  ok("a document whose client_id differs from its address is refused", liar === null);

  // ── Authorize ──
  const p0 = pkce();
  const base = { response_type: "code", client_id: good.body.client_id, redirect_uri: CB, code_challenge: p0.challenge, code_challenge_method: "S256", state: "abc", resource: U.BASE };
  const unknownClient = await O.authorize({ ...base, client_id: "dcr_unknownclient00" }, { switchState: "on" });
  ok("unknown client: an error page, no redirect", unknownClient.status === 400 && !unknownClient.redirect);
  const wrongCb = await O.authorize({ ...base, redirect_uri: "http://localhost:1/callback" }, { switchState: "on" });
  ok("return address not registered for the client: error page, no redirect", wrongCb.status === 400 && !wrongCb.redirect);
  const plain = await O.authorize({ ...base, code_challenge_method: "plain" }, { switchState: "on" });
  ok("PKCE plain refused (back to Claude with invalid_request)", /error=invalid_request/.test(plain.redirect) && /state=abc/.test(plain.redirect));
  const wrongRes = await O.authorize({ ...base, resource: "https://other.example/mcp" }, { switchState: "on" });
  ok("a token for another resource refused (invalid_target)", /error=invalid_target/.test(wrongRes.redirect));
  const off = await O.authorize(base, { switchState: "off" });
  ok("switch Off: back to Claude with access_denied", /error=access_denied/.test(off.redirect));
  const onA = await O.authorize(base, { switchState: "on" });
  ok("switch On: to the live sign-in page", onA.redirect.startsWith("https://douropartners.pt/portal/claude-connect.html?r="));
  const testA = await O.authorize(base, { switchState: "test" });
  ok("switch Test: to the staging sign-in page", testA.redirect.startsWith("https://staging--douro-partners.netlify.app/portal/claude-connect.html?r="));
  const rawReq = new URL(onA.redirect).searchParams.get("r");
  ok("the sign-in request is stored only as a hash", !store.has(`claudeTokens/${rawReq}`) && store.get(`claudeTokens/${U.sha256(rawReq)}`)?.type === "request");

  // ── The Allow step ──
  const d1 = await Conn.forPage("describe", { r: rawReq }, X.ANT);
  ok("describe: names the client, the return host and the person", d1.ok && d1.clientName === "Claude" && d1.redirectHost === "claude.ai" && d1.person.name === "António Carvalho");
  const dNo = await Conn.forPage("describe", { r: rawReq }, X.NOCLAUDE);
  ok("describe: a person without Claude access is told why", !dNo.ok && /Claude access/.test(dNo.message));
  let threw = null; try { await Conn.forPage("allow", { r: rawReq }, X.NOCLAUDE); } catch (e) { threw = e; }
  ok("allow refused for a person without Claude access", threw && threw.code === "permission-denied");
  threw = null; try { await Conn.forPage("allow", { r: rawReq }, X.NONDA); } catch (e) { threw = e; }
  ok("allow refused without the NDA tick", threw && /NDA/.test(threw.message));
  const allowed = await Conn.forPage("allow", { r: rawReq }, X.ANT);
  const au = new URL(allowed.redirect);
  ok("allow: back to claude.ai with a code, the state and the issuer", au.origin + au.pathname === CB && au.searchParams.get("code") && au.searchParams.get("state") === "abc" && au.searchParams.get("iss") === U.BASE);
  threw = null; try { await Conn.forPage("allow", { r: rawReq }, X.ANT); } catch (e) { threw = e; }
  ok("a sign-in request can be answered only once", threw && /already answered/.test(threw.message));
  const denyReq = new URL((await O.authorize({ ...base, state: "zz" }, { switchState: "on" })).redirect).searchParams.get("r");
  const denied = await Conn.forPage("deny", { r: denyReq }, X.ANT);
  ok("deny: back to Claude with access_denied and the state", /error=access_denied/.test(denied.redirect) && /state=zz/.test(denied.redirect));
  const oldReq = new URL((await O.authorize(base, { switchState: "on" })).redirect).searchParams.get("r");
  store.get(`claudeTokens/${U.sha256(oldReq)}`).expiresAt = Timestamp.fromMillis(Date.now() - 1000);
  threw = null; try { await Conn.forPage("allow", { r: oldReq }, X.ANT); } catch (e) { threw = e; }
  ok("an expired sign-in request (10 minutes) is refused", threw && /expired/.test(threw.message));

  // ── Token endpoint ──
  const code = au.searchParams.get("code");
  const tBad = await O.token({ grant_type: "authorization_code", code, client_id: good.body.client_id, redirect_uri: CB, code_verifier: pkce().verifier, resource: U.BASE });
  ok("wrong PKCE verifier refused (invalid_grant)", tBad.status === 400 && tBad.body.error === "invalid_grant");
  const tCb = await O.token({ grant_type: "authorization_code", code, client_id: good.body.client_id, redirect_uri: "http://localhost:9/callback", code_verifier: p0.verifier, resource: U.BASE });
  ok("a different return address refused", tCb.body.error === "invalid_grant");
  const tOk = await O.token({ grant_type: "authorization_code", code, client_id: good.body.client_id, redirect_uri: CB, code_verifier: p0.verifier, resource: U.BASE });
  ok("code + verifier → access and refresh tokens, 1 hour", tOk.status === 200 && tOk.body.access_token && tOk.body.refresh_token && tOk.body.expires_in === 3600 && tOk.body.token_type === "Bearer");
  ok("tokens are stored only as hashes", !store.has(`claudeTokens/${tOk.body.access_token}`) && store.get(`claudeTokens/${U.sha256(tOk.body.access_token)}`)?.type === "access");
  const chk = await O.checkAccessToken(tOk.body.access_token);
  ok("the access token is accepted", chk.email === X.ANT && !chk.error);
  const tReuse = await O.token({ grant_type: "authorization_code", code, client_id: good.body.client_id, redirect_uri: CB, code_verifier: p0.verifier, resource: U.BASE });
  ok("a code used twice is refused…", tReuse.body.error === "invalid_grant");
  ok("…and the connection it made is ended for safety", (await O.checkAccessToken(tOk.body.access_token)).error === "invalid_token");

  // Refresh rotation
  const s2 = await signIn(X.ANT);
  const t2 = (await O.token({ grant_type: "authorization_code", code: s2.code, client_id: s2.reg.client_id, redirect_uri: CB, code_verifier: s2.p.verifier, resource: U.BASE })).body;
  const r1 = await O.token({ grant_type: "refresh_token", refresh_token: t2.refresh_token, client_id: s2.reg.client_id });
  ok("refresh gives a new pair (rotated)", r1.status === 200 && r1.body.refresh_token !== t2.refresh_token && r1.body.access_token !== t2.access_token);
  const r1b = await O.token({ grant_type: "refresh_token", refresh_token: r1.body.refresh_token, client_id: "dcr_someoneelse0000" });
  ok("a refresh token belongs to its client", r1b.body.error === "invalid_grant");
  const retry = await O.token({ grant_type: "refresh_token", refresh_token: t2.refresh_token, client_id: s2.reg.client_id });
  ok("a renewal retried within 2 minutes (Claude's retry) gets a fresh pair, connection kept", retry.status === 200 && retry.body.access_token && !(await O.checkAccessToken(r1.body.access_token)).error);
  store.get(`claudeTokens/${U.sha256(t2.refresh_token)}`).usedAt = Timestamp.fromMillis(Date.now() - 3 * 60000);
  const reuse = await O.token({ grant_type: "refresh_token", refresh_token: t2.refresh_token, client_id: s2.reg.client_id });
  ok("reusing an old refresh token is refused (invalid_grant)…", reuse.status === 400 && reuse.body.error === "invalid_grant");
  const connId = (await U.db().collection("claudeConnections").where("email", "==", X.ANT).get()).docs.map((d) => d.data()).filter((c) => c.revokeReason === "refresh_reuse");
  ok("…and ends the connection (theft protection)", connId.length === 1);
  const r2 = await O.token({ grant_type: "refresh_token", refresh_token: r1.body.refresh_token, client_id: s2.reg.client_id });
  ok("…so the newest refresh token stops working too", r2.body.error === "invalid_grant");
  ok("unknown grant types refused", (await O.token({ grant_type: "client_credentials" })).body.error === "unsupported_grant_type");

  // Expiry after the sign-in days, Disconnect, revoke
  const s3 = await signIn(X.ANDRE);
  const t3 = (await O.token({ grant_type: "authorization_code", code: s3.code, client_id: s3.reg.client_id, redirect_uri: CB, code_verifier: s3.p.verifier, resource: U.BASE })).body;
  const c3 = (await O.checkAccessToken(t3.access_token)).connectionId;
  const conn3 = store.get(`claudeConnections/${c3}`);
  ok("a connection lasts 90 days after last use by default", Math.abs((conn3.expiresAt.toMillis() - conn3.lastUsedAt.toMillis()) - 90 * 86400000) < 5000);
  conn3.expiresAt = Timestamp.fromMillis(Date.now() - 1000);
  ok("past its sign-in days the access token stops working", (await O.checkAccessToken(t3.access_token)).error === "invalid_token");
  ok("…and refresh answers invalid_grant", (await O.token({ grant_type: "refresh_token", refresh_token: t3.refresh_token, client_id: s3.reg.client_id })).body.error === "invalid_grant");
  store.set("claudeSettings/main", { signInDays: 7 }); U._resetSettings();
  const s4 = await signIn(X.ANDRE);
  const t4 = (await O.token({ grant_type: "authorization_code", code: s4.code, client_id: s4.reg.client_id, redirect_uri: CB, code_verifier: s4.p.verifier, resource: U.BASE })).body;
  const c4 = (await O.checkAccessToken(t4.access_token)).connectionId;
  ok("sign-in days is a setting (7 days here)", Math.abs(store.get(`claudeConnections/${c4}`).expiresAt.toMillis() - Date.now() - 7 * 86400000) < 5000);
  store.delete("claudeSettings/main"); U._resetSettings();
  await O.revokeConnection(c4, "disconnect", X.ANDRE);
  ok("Disconnect ends the connection at once", (await O.checkAccessToken(t4.access_token)).error === "invalid_token");
  const s5 = await signIn(X.ANDRE);
  const t5 = (await O.token({ grant_type: "authorization_code", code: s5.code, client_id: s5.reg.client_id, redirect_uri: CB, code_verifier: s5.p.verifier, resource: U.BASE })).body;
  await O.revoke({ token: t5.refresh_token });
  ok("revocation endpoint ends the connection", (await O.checkAccessToken(t5.access_token)).error === "invalid_token");
  const sMaria = await signIn(X.MARIA);
  const tMaria = (await O.token({ grant_type: "authorization_code", code: sMaria.code, client_id: sMaria.reg.client_id, redirect_uri: CB, code_verifier: sMaria.p.verifier, resource: U.BASE })).body;
  await Conn.setAccess({ email: X.MARIA, on: false }, X.ANDRE);
  ok("unticking Claude access ends that person's connections", (await O.checkAccessToken(tMaria.access_token)).error === "invalid_token");
  await Conn.setAccess({ email: X.MARIA, on: true }, X.ANDRE);

  // ── Over HTTP: form-encoded token request and a full MCP exchange ──
  const server = http.createServer((req, res) => S.handle(req, res));
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const h0 = await fetch(url + "/", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
  ok("HTTP: no token → 401 with the resource metadata pointer", h0.status === 401 && /resource_metadata=/.test(h0.headers.get("www-authenticate") || ""));
  const hBad = await fetch(url + "/", { method: "POST", headers: { authorization: "Bearer nope", "content-type": "application/json" }, body: "{}" });
  ok("HTTP: a bad token → 401 invalid_token", hBad.status === 401 && /invalid_token/.test(hBad.headers.get("www-authenticate") || ""));
  const wk = await (await fetch(url + "/.well-known/oauth-protected-resource")).json();
  ok("HTTP: resource metadata served under the function", wk.resource === U.BASE);
  const oidc = await (await fetch(url + "/claudeMcp/.well-known/openid-configuration")).json();
  ok("HTTP: sign-in metadata served at …/claudeMcp/.well-known/openid-configuration", oidc.issuer === U.BASE);
  // Claude Code checks discovery documents with the MCP SDK's own schemas (13 Nov: the OpenID one failed without these fields).
  const SA = require("@modelcontextprotocol/sdk/shared/auth.js");
  ok("HTTP: the openid-configuration passes the MCP SDK's OpenID check (Claude Code)", SA.OpenIdProviderDiscoveryMetadataSchema.safeParse(oidc).success);
  ok("HTTP: the oauth-authorization-server document passes the SDK's OAuth check", SA.OAuthMetadataSchema.safeParse(await (await fetch(url + "/.well-known/oauth-authorization-server")).json()).success);
  ok("HTTP: the resource metadata passes the SDK's check", SA.OAuthProtectedResourceMetadataSchema.safeParse(wk).success);
  ok("HTTP: the key list exists and is empty (no ID tokens are issued)", JSON.stringify(await (await fetch(url + "/jwks")).json()) === '{"keys":[]}');
  const regH = await fetch(url + "/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://localhost/callback"], client_name: "Claude Code" }) });
  const regB = await regH.json();
  ok("HTTP: registration (JSON) for Claude Code's loopback", regH.status === 201 && regB.client_id);
  const pH = pkce();
  const authH = await fetch(url + `/authorize?${new URLSearchParams({ response_type: "code", client_id: regB.client_id, redirect_uri: "http://localhost:53682/callback", code_challenge: pH.challenge, code_challenge_method: "S256", state: "s", resource: U.BASE })}`, { redirect: "manual" });
  ok("HTTP: authorize redirects to the sign-in page", authH.status === 302 && /claude-connect\.html\?r=/.test(authH.headers.get("location")));
  const rH = new URL(authH.headers.get("location")).searchParams.get("r");
  const dH = await Conn.forPage("describe", { r: rH }, X.MARIA);
  ok("Claude Code sign-in is flagged as a localhost return (extra warning)", dH.loopback === true && dH.surface === "Claude Code");
  const codeH = new URL((await Conn.forPage("allow", { r: rH }, X.MARIA)).redirect).searchParams.get("code");
  const tokH = await fetch(url + "/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: codeH, client_id: regB.client_id, redirect_uri: "http://localhost:53682/callback", code_verifier: pH.verifier, resource: U.BASE }).toString() });
  const tokB = await tokH.json();
  ok("HTTP: form-encoded token exchange", tokH.status === 200 && tokB.access_token && tokH.headers.get("cache-control") === "no-store");
  const rpc = async (body) => {
    const r = await fetch(url + "/", { method: "POST", headers: { authorization: "Bearer " + tokB.access_token, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
  ok("MCP: initialize answers with the server name and instructions", init.status === 200 && init.body?.result?.serverInfo?.name === "douro-partners" && init.body.result.serverInfo.title === "Douro Partners" && /untrusted content/.test(init.body.result.instructions || ""));
  const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const names = (list.body?.result?.tools || []).map((t) => t.name);
  ok("MCP: an intern's tool list has Search, Outreach, files and Network", ["find_companies", "get_company", "list_campaigns", "read_file", "find_network"].every((n) => names.includes(n)));
  ok("MCP: an intern's tool list has no stats, investors, budget, portal documents or query", ["pipeline_stats", "find_investors", "budget_summary", "list_portal_documents", "query"].every((n) => !names.includes(n)));
  ok("MCP: every tool is marked read-only", (list.body?.result?.tools || []).every((t) => t.annotations?.readOnlyHint === true));
  const callR = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "find_companies", arguments: { text: "metais", fields: ["name", "district"] } } });
  const callT = JSON.parse(callR.body?.result?.content?.[0]?.text || "{}");
  ok("MCP: a tool call returns rows", callT.total === 1 && callT.rows[0].name === "METAIS DE BRAGA SA");
  const callNo = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "budget_summary", arguments: {} } });
  ok("MCP: calling a tool outside the role is refused", callNo.body?.error || callNo.body?.result?.isError === true);
  const getR = await fetch(url + "/", { headers: { authorization: "Bearer " + tokB.access_token } });
  ok("MCP: GET (no event stream) answers 405", getR.status === 405);
  X.setSwitch("off");
  const offList = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/list", params: {} });
  const offNames = (offList.body?.result?.tools || []).map((t) => t.name);
  ok("switch Off: only whoami is offered…", offNames.length === 1 && offNames[0] === "whoami");
  const offCall = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "whoami", arguments: {} } });
  ok("…and it explains the connector is switched off", offCall.body?.result?.isError === true && /switched off/.test(offCall.body.result.content[0].text));
  X.setSwitch("test");
  const testList = await rpc({ jsonrpc: "2.0", id: 7, method: "tools/list", params: {} });
  ok("switch Test: a non-tester gets nothing but the explanation", (testList.body?.result?.tools || []).length === 1);
  X.setSwitch("test", [X.MARIA]);
  const testList2 = await rpc({ jsonrpc: "2.0", id: 8, method: "tools/list", params: {} });
  ok("switch Test: a listed tester gets their tools", (testList2.body?.result?.tools || []).length > 5);
  X.setSwitch("on");
  server.close();

  console.log(fail ? `\n${fail} FAILED` : "\nall Claude sign-in tests passed");
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
